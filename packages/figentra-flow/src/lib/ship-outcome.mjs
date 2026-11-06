/**
 * Figentra Flow file contract:
 * Purpose: what a ship did (STA-2137): `followRun` finds the deploy run a `fflow ship` dispatch started (by workflow,
 *   branch, the dispatched sha and creation time), waits for it, and `readOutcome` reads its `runway-outcome`
 *   artifact, the product deploy's manifest (`dist/product/deploy-<env>.json`, Runway's `ProductDeploy`), into one
 *   `ships` entry of Flow's record: the environment, the deployed revision, the run's URL and conclusion, the KV rows
 *   and uploads written, and any smoke or rollback field. A run without the artifact is `no outcome artifact`, never a
 *   success. `shipsOf` lists each record's newest ship for `fflow status`, re-reading a pending one's run.
 * Boundary: GitHub REST reads only, through the caller's `Api` (the credentials port); the artifact's zip is read in
 *   memory (`unzipFile`, stored or deflated entries, no zip64). Writes nothing.
 * Runtime: node
 * Governing contract: STA-2137; Stackra ADR 0436 (the deploy manifest).
 * Secrets: none; the token stays inside `gh` or the wrapper, and the manifest carries none.
 */
import { inflateRawSync } from "node:zlib";

import { allRecords } from "./records.mjs";

/** The artifact a Runway product deploy uploads, holding its deploy manifest. */
export const OUTCOME_ARTIFACT = "runway-outcome";

/** The outcome of a completed run that uploaded no readable manifest. */
export const NO_OUTCOME = "no outcome artifact";

/**
 * @typedef {{ env: string, at: string, outcome: string, run?: number, url?: string, conclusion?: string,
 *   sha?: string, written?: number, uploaded?: number, held?: string[], smoke?: string, rollback?: string }} Ship
 *   `outcome` is `pending`, `success`, `failure` or `NO_OUTCOME`
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

/**
 * The run of `workflow` a dispatch started: a `workflow_dispatch` run on `branch` at `sha` created at `since` or
 * later, the earliest such; undefined until GitHub lists it.
 * @param {import("./github.mjs").Api} api
 * @param {string} repo
 * @param {{ workflow: string, branch: string, sha: string, since: number }} at
 * @returns {any}
 */
export function findRun(api, repo, { workflow, branch, sha, since }) {
  const runs =
    api(
      "GET",
      `/repos/${repo}/actions/workflows/${workflow}/runs?event=workflow_dispatch&branch=${encodeURIComponent(branch)}&per_page=20`,
    ).json?.workflow_runs ?? [];
  return runs
    .filter((/** @type {any} */ r) => r.head_sha === sha && Date.parse(r.created_at) >= since)
    .at(-1);
}

/**
 * The ship entry of `run` (a GitHub workflow run) to `env`: `pending` until it completes, then its manifest's
 * revision and writes, `success` only for a successful run whose manifest is of `env` and no dry run.
 * @param {import("./github.mjs").Api} api
 * @param {string} repo
 * @param {any} run
 * @param {string} env
 * @returns {Omit<Ship, "at">}
 */
export function readOutcome(api, repo, run, env) {
  const base = {
    env,
    run: run.id,
    url: run.html_url,
    ...(run.conclusion ? { conclusion: run.conclusion } : {}),
  };
  if (run.status !== "completed") return { ...base, outcome: "pending" };
  const artifact = (
    api("GET", `/repos/${repo}/actions/runs/${run.id}/artifacts?name=${OUTCOME_ARTIFACT}`).json
      ?.artifacts ?? []
  ).find((/** @type {any} */ a) => a.name === OUTCOME_ARTIFACT && !a.expired);
  const zip = artifact
    ? api("GET", `/repos/${repo}/actions/artifacts/${artifact.id}/zip`, undefined, { raw: true })
        .bytes
    : undefined;
  /** @type {any} */
  let m;
  try {
    // A corrupt zip or manifest throws here, and reads as no outcome.
    const file = zip && unzipFile(zip, (n) => n.split("/").at(-1) === `deploy-${env}.json`);
    m = file ? JSON.parse(file.toString("utf8")) : undefined;
  } catch {
    m = undefined;
  }
  if (!m || typeof m !== "object") return { ...base, outcome: NO_OUTCOME };
  const count = (/** @type {unknown} */ x) => (Array.isArray(x) ? x.length : 0);
  const text = (/** @type {unknown} */ x) => (typeof x === "string" && x ? x : undefined);
  const smoke = text(m.smoke?.status);
  const rollback = text(m.rollback?.previousSha);
  const sha = text(m.sha);
  return {
    ...base,
    outcome:
      run.conclusion === "success" && m.environment === env && m.dryRun !== true
        ? "success"
        : "failure",
    ...(sha ? { sha } : {}),
    written: count(m.surfaces?.written),
    uploaded: count(m.surfaces?.uploaded),
    ...(m.held && typeof m.held === "object" ? { held: Object.keys(m.held) } : {}),
    ...(smoke ? { smoke } : {}),
    ...(rollback ? { rollback } : {}),
  };
}

/**
 * Waits up to `polls` polls for the dispatched run to complete and returns its ship entry; `pending` when it is still
 * running (or not yet listed) at the last poll.
 * @param {import("./github.mjs").Api} api
 * @param {string} repo
 * @param {{ workflow: string, branch: string, sha: string, since: number, env: string, polls: number,
 *           pollMs?: number, sleep?: (ms: number) => Promise<void>, log?: (s: string) => void }} options
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
  return run ? readOutcome(api, repo, run, env) : { env, outcome: "pending" };
}

/** The record state a ship ends in: done only on success, active while pending, else failed. */
export const shipState = (/** @type {string} */ outcome) =>
  outcome === "success" ? "done" : outcome === "pending" ? "active" : "failed";

/**
 * Each record's newest ship in the repository at `root`, a pending one re-read from its run when `api` is given.
 * @param {string} root
 * @param {string | undefined} repo the GitHub slug
 * @param {import("./github.mjs").Api} [api]
 * @returns {(Ship & { key: string })[]}
 */
export function shipsOf(root, repo, api) {
  return allRecords([root]).flatMap(({ key, record }) => {
    const ship = record?.ships?.at(-1);
    if (!ship) return [];
    if (ship.outcome !== "pending" || !ship.run || !repo || !api) return [{ key, ...ship }];
    const run = api("GET", `/repos/${repo}/actions/runs/${ship.run}`).json;
    return [{ key, ...ship, ...(run?.id ? readOutcome(api, repo, run, ship.env) : {}) }];
  });
}
