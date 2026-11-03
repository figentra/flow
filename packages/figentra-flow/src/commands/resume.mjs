/**
 * Figentra Flow file contract:
 * Purpose: `fflow resume <key>` (FR-13, AC-13): re-enters the stage a dead session left half done. It finds the
 *   task's worktree (this checkout, a linked worktree, or a new one in `.claude/worktrees/` from the branch a stopped
 *   session pushed), fast-forwards it to the pushed branch (refusing when the two have diverged), reads Flow's record
 *   there and, when the recorded stage is active or failed, re-runs that
 *   stage's command if it is one Flow can repeat unattended (`RERUNNABLE`), records the outcome and pushes it. Any
 *   other half-done stage is the session's or the owner's: its command is printed.
 * Boundary: may add one worktree (inside `.claude/worktrees/`), runs one `fflow` command, writes the record and commits
 *   and pushes it on the task's branch.
 * Runtime: node
 * Governing contract: STA-1945 (FR-13, AC-13, P-017).
 * Secrets: none; network git goes through the configured credentials.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { schemeFor } from "../adapters/tracker/index.mjs";
import { findTask, specFacts } from "./next.mjs";
import { say } from "../lib/cli.mjs";
import { fetch, git, mainCheckout } from "../lib/git.mjs";
import { NAME } from "../lib/product.mjs";
import { commitRecord, readRecord, RecordError, updateRecord } from "../lib/record.mjs";
import { nextStep } from "../lib/stages.mjs";

/** The stages whose command is safe to repeat with no one at the keyboard. */
export const RERUNNABLE = ["gate", "land", "release", "ship"];

const BIN = fileURLToPath(new URL("../../bin/fflow.mjs", import.meta.url));

/**
 * The worktree of `key`: a checkout on the key's branch, or a new worktree in `.claude/worktrees/` for the key's
 * local or pushed branch (as of the last fetch; `sync` then brings it up to origin).
 * @param {string} cwd
 * @param {string} key lower-cased
 * @returns {{ ok: true, path: string, made: boolean } | { ok: false, problem: string }}
 */
export function locate(cwd, key) {
  const task = findTask(cwd, key);
  if (!task.ok) return task;
  if (task.path) return { ok: true, path: task.path, made: false };
  const branch = task.branch;
  if (!branch)
    return {
      ok: false,
      problem: `no branch for ${key.toUpperCase()}: \`${NAME} start\` makes one`,
    };
  const path = join(task.root, ".claude", "worktrees", branch.split("/").at(-1) ?? branch);
  if (existsSync(path)) return { ok: false, problem: `${path} exists but is not on ${branch}` };
  const added = task.local
    ? git(task.root, ["worktree", "add", "-q", path, branch])
    : git(task.root, ["worktree", "add", "-q", "--track", "-b", branch, path, `origin/${branch}`]);
  if (!added.ok) return { ok: false, problem: `git worktree add failed: ${added.err}` };
  return { ok: true, path, made: true };
}

/**
 * Brings the worktree at `path` up to its pushed branch (as of the last fetch), so a stage never re-runs on a stale
 * checkout: fast-forwards when origin is ahead, refuses when the two have diverged. Never merges, rebases or forces.
 * @param {string} path
 * @returns {string | undefined} why it refused
 */
export function sync(path) {
  const branch = git(path, ["branch", "--show-current"]).out;
  const theirs = `refs/remotes/origin/${branch}`;
  const counts = git(path, ["rev-list", "--left-right", "--count", `HEAD...${theirs}`]);
  // Never pushed: the local branch is the only copy.
  if (!counts.ok) return undefined;
  const [ahead, behind] = counts.out.split(/\s+/).map(Number);
  if (!behind) return undefined;
  if (ahead)
    return `${branch} and origin/${branch} have diverged (${ahead} local and ${behind} pushed commits): merge origin/${branch} in ${path}, then resume`;
  const ff = git(path, ["merge", "-q", "--ff-only", theirs]);
  return ff.ok ? undefined : `${path} cannot fast-forward to origin/${branch}: ${ff.err}`;
}

/**
 * Runs one `fflow …` command in `cwd`, its output passed through.
 * @param {string} command
 * @param {string} cwd
 * @returns {number}
 */
function runStep(command, cwd) {
  const r = spawnSync(process.execPath, [BIN, ...command.split(" ").slice(1)], {
    cwd,
    stdio: "inherit",
  });
  return r.status ?? 1;
}

/**
 * Resumes `key`.
 * @param {{ cwd: string, key: string, run?: (command: string, cwd: string) => number }} options
 * @returns {{ ok: true, path: string, made: boolean, stage: string, command: string, ran: boolean, exit?: number,
 *             pushed?: boolean, problem?: string, hooks?: string } | { ok: false, problem: string }}
 */
export function resume({ cwd, key, run: runCommand = runStep }) {
  const root = mainCheckout(cwd);
  if (!root) return { ok: false, problem: `${cwd} is not in a git repository` };
  const k = schemeFor(root).parse(key);
  if (!k) return { ok: false, problem: `${key} is not an issue key` };
  const fetched = fetch(root);
  if (!fetched.ok) return { ok: false, problem: `fetch failed: ${fetched.err}` };
  const at = locate(cwd, k);
  if (!at.ok) return at;
  const stale = sync(at.path);
  if (stale) return { ok: false, problem: stale };
  let record;
  try {
    record = readRecord(at.path, k);
  } catch (error) {
    if (error instanceof RecordError) return { ok: false, problem: error.message };
    throw error;
  }
  if (!record)
    return {
      ok: false,
      problem: `${k.toUpperCase()} has no record in ${at.path}; \`${NAME} next ${k.toUpperCase()}\` names its stage`,
    };
  const step = nextStep(record, specFacts(at.path, k));
  const base = { ok: /** @type {const} */ (true), path: at.path, made: at.made, ...step };
  const halfDone = step.stage === record.stage && ["active", "failed"].includes(record.state);
  if (!halfDone || !RERUNNABLE.includes(step.stage) || !step.command.startsWith(`${NAME} `))
    return { ...base, ran: false };
  const exit = runCommand(step.command, at.path);
  const state = exit === 0 ? "done" : "failed";
  updateRecord(at.path, k, (r) => ({ ...r, state }));
  const shown = k.toUpperCase();
  const saved = commitRecord(at.path, k, {
    message: `chore(flow): ${shown} ${step.stage} ${state}\n\nRefs: ${shown}`,
  });
  return {
    ...base,
    ran: true,
    exit,
    pushed: saved.pushed,
    problem: saved.problem,
    hooks: saved.hooks,
  };
}

/** @param {string[]} args */
export async function run(args = []) {
  const key = args.find((a) => !a.startsWith("--"));
  if (!key) {
    console.error(`usage: ${NAME} resume <issue-key>`);
    return 2;
  }
  const result = resume({ cwd: process.cwd(), key });
  if (!result.ok) {
    console.error(`${NAME} resume: ${result.problem}`);
    return 1;
  }
  if (result.made) say("checking", `worktree ready at ${result.path}`);
  if (!result.ran) {
    say("waiting", `${key.toUpperCase()}: ${result.stage}; continue with:`);
    console.log(result.command);
    return 0;
  }
  say(
    result.exit === 0 ? "approved" : "blocked",
    `${result.stage}: \`${result.command}\` exited ${result.exit}`,
  );
  if (result.hooks !== undefined)
    say(
      "blocked",
      `the hooks refused the record's commit: ${result.hooks}; the record stays in the worktree, uncommitted`,
    );
  else if (!result.pushed)
    say("waiting", `the record is committed but not pushed: ${result.problem}`);
  return result.exit === 0 ? 0 : 1;
}
