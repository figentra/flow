#!/usr/bin/env node
/**
 * Figentra Flow file contract:
 * Purpose: the `github-actions` runner's verdict (the L2 design, PR F): main's approval workflow runs this on the
 *   gate workflow's `workflow_run`. It reads that run from the API and posts the gate's status on its head as the Flow
 *   App: `success` when the `check` job succeeded, `failure` otherwise (a missing job too), and `pending` ("the owner
 *   reviews it") when the PR changes `.github/workflows/**` and the owner has not approved that head, since the PR
 *   controls its own copy of the gate workflow.
 * Boundary: refuses (posts nothing, exits 0) unless the automation variable allows it, `RUN_ID` is digits, and the
 *   run is this repository's, of the gate workflow's path, for a `pull_request`, completed, from a head in this
 *   repository that an open PR still points at. GitHub REST only; reads with the job's token, writes one status with a
 *   `verdict` token from `app-token.mjs`. Never reads the run's artifacts or logs, never checks out or runs the PR's
 *   code. Exits 1 only on an infrastructure error (an API or mint failure). With `secrets.oidc` this job is the only
 *   writer of `fflow/gate` (STA-2134): `GITHUB_TOKEN` only reads, and off main's approval job (a box, a workstation,
 *   a user's token) the mint refuses and nothing is posted.
 * Runtime: node (GitHub Actions)
 * Governing contract: ADR 0523; the L2 design (verdict, PR F; Threat model); STA-1945.
 * Secrets: `GITHUB_TOKEN` from the environment; the Flow App token is minted in process and revoked; neither is
 *   printed.
 */
import { pathToFileURL } from "node:url";

import { withToken } from "./app-token.mjs";
import { rest } from "./approve-check.mjs";
import { CHECK_JOB } from "./gate-workflow.mjs";
import { AUTOMATION_RUNS, AUTOMATION_VARIABLE, STATUS_CONTEXT } from "./product.mjs";

/** @typedef {import("./approve-check.mjs").Rest} Rest */

const SHA = /^[0-9a-f]{40}$/;
const WORKFLOWS = ".github/workflows/";
const PAGE = 100;
/** GitHub lists at most 3000 files of a PR; past that the owner reviews it. */
const MAX_PAGES = 30;

/** Raised for an answer that is not the expected one: an infrastructure error, so the job goes red. */
class ApiError extends Error {}

/**
 * One GET's JSON, or an `ApiError` naming the path and status.
 * @param {Rest} api
 * @param {string} path
 */
async function get(api, path) {
  const r = await api("GET", path);
  if (!r.ok || r.json === undefined)
    throw new ApiError(`verdict: GET ${path.split("?")[0]} answered ${r.status}`);
  return r.json;
}

/**
 * Every item of a listing, and whether the listing ended before `MAX_PAGES`.
 * @param {Rest} api
 * @param {string} path
 */
async function all(api, path) {
  const items = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const json = await get(api, `${path}?per_page=${PAGE}&page=${page}`);
    if (!Array.isArray(json)) throw new ApiError(`verdict: GET ${path} answered no list`);
    items.push(...json);
    if (json.length < PAGE) return { items, complete: true };
  }
  return { items, complete: false };
}

/**
 * What to post for gate run `runId`, or why nothing is posted.
 * @param {{ api: Rest, repo: string, repoId: string, runId: string, gatePath: string, owner?: string }} input
 * @returns {Promise<{ skip: string } | { sha: string, state: "success" | "failure" | "pending",
 *   description: string, url: string }>}
 */
export async function decide({ api, repo, repoId, runId, gatePath, owner }) {
  if (!/^\d+$/.test(runId)) return { skip: `RUN_ID ${JSON.stringify(runId)} is not a run id` };
  if (!/^\d+$/.test(repoId)) return { skip: "GITHUB_REPOSITORY_ID is not an id" };
  const run = await get(api, `/repos/${repo}/actions/runs/${runId}`);
  if (String(run.repository?.id) !== repoId)
    return { skip: `run ${runId} is another repository's` };
  // GitHub may suffix the path with the ref it ran from (`…/x.yml@refs/pull/1/merge`); the file is what counts.
  const path = String(run.path ?? "").replace(/@.*$/, "");
  if (path !== gatePath) return { skip: `run ${runId} is ${path}, not ${gatePath}` };
  if (run.event !== "pull_request") return { skip: `run ${runId} is a ${run.event} run` };
  if (run.status !== "completed") return { skip: `run ${runId} is ${run.status}` };
  if (String(run.head_repository?.id) !== repoId)
    return { skip: `run ${runId}'s head is in another repository (a fork)` };
  const sha = String(run.head_sha ?? "");
  if (!SHA.test(sha)) return { skip: `run ${runId}'s head is not a commit` };
  const pulls = await get(api, `/repos/${repo}/commits/${sha}/pulls`);
  const pr = (Array.isArray(pulls) ? pulls : []).find(
    (/** @type {any} */ p) =>
      p.state === "open" && p.head?.sha === sha && String(p.head?.repo?.id) === repoId,
  );
  if (!pr) return { skip: `no open PR's head is ${sha} (it moved or closed)` };
  const url = String(run.html_url ?? "");

  const jobs = await get(
    api,
    `/repos/${repo}/actions/runs/${runId}/jobs?filter=latest&per_page=100`,
  );
  const check = jobs.jobs?.find((/** @type {any} */ j) => j.name === CHECK_JOB);
  const passed = check?.conclusion === "success";

  const files = await all(api, `/repos/${repo}/pulls/${pr.number}/files`);
  const touches =
    !files.complete ||
    files.items.some((/** @type {any} */ f) =>
      [f.filename, f.previous_filename].some((n) => String(n ?? "").startsWith(WORKFLOWS)),
    );
  if (touches) {
    const reviews = (await all(api, `/repos/${repo}/pulls/${pr.number}/reviews`)).items.filter(
      (/** @type {any} */ r) =>
        owner && r.user?.login === owner && r.user?.type === "User" && r.commit_id === sha,
    );
    // The owner's newest verdict at this head; a comment is not one, a dismissal undoes one.
    const last = reviews.filter((/** @type {any} */ r) => r.state !== "COMMENTED").at(-1);
    if (last?.state !== "APPROVED")
      return {
        sha,
        state: "pending",
        description: "the gate workflow changed: the owner reviews it",
        url,
      };
  }
  if (passed) return { sha, state: "success", description: `${CHECK_JOB} passed`, url };
  return {
    sha,
    state: "failure",
    description: check
      ? `${CHECK_JOB} ended ${check.conclusion ?? "without a conclusion"}`
      : `the run has no ${CHECK_JOB} job`,
    url,
  };
}

/**
 * Reads the gate run and posts its verdict.
 * @param {Record<string, string | undefined>} env
 * @param {{ read?: Rest, write?: (token: string) => Rest, withToken?: typeof withToken,
 *           log?: (s: string) => void }} [deps]
 * @returns {Promise<number>} 0 posted or refused, 1 an infrastructure error
 */
export async function main(env, deps = {}) {
  const log = deps.log ?? console.log;
  const base = env.GITHUB_API_URL;
  const automation = env.AUTOMATION ?? "";
  if (!AUTOMATION_RUNS.includes(automation)) {
    log(`::notice::${AUTOMATION_VARIABLE} is ${JSON.stringify(automation)}: automation is frozen`);
    return 0;
  }
  const repo = String(env.GITHUB_REPOSITORY);
  try {
    const v = await decide({
      api: deps.read ?? rest(String(env.GITHUB_TOKEN), base),
      repo,
      repoId: String(env.GITHUB_REPOSITORY_ID ?? ""),
      runId: String(env.RUN_ID ?? ""),
      gatePath: String(env.GATE_PATH ?? ""),
      owner: env.OWNER || undefined,
    });
    if ("skip" in v) {
      log(`::notice::no verdict: ${v.skip}`);
      return 0;
    }
    const oidc = JSON.parse(env.OIDC || "null");
    await (deps.withToken ?? withToken)(
      "verdict",
      { oidc, defaultBranch: env.DEFAULT_BRANCH, env },
      async (token) => {
        const r = await (deps.write ?? ((/** @type {string} */ t) => rest(t, base)))(token)(
          "POST",
          `/repos/${repo}/statuses/${v.sha}`,
          {
            state: v.state,
            context: STATUS_CONTEXT,
            description: v.description.slice(0, 140),
            ...(v.url.startsWith("https://") ? { target_url: v.url } : {}),
          },
        );
        if (!r.ok) throw new ApiError(`verdict: POST /repos/${repo}/statuses answered ${r.status}`);
      },
    );
    log(`${STATUS_CONTEXT} ${v.state} on ${v.sha}: ${v.description}`);
    return 0;
  } catch (error) {
    log(`::error::${/** @type {Error} */ (error).message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = await main(process.env);
