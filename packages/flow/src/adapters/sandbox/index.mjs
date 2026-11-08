/**
 * Figentra Flow file contract:
 * Purpose: the build-sandbox port (the Studio's write surface, master plan Phase 5): where a Studio run builds a
 *   tasked spec. A run is started for one spec in one sandbox region on behalf of one person, read back by its id,
 *   listed by its spec (newest first, a page at a time) and cancelled on behalf of a person while it has not finished.
 *   Only the EU and US sandboxes exist, and they hold no real data.
 * Boundary: the port's shape and its regions only; `./fake.mjs` is the one driver until a real sandbox exists. A driver
 *   never holds a shared service key: the run carries the person it acts for (`onBehalfOf`, Stackra ADR 0209 A8,
 *   STA-2558), and the sandbox checks that person's grants.
 * Runtime: node
 * Governing contract: master plan 2026-11-07 Phase 5; Stackra ADR 0209 A8 (STA-2558).
 * Secrets: none.
 */

/** The sandbox regions: EU and US only, never a region with real data. */
export const SANDBOX_REGIONS = Object.freeze(["eu", "us"]);

/** A run's states, in the order a run moves through them; the last three are finished. */
export const RUN_STATUSES = Object.freeze(["queued", "running", "passed", "failed", "cancelled"]);

/** The states a run never leaves. */
export const FINISHED = Object.freeze(["passed", "failed", "cancelled"]);

/**
 * @typedef {{ repo: string, key: string, folder: string, region: string, onBehalfOf: string }} RunRequest
 * @typedef {"queued" | "running" | "passed" | "failed" | "cancelled"} RunStatus
 * @typedef {RunRequest & { runId: string, status: RunStatus, startedAt: string, finishedAt: string | null,
 *             detail: string, cancelledBy?: string }} RunState
 * @typedef {{ key: string, status?: RunStatus, limit: number, after?: string }} RunQuery
 * @typedef {{ items: RunState[], next: string | null }} RunPage
 * @typedef {{ kind: string, start: (request: RunRequest) => Promise<RunState>,
 *             status: (runId: string) => Promise<RunState | undefined>,
 *             cancel: (runId: string, onBehalfOf: string) => Promise<RunState | undefined>,
 *             list: (query: RunQuery) => Promise<RunPage> }} BuildSandbox
 */
