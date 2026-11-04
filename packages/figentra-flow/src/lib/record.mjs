/**
 * Figentra Flow file contract:
 * Purpose: Flow's record (FR-14): `.flow/record/<key>.json` on the task's branch, holding the task's stage and state,
 *   approvals, sessions, commits, PRs, gate and review results, open owner asks, task evidence and its dated stage
 *   history. `readRecord` and `updateRecord` read and write it against `RECORD_SCHEMA` (shipped as
 *   `schema/record.schema.json`), `updateRecord` dating each change of stage or state in `history` (FR-21);
 *   `readRecordAt` reads it from a branch with no checkout; `commitRecord` commits it (with the tracked changes for a
 *   session's stop) and pushes the branch through the credentials port (FR-19).
 * Boundary: writes only the record file, one commit on the task's branch and a push of that branch. Never commits on
 *   or pushes to the default branch, never rebases or force-pushes: a rejected push is merged once (never into a
 *   worktree holding uncommitted work) and retried, then reported as `pushed: false`. Never stages an untracked file
 *   but the record, or a file named like a secret; the hooks always run (FR-18), `LEFTHOOK` and `LEFTHOOK_EXCLUDE`
 *   stripped from their environment.
 * Runtime: node
 * Governing contract: STA-1945 (FR-14, FR-19, AC-13, AC-18, P-019).
 * Secrets: none; network git goes through `remote` and the configured credentials.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";

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
    sessions: list(
      {
        name: str,
        id: str,
        kind: str,
        // null: the session was first seen at its stop, so when it started is unknown.
        start: { type: ["string", "null"], minLength: 1 },
        end: str,
        pushed: { type: "boolean" },
      },
      ["name", "kind", "start"],
    ),
    commits: { type: "array", items: str },
    prs: { type: "array", items: { type: "integer", minimum: 1 } },
    gate: list({ sha: str, state: str, baseline: { type: "boolean" } }, ["sha", "state"]),
    // FR-15: `blocking` holds the review workflow's confirmed blocking findings, which `land` refuses on
    review: list(
      {
        sha: str,
        verdict: str,
        findings: { type: "integer", minimum: 0 },
        pr: { type: "integer", minimum: 1 },
        blocking: list({ id: str, file: str, text: str }),
      },
      ["sha", "verdict", "findings"],
    ),
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
          error: str,
        },
        ["command", "exit", "head", "clean", "digest", "at"],
      ),
    },
    // FR-23: each task's start, with the digest of the documents it started on (absent in older records)
    started: {
      type: "object",
      additionalProperties: {
        type: "object",
        additionalProperties: false,
        required: ["at", "head", "docs"],
        properties: { at: str, head: str, docs: str, session: str },
      },
    },
    // FR-21: each stage's state change with its time, which the ledger reads (absent in older records)
    history: list({
      stage: { enum: STAGES },
      state: { enum: ["active", "waiting", "done", "failed"] },
      at: str,
    }),
  },
};

/** @typedef {import("./stages.mjs").Stage} Stage */
/**
 * @typedef {{ recordVersion: 1, key: string, stage: Stage, state: "active" | "waiting" | "done" | "failed",
 *   approvals: { who: string, when: string, stage: string, digest: string }[],
 *   sessions: { name: string, id?: string, kind: string, start: string | null, end?: string, pushed?: boolean }[],
 *   commits: string[],
 *   prs: number[], gate: { sha: string, state: string, baseline?: boolean }[],
 *   review: { sha: string, verdict: string, findings: number, pr?: number,
 *     blocking?: { id: string, file: string, text: string }[] }[], asks: { what: string, command: string }[],
 *   tasks: Record<string, { command: string, exit: number, ms?: number, head: string, clean: boolean, digest: string, at: string, error?: string }[]>,
 *   started?: Record<string, { at: string, head: string, docs: string, session?: string }>,
 *   history?: { stage: Stage, state: "active" | "waiting" | "done" | "failed", at: string }[] }} FlowRecord
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
  return existsSync(file) ? parseRecord(readFileSync(file, "utf8"), file) : undefined;
}

/**
 * The record of `key` as the commit `ref` holds it (a branch the task has no checkout of), or undefined when there is
 * none.
 * @param {string} root
 * @param {string} ref
 * @param {string} key
 * @returns {FlowRecord | undefined}
 * @throws {RecordError} when the file is not JSON or fails the schema
 */
export function readRecordAt(root, ref, key) {
  recordPath(root, key);
  const at = `${ref}:${RECORD_DIR}/${key.toLowerCase()}.json`;
  const shown = git(root, ["show", at]);
  return shown.ok ? parseRecord(shown.out, at) : undefined;
}

/**
 * @param {string} text
 * @param {string} where
 * @returns {FlowRecord}
 */
function parseRecord(text, where) {
  let record;
  try {
    record = JSON.parse(text);
  } catch (error) {
    throw new RecordError(`${where}: not valid JSON (${/** @type {Error} */ (error).message})`);
  }
  const problems = recordProblems(record);
  if (problems.length) throw new RecordError(`${where}: ${problems.join("; ")}`);
  return record;
}

/**
 * Applies `change` to the record of `key` (a new one when there is none) and writes it, with a dated `history` entry
 * when the stage or state is new (the ledger's by-day source, FR-21); nothing is written when the result fails the
 * schema.
 * @param {string} root
 * @param {string} key
 * @param {(r: FlowRecord) => FlowRecord} change
 * @returns {FlowRecord}
 * @throws {RecordError} naming each field the result gets wrong
 */
export function updateRecord(root, key, change) {
  const file = recordPath(root, key);
  const was = readRecord(root, key);
  const changed = change(was ?? emptyRecord(key));
  const { stage, state } = changed;
  const next =
    was?.stage === stage && was?.state === state
      ? changed
      : {
          ...changed,
          history: [...(changed.history ?? []), { stage, state, at: new Date().toISOString() }],
        };
  const problems = recordProblems(next);
  if (problems.length) throw new RecordError(`${file}: ${problems.join("; ")}`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

/**
 * The environment a commit, merge or push of the record runs in: the caller's, less what would skip or trim the
 * hooks, which always run (FR-18).
 */
function hooked() {
  const env = { ...process.env };
  delete env.LEFTHOOK;
  delete env.LEFTHOOK_EXCLUDE;
  return env;
}

/**
 * Pushes the current branch to origin; a rejected push is merged (never rebased or forced) and retried once. A
 * worktree holding work left out of the commit is never merged into: it is pushed only when origin's branch is still
 * an ancestor of HEAD.
 * @param {string} root
 * @param {string} branch
 * @returns {string | undefined} why it was not pushed
 */
function push(root, branch) {
  const to = ["push", "-q", "origin", `HEAD:refs/heads/${branch}`];
  try {
    let r = remote(root, to, hooked());
    if (r.ok) return undefined;
    const fetched = remote(root, ["fetch", "-q", "origin", branch]);
    if (!fetched.ok) return `push failed (${r.err}) and fetch failed (${fetched.err})`;
    if (git(root, ["status", "--porcelain"]).out) {
      if (!git(root, ["merge-base", "--is-ancestor", "FETCH_HEAD", "HEAD"]).ok)
        return `push rejected: origin moved; resume first (origin/${branch} has commits this branch lacks, and the worktree holds work left out of the commit, so nothing was merged)`;
    } else {
      const merged = git(root, ["merge", "-q", "--no-edit", "FETCH_HEAD"], hooked());
      if (!merged.ok) {
        git(root, ["merge", "--abort"]);
        return `push rejected and origin/${branch} does not merge cleanly: ${merged.err || merged.out}`;
      }
    }
    r = remote(root, to, hooked());
    return r.ok ? undefined : `push failed after a merge: ${r.err}`;
  } catch (error) {
    return /** @type {Error} */ (error).message;
  }
}

/** File names that look like secrets: a stop never stages them, tracked or not. */
const SECRET = /^(\.env|\.secrets|id_rsa)|\.(pem|key|p12)$/;

/** The paths of a `-z` git listing. */
const paths = (/** @type {string} */ out) => out.split("\0").filter(Boolean);

/**
 * Commits the record of `key` on the current branch and pushes it. With `wip` (a session's stop) the commit also
 * takes every tracked change (`git add -u`), never an untracked file but the record, and never a file whose name looks
 * like a secret: those are reported as `secrets` and `untracked`, left in the worktree. The hooks always run, even
 * when the caller's environment sets `LEFTHOOK` or `LEFTHOOK_EXCLUDE`. When nothing could be committed `uncommitted`
 * is set and the staging is undone (the working tree is unchanged); when it is the hooks that refused, `hooks` is
 * their output's tail.
 * @param {string} root the task's worktree
 * @param {string} key
 * @param {{ message: string, wip?: boolean, push?: boolean }} options `push: false` commits only
 * @returns {{ sha: string, pushed: boolean, uncommitted?: boolean, problem?: string, hooks?: string,
 *             secrets?: string[], untracked?: string[] }}
 */
export function commitRecord(root, key, { message, wip = false, push: send = true }) {
  const head = () => git(root, ["rev-parse", "HEAD"]).out;
  /** @type {{ secrets?: string[], untracked?: string[] }} */
  const left = {};
  /** @param {string} problem */
  const failed = (problem) => ({ sha: head(), pushed: false, uncommitted: true, problem, ...left });
  const branch = git(root, ["branch", "--show-current"]).out;
  if (!branch) return failed("HEAD is detached: no branch");
  if (branch === defaultBranch(root))
    return failed(`${branch} is the default branch: the record lives on the task's branch`);
  const file = recordPath(root, key);
  if (wip) {
    const record = relative(root, file);
    const untracked = paths(git(root, ["ls-files", "-z", "--others", "--exclude-standard"]).out);
    const changed = paths(git(root, ["diff", "-z", "--name-only", "--no-renames", "HEAD"]).out);
    const secret = (/** @type {string} */ p) => SECRET.test(basename(p));
    const secrets = [...changed, ...untracked].filter(secret);
    const others = untracked.filter((p) => p !== record && !secret(p));
    if (secrets.length) left.secrets = secrets;
    if (others.length) left.untracked = others;
    const staged = git(root, ["add", "-u"]);
    if (!staged.ok) return failed(`git add -u failed: ${staged.err}`);
    // `add -u` stages a changed secret like any tracked change: take it back out before anything commits.
    const kept = changed.filter(secret);
    const unstaged = kept.length
      ? git(root, ["--literal-pathspecs", "reset", "-q", "--", ...kept])
      : staged;
    if (!unstaged.ok) return failed(`git reset failed: ${unstaged.err}`);
  }
  const added = git(root, ["add", "--", file]);
  if (!added.ok) return failed(`git add failed: ${added.err}`);
  // Only a stop commits more than the record.
  const only = wip ? [] : ["--", file];
  if (!git(root, ["diff", "--cached", "--quiet", ...only]).ok) {
    const committed = git(root, ["commit", "-q", "-m", message, ...only], hooked());
    if (!committed.ok) {
      // Undo the staging (a stop's whole index, else the record); the working tree keeps every change.
      git(root, ["reset", "-q", ...only]);
      const tail = `${committed.out}\n${committed.err}`.trim().split("\n").slice(-12).join("\n");
      // A refusing hook makes git exit silently; git's own failures (identity, signing, a lock) end in `fatal:`.
      if ((tail.split("\n").at(-1) ?? "").startsWith("fatal: "))
        return failed(`git commit failed: ${tail}`);
      return { ...failed(`the hooks refused the commit: ${tail}`), hooks: tail };
    }
  }
  if (!send) return { sha: head(), pushed: false, ...left };
  const problem = push(root, branch);
  return { sha: head(), pushed: !problem, ...(problem ? { problem } : {}), ...left };
}

/**
 * Whether `branch` (the current one by default) has commits origin does not (by the last fetched `origin/<branch>`).
 * @param {string} root
 * @param {string} [branch]
 */
export function unpushed(root, branch = git(root, ["branch", "--show-current"]).out) {
  if (!branch) return false;
  const ahead = git(root, [
    "rev-list",
    "--count",
    `refs/remotes/origin/${branch}..refs/heads/${branch}`,
  ]);
  return !ahead.ok || ahead.out !== "0";
}
