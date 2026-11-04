/**
 * Figentra Flow file contract:
 * Purpose: the wave graph of tasks.md (FR-24, FR-25). `waves` puts each live task in the first wave after its `deps`
 *   where no task shares one of its paths and fewer than `MAX_PARALLEL` run; a checkpoint runs alone after every task
 *   above it, and every task below it comes later. `nextWave` names the first wave the build has not finished, with
 *   the tasks still to run in it, so a failed task holds its wave and a dead session restarts there; an optional task
 *   left `[ ]` is never in it.
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
  // a checkpoint needs no clash rule: its implied deps already leave it alone in its wave
  const clash = (/** @type {Task} */ a, /** @type {Task} */ b) =>
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
 * A wave of the build: its number from 1, the tasks the build still owes in it in document order, and whether one of
 *   them is already queued or in progress (a dead or failed session's, so the wave restarts rather than starts).
 * @typedef {{ wave: number, ids: string[], restarts: boolean }} Wave
 */

/**
 * A task the build still owes: not `[x]`, and not an optional task left `[ ]`. An optional task runs only once someone
 * starts it, and a task with `deps:` on one left `[ ]` runs without it (FR-25).
 * @param {Task} t
 */
const owed = (t) => t.marker !== "x" && !(t.optional && t.marker === " ");

/**
 * The first wave with a task the build still owes, with those tasks; undefined once every wave is done.
 * @param {Task[]} tasks
 * @param {string[][]} [all] `waves(tasks)`, when the caller has it
 * @returns {Wave | undefined}
 * @throws {WaveError} on a dependency cycle
 */
export function nextWave(tasks, all = waves(tasks)) {
  const byId = new Map(tasks.filter((t) => !t.struck).map((t) => [t.id, t]));
  const due = all.map((ids) => ids.map((id) => /** @type {Task} */ (byId.get(id))).filter(owed));
  const i = due.findIndex((ts) => ts.length > 0);
  if (i < 0) return undefined;
  return {
    wave: i + 1,
    ids: due[i].map((t) => t.id),
    restarts: due[i].some((t) => t.marker === "-" || t.marker === "~"),
  };
}
