/**
 * Figentra Flow file contract:
 * Purpose: `fflow gate run [--ref <branch>] [--box <ssh host>] [-- <runner flags>]`, the caller's side of the
 *   gate: check that the head is committed and pushed, clone exactly that commit into a temporary folder with the
 *   box poster beside it, and run the repository's check command through the runner port (`runner` in the
 *   configuration, or `--box <host>` for one run). An `ssh` or `local` box posts `fflow/gate` after the
 *   check; for a `command` runner (the testbed) the box returns only the check's exit code and this side posts, inside
 *   `gate run` only (the owner's option C1 of 2026-11-01; the hook guard refuses a direct poster call).
 *   `--shards <n>` (FR-15, a `command` runner only) fans the check out: the workspace's packages dealt into at most
 *   n groups, one `run … --json` call per group with `gate.shard`'s `{filters}`, all at once, and one `fflow/gate`
 *   status, green only when every shard exited 0 (AC-41), red when one failed; a shard with still no slot or healthy
 *   box (73, 75) and no failed shard posts nothing, since that is never a test failure. The spec gate runs on the first
 *   shard only.
 * Boundary: runs no check on the caller's machine (FR-9). Refuses a dirty tree, a detached head without `--ref`, a
 *   head that is not the remote branch tip, a missing runner and, with `--shards`, a workspace pattern or package
 *   folder it cannot read, before any box is claimed; a runner program that
 *   is not installed is refused after. Removes its temporary
 *   folder when the run ends.
 * Runtime: node
 * Governing contract: Stackra ADR 0503 (decision 4), ADR 0484 (the testbed); STA-1729 phase 2.
 * Secrets: the gate App's key is read through the secrets port's `gate` scope (`infisical run`, `/ci/gate`) by the
 *   poster process only: on the box for `ssh` and `local`, on this side for a `command` runner. It never reaches a
 *   testbed box, and this process never reads it.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runnerFor } from "../adapters/runner/index.mjs";
import { secretsPort } from "../adapters/secrets.mjs";
import { artifactProblems } from "../lib/artifacts.mjs";
import { say } from "../lib/cli.mjs";
import { loadConfig } from "../lib/config.mjs";
import { defaultBranch, git, isClean, remoteTip } from "../lib/git.mjs";
import {
  combine,
  MAX_SHARDS,
  NO_BOX,
  NO_SLOT,
  reportOf,
  shard,
  shardCommand,
  workspacePackages,
} from "../lib/shards.mjs";
import {
  CONFIG_FILE,
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
 * The repository's check command: `check` (a shard's), else the configuration's `gate.check`, else `pnpm verify`,
 * followed by the spec gate where this package is installed, unless `spec` is false (a shard after the first).
 * @param {string} dir
 * @param {string} [check]
 * @param {boolean} [spec]
 */
export function checkCommand(
  dir,
  check = loadConfig(dir).config.gate?.check ?? "pnpm verify",
  spec = true,
) {
  /** @type {any} */
  let pkg = {};
  try {
    pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  } catch {
    // no package.json: the default command, which will fail loudly on the box
  }
  const installed = spec && Boolean(pkg.devDependencies?.[PACKAGE] ?? pkg.dependencies?.[PACKAGE]);
  return `pnpm install --frozen-lockfile && ${check}${installed ? ` && pnpm exec ${NAME} gate ci` : ""}`;
}

/**
 * The POSIX command the box runs: the check, its output and exit code kept for the poster, then the poster, wrapped
 * by the secrets port for the `gate` scope.
 * @param {string} check
 * @param {{ wrap?: (command: string) => string }} [options]
 */
export function boxCommand(check, { wrap = (command) => command } = {}) {
  return `{ ${check}; echo $? > ${GATE_DIR}/exit; } 2>&1 | tee ${GATE_DIR}/log.txt; ${wrap(posterCommand())}`;
}

/** The poster's command line: it refuses to run without the variable only `gate run` sets. */
export const posterCommand = () => `${ENV_PREFIX}GATE_RUN=1 node ${GATE_DIR}/post.mjs`;

/**
 * Runs the poster on this side in `dir` (the job's folder), through the secrets port's `gate` scope.
 * @param {string} dir
 * @param {(command: string) => string} wrap
 * @returns {number} the poster's exit code
 */
function postHere(dir, wrap) {
  const r = spawnSync("sh", ["-c", wrap(posterCommand())], { cwd: dir, stdio: "inherit" });
  return r.status ?? 4;
}

/**
 * The GitHub `owner/name` of `origin`, or undefined.
 * @param {string} url
 */
export const slugOf = (url) => url.match(/github\.com[:/]+([^/]+\/[^/]+?)(?:\.git)?\/?$/)?.[1];

/**
 * Runs every shard at once (the testbed picks region, box and slot, and a call over its cap waits inside `run`), each
 * with `--json` for the testbed's one result line; a shard that found no free slot or healthy box is tried once more.
 * @param {NonNullable<import("../adapters/runner/index.mjs").Runner["start"]>} start
 * @param {string[][]} groups
 * @param {import("../adapters/runner/index.mjs").Job} job
 * @param {(group: string[], i: number) => string} check
 * @returns {Promise<import("../lib/shards.mjs").ShardResult[]>}
 */
export function runShards(start, groups, job, check) {
  return Promise.all(
    groups.map(async (packages, i) => {
      const one = {
        ...job,
        label: `${job.label} shard ${i + 1}/${groups.length}`,
        command: check(packages, i),
        flags: [...job.flags, "--json"],
      };
      let r = await start(one);
      if (r.code === NO_SLOT || r.code === NO_BOX) r = await start(one);
      return { packages, code: r.code, report: reportOf(r.out) };
    }),
  );
}

/**
 * Runs the gate for the head of `cwd`; with `shards`, the check fans out by package shard (FR-15).
 * @param {{ cwd: string, ref?: string, box?: string, flags?: string[], shards?: number,
 *           runner?: import("../adapters/runner/index.mjs").Runner,
 *           tip?: (root: string, branch: string) => string | undefined, now?: () => Date,
 *           post?: (dir: string) => number }} options
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
  const template = loaded.config.gate?.shard ?? "";
  /** @type {string[][] | undefined} */
  let groups;
  if (options.shards !== undefined) {
    if (runner.posts !== "caller" || !runner.start)
      return {
        code: 2,
        problem: `--shards needs a command runner (the testbed); ${runner.kind} is not one`,
      };
    if (!template.includes("{filters}"))
      return {
        code: 2,
        problem: `--shards needs "gate.shard" in ${CONFIG_FILE}: the check command, with {filters} for the shard's packages`,
      };
    const workspace = workspacePackages(root);
    if (workspace && "problem" in workspace)
      return { code: 2, problem: `--shards: ${workspace.problem}` };
    if (!workspace?.packages.length)
      return { code: 2, problem: "--shards needs pnpm-workspace.yaml naming the packages" };
    groups = shard(workspace.packages, Math.min(options.shards, MAX_SHARDS));
  }

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
    const callerPosts = runner.posts === "caller";
    mkdirSync(join(dir, GATE_DIR));
    // A caller-posting runner's box gets neither the poster nor the job file: it runs the check and returns its exit.
    if (!callerPosts) copyFileSync(POSTER, join(dir, GATE_DIR, "post.mjs"));
    const job = {
      sha,
      branch,
      repository,
      startedAt: now().toISOString(),
      context: STATUS_CONTEXT,
      marker: GATE_MARKER,
      envPrefix: ENV_PREFIX,
    };
    const writeJob = () =>
      writeFileSync(join(dir, GATE_DIR, "job.json"), `${JSON.stringify(job, null, 2)}\n`);
    if (!callerPosts) writeJob();
    // A box-side poster runs under the secrets port's `gate` scope unless the runner brings its own.
    const wrap = runner.wraps ? (/** @type {string} */ c) => secrets.wrap(c, "gate") : undefined;
    const command = callerPosts ? checkCommand(dir) : boxCommand(checkCommand(dir), { wrap });
    const each = {
      dir,
      command,
      label: `${NAME} gate ${repository}@${sha.slice(0, 12)}`,
      flags,
      sha,
      branch,
      repository,
      base,
    };
    let code;
    if (groups && runner.start) {
      // AC-41: one status for every shard, green only when each passed; it goes to the poster as the check's log.
      // The spec gate reads the whole repository, so only the first shard runs it.
      const results = await runShards(runner.start, groups, each, (g, i) =>
        checkCommand(dir, shardCommand(template, g), i === 0),
      );
      const verdict = combine(results);
      for (const line of verdict.lines) console.error(`${NAME} gate run: ${line}`);
      code = results.some((r) => r.code === 127) ? 127 : verdict.code;
      if (code !== 127 && verdict.infra) return { code, problem: verdict.infra, sha };
      writeFileSync(join(dir, GATE_DIR, "log.txt"), `${verdict.lines.join("\n")}\n`);
    } else code = runner.run(each);
    if (code === 127)
      return {
        code: 2,
        problem: `\`${runner.program}\` is not on PATH (the ${runner.kind} runner); install it, set "runner", or pass --box <ssh host>`,
        sha,
      };
    if (!callerPosts) return { code, sha };
    // C1: the box returned the check's exit code; this side posts it, under the `gate` scope, then removes the poster.
    writeJob();
    writeFileSync(join(dir, GATE_DIR, "exit"), `${code}\n`);
    copyFileSync(POSTER, join(dir, GATE_DIR, "post.mjs"));
    const posted = (options.post ?? ((d) => postHere(d, (c) => secrets.wrap(c, "gate"))))(dir);
    if (posted === 0 || posted === 1) return { code, sha };
    return {
      code: code || 4,
      problem: `the check exited ${code}, but ${STATUS_CONTEXT} was not posted (poster exit ${posted})`,
      sha,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** `fflow gate run [--ref <branch>] [--box <ssh host>] [--shards <n>] [-- <runner flags>]`. */
export async function run(/** @type {string[]} */ all) {
  // Everything after `--` is the runner's own (a command runner's `{flags}`, e.g. the testbed's `--no-wait`).
  const cut = all.indexOf("--");
  const args = cut === -1 ? all : all.slice(0, cut);
  const flags = cut === -1 ? [] : all.slice(cut + 1);
  const opt = (/** @type {string} */ name) =>
    args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined;
  const shards = args.includes("--shards") ? Number(opt("shards")) : undefined;
  if (shards !== undefined && !(Number.isInteger(shards) && shards >= 1 && shards <= MAX_SHARDS)) {
    console.error(`${NAME} gate run: --shards takes 1 to ${MAX_SHARDS}`);
    return 2;
  }
  /** @type {{ code: number, problem?: string }} */
  let result;
  say("checking", `${NAME} gate run: checking ${opt("ref") ?? "HEAD"}`);
  try {
    result = await gateRun({
      cwd: process.cwd(),
      ref: opt("ref"),
      box: opt("box"),
      flags,
      shards,
    });
  } catch (error) {
    // a configuration the secrets or runner port refuses
    result = { code: 2, problem: /** @type {Error} */ (error).message };
  }
  if (result.problem) console.error(`${NAME} gate run: ${result.problem}`);
  say(result.code ? "blocked" : "approved", `${NAME} gate run: ${result.code ? "red" : "green"}`);
  return result.code;
}
