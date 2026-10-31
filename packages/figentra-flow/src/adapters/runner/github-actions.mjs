/**
 * Figentra Flow file contract:
 * Purpose: the `github-actions` runner (AC-038): dispatch the repository's gate workflow (`figentra-flow init --runner
 *   github-actions` writes it) on the default branch with the head's `sha` and `branch`, find that run by its title,
 *   follow it to the end, and map its two jobs to `gate run`'s exit code: the `post` job not succeeding is 4 (not
 *   posted), else the `check` job decides 0 or 1. A run that cannot be found, is cancelled or times out is 4, never
 *   green.
 * Boundary: GitHub calls only, through the credentials port; runs nothing on the caller's machine (FR-9).
 * Runtime: node
 * Governing contract: STA-1729 phase A (A3).
 * Secrets: none here. The workflow's `post` job reads the gate App's id and key from repository secrets; its `check`
 *   job, which runs the change's code, holds none.
 */
import { ConfigError } from "../../lib/config.mjs";
import { github } from "../../lib/github.mjs";
import { NAME } from "../../lib/product.mjs";

/** The workflow file `init` writes when the block names none. */
export const GATE_WORKFLOW = `${NAME}-gate.yml`;

/** Blocks the thread for `ms` (the runner port is synchronous). */
const sleepSync = (/** @type {number} */ ms) =>
  void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * @param {any} block the configuration's `runner`
 * @param {{ root?: string, api?: import("../../lib/github.mjs").Api, sleep?: (ms: number) => void,
 *           now?: () => number, timeoutMs?: number, pollMs?: number, log?: (s: string) => void }} [options]
 * @returns {import("./index.mjs").Runner}
 */
export function githubActionsRunner(block, options = {}) {
  const {
    sleep = sleepSync,
    now = Date.now,
    timeoutMs = 90 * 60_000,
    pollMs = 15_000,
    log = console.error,
  } = options;
  const workflow = block.workflow ?? GATE_WORKFLOW;
  if (!/^[\w.-]+\.ya?ml$/.test(workflow))
    throw new ConfigError(
      `runner "github-actions": workflow is not a workflow file name: ${workflow}`,
    );
  return {
    kind: "github-actions",
    wraps: false,
    program: "gh",
    run(job) {
      const api = options.api ?? github(options.root ?? job.dir);
      const actions = `/repos/${job.repository}/actions`;
      const started = now();
      const dispatched = api("POST", `${actions}/workflows/${workflow}/dispatches`, {
        ref: job.base,
        inputs: { sha: job.sha, branch: job.branch },
      });
      if (!dispatched.ok) {
        log(`${NAME} gate: dispatching ${workflow} failed: ${dispatched.err}`);
        return 2;
      }
      // The run appears a few seconds after the dispatch; its title carries the sha (`run-name`).
      /** @type {any} */
      let run;
      for (let tries = 0; !run && tries < 20; tries++) {
        if (tries) sleep(Math.min(pollMs, 5_000));
        const listed = api(
          "GET",
          `${actions}/workflows/${workflow}/runs?event=workflow_dispatch&per_page=30`,
        );
        run = listed.json?.workflow_runs?.find(
          (/** @type {any} */ w) =>
            String(w.display_title ?? "").includes(job.sha) &&
            Date.parse(w.created_at) >= started - 60_000,
        );
      }
      if (!run) {
        log(`${NAME} gate: the dispatched ${workflow} run did not appear`);
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
      const jobs = api("GET", `${actions}/runs/${run.id}/jobs`).json?.jobs ?? [];
      const conclusion = (/** @type {string} */ name) =>
        jobs.find((/** @type {any} */ j) => j.name === name)?.conclusion;
      if (conclusion("post") !== "success") return 4;
      return conclusion("check") === "success" ? 0 : 1;
    },
  };
}
