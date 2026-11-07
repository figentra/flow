/**
 * Figentra Flow file contract:
 * Purpose: the fake build sandbox: records each run in memory, queued, and answers it by id; `settle` moves a run to
 *   its end for tests. Nothing builds, and every run says so in its `detail`.
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
    settle: (runId, status) => {
      const run = runs.get(runId);
      if (run) runs.set(runId, { ...run, status, finishedAt: now() });
    },
  };
}
