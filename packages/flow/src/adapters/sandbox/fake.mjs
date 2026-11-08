/**
 * Figentra Flow file contract:
 * Purpose: the fake build sandbox: records each run in memory, queued, answers it by id, lists a spec's runs newest
 *   first a page at a time (the cursor is the last run's id) and cancels one; `settle` moves a run to its end for
 *   tests. Nothing builds, and every run says so in its `detail`.
 * Boundary: process memory only; no network, no repository write. The Studio's MCP surface binds it until a real
 *   sandbox driver exists.
 * Runtime: node
 * Governing contract: master plan 2026-11-07 Phase 5.
 * Secrets: none.
 */
import { randomUUID } from "node:crypto";

/**
 * The fake sandbox.
 * @param {{ now?: () => string, id?: () => string }} [options] the clock and the run id, for tests
 * @returns {import("./index.mjs").BuildSandbox & { settle: (runId: string, status: "passed" | "failed") => void }}
 */
export function fakeSandbox({
  now = () => new Date().toISOString(),
  id = () => `run_${randomUUID().replaceAll("-", "")}`,
} = {}) {
  /** @type {Map<string, import("./index.mjs").RunState>} */
  const runs = new Map();
  return {
    kind: "fake",
    start: async (request) => {
      const run = {
        ...request,
        runId: id(),
        status: /** @type {const} */ ("queued"),
        startedAt: now(),
        finishedAt: null,
        detail: "the fake sandbox records the run; nothing builds",
      };
      runs.set(run.runId, run);
      return { ...run };
    },
    status: async (runId) => {
      const run = runs.get(runId);
      return run && { ...run };
    },
    cancel: async (runId, onBehalfOf) => {
      const run = runs.get(runId);
      if (!run) return undefined;
      const cancelled = {
        ...run,
        status: /** @type {const} */ ("cancelled"),
        finishedAt: now(),
        cancelledBy: onBehalfOf,
      };
      runs.set(runId, cancelled);
      return { ...cancelled };
    },
    list: async ({ key, status, limit, after }) => {
      const matching = [...runs.values()]
        .toReversed()
        .filter((run) => run.key === key && (status === undefined || run.status === status));
      const from = after === undefined ? 0 : matching.findIndex((run) => run.runId === after) + 1;
      // An unknown cursor answers an empty last page.
      if (after !== undefined && from === 0) return { items: [], next: null };
      const items = matching.slice(from, from + limit);
      const more = from + limit < matching.length;
      return {
        items: items.map((run) => ({ ...run })),
        next: more ? (items.at(-1)?.runId ?? null) : null,
      };
    },
    settle: (runId, status) => {
      const run = runs.get(runId);
      if (run) runs.set(runId, { ...run, status, finishedAt: now() });
    },
  };
}
