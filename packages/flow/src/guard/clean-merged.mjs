/**
 * Figentra Flow file contract:
 * Purpose: the guard's post-merge cleanup: at a session's start, when the repository sets `clean.whenMerged`, starts
 *   `fflow clean --merged` in the background in the main checkout, so a worktree whose pull request merged goes
 *   without anyone running `clean`. Its report goes to `.claude/worktrees/clean-merged.log`; a run within the last
 *   ten minutes (that log's age) is not repeated, so a burst of sessions starts one.
 * Boundary: spawns one detached process and writes its log; never waits for it, so the hook stays fast. Does nothing
 *   when the package is not installed in the main checkout. `clean` keeps every tree its rules keep.
 * Runtime: node
 * Governing contract: STA-1871 (worktree hygiene); the owner's post-merge cleanup of 2026-11-09.
 * Secrets: none here; `clean` reads GitHub through the configured credentials.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, statSync } from "node:fs";
import { join } from "node:path";

import { mainCheckout } from "../lib/git.mjs";
import { NAME, PACKAGE } from "../lib/product.mjs";

/** How long after one background run another is skipped. */
export const QUIET_MS = 10 * 60_000;

/** The background run's report, under the main checkout. */
export const LOG = ".claude/worktrees/clean-merged.log";

/**
 * Starts `fflow clean --merged` for the repository at `root` in the background.
 * @param {string} root
 * @param {{ run?: typeof spawn, now?: number }} [options] `run`: the spawner (tests)
 * @returns {boolean} whether a run started
 */
export function cleanMerged(root, { run = spawn, now = Date.now() } = {}) {
  const main = mainCheckout(root);
  if (!main) return false;
  const bin = join(main, "node_modules", ...PACKAGE.split("/"), "bin", `${NAME}.mjs`);
  const log = join(main, LOG);
  if (!existsSync(bin) || (existsSync(log) && now - statSync(log).mtimeMs < QUIET_MS)) return false;
  mkdirSync(join(main, ".claude", "worktrees"), { recursive: true });
  const out = openSync(log, "w");
  run(process.execPath, [bin, "clean", "--merged"], {
    cwd: main,
    detached: true,
    stdio: ["ignore", out, out],
  }).unref();
  return true;
}
