/**
 * Figentra Flow file contract:
 * Purpose: the wave graph of tasks.md (FR-24, FR-25). `waves` puts each live task in the first wave after its `deps`
 *   where no task shares one of its paths and fewer than `MAX_PARALLEL` run; a checkpoint runs alone after every task
 *   above it, and every task below it comes later. `nextWave` names the first wave the build has not finished, with
 *   the tasks still to run in it, so a failed task holds its wave and a dead session restarts there.
 * Boundary: pure: reads nothing, writes nothing.
 * Runtime: node
 * Governing contract: STA-1945 (FR-24, FR-25, AC-25, AC-26, P-029, P-030).
 * Secrets: none.
 */

/** @typedef {import("./spec-parse.mjs").Task} Task */

/** The most tasks of one wave, so the most subagents the build runs at once (P-029). */
export const MAX_PARALLEL = 5;

/** A dependency cycle among the tasks: `gate tasks` names it too. */
export class WaveError extends Error {}

/**
 * The live tasks' ids by wave, each wave in document order.
 * @param {Task[]} tasks
 * @returns {string[][]}
 * @throws {WaveError} on a dependency cycle (a checkpoint's place counts as one)
 */
export function waves(tasks) {
  const live = tasks.filter((t) => !t.struck);
  const byId = new Map(live.map((t) => [t.id, t]));
  const order = new Map(live.map((t, i) => [t.id, i]));
  /** FR-25: a checkpoint waits for every task above it; every task below waits for the checkpoint. */
  const implied = new Map();
  let checkpoint;
  for (const [i, t] of live.entries()) {
    implied.set(
      t.id,
      t.checkpoint !== undefined
        ? live.slice(0, i).map((x) => x.id)
        : checkpoint
          ? [checkpoint]
          : [],
    );
    if (t.checkpoint !== undefined) checkpoint = t.id;
  }
  /** @type {string[][]} */
  const out = [];
  /** @type {Map<string, number>} */
  const placed = new Map();
  const open = new Set();
  const clash = (/** @type {Task} */ a, /** @type {Task} */ b) =>
    a.checkpoint !== undefined ||
    b.checkpoint !== undefined ||
    a.paths.some((p) => b.paths.includes(p));
  /** @returns {number} */
  const place = (/** @type {Task} */ t) => {
    const at = placed.get(t.id);
    if (at !== undefined) return at;
    if (open.has(t.id)) throw new WaveError(`tasks.md: dependency cycle through ${t.id}`);
    open.add(t.id);
    let w = 0;
    for (const d of [...t.deps, ...implied.get(t.id)]) {
      const dep = byId.get(d);
      if (dep) w = Math.max(w, place(dep) + 1);
    }
    open.delete(t.id);
    const full = (/** @type {number} */ i) =>
      out[i] &&
      (out[i].length >= MAX_PARALLEL ||
        out[i].some((id) => clash(/** @type {Task} */ (byId.get(id)), t)));
    while (full(w)) w += 1;
    (out[w] ??= []).push(t.id);
    placed.set(t.id, w);
    return w;
  };
  for (const t of live) place(t);
  return out.map((ids) => ids.toSorted((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)));
}

/**
 * A task the build still owes: not `[x]`, and not an optional task left `[ ]` (it may be skipped, FR-25).
 * @param {Task} t
 */
const owed = (t) => t.marker !== "x" && !(t.optional && t.marker === " ");

/**
 * The first wave with a task the build still owes, numbered from 1, with every task of it not yet `[x]` (an optional
 * one too) in document order; undefined once every wave is done.
 * @param {Task[]} tasks
 * @returns {{ wave: number, ids: string[] } | undefined}
 * @throws {WaveError} on a dependency cycle
 */
export function nextWave(tasks) {
  const byId = new Map(tasks.filter((t) => !t.struck).map((t) => [t.id, t]));
  const all = waves(tasks);
  const i = all.findIndex((ids) => ids.some((id) => owed(/** @type {Task} */ (byId.get(id)))));
  if (i < 0) return undefined;
  return { wave: i + 1, ids: all[i].filter((id) => byId.get(id)?.marker !== "x") };
}
