/**
 * Figentra Flow file contract:
 * Purpose: the `github-actions` runner (AC-038; the L2 design, PR F): the repository's gate workflow (`fflow init
 *   --runner github-actions` writes it) runs on every push to a PR, and main's approval workflow posts `fflow/gate`
 *   from its result as the Flow App. `gate run` dispatches nothing: it finds the `pull_request` run of the gate
 *   workflow for the head, follows it to the end, then waits for the gate's status on the head from a gate login
 *   (`apps.gate`), newer than the run: `success` is 0, `failure` or `error` is 1, and `pending` (the owner reviews a
 *   changed gate workflow), a status that never appears, a run that never appears (no open PR), is cancelled or times
 *   out is 4, never green.
 * Boundary: GitHub reads only, through the credentials port; runs nothing on the caller's machine (FR-9) and posts
 *   nothing.
 * Runtime: node
 * Governing contract: STA-1729 phase A (A3); the L2 design (PR F); STA-1945.
 * Secrets: none here, and none in the gate workflow: main's approval workflow mints the Flow App token in process.
 */
import { ConfigError } from "../../lib/config.mjs";
import { github } from "../../lib/github.mjs";
import { NAME, STATUS_CONTEXT } from "../../lib/product.mjs";

/** The workflow file `init` writes when the block names none. */
export const GATE_WORKFLOW = `${NAME}-gate.yml`;

/** Blocks the thread for `ms` (the runner port is synchronous). */
const sleepSync = (/** @type {number} */ ms) =>
  void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * @param {any} block the configuration's `runner`
 * @param {{ root?: string, api?: import("../../lib/github.mjs").Api, sleep?: (ms: number) => void,
 *           now?: () => number, timeoutMs?: number, verdictMs?: number, pollMs?: number,
 *           log?: (s: string) => void, gate?: string | string[] }} [options] `gate`: the gate App's logins
 * @returns {import("./index.mjs").Runner}
 */
export function githubActionsRunner(block, options = {}) {
  const {
    sleep = sleepSync,
    now = Date.now,
    timeoutMs = 90 * 60_000,
    verdictMs = 10 * 60_000,
    pollMs = 15_000,
    log = console.error,
  } = options;
  const workflow = block.workflow ?? GATE_WORKFLOW;
  if (!/^[\w.-]+\.ya?ml$/.test(workflow))
    throw new ConfigError(
      `runner "github-actions": workflow is not a workflow file name: ${workflow}`,
    );
  const logins = [options.gate ?? []].flat().filter(Boolean);
  return {
    kind: "github-actions",
    wraps: false,
    program: "gh",
    run(job) {
      if (!logins.length) {
        log(
          `${NAME} gate: the github-actions runner trusts ${STATUS_CONTEXT} only from "apps.gate"; set it`,
        );
        return 2;
      }
      const api = options.api ?? github(options.root ?? job.dir);
      const actions = `/repos/${job.repository}/actions`;
      const started = now();
      // The PR's push starts the run; it appears a few seconds later, or never without an open PR.
      /** @type {any} */
      let run;
      for (let tries = 0; !run && tries < 20; tries++) {
        if (tries) sleep(Math.min(pollMs, 5_000));
        run = api(
          "GET",
          `${actions}/workflows/${workflow}/runs?event=pull_request&head_sha=${job.sha}&per_page=1`,
        ).json?.workflow_runs?.[0];
      }
      if (!run) {
        log(`${NAME} gate: no pull_request run of ${workflow} for ${job.sha}; open the PR first`);
        return 4;
      }
      log(`${NAME} gate: following ${run.html_url}`);
      while (run.status !== "completed") {
        if (now() - started > timeoutMs) {
          log(`${NAME} gate: ${run.html_url} did not finish in time`);
          return 4;
        }
        sleep(pollMs);
        const polled = api("GET", `${actions}/runs/${run.id}`);
        if (polled.ok && polled.json) run = polled.json;
      }
      if (run.conclusion === "cancelled" || run.conclusion === "timed_out") return 4;
      // Main's approval workflow posts the verdict after the run; only a gate login's, newer than the run, counts.
      const finished = now();
      const after = Date.parse(run.updated_at ?? "") || 0;
      for (;;) {
        const statuses = api(
          "GET",
          `/repos/${job.repository}/commits/${job.sha}/statuses?per_page=100`,
        ).json;
        const status = (Array.isArray(statuses) ? statuses : []).find(
          (/** @type {any} */ s) =>
            s.context === STATUS_CONTEXT &&
            logins.includes(s.creator?.login) &&
            Date.parse(s.created_at) >= after,
        );
        if (status?.state === "success") return 0;
        if (status?.state === "failure" || status?.state === "error") return 1;
        if (status?.state === "pending") {
          log(`${NAME} gate: ${STATUS_CONTEXT} is pending: ${status.description}`);
          return 4;
        }
        if (now() - finished > verdictMs) {
          log(`${NAME} gate: ${STATUS_CONTEXT} did not appear on ${job.sha} after ${run.html_url}`);
          return 4;
        }
        sleep(pollMs);
      }
    },
  };
}
