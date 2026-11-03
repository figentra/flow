/**
 * Figentra Flow file contract:
 * Purpose: `fflow next [<key>] [--json]` (FR-13): the task's current stage and the command that moves it on, read
 *   from Flow's record and the spec's `**Status**`; the key defaults to the branch's. The record is read where the
 *   task lives: its checkout, else its branch (the newer of the local and the last fetched pushed one). It warns when
 *   the record has commits origin does not.
 * Boundary: reads the record, the spec and git; writes nothing and never fetches.
 * Runtime: node
 * Governing contract: STA-1945 (FR-13, AC-13, P-017).
 * Secrets: none.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { schemeFor } from "../adapters/tracker/index.mjs";
import { specDir, statusOf } from "./gate.mjs";
import { say } from "../lib/cli.mjs";
import { git, mainCheckout, worktrees } from "../lib/git.mjs";
import { NAME } from "../lib/product.mjs";
import { emptyRecord, readRecord, readRecordAt, RecordError, unpushed } from "../lib/record.mjs";
import { nextStep } from "../lib/stages.mjs";

/**
 * What the spec of `key` says: its folder and declared status, when the folder exists.
 * @param {string} root
 * @param {string} key
 * @returns {{ specDir?: string, specStatus?: string }}
 */
export function specFacts(root, key) {
  const found = specDir({ root, key, keys: schemeFor(root) });
  if (!found.dir || !existsSync(join(root, found.dir, "spec.md"))) return {};
  return {
    specDir: found.dir,
    specStatus: statusOf(readFileSync(join(root, found.dir, "spec.md"), "utf8")),
  };
}

/**
 * Where the task of `key` lives: `path`, a checkout on its branch (the main checkout or a linked worktree), else
 * `branch`, its one local or pushed branch as of the last fetch (`local` when it has a local one), else neither.
 * @param {string} cwd
 * @param {string} key lower-cased
 * @returns {{ ok: true, root: string, path?: string, branch?: string, local?: boolean }
 *   | { ok: false, problem: string }}
 */
export function findTask(cwd, key) {
  const root = mainCheckout(cwd);
  if (!root) return { ok: false, problem: `${cwd} is not in a git repository` };
  const scheme = schemeFor(root);
  const isKey = (/** @type {string | undefined} */ b) => !!b && scheme.keys(b)[0] === key;
  const open = [
    { path: root, branch: git(root, ["branch", "--show-current"]).out },
    ...worktrees(root),
  ].find((t) => isKey(t.branch));
  if (open) return { ok: true, root, path: open.path };
  const refs = (/** @type {string} */ prefix) =>
    git(root, ["for-each-ref", "--format=%(refname:short)", prefix])
      .out.split("\n")
      .filter(Boolean);
  const local = refs("refs/heads").filter(isKey);
  const pushed = refs("refs/remotes/origin")
    .map((r) => r.replace(/^origin\//, ""))
    .filter(isKey);
  const found = [...new Set([...local, ...pushed])];
  if (found.length > 1)
    return { ok: false, problem: `several branches for ${key.toUpperCase()}: ${found.join(", ")}` };
  return found.length
    ? { ok: true, root, branch: found[0], local: local.includes(found[0]) }
    : { ok: true, root };
}

/**
 * The newer of `branch` and `origin/<branch>`: the pushed one when the local one is missing or behind it.
 * @param {string} root
 * @param {string} branch
 * @param {boolean} local
 */
function newest(root, branch, local) {
  const mine = `refs/heads/${branch}`;
  const theirs = `refs/remotes/origin/${branch}`;
  if (!local) return theirs;
  const behind = git(root, ["merge-base", "--is-ancestor", mine, theirs]).ok;
  return behind ? theirs : mine;
}

/**
 * The next step of a task, read from the record on the task's branch: its checkout when it has one, else the branch
 * itself, else (no branch, a landed task) this checkout.
 * @param {{ cwd: string, key?: string }} options
 * @returns {{ ok: true, key: string, recorded: boolean, state: string, stage: import("../lib/stages.mjs").Stage,
 *             command: string, unpushed: boolean } | { ok: false, problem: string }}
 */
export function next({ cwd, key }) {
  const top = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (!top.ok) return { ok: false, problem: `${cwd} is not in a git repository` };
  const scheme = schemeFor(top.out);
  const k = key
    ? scheme.parse(key)
    : scheme.keys(git(top.out, ["branch", "--show-current"]).out)[0];
  if (!k) return { ok: false, problem: `no issue key: pass one, or work on the issue's branch` };
  const task = findTask(top.out, k);
  if (!task.ok) return task;
  const root = task.path ?? top.out;
  let record;
  try {
    record = task.branch
      ? readRecordAt(task.root, newest(task.root, task.branch, !!task.local), k)
      : readRecord(root, k);
  } catch (error) {
    if (error instanceof RecordError) return { ok: false, problem: error.message };
    throw error;
  }
  const step = nextStep(record ?? emptyRecord(k), specFacts(root, k));
  return {
    ok: true,
    key: k,
    recorded: record !== undefined,
    state: record?.state ?? "active",
    ...step,
    unpushed:
      record !== undefined &&
      (task.branch ? !!task.local && unpushed(task.root, task.branch) : unpushed(root)),
  };
}

/** @param {string[]} args */
export async function run(args = []) {
  const key = args.find((a) => !a.startsWith("--"));
  const result = next({ cwd: process.cwd(), key });
  if (!result.ok) {
    console.error(`${NAME} next: ${result.problem}`);
    return 1;
  }
  if (args.includes("--json")) {
    console.log(JSON.stringify({ schema: `${NAME}.next/1`, ...result, ok: undefined }, null, 2));
    return 0;
  }
  const shown = result.key.toUpperCase();
  say(
    result.state === "failed" ? "blocked" : result.state === "waiting" ? "waiting" : "checking",
    `${shown}: ${result.stage}${result.recorded ? ` (${result.state})` : " (no record yet)"}`,
  );
  console.log(result.command);
  if (result.unpushed)
    say(
      "waiting",
      `the record has commits origin lacks: push the branch (\`${NAME} session stop\` retries)`,
    );
  return 0;
}
