/**
 * Figentra Flow file contract:
 * Purpose: `figentra-flow gate run [--ref <branch>] [--box <ssh host>] [-- <runner flags>]`, the caller's side of the
 *   gate: check that the head is committed and pushed, clone exactly that commit into a temporary folder with the
 *   box poster beside it, and run the repository's check command through the runner port (`runner` in the
 *   configuration, or `--box <host>` for one run). The box posts `figentra-flow/gate`; this side only passes its exit
 *   code through.
 * Boundary: runs no check on the caller's machine (FR-9). Refuses a dirty tree, a detached head without `--ref`, a
 *   head that is not the remote branch tip, and a missing runner, before any box is claimed; a runner program that
 *   is not installed is refused after. Removes its temporary
 *   folder when the run ends.
 * Runtime: node
 * Governing contract: Stackra ADR 0503 (decision 4), ADR 0484 (the testbed); STA-1729 phase 2.
 * Secrets: none here. The box reads the gate App's key through `infisical run` (`/ci/gate`); this side never sees it.
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runnerFor } from "../adapters/runner/index.mjs";
import { secretsPort } from "../adapters/secrets.mjs";
import { artifactProblems } from "../lib/artifacts.mjs";
import { loadConfig } from "../lib/config.mjs";
import { defaultBranch, git, isClean, remoteTip } from "../lib/git.mjs";
import {
  ENV_PREFIX,
  GATE_DIR,
  GATE_MARKER,
  NAME,
  PACKAGE,
  STATUS_CONTEXT,
} from "../lib/product.mjs";

/** The poster, copied into every job as `<GATE_DIR>/post.mjs`. */
const POSTER = new URL("../lib/gate-post.mjs", import.meta.url);

/**
 * The repository's check command: the configuration's `gate.check`, else `pnpm verify`, followed by the spec gate
 * where this package is installed.
 * @param {string} dir
 */
export function checkCommand(dir) {
  /** @type {any} */
  let pkg = {};
  try {
    pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  } catch {
    // no package.json: the default command, which will fail loudly on the box
  }
  const check = loadConfig(dir).config.gate?.check ?? "pnpm verify";
  const installed = Boolean(pkg.devDependencies?.[PACKAGE] ?? pkg.dependencies?.[PACKAGE]);
  return `pnpm install --frozen-lockfile && ${check}${installed ? ` && pnpm exec ${NAME} gate ci` : ""}`;
}

/**
 * The POSIX command the box runs: the check, its output and exit code kept for the poster, then the poster, wrapped
 * by the secrets port for the `gate` scope.
 * @param {string} check
 * @param {{ wrap?: (command: string) => string }} [options]
 */
export function boxCommand(check, { wrap = (command) => command } = {}) {
  return `{ ${check}; echo $? > ${GATE_DIR}/exit; } 2>&1 | tee ${GATE_DIR}/log.txt; ${wrap(`node ${GATE_DIR}/post.mjs`)}`;
}

/**
 * The GitHub `owner/name` of `origin`, or undefined.
 * @param {string} url
 */
export const slugOf = (url) => url.match(/github\.com[:/]+([^/]+\/[^/]+?)(?:\.git)?\/?$/)?.[1];

/**
 * Runs the gate for the head of `cwd`.
 * @param {{ cwd: string, ref?: string, box?: string, flags?: string[],
 *           runner?: import("../adapters/runner/index.mjs").Runner,
 *           tip?: (root: string, branch: string) => string | undefined, now?: () => Date }} options
 * @returns {Promise<{ code: number, problem?: string, sha?: string }>}
 */
export async function gateRun(options) {
  const { cwd, box, flags = [], tip = remoteTip, now = () => new Date() } = options;
  const top = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (!top.ok) return { code: 2, problem: `${cwd} is not in a git repository` };
  const root = top.out;
  if (!isClean(root))
    return {
      code: 2,
      problem: "the tree has uncommitted or untracked changes; commit and push first",
    };
  const loaded = loadConfig(root);
  if (loaded.errors.length) return { code: 2, problem: loaded.errors.join("; ") };
  const branch = options.ref ?? git(root, ["branch", "--show-current"]).out;
  if (!branch) return { code: 2, problem: "the head is detached; pass --ref <branch>" };
  const sha = git(root, ["rev-parse", "HEAD"]).out;
  const pushed = tip(root, branch);
  if (pushed !== sha)
    return {
      code: 2,
      problem: `the head ${sha.slice(0, 12)} is not origin/${branch}'s tip (${pushed?.slice(0, 12) ?? "none"}); push it first`,
    };
  const url = git(root, ["remote", "get-url", "origin"]).out;
  const repository = slugOf(url);
  if (!repository) return { code: 2, problem: `origin (${url}) is not a GitHub repository` };
  const base = defaultBranch(root);
  for (const w of loaded.warnings) console.error(w);
  const secrets = secretsPort(loaded.config.secrets);
  const found = options.runner
    ? { runner: options.runner }
    : runnerFor(root, loaded.config, { box });
  if (!found.runner) return { code: 2, problem: found.problem };
  const runner = found.runner;
  // AC-043: no build or tool output and no oversized file reaches a box, or main.
  const artifacts = artifactProblems(root, `origin/${base}`, sha, loaded.config.artifacts);
  if (artifacts.length)
    return { code: 2, problem: `the change carries artifacts:\n  ${artifacts.join("\n  ")}` };

  const dir = mkdtempSync(join(tmpdir(), `${NAME}-gate-`));
  try {
    for (const args of [
      ["clone", "-q", "--no-hardlinks", "--no-checkout", root, dir],
      ["-C", dir, "fetch", "-q", root, `+refs/remotes/origin/${base}:refs/remotes/origin/${base}`],
      ["-C", dir, "checkout", "-q", "--detach", sha],
      ["-C", dir, "remote", "set-url", "origin", url],
    ]) {
      const r = git(root, args);
      if (!r.ok) return { code: 2, problem: `git ${args.join(" ")} failed: ${r.err}` };
    }
    mkdirSync(join(dir, GATE_DIR));
    copyFileSync(POSTER, join(dir, GATE_DIR, "post.mjs"));
    const job = {
      sha,
      branch,
      repository,
      startedAt: now().toISOString(),
      context: STATUS_CONTEXT,
      marker: GATE_MARKER,
      envPrefix: ENV_PREFIX,
    };
    writeFileSync(join(dir, GATE_DIR, "job.json"), `${JSON.stringify(job, null, 2)}\n`);
    // The poster runs under the secrets port's `gate` scope unless the runner brings its own (a testbed job, ADR 0484).
    const wrap = runner.wraps ? (/** @type {string} */ c) => secrets.wrap(c, "gate") : undefined;
    const command = boxCommand(checkCommand(dir), { wrap });
    const code = runner.run({
      dir,
      command,
      label: `${NAME} gate ${repository}@${sha.slice(0, 12)}`,
      flags,
      sha,
      branch,
      repository,
      base,
    });
    if (code === 127)
      return {
        code: 2,
        problem: `\`${runner.program}\` is not on PATH (the ${runner.kind} runner); install it, set "runner", or pass --box <ssh host>`,
        sha,
      };
    return { code, sha };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** `figentra-flow gate run [--ref <branch>] [--box <ssh host>] [-- <runner flags>]`. */
export async function run(/** @type {string[]} */ all) {
  // Everything after `--` is the runner's own (a command runner's `{flags}`, e.g. the testbed's `--no-wait`).
  const cut = all.indexOf("--");
  const args = cut === -1 ? all : all.slice(0, cut);
  const flags = cut === -1 ? [] : all.slice(cut + 1);
  const opt = (/** @type {string} */ name) =>
    args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined;
  /** @type {{ code: number, problem?: string }} */
  let result;
  try {
    result = await gateRun({
      cwd: process.cwd(),
      ref: opt("ref"),
      box: opt("box"),
      flags,
    });
  } catch (error) {
    // a configuration the secrets or runner port refuses
    result = { code: 2, problem: /** @type {Error} */ (error).message };
  }
  if (result.problem) console.error(`${NAME} gate run: ${result.problem}`);
  return result.code;
}
