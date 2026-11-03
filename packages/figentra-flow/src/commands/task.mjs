/**
 * Figentra Flow file contract:
 * Purpose: `fflow task start|done <key> <task>` (STA-1945 FR-23): the only way a task's marker moves.
 *   start <key> <task>                    refuses unless the spec is Tasked or Implementing with its approvals
 *                                         (ADR 0502), then sets `[-]` and records the start (session, HEAD and the
 *                                         digest of spec, plan and tasks) in Flow's record
 *   done <key> <task> --command <cmd>     runs the check command (`runEvidence`), keeps the attempt in the record and
 *                                         sets `[x]` only on exit 0 at a clean HEAD; refuses a secret-looking command
 *   `resetChanged` is what `check` calls (T024): a task in progress whose documents changed since its start goes back
 *   to `[ ]` with the reason; `handTicks` names each `[x]` with no passing evidence (AC-22).
 * Boundary: writes the task's line in tasks.md and the record (`.flow/record/<key>.json`); runs the check command in
 *   the repository; commits and pushes nothing (the session's commits carry both files).
 * Runtime: node
 * Governing contract: STA-1945 FR-23, AC-23, AC-24, P-028, NFR-5.
 * Secrets: none; the command's output is kept only as a digest, and a secret-looking command never runs.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { schemeFor } from "../adapters/tracker/index.mjs";
import { checkApproval, specDir, statusOf } from "./gate.mjs";
import { say } from "../lib/cli.mjs";
import { passed, runEvidence } from "../lib/evidence.mjs";
import { git } from "../lib/git.mjs";
import { ENV_PREFIX, NAME } from "../lib/product.mjs";
import { readRecord, recordPath, RecordError, updateRecord } from "../lib/record.mjs";
import { parseTasks } from "../lib/spec-parse.mjs";

/** A refusal: a task that cannot move, or a command that may not run. */
export class TaskError extends Error {}

/** The documents a task is started on. */
const DOCS = ["spec.md", "plan.md", "tasks.md"];

/** A task line's marker; group 1 is the bullet before it. */
const MARKER = /^(\s*[-*] )\[[ xX~-]\](?= (?:~~)?T\d{3})/gm;

/** `text` with its HTML comments blanked to spaces, so offsets still match the original. */
const masked = (/** @type {string} */ text) =>
  text.replaceAll(/<!--[\s\S]*?-->/g, (c) => c.replaceAll(/[^\n]/g, " "));

/**
 * One digest of a spec folder's documents, with tasks.md's markers read as `[ ]`, so moving a marker changes nothing.
 * @param {string} dir absolute
 */
export function docsDigest(dir) {
  const hash = createHash("sha256");
  for (const name of DOCS) {
    const file = join(dir, name);
    const text = existsSync(file) ? readFileSync(file, "utf8") : "";
    hash.update(`${name}\0${name === "tasks.md" ? text.replaceAll(MARKER, "$1[ ]") : text}\0`);
  }
  return `sha256:${hash.digest("hex")}`;
}

/**
 * `text` with task `id`'s marker set to `marker` (a task inside an HTML comment is never touched).
 * @param {string} text
 * @param {string} id
 * @param {" " | "~" | "-" | "x"} marker
 */
export function setMarker(text, id, marker) {
  const at = masked(text).search(new RegExp(`^\\s*[-*] \\[[ xX~-]\\] (?:~~)?${id}\\b`, "m"));
  if (at < 0) throw new TaskError(`tasks.md has no ${id}`);
  const open = text.indexOf("[", at);
  return `${text.slice(0, open + 1)}${marker}${text.slice(open + 2)}`;
}

/**
 * The spec folder and task of `key` in `root`.
 * @param {string} root
 * @param {string} key
 * @param {string} id
 */
function locate(root, key, id) {
  const keys = schemeFor(root);
  const k = keys.parse(key);
  if (!k) throw new TaskError(`${key} is not an issue key`);
  const found = specDir({ root, key: k, keys });
  if (!found.dir || !existsSync(join(root, found.dir, "tasks.md")))
    throw new TaskError(found.error ?? `${found.dir} has no tasks.md`);
  const dir = join(root, found.dir);
  const file = join(dir, "tasks.md");
  const text = readFileSync(file, "utf8");
  const task = parseTasks(text).find((t) => t.id === id && !t.struck);
  if (!task) throw new TaskError(`${found.dir}/tasks.md has no live ${id}`);
  return { k, dir, file, text, task, spec: readFileSync(join(dir, "spec.md"), "utf8") };
}

/**
 * Starts task `id` of `key`: the problems that refuse it, or none once it is `[-]` and recorded.
 * @param {string} root
 * @param {string} key
 * @param {string} id
 * @param {{ session?: string, now?: () => Date }} [options]
 * @returns {string[]}
 */
export function startTask(root, key, id, { session, now = () => new Date() } = {}) {
  const { k, dir, file, text, task, spec } = locate(root, key, id);
  const status = statusOf(spec);
  const problems = [];
  if (status !== "tasked" && status !== "implementing")
    problems.push(
      `the spec is ${status || "without a status"}: a task starts at Tasked or Implementing`,
    );
  problems.push(...checkApproval(spec));
  if (task.marker === "-") problems.push(`${id} is already in progress`);
  if (task.marker === "x") problems.push(`${id} is done`);
  if (problems.length) return problems;
  writeFileSync(file, setMarker(text, id, "-"));
  updateRecord(root, k, (r) => ({
    ...r,
    started: {
      ...r.started,
      [id]: {
        at: now().toISOString(),
        head: git(root, ["rev-parse", "HEAD"]).out,
        docs: docsDigest(dir),
        ...(session ? { session } : {}),
      },
    },
  }));
  return [];
}

/**
 * Runs task `id`'s check command and records the attempt; `[x]` only on exit 0 at a clean HEAD (tasks.md and the
 * record are Flow's bookkeeping, outside the clean check).
 * @param {string} root
 * @param {string} key
 * @param {string} id
 * @param {string} command
 * @param {{ echo?: boolean, now?: () => Date, timeoutMs?: number }} [options]
 * @returns {{ done: boolean, evidence: import("../lib/evidence.mjs").TaskEvidence }}
 * @throws {TaskError} when the task is not in progress, its documents changed since its start, or the command looks
 *   like it carries or prints a secret
 */
export function doneTask(root, key, id, command, options = {}) {
  const { k, dir, file, task } = locate(root, key, id);
  if (task.marker !== "-")
    throw new TaskError(
      task.marker === "x"
        ? `${id} is done`
        : `${id} is not started: \`${NAME} task start ${key} ${id}\``,
    );
  const start = readRecord(root, k)?.started?.[id];
  if (start && start.docs !== docsDigest(dir))
    throw new TaskError(`the spec, plan or tasks changed since ${id} started: \`check\` resets it`);
  let evidence;
  try {
    evidence = runEvidence(root, command, {
      ...options,
      ignore: [relative(root, file), relative(root, recordPath(root, k))],
    });
  } catch (error) {
    throw new TaskError(/** @type {Error} */ (error).message);
  }
  updateRecord(root, k, (r) => ({
    ...r,
    tasks: { ...r.tasks, [id]: [...(r.tasks[id] ?? []), evidence] },
  }));
  const done = evidence.exit === 0 && evidence.clean;
  // re-read: the command may have changed tasks.md, and only this task's marker moves
  if (done) writeFileSync(file, setMarker(readFileSync(file, "utf8"), id, "x"));
  return { done, evidence };
}

/**
 * Each `[x]` task with no passing evidence in the record (AC-22); a spec with no record predates FR-23 and has none.
 * @param {string} tasks the tasks.md text
 * @param {import("../lib/record.mjs").FlowRecord | undefined} record
 */
export const handTicks = (tasks, record) =>
  record
    ? parseTasks(tasks)
        .filter((t) => t.done && !t.struck && !passed(record.tasks[t.id]))
        .map((t) => t.id)
    : [];

/**
 * Sets each task in progress whose documents changed since its start back to `[ ]` and drops its start (AC-24).
 * @param {string} root
 * @param {string} key
 * @returns {{ id: string, reason: string }[]} the tasks reset, with why
 */
export function resetChanged(root, key) {
  const keys = schemeFor(root);
  const k = keys.parse(key);
  if (!k) return [];
  const found = specDir({ root, key: k, keys });
  const record = readRecord(root, k);
  if (!found.dir || !record?.started) return [];
  const dir = join(root, found.dir);
  const file = join(dir, "tasks.md");
  if (!existsSync(file)) return [];
  const docs = docsDigest(dir);
  let text = readFileSync(file, "utf8");
  const reset = parseTasks(text).filter(
    (t) => t.marker === "-" && record.started?.[t.id] && record.started[t.id].docs !== docs,
  );
  if (!reset.length) return [];
  for (const t of reset) text = setMarker(text, t.id, " ");
  writeFileSync(file, text);
  updateRecord(root, k, (r) => ({
    ...r,
    started: Object.fromEntries(
      Object.entries(r.started ?? {}).filter(([id]) => !reset.some((t) => t.id === id)),
    ),
  }));
  return reset.map((t) => ({
    id: t.id,
    reason: `the spec, plan or tasks changed since ${t.id} started (${record.started?.[t.id].at})`,
  }));
}

/** @param {string[]} args */
export function run(args = []) {
  const [mode, key, id] = args;
  const at = args.indexOf("--command");
  const command = at >= 0 ? args[at + 1] : undefined;
  if (!key || !id || !/^T\d{3}$/.test(id) || !(mode === "start" || (mode === "done" && command))) {
    console.error(
      `usage: ${NAME} task start <key> <T###> | done <key> <T###> --command <cmd> [--echo]`,
    );
    return 2;
  }
  const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).out || process.cwd();
  try {
    if (mode === "start") {
      const problems = startTask(root, key, id, { session: process.env[`${ENV_PREFIX}SESSION`] });
      for (const p of problems) say("blocked", `${NAME} task start: ${id}: ${p}`);
      if (!problems.length) say("checking", `${id} is in progress`);
      return problems.length ? 1 : 0;
    }
    const { done, evidence } = doneTask(root, key, id, /** @type {string} */ (command), {
      echo: args.includes("--echo"),
    });
    const why =
      evidence.error ??
      (evidence.exit ? `exit ${evidence.exit}` : "the tree is not clean or HEAD moved");
    say(
      done ? "approved" : "blocked",
      done ? `${id} is done` : `${id} stays in progress: ${why} (the attempt is recorded)`,
    );
    return done ? 0 : 1;
  } catch (error) {
    if (!(error instanceof TaskError || error instanceof RecordError)) throw error;
    say("blocked", `${NAME} task ${mode}: ${error.message}`);
    return error instanceof TaskError ? 2 : 1;
  }
}
