/**
 * Figentra Flow file contract:
 * Purpose: Flow's record (FR-14): `.flow/record/<key>.json` on the task's branch, holding the task's stage and state,
 *   approvals, sessions, commits, PRs, gate and review results, open owner asks and task evidence. `readRecord` and
 *   `updateRecord` read and write it against `RECORD_SCHEMA` (shipped as `schema/record.schema.json`);
 *   `commitRecord` commits it (with the whole worktree for a session's stop) and pushes the branch through the
 *   credentials port (FR-19).
 * Boundary: writes only the record file, one commit on the task's branch and a push of that branch. Never commits on
 *   or pushes to the default branch, never rebases or force-pushes: a rejected push is merged once and retried, then
 *   reported as `pushed: false`.
 * Runtime: node
 * Governing contract: STA-1945 (FR-14, FR-19, AC-13, AC-18, P-019).
 * Secrets: none; network git goes through `remote` and the configured credentials.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { validate } from "./config.mjs";
import { FLOW_DIR } from "./flow-dir.mjs";
import { defaultBranch, git, remote } from "./git.mjs";
import { STAGES } from "./stages.mjs";

/** Where the records live, under the repository (or worktree) root. */
export const RECORD_DIR = `${FLOW_DIR}/record`;

const str = { type: "string", minLength: 1 };
/** An array of closed objects. */
const list = (
  /** @type {Record<string, unknown>} */ properties,
  /** @type {string[]} */ required = Object.keys(properties),
) => ({
  type: "array",
  items: { type: "object", additionalProperties: false, required, properties },
});

/** The record's JSON Schema (draft 2020-12), the single source of `schema/record.schema.json`. */
export const RECORD_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "record.schema.json",
  title: ".flow/record/<key>.json",
  type: "object",
  additionalProperties: false,
  required: [
    "recordVersion",
    "key",
    "stage",
    "state",
    "approvals",
    "sessions",
    "commits",
    "prs",
    "gate",
    "review",
    "asks",
    "tasks",
  ],
  properties: {
    $schema: str,
    recordVersion: { const: 1 },
    key: str,
    stage: { enum: STAGES },
    state: { enum: ["active", "waiting", "done", "failed"] },
    approvals: list({ who: str, when: str, stage: str, digest: str }),
    sessions: list({ name: str, kind: str, start: str, end: str, pushed: { type: "boolean" } }, [
      "name",
      "kind",
      "start",
    ]),
    commits: { type: "array", items: str },
    prs: { type: "array", items: { type: "integer", minimum: 1 } },
    gate: list({ sha: str, state: str, baseline: { type: "boolean" } }, ["sha", "state"]),
    review: list({ sha: str, verdict: str, findings: { type: "integer", minimum: 0 } }),
    asks: list({ what: str, command: str }),
    tasks: {
      type: "object",
      additionalProperties: list(
        {
          command: str,
          exit: { type: "integer" },
          ms: { type: "integer", minimum: 0 },
          head: str,
          clean: { type: "boolean" },
          digest: str,
          at: str,
        },
        ["command", "exit", "head", "clean", "digest", "at"],
      ),
    },
  },
};

/** @typedef {import("./stages.mjs").Stage} Stage */
/**
 * @typedef {{ recordVersion: 1, key: string, stage: Stage, state: "active" | "waiting" | "done" | "failed",
 *   approvals: { who: string, when: string, stage: string, digest: string }[],
 *   sessions: { name: string, kind: string, start: string, end?: string, pushed?: boolean }[], commits: string[],
 *   prs: number[], gate: { sha: string, state: string, baseline?: boolean }[],
 *   review: { sha: string, verdict: string, findings: number }[], asks: { what: string, command: string }[],
 *   tasks: Record<string, { command: string, exit: number, ms?: number, head: string, clean: boolean, digest: string, at: string }[]> }} FlowRecord
 */

/** Raised for a key that is not one, or a record that is not valid JSON or fails its schema. */
export class RecordError extends Error {}

/**
 * The record's path for `key` (lower-cased); refuses anything but `<letters>-<n>`, so a key never leaves the folder.
 * @param {string} root
 * @param {string} key
 */
export function recordPath(root, key) {
  const k = key.toLowerCase();
  if (!/^[a-z][a-z0-9]*-\d+$/.test(k)) throw new RecordError(`${key} is not an issue key`);
  return join(root, RECORD_DIR, `${k}.json`);
}

/**
 * A new record for `key`, at its first stage.
 * @param {string} key
 * @returns {FlowRecord}
 */
export function emptyRecord(key) {
  return {
    recordVersion: 1,
    key: key.toLowerCase(),
    stage: "start",
    state: "active",
    approvals: [],
    sessions: [],
    commits: [],
    prs: [],
    gate: [],
    review: [],
    asks: [],
    tasks: {},
  };
}

/**
 * The problems of a record against its schema, each naming the field; empty means valid.
 * @param {unknown} record
 */
export const recordProblems = (record) => validate(RECORD_SCHEMA, record);

/**
 * The record of `key` in `root`, or undefined when there is none.
 * @param {string} root
 * @param {string} key
 * @returns {FlowRecord | undefined}
 * @throws {RecordError} when the file is not JSON or fails the schema
 */
export function readRecord(root, key) {
  const file = recordPath(root, key);
  if (!existsSync(file)) return undefined;
  let record;
  try {
    record = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new RecordError(`${file}: not valid JSON (${/** @type {Error} */ (error).message})`);
  }
  const problems = recordProblems(record);
  if (problems.length) throw new RecordError(`${file}: ${problems.join("; ")}`);
  return record;
}

/**
 * Applies `change` to the record of `key` (a new one when there is none) and writes it; nothing is written when the
 * result fails the schema.
 * @param {string} root
 * @param {string} key
 * @param {(r: FlowRecord) => FlowRecord} change
 * @returns {FlowRecord}
 * @throws {RecordError} naming each field the result gets wrong
 */
export function updateRecord(root, key, change) {
  const file = recordPath(root, key);
  const next = change(readRecord(root, key) ?? emptyRecord(key));
  const problems = recordProblems(next);
  if (problems.length) throw new RecordError(`${file}: ${problems.join("; ")}`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

/**
 * Pushes the current branch to origin; a rejected push is merged (never rebased or forced) and retried once.
 * @param {string} root
 * @param {string} branch
 * @returns {string | undefined} why it was not pushed
 */
function push(root, branch) {
  const to = ["push", "-q", "origin", `HEAD:refs/heads/${branch}`];
  try {
    let r = remote(root, to);
    if (r.ok) return undefined;
    const fetched = remote(root, ["fetch", "-q", "origin", branch]);
    if (!fetched.ok) return `push failed (${r.err}) and fetch failed (${fetched.err})`;
    const merged = git(root, ["merge", "-q", "--no-edit", "FETCH_HEAD"]);
    if (!merged.ok) {
      git(root, ["merge", "--abort"]);
      return `push rejected and origin/${branch} does not merge cleanly: ${merged.err || merged.out}`;
    }
    r = remote(root, to);
    return r.ok ? undefined : `push failed after a merge: ${r.err}`;
  } catch (error) {
    return /** @type {Error} */ (error).message;
  }
}

/**
 * Commits the record of `key` (with `wip`, every change in the worktree) on the current branch and pushes it.
 * @param {string} root the task's worktree
 * @param {string} key
 * @param {{ message: string, wip?: boolean, push?: boolean }} options `push: false` commits only
 * @returns {{ sha: string, pushed: boolean, problem?: string }}
 */
export function commitRecord(root, key, { message, wip = false, push: send = true }) {
  const head = () => git(root, ["rev-parse", "HEAD"]).out;
  const branch = git(root, ["branch", "--show-current"]).out;
  if (!branch) return { sha: head(), pushed: false, problem: "HEAD is detached: no branch" };
  if (branch === defaultBranch(root))
    return {
      sha: head(),
      pushed: false,
      problem: `${branch} is the default branch: the record lives on the task's branch`,
    };
  const added = git(root, wip ? ["add", "-A"] : ["add", "--", recordPath(root, key)]);
  if (!added.ok) return { sha: head(), pushed: false, problem: `git add failed: ${added.err}` };
  if (!git(root, ["diff", "--cached", "--quiet"]).ok) {
    const committed = git(root, ["commit", "-q", "-m", message]);
    if (!committed.ok)
      return {
        sha: head(),
        pushed: false,
        problem: `commit failed: ${committed.err || committed.out}`,
      };
  }
  if (!send) return { sha: head(), pushed: false };
  const problem = push(root, branch);
  return problem ? { sha: head(), pushed: false, problem } : { sha: head(), pushed: true };
}

/**
 * Whether the current branch has commits origin does not (by the last fetched `origin/<branch>`).
 * @param {string} root
 */
export function unpushed(root) {
  const branch = git(root, ["branch", "--show-current"]).out;
  if (!branch) return false;
  const ahead = git(root, ["rev-list", "--count", `origin/${branch}..HEAD`]);
  return !ahead.ok || ahead.out !== "0";
}
