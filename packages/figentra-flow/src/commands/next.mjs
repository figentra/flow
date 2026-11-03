/**
 * Figentra Flow file contract:
 * Purpose: `fflow next [<key>] [--json]` (FR-13; declared in src/lib/console.mjs, which refuses a failed `next`
 *   and has `show` print the rest): the task's current stage and the command that moves it on, read from Flow's
 *   record and the spec's `**Status**`, and at the build stage the wave tasks.md's markers leave (FR-24); the key
 *   defaults to the branch's. The record is read where the task lives: its checkout, else its branch (the newer of
 *   the local and the last fetched pushed one), and the spec and its wave from the same place. It warns when the
 *   record has commits origin does not.
 * Boundary: reads the record, the spec and git; writes nothing and never fetches.
 * Runtime: node
 * Governing contract: STA-1945 (FR-13, AC-13, P-017).
 * Secrets: none.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { schemeFor } from "../adapters/tracker/index.mjs";
import { specDir, statusOf } from "./gate.mjs";
import { specsDirs } from "../lib/flow-dir.mjs";
import { git, mainCheckout, worktrees } from "../lib/git.mjs";
import { NAME } from "../lib/product.mjs";
import { emptyRecord, readRecord, readRecordAt, RecordError, unpushed } from "../lib/record.mjs";
import { parseTasks } from "../lib/spec-parse.mjs";
import { nextStep } from "../lib/stages.mjs";
import { nextWave, WaveError } from "../lib/waves.mjs";

/**
 * What the spec of `key` says: its folder and declared status, when the folder exists, and the build's next wave
 * from tasks.md's markers (`built` once tasks.md has tasks and none is owed; neither on a dependency cycle). With
 * `ref`, the spec is read from that commit, as the record is, rather than from the checkout at `root`.
 * @param {string} root
 * @param {string} key
 * @param {string} [ref]
 * @returns {{ specDir?: string, specStatus?: string, wave?: import("../lib/waves.mjs").Wave, built?: boolean }}
 */
export function specFacts(root, key, ref) {
  const keys = schemeFor(root);
  /** @type {(file: string) => string | undefined} */
  const read = ref
    ? (file) => {
        const shown = git(root, ["show", `${ref}:${file}`]);
        return shown.ok ? shown.out : undefined;
      }
    : (file) => (existsSync(join(root, file)) ? readFileSync(join(root, file), "utf8") : undefined);
  const dir = ref ? specDirAt(root, ref, key, keys) : specDir({ root, key, keys }).dir;
  const spec = dir === undefined ? undefined : read(`${dir}/spec.md`);
  if (spec === undefined) return {};
  const facts = { specDir: dir, specStatus: statusOf(spec) };
  const text = read(`${dir}/tasks.md`);
  if (text === undefined) return facts;
  const tasks = parseTasks(text);
  try {
    const wave = nextWave(tasks);
    return wave ? { ...facts, wave } : { ...facts, built: tasks.length > 0 };
  } catch (error) {
    // `gate tasks` names the cycle; the build stage then waits on it
    if (error instanceof WaveError) return facts;
    throw error;
  }
}

/**
 * The one `<key>-*` spec folder at `ref`, as `specDir` finds it in a checkout.
 * @param {string} root
 * @param {string} ref
 * @param {string} key lower-cased
 * @param {import("../adapters/tracker/index.mjs").KeyScheme} keys
 */
function specDirAt(root, ref, key, keys) {
  const specs = specsDirs(root).dir;
  const listed = git(root, ["ls-tree", "--name-only", `${ref}:${specs}`]);
  const found = listed.ok ? listed.out.split("\n").filter((d) => keys.folderKey(d) === key) : [];
  return found.length === 1 ? `${specs}/${found[0]}` : undefined;
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
 *             command: string, wave?: import("../lib/waves.mjs").Wave, unpushed: boolean } | { ok: false, problem: string }}
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
  if (task.ok === false) return { ok: false, problem: task.problem };
  const root = task.path ?? top.out;
  const ref = task.branch ? newest(task.root, task.branch, !!task.local) : undefined;
  let record;
  try {
    record = ref ? readRecordAt(task.root, ref, k) : readRecord(root, k);
  } catch (error) {
    if (error instanceof RecordError) return { ok: false, problem: error.message };
    throw error;
  }
  const step = nextStep(
    record ?? emptyRecord(k),
    ref ? specFacts(task.root, k, ref) : specFacts(root, k),
  );
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

/**
 * `fflow next`'s output, once `next` found the step: the stage and the command that moves it on; `--json` writes
 * them as the console's data, tagged `fflow.next/1`.
 * @param {import("../lib/console.mjs").Io} io
 * @param {Extract<ReturnType<typeof next>, { ok: true }>} result
 */
export function show(io, result) {
  if (io.json) {
    io.output.json({ schema: `${NAME}.next/1`, ...result, ok: undefined });
    return;
  }
  io.output.line(
    `${result.key.toUpperCase()}: ${result.stage}${result.recorded ? ` (${result.state})` : " (no record yet)"}`,
  );
  io.output.line(result.command);
  if (result.wave)
    io.output.info(
      `wave ${result.wave.wave} ${result.wave.restarts ? "restarts" : "starts"} at ${result.wave.ids[0]}: ${result.wave.ids.join(", ")}`,
    );
  if (result.unpushed)
    io.output.warn(
      `the record has commits origin lacks: push the branch (\`${NAME} session stop\` retries)`,
    );
}
