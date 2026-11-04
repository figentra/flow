/**
 * Figentra Flow file contract:
 * Purpose: `fflow task start|done|wave` (STA-1945 FR-23, FR-24; declared in src/lib/console.mjs, which turns a
 *   `TaskError` into a usage error): the only way a task's marker moves.
 *   start <key> <task> [--session <name>] first resets each task whose documents changed since it started
 *                                         (`resetChanged`, AC-24), then refuses unless the spec is Tasked or
 *                                         Implementing with its approvals (ADR 0502), then sets `[-]` and records the
 *                                         start (session, HEAD and the digest of spec, plan and tasks) in Flow's
 *                                         record; a task ticked `[x]` by hand (no passing evidence) starts again;
 *                                         an approval whose documents changed since refuses it (A-3, AC-34), and
 *                                         the spec's approvals not yet recorded are bound to the content it starts on
 *   done <key> <task> --command <cmd>     runs the check command (`runEvidence`), keeps the attempt in the record and
 *                                         sets `[x]` only on exit 0 at a clean HEAD; refuses a secret-looking command
 *   wave <key> [--json]                   refuses as `start` does, then prints the build's next wave (`nextWave`), its
 *                                         `[ ]` tasks set to `[~]`; a wave holding a failed task is printed again, so
 *                                         the next one never starts
 *   `check` writes nothing, so it names what `task start` fixes (T024): `changedTasks`, each task in progress whose
 *   documents changed since its start, which `resetChanged` sets back to `[ ]` with the reason (AC-24); `handTicks`,
 *   each `[x]` with no passing evidence (AC-22).
 * Boundary: writes the task's line in tasks.md and the record (`.flow/record/<key>.json`); runs the check command in
 *   the repository; commits and pushes nothing (the session's commits carry both files).
 * Runtime: node
 * Governing contract: STA-1945 FR-23, FR-24, FR-30, AC-22, AC-23, AC-24, AC-25, AC-34, P-028, P-029, P-034, NFR-5.
 * Secrets: none; the command's output is kept only as a digest, and a secret-looking command never runs.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { schemeFor } from "../adapters/tracker/index.mjs";
import { checkApproval, specDir, statusOf } from "./gate.mjs";
import { passed, runEvidence } from "../lib/evidence.mjs";
import { git } from "../lib/git.mjs";
import { ENV_PREFIX, NAME } from "../lib/product.mjs";
import {
  bindApprovals,
  docsIn,
  readRecord,
  recordPath,
  staleApprovals,
  updateRecord,
} from "../lib/record.mjs";
import { parseTasks } from "../lib/spec-parse.mjs";
import { nextWave, waves, WaveError } from "../lib/waves.mjs";

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
 * The spec folder and tasks.md of `key` in `root`.
 * @param {string} root
 * @param {string} key
 */
function tasksOf(root, key) {
  const keys = schemeFor(root);
  const k = keys.parse(key);
  if (!k) throw new TaskError(`${key} is not an issue key`);
  const found = specDir({ root, key: k, keys });
  if (!found.dir || !existsSync(join(root, found.dir, "tasks.md")))
    throw new TaskError(found.error ?? `${found.dir} has no tasks.md`);
  const dir = join(root, found.dir);
  const file = join(dir, "tasks.md");
  return { k, shown: found.dir, dir, file, text: readFileSync(file, "utf8") };
}

/**
 * The spec folder and task of `key` in `root`.
 * @param {string} root
 * @param {string} key
 * @param {string} id
 */
function locate(root, key, id) {
  const { k, shown, dir, file, text } = tasksOf(root, key);
  const task = parseTasks(text).find((t) => t.id === id && !t.struck);
  if (!task) throw new TaskError(`${shown}/tasks.md has no live ${id}`);
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
  // AC-22: a hand tick (no passing evidence in the record) is not done; it starts again
  const record = readRecord(root, k);
  if (task.marker === "x" && (!record || passed(record.tasks[id]))) problems.push(`${id} is done`);
  for (const a of record ? staleApprovals(record, docsIn(dir)) : [])
    problems.push(
      `${a.docs.join(" and ")} changed since the ${a.stage} approval (${a.who} ${a.when}): approve it again`,
    );
  if (problems.length) return problems;
  writeFileSync(file, setMarker(text, id, "-"));
  updateRecord(root, k, (r) => ({
    ...bindApprovals(r, docsIn(dir)),
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
    throw new TaskError(
      `the spec, plan or tasks changed since ${id} started: \`${NAME} task start ${key} ${id}\` restarts it`,
    );
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
 * Each live task in progress whose documents changed since its start (FR-23): its start's digest is not `docs`.
 * @param {string} tasks the tasks.md text
 * @param {import("../lib/record.mjs").FlowRecord | undefined} record
 * @param {string} docs `docsDigest` of the spec folder now
 */
export const changedTasks = (tasks, record, docs) =>
  parseTasks(tasks).filter(
    (t) =>
      t.marker === "-" &&
      !t.struck &&
      record?.started?.[t.id] &&
      record.started[t.id].docs !== docs,
  );

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
  let text = readFileSync(file, "utf8");
  const reset = changedTasks(text, record, docsDigest(dir));
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

/**
 * The next wave of `key`'s build (FR-24), its `[ ]` tasks set to `[~]` (queued): the wave's number, how many waves
 * there are, and its tasks still to run in document order; a task already `[-]` (a dead session's) is in it, to finish
 * with `task done`, and an optional task left `[ ]` is not. Undefined once every wave is done.
 * @param {string} root
 * @param {string} key
 * @returns {{ wave: number, of: number, tasks: import("../lib/spec-parse.mjs").Task[] } | undefined}
 * @throws {TaskError} when the spec has no tasks.md, is not Tasked or Implementing with its approvals (markers follow
 *   the spec's state, as at `task start`), or its deps form a cycle
 */
export function queueWave(root, key) {
  const { dir, file, text } = tasksOf(root, key);
  const spec = readFileSync(join(dir, "spec.md"), "utf8");
  const status = statusOf(spec);
  const problems = checkApproval(spec);
  if (status !== "tasked" && status !== "implementing")
    problems.unshift(
      `the spec is ${status || "without a status"}: a wave is queued at Tasked or Implementing`,
    );
  if (problems.length) throw new TaskError(problems.join("; "));
  const tasks = parseTasks(text);
  let all;
  try {
    all = waves(tasks);
  } catch (error) {
    if (!(error instanceof WaveError)) throw error;
    throw new TaskError(error.message);
  }
  const next = nextWave(tasks, all);
  if (!next) return undefined;
  const queued = tasks.filter((t) => !t.struck && next.ids.includes(t.id));
  const out = queued
    .filter((t) => t.marker === " ")
    .reduce((acc, t) => setMarker(acc, t.id, "~"), text);
  if (out !== text) writeFileSync(file, out);
  return {
    wave: next.wave,
    of: all.length,
    tasks: queued.map((t) => (t.marker === " " ? { ...t, marker: /** @type {const} */ ("~") } : t)),
  };
}

/**
 * `fflow task wave`: queues the build's next wave and prints its tasks, or that every wave is done; `--json` writes
 * the wave as the console's data, tagged `fflow.wave/1`.
 * @param {import("../lib/console.mjs").Io} io
 * @param {{ key: string }} options
 * @returns {number}
 */
export function wave(io, { key }) {
  const root = git(io.cwd, ["rev-parse", "--show-toplevel"]).out || io.cwd;
  const next = queueWave(root, key);
  if (io.json) {
    io.output.json({ schema: `${NAME}.wave/1`, key, ...(next ?? { tasks: [] }) });
    return 0;
  }
  if (!next) {
    io.output.success(`every wave of ${key.toUpperCase()} is done: \`${NAME} gate run\``);
    return 0;
  }
  io.output.info(
    `${key.toUpperCase()}: wave ${next.wave} of ${next.of}, ${next.tasks.length} to run`,
  );
  for (const t of next.tasks)
    io.output.line(
      `${t.id} [${t.marker}]${t.optional ? " optional" : ""} ${t.checkpoint ?? t.paths.join(" ")}`,
    );
  return 0;
}

/**
 * `fflow task start`: each problem that refuses the start, or that the task is in progress.
 * @param {import("../lib/console.mjs").Io} io
 * @param {{ key: string, id: string, session?: string }} options
 * @returns {number}
 */
export function start(io, { key, id, session }) {
  const root = git(io.cwd, ["rev-parse", "--show-toplevel"]).out || io.cwd;
  for (const r of resetChanged(root, key)) io.output.warn(`${r.id} is back to [ ]: ${r.reason}`);
  // the same session name `session stop` records: the option, then the environment
  const problems = startTask(root, key, id, {
    session: session ?? process.env[`${ENV_PREFIX}SESSION`],
  });
  for (const p of problems) io.output.error(`${NAME} task start: ${id}: ${p}`);
  if (!problems.length) io.output.info(`${id} is in progress`);
  return problems.length ? 1 : 0;
}

/**
 * `fflow task done`: runs the check and says whether the task is done or why it stays in progress.
 * @param {import("../lib/console.mjs").Io} io
 * @param {{ key: string, id: string, command: string, echo: boolean }} options
 * @returns {number}
 */
export function done(io, { key, id, command, echo }) {
  const root = git(io.cwd, ["rev-parse", "--show-toplevel"]).out || io.cwd;
  const { done: finished, evidence } = doneTask(root, key, id, command, { echo });
  if (finished) {
    io.output.success(`${id} is done`);
    return 0;
  }
  const why =
    evidence.error ??
    (evidence.exit ? `exit ${evidence.exit}` : "the tree is not clean or HEAD moved");
  io.output.error(`${id} stays in progress: ${why} (the attempt is recorded)`);
  return 1;
}
