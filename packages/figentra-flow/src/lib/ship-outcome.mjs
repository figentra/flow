/**
 * Figentra Flow file contract:
 * Purpose: what a ship did (STA-2137): `followRun` finds the deploy run a `fflow ship` dispatch started (a run of the
 *   workflow on the branch that was not listed before the dispatch, created after it, whose deploy job names the
 *   environment), waits for it, and `readOutcome` reads its `runway-outcome-<env>` artifact into one `ships` entry of
 *   Flow's record. The artifact's `runway-outcome.json` (`runway.outcome/v1`) decides: `deployed` for the environment
 *   and the dispatched revision is a success, anything else a failure; its `deploy-<env>.json` (Runway's
 *   `ProductDeploy`) adds the KV rows and uploads written, the held apps and any smoke or rollback field. A run without
 *   the artifact is `no outcome artifact`, never a success. `shipsOf` lists each record's newest ship for
 *   `fflow status`, re-reading (or first finding) a pending one's run.
 * Boundary: GitHub REST reads only, through the caller's `Api` (the credentials port); the artifact's zip is read in
 *   memory (`unzipFile`, stored or deflated entries, no zip64). Writes nothing.
 * Runtime: node
 * Governing contract: STA-2137; Runway delivery contract (STA-2138, products' deploy.yml); Stackra ADR 0436.
 * Secrets: none; the token stays inside `gh` or the wrapper, and the outcome and manifest carry none.
 */
import { inflateRawSync } from "node:zlib";

import { allRecords } from "./records.mjs";

/** The artifact a Runway product deploy uploads for `env`, holding its outcome and deploy manifest. */
export const outcomeArtifact = (/** @type {string} */ env) => `runway-outcome-${env}`;

/** The outcome file in that artifact. */
export const OUTCOME_FILE = "runway-outcome.json";

/** How far before the dispatch a run may be created and still be its own: clock skew with GitHub. */
export const SKEW_MS = 60_000;

/** The outcome of a completed run that uploaded no readable manifest. */
export const NO_OUTCOME = "no outcome artifact";

/**
 * @typedef {{ env: string, at: string, outcome: string, run?: number, url?: string, conclusion?: string,
 *   sha?: string, written?: number, uploaded?: number, held?: string[], smoke?: string, rollback?: string,
 *   problem?: string, workflow?: string, branch?: string, before?: number[] }} Ship
 *   `outcome` is `pending`, `success`, `failure` or `NO_OUTCOME`; `at` is the dispatch's time; `problem` why a read
 *   outcome is a failure; `workflow`, `branch` and `before` (the run ids listed before the dispatch) let a pending ship
 *   with no run yet find it later
 */

/**
 * The bytes of the first file of `zip` whose name `wanted` accepts, by the central directory; undefined when there is
 * none or the archive is not one.
 * @param {Buffer} zip
 * @param {(name: string) => boolean} wanted
 * @returns {Buffer | undefined}
 */
export function unzipFile(zip, wanted) {
  // A wrapper may print lines before the body: the archive starts at its first local header.
  const start = zip.indexOf("PK\x03\x04");
  if (start < 0) return undefined;
  const buf = zip.subarray(start);
  const end = buf.lastIndexOf("PK\x05\x06");
  if (end < 0) return undefined;
  let at = buf.readUInt32LE(end + 16);
  for (let n = buf.readUInt16LE(end + 10); n > 0; n--) {
    if (buf.readUInt32LE(at) !== 0x02014b50) return undefined;
    const length = buf.readUInt16LE(at + 28);
    const name = buf.toString("utf8", at + 46, at + 46 + length);
    if (wanted(name)) {
      const local = buf.readUInt32LE(at + 42);
      const data = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const raw = buf.subarray(data, data + buf.readUInt32LE(at + 20));
      const method = buf.readUInt16LE(at + 10);
      return method === 8 ? inflateRawSync(raw) : method === 0 ? raw : undefined;
    }
    at += 46 + length + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
  }
  return undefined;
}

/** @returns {any[]} the workflow's dispatched runs on `branch`, newest first (GitHub's order) */
const listRuns = (
  /** @type {import("./github.mjs").Api} */ api,
  /** @type {string} */ repo,
  /** @type {string} */ workflow,
  /** @type {string} */ branch,
) =>
  api(
    "GET",
    `/repos/${repo}/actions/workflows/${workflow}/runs?event=workflow_dispatch&branch=${encodeURIComponent(branch)}&per_page=20`,
  ).json?.workflow_runs ?? [];

/**
 * The ids of the workflow's dispatched runs on `branch` now: taken before a dispatch, none of them is its run.
 * @param {import("./github.mjs").Api} api
 * @param {string} repo
 * @param {string} workflow
 * @param {string} branch
 * @returns {number[]}
 */
export const runIds = (api, repo, workflow, branch) =>
  listRuns(api, repo, workflow, branch).map((/** @type {any} */ r) => r.id);

/**
 * The ship environment a run's jobs name (Runway's `Deploy (<env>)`), undefined before its deploy job exists.
 * @param {import("./github.mjs").Api} api
 * @param {string} repo
 * @param {number} id
 * @returns {string | undefined}
 */
function envOf(api, repo, id) {
  const jobs = api("GET", `/repos/${repo}/actions/runs/${id}/jobs?per_page=100`).json?.jobs ?? [];
  // Only the environments a ship deploys: a run's skipped `Promote (production)` names no ship.
  return jobs
    .map((/** @type {any} */ j) => /\((dev|staging)\)$/.exec(j.name ?? "")?.[1])
    .find(Boolean);
}

/**
 * The run of `workflow` a dispatch to `env` started: the earliest run on `branch` that is not in `before`, was created
 * at `since` or later, and whose deploy job names `env` (or, completed, names none); undefined until GitHub lists it.
 * A run another ship started, to another environment or before this dispatch, is never taken.
 * @param {import("./github.mjs").Api} api
 * @param {string} repo
 * @param {{ workflow: string, branch: string, since: number, before?: number[], env: string }} at
 * @returns {any}
 */
export function findRun(api, repo, { workflow, branch, since, before = [], env }) {
  const fresh = listRuns(api, repo, workflow, branch)
    .filter((/** @type {any} */ r) => !before.includes(r.id) && Date.parse(r.created_at) >= since)
    .sort((/** @type {any} */ a, /** @type {any} */ b) => a.id - b.id);
  return fresh.find((/** @type {any} */ r) => {
    const named = envOf(api, repo, r.id);
    return named ? named === env : r.status === "completed";
  });
}

/**
 * The ship entry of `run` (a GitHub workflow run) to `env`: `pending` until it completes, then its outcome file's
 * revision and status (`success` only for `deployed` to `env` at `sha`, when given) and its manifest's writes.
 * @param {import("./github.mjs").Api} api
 * @param {string} repo
 * @param {any} run
 * @param {string} env
 * @param {string} [sha] the revision the dispatch shipped
 * @returns {Omit<Ship, "at">}
 */
export function readOutcome(api, repo, run, env, sha) {
  const base = {
    env,
    run: run.id,
    url: run.html_url,
    ...(run.conclusion ? { conclusion: run.conclusion } : {}),
  };
  if (run.status !== "completed") return { ...base, outcome: "pending" };
  const name = outcomeArtifact(env);
  const artifact = (
    api("GET", `/repos/${repo}/actions/runs/${run.id}/artifacts?name=${name}`).json?.artifacts ?? []
  ).find((/** @type {any} */ a) => a.name === name && !a.expired);
  const zip = artifact
    ? api("GET", `/repos/${repo}/actions/artifacts/${artifact.id}/zip`, undefined, { raw: true })
        .bytes
    : undefined;
  /** @returns {any} the JSON of the zip's file `file`; a corrupt zip or file reads as none */
  const read = (/** @type {string} */ file) => {
    try {
      const bytes = zip && unzipFile(zip, (n) => n.split("/").at(-1) === file);
      const json = bytes ? JSON.parse(bytes.toString("utf8")) : undefined;
      return json && typeof json === "object" ? json : undefined;
    } catch {
      return undefined;
    }
  };
  const o = read(OUTCOME_FILE);
  if (o?.schema !== "runway.outcome/v1") return { ...base, outcome: NO_OUTCOME };
  const m = read(`deploy-${env}.json`);
  const count = (/** @type {unknown} */ x) => (Array.isArray(x) ? x.length : 0);
  const text = (/** @type {unknown} */ x) => (typeof x === "string" && x ? x : undefined);
  const deployed = text(o.sourceSha) ?? text(m?.sha);
  const problem =
    o.environment !== env
      ? `the outcome is of ${o.environment}, not ${env}`
      : sha && deployed !== sha
        ? `it deployed ${deployed?.slice(0, 12) ?? "no revision"}, not ${sha.slice(0, 12)}`
        : o.status !== "deployed"
          ? `runway ${text(o.status) ?? "gave no status"}`
          : m?.dryRun === true
            ? "a dry run"
            : undefined;
  const smoke = text(m?.smoke?.status);
  const rollback = text(m?.rollback?.previousSha);
  return {
    ...base,
    outcome: problem ? "failure" : "success",
    ...(deployed ? { sha: deployed } : {}),
    // Without the manifest (a deploy that failed before writing it) nothing is known to be written.
    ...(m ? { written: count(m.surfaces?.written), uploaded: count(m.surfaces?.uploaded) } : {}),
    ...(m?.held && typeof m.held === "object" ? { held: Object.keys(m.held) } : {}),
    ...(smoke ? { smoke } : {}),
    ...(rollback ? { rollback } : {}),
    ...(problem ? { problem } : {}),
  };
}

/**
 * Waits up to `polls` polls for the dispatched run to complete and returns its ship entry; `pending` when it is still
 * running (or not yet listed) at the last poll.
 * @param {import("./github.mjs").Api} api
 * @param {string} repo
 * @param {{ workflow: string, branch: string, sha: string, since: number, before?: number[], env: string,
 *           polls: number, pollMs?: number, sleep?: (ms: number) => Promise<void>, log?: (s: string) => void }} options
 * @returns {Promise<Omit<Ship, "at">>}
 */
export async function followRun(api, repo, options) {
  const {
    env,
    polls,
    pollMs = 10_000,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log = () => {},
  } = options;
  /** @type {any} */
  let run;
  for (let i = 1; ; i++) {
    await sleep(pollMs);
    const was = run;
    run = was
      ? (api("GET", `/repos/${repo}/actions/runs/${was.id}`).json ?? was)
      : findRun(api, repo, options);
    if (run && !was) log(`  run: ${run.html_url}`);
    if (run?.status === "completed" || i >= polls) break;
  }
  return run ? readOutcome(api, repo, run, env, options.sha) : { env, outcome: "pending" };
}

/** The record state a ship ends in: done only on success, active while pending, else failed. */
export const shipState = (/** @type {string} */ outcome) =>
  outcome === "success" ? "done" : outcome === "pending" ? "active" : "failed";

/**
 * Each record's newest ship in the repository at `root`, a pending one re-read from its run when `api` is given: by
 * its id, or found as `followRun` would when the ship ended before GitHub listed it.
 * @param {string} root
 * @param {string | undefined} repo the GitHub slug
 * @param {import("./github.mjs").Api} [api]
 * @returns {(Ship & { key: string })[]}
 */
export function shipsOf(root, repo, api) {
  return allRecords([root]).flatMap(({ key, record }) => {
    const ship = record?.ships?.at(-1);
    if (!ship) return [];
    if (ship.outcome !== "pending" || !repo || !api) return [{ key, ...ship }];
    const { workflow, branch, before, env } = ship;
    const run = ship.run
      ? api("GET", `/repos/${repo}/actions/runs/${ship.run}`).json
      : workflow && branch
        ? findRun(api, repo, {
            workflow,
            branch,
            before,
            env,
            since: Date.parse(ship.at) - SKEW_MS,
          })
        : undefined;
    return [{ key, ...ship, ...(run?.id ? readOutcome(api, repo, run, env, ship.sha) : {}) }];
  });
}
