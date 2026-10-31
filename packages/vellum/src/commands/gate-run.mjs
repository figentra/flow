/**
 * Vellum file contract:
 * Purpose: `vellum gate run [--ref <branch>] [--box <ssh host>] [--no-wait] [--on-demand]`, the caller's side of the
 *   gate: check that the head is committed and pushed, clone exactly that commit into a temporary folder with the
 *   box poster beside it, and run the repository's check command on a testbed box (`stackra testbed run`) or on a
 *   named host (`--box`). The box posts `vellum/gate`; this side only passes its exit code through.
 * Boundary: runs no check on the caller's machine (FR-9). Refuses a dirty tree, a detached head without `--ref`, a
 *   head that is not the remote branch tip, and a missing `stackra`, before any box is claimed. Removes its temporary
 *   folder when the run ends.
 * Runtime: node
 * Governing contract: Stackra ADR 0503 (decision 4), ADR 0484 (the testbed); STA-1729 phase 2.
 * Secrets: none here. The box reads the gate App's key through `infisical run` (`/ci/gate`); this side never sees it.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { defaultBranch, git, isClean, remoteTip } from "../lib/git.mjs";

/** The poster, copied into every job as `.vellum-gate/post.mjs`. */
const POSTER = new URL("../lib/gate-post.mjs", import.meta.url);

/**
 * The repository's check command: `package.json` `"vellum": { "gate": "<cmd>" }`, else `pnpm verify`, followed by the
 * spec gate where Vellum is installed.
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
  const check = pkg.vellum?.gate ?? "pnpm verify";
  const hasVellum = Boolean(
    pkg.devDependencies?.["@stackra/vellum"] ?? pkg.dependencies?.["@stackra/vellum"],
  );
  return `pnpm install --frozen-lockfile && ${check}${hasVellum ? " && pnpm exec vellum gate ci" : ""}`;
}

/**
 * The POSIX command the box runs: the check, its output and exit code kept for the poster, then the poster.
 * @param {string} check
 * @param {{ infisical?: boolean }} [options] wrap the poster in `infisical run --path=/ci/gate` (a `--box` host)
 */
export function boxCommand(check, { infisical = false } = {}) {
  const poster = "node .vellum-gate/post.mjs";
  return `{ ${check}; echo $? > .vellum-gate/exit; } 2>&1 | tee .vellum-gate/log.txt; ${infisical ? `infisical run --silent --path=/ci/gate -- ${poster}` : poster}`;
}

/**
 * The GitHub `owner/name` of `origin`, or undefined.
 * @param {string} url
 */
export const slugOf = (url) => url.match(/github\.com[:/]+([^/]+\/[^/]+?)(?:\.git)?\/?$/)?.[1];

/**
 * @typedef {(job: { dir: string, command: string, label: string, box?: string, noWait: boolean, onDemand: boolean }) => number} Runner
 */

/** Runs the job on a testbed box, or rsyncs it to `box` and runs it there over ssh. */
/** @type {Runner} */
export function defaultRunner({ dir, command, label, box, noWait, onDemand }) {
  if (box !== undefined) {
    const remoteDir = `/tmp/vellum-gate/${basename(dir)}`;
    const copied = spawnSync(
      "rsync",
      [
        "-a",
        "--delete",
        "--rsync-path",
        `mkdir -p ${remoteDir} && rsync`,
        `${dir}/`,
        `${box}:${remoteDir}/`,
      ],
      { stdio: "inherit" },
    );
    if (copied.status !== 0) return 2;
    const r = spawnSync(
      "ssh",
      [box, `cd ${remoteDir} && ${command}; code=$?; cd / && rm -rf ${remoteDir}; exit $code`],
      { stdio: "inherit" },
    );
    return r.status ?? 4;
  }
  const args = [
    "testbed",
    "run",
    label,
    dir,
    command,
    ...(noWait ? ["--no-wait"] : []),
    ...(onDemand ? ["--on-demand"] : []),
  ];
  const r = spawnSync("stackra", args, { stdio: "inherit" });
  if (r.error) return 127;
  return r.status ?? 4;
}

/**
 * Runs the gate for the head of `cwd`.
 * @param {{ cwd: string, ref?: string, box?: string, noWait?: boolean, onDemand?: boolean, runner?: Runner,
 *           tip?: (root: string, branch: string) => string | undefined, now?: () => Date }} options
 * @returns {Promise<{ code: number, problem?: string, sha?: string }>}
 */
export async function gateRun(options) {
  const {
    cwd,
    box,
    noWait = false,
    onDemand = false,
    runner = defaultRunner,
    tip = remoteTip,
    now = () => new Date(),
  } = options;
  const top = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (!top.ok) return { code: 2, problem: `${cwd} is not in a git repository` };
  const root = top.out;
  if (!isClean(root))
    return {
      code: 2,
      problem: "the tree has uncommitted or untracked changes; commit and push first",
    };
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

  const dir = mkdtempSync(join(tmpdir(), "vellum-gate-"));
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
    mkdirSync(join(dir, ".vellum-gate"));
    copyFileSync(POSTER, join(dir, ".vellum-gate", "post.mjs"));
    writeFileSync(
      join(dir, ".vellum-gate", "job.json"),
      `${JSON.stringify({ sha, branch, repository, startedAt: now().toISOString() }, null, 2)}\n`,
    );
    const command = boxCommand(checkCommand(dir), { infisical: box !== undefined });
    const code = runner({
      dir,
      command,
      label: `vellum gate ${repository}@${sha.slice(0, 12)}`,
      box,
      noWait,
      onDemand,
    });
    if (code === 127)
      return {
        code: 2,
        problem:
          "`stackra` is not on PATH (stackra testbed, ADR 0484); pass --box <ssh host> meanwhile",
        sha,
      };
    return { code, sha };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** `vellum gate run [--ref <branch>] [--box <ssh host>] [--no-wait] [--on-demand]`. */
export async function run(/** @type {string[]} */ args) {
  const opt = (/** @type {string} */ name) =>
    args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined;
  const result = await gateRun({
    cwd: process.cwd(),
    ref: opt("ref"),
    box: opt("box"),
    noWait: args.includes("--no-wait"),
    onDemand: args.includes("--on-demand"),
  });
  if (result.problem) console.error(`vellum gate run: ${result.problem}`);
  return result.code;
}
