/**
 * Figentra Flow file contract:
 * Purpose: the divergence report behind `fflow status --divergence` (STA-1945 FR-9, AC-11, P-014): for one repository,
 *   what its `.flow/lock.json` records (the Flow version, the preset's name, version and digest, the profile), the
 *   preset lag (the locked preset version against the installed one), the overrides by kind, the replacements and
 *   disables with their owner and review date, the overrides past their review date, and the drift (what the install
 *   check finds: owned files that differ from the lock, among them). A repository without a lock is "not synced",
 *   never skipped.
 * Boundary: reads the repository's config, lock, overrides and owned files; writes nothing.
 * Runtime: node
 * Governing contract: STA-1945 FR-2, FR-4, FR-9, AC-11.
 * Secrets: none.
 */
import { presetSource } from "./flow-dir.mjs";
import { LockError, readLock } from "./lock.mjs";
import { loadOverrides, reviewState } from "./overrides.mjs";
import { installProblems } from "./render.mjs";

/**
 * @typedef {{ repo: string, synced: boolean, flow?: string,
 *   preset?: { name: string, version: string, digest: string }, profile?: string,
 *   lag: { locked: string, latest: string } | undefined, overrides: Record<string, number>,
 *   reviewed: { id: string, kind: "replace" | "disable", owner: string, review: string,
 *     state: "ok" | "due" | "expired" }[],
 *   expired: string[], drift: string[], problems: string[] }} Divergence `expired` names each override past its
 *   review date (any kind); `problems` the overrides that are not valid
 */

/**
 * One repository's divergence from its preset.
 * @param {string} root
 * @param {{ latest?: string, now?: Date }} [options] `latest` is the preset version to measure lag against (the
 *   installed preset's by default); `now` the day review dates are measured from
 * @returns {Divergence}
 */
export function divergence(root, options = {}) {
  const now = options.now ?? new Date();
  /** @type {import("./lock.mjs").Lock | undefined} */
  let lock;
  try {
    lock = readLock(root);
  } catch (error) {
    // an unreadable lock is drift: installProblems names it
    if (!(error instanceof LockError)) throw error;
  }
  const latest = options.latest ?? presetSource(root).version;
  const { overrides, problems } = loadOverrides(root);
  /** @type {Record<string, number>} */
  const byKind = {};
  for (const o of overrides) byKind[o.kind] = (byKind[o.kind] ?? 0) + 1;
  return {
    repo: root,
    synced: lock !== undefined,
    flow: lock?.flow,
    preset: lock?.preset,
    profile: lock?.profile,
    lag:
      lock && lock.preset.version !== latest ? { locked: lock.preset.version, latest } : undefined,
    overrides: byKind,
    reviewed: overrides
      .filter((o) => o.kind === "replace" || o.kind === "disable")
      .map((o) => ({
        id: o.id,
        kind: /** @type {"replace" | "disable"} */ (o.kind),
        owner: o.owner ?? "",
        review: o.review ?? "",
        state: reviewState(o, now),
      })),
    expired: overrides.filter((o) => reviewState(o, now) === "expired").map((o) => o.id),
    drift: installProblems(root),
    problems,
  };
}
