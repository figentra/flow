/**
 * Figentra Flow file contract:
 * Purpose: `--workspace <dir>` for `sync`, `update`, `check`, `diff` and `validate` (STA-1945 FR-1, AC-3): the command
 *   runs in every repository under `<dir>` that has `flow.config.json`, as it would there alone, and prints one line per
 *   repository, `<repo>: <line>`. A repository that throws prints its error as its line and the run goes on; the exit
 *   code is the worst one, and 1 when no repository under `<dir>` has `flow.config.json`. Without `--workspace`, the
 *   command runs in the current repository and prints in full.
 * Boundary: finds the repositories with `findRepos`; each command does its own reads and writes.
 * Runtime: node
 * Governing contract: STA-1945 (FR-1, AC-3, P-003).
 * Secrets: none.
 */
import { existsSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

import { git } from "./git.mjs";
import { CONFIG_FILE, NAME } from "./product.mjs";
import { findRepos } from "./workspace.mjs";

/**
 * Where a command prints: `log` takes its lines; `quiet` drops what child processes print (under `--workspace`).
 * @typedef {{ log: (line: string) => void, quiet: boolean }} Io
 */
/**
 * One repository's run of a command: its exit code and its one-line summary.
 * @typedef {(root: string, args: string[], io: Io) => { code: number, line: string } | Promise<{ code: number, line: string }>} Report
 */

/**
 * Runs `fn` in every repository under `dir` that has `flow.config.json` and prints `<repo>: <line>` for each.
 * @param {string} dir
 * @param {(root: string) => Promise<{ code: number, line: string }> | { code: number, line: string }} fn
 * @param {(line: string) => void} [log]
 * @returns {Promise<number>} the worst exit code; 1 when no repository under `dir` has `flow.config.json`
 */
export async function eachRepo(dir, fn, log = console.log) {
  let worst = 0;
  const repos = findRepos([dir])
    .filter((r) => existsSync(join(r.path, CONFIG_FILE)))
    .toSorted((a, b) => a.path.localeCompare(b.path));
  for (const { path } of repos) {
    let result;
    try {
      result = await fn(path);
    } catch (error) {
      result = { code: 1, line: `error: ${/** @type {Error} */ (error).message}` };
    }
    log(`${relative(dir, path) || basename(path)}: ${result.line}`);
    worst = Math.max(worst, result.code);
  }
  // A folder with no governed repository fails, so a mistyped `--workspace` never reads as a green check.
  if (!repos.length) {
    log(`${NAME}: no repository under ${dir} has ${CONFIG_FILE}`);
    return 1;
  }
  return worst;
}

/** The repository the current folder is in, else the folder itself. */
export function currentRoot() {
  const top = git(process.cwd(), ["rev-parse", "--show-toplevel"]);
  return top.ok ? top.out : process.cwd();
}

/**
 * A command's `run`: `report` in the current repository, or with `--workspace <dir>` in each repository under it.
 * @param {string[]} args
 * @param {Report} report
 * @returns {Promise<number>}
 */
export async function runIn(args, report) {
  const at = args.indexOf("--workspace");
  if (at === -1)
    return (await report(currentRoot(), args, { log: console.log, quiet: false })).code;
  const dir = args[at + 1];
  if (!dir || dir.startsWith("--")) {
    console.error(`${NAME}: --workspace needs a folder`);
    return 2;
  }
  const rest = args.filter((_, i) => i !== at && i !== at + 1);
  return eachRepo(resolve(dir), (root) => report(root, rest, { log: () => {}, quiet: true }));
}
