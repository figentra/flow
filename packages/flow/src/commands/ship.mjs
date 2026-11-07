/**
 * Figentra Flow file contract:
 * Purpose: `fflow ship <dev|staging> [--workflow <file>] [--wait <minutes>] [--resolve] [--dry-run]`: ships the tip of the
 *   default branch to dev or staging by dispatching the product's Runway deploy workflow
 *   (`.github/workflows/deploy.yml`, input `environment`), so the deploy runs in CI from a commit of main, in that GitHub environment, as every Runway deploy
 *   does. Production is refused outright: it moves only by `runway promote <sha>`, behind the production
 *   environment's approval, which is the owner's. Run in a landed task's checkout (its record at `land`, `release` or
 *   `ship`), a dispatch ends the ship stage in Flow's record there, committed and pushed (`recordShip`, STA-1945 FR-14).
 *   In a Runway product (a `runway.yaml` at the root) it asks GitHub for the run the dispatch started
 *   (`return_run_details`) and puts it in the record at once (uncommitted), then follows it (or, when GitHub names
 *   none, the run it finds) for up to `--wait` minutes (default 10) and records its outcome from the
 *   `runway-outcome-<env>` artifact (`lib/ship-outcome.mjs`, STA-2137): the stage is done only on success, active while
 *   the run is pending, else failed; a run without the artifact is `no outcome artifact`. `--resolve` dispatches
 *   nothing: it re-reads the record's newest ship to `<env>`, pending, and writes its outcome back (committed and
 *   pushed). Exit 0 on success, 4 pending, 1 otherwise. Without `runway.yaml` the dispatch alone ends the stage, as
 *   before.
 * Boundary: reads origin's tip, then makes one dispatch through the configured GitHub credentials (then only reads
 *   the run and its artifact; `--resolve` only reads); it builds and deploys nothing itself and never sends a `sha` (a
 *   promote's input).
 *   GitHub itself refuses an input the workflow does not declare, so the workflow is not parsed here. The record is
 *   written only on a task's branch, and a failed commit or push only warns.
 * Runtime: node
 * Governing contract: Stackra ADR 0352 (decision 6), ADR 0170; STA-1729 (FR-8, AC-014, AC-015); STA-1945 (FR-14);
 *   STA-2137.
 * Secrets: none here; the token stays inside `gh` or the wrapper.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { schemeFor } from "../adapters/tracker/index.mjs";
import { connect } from "./land.mjs";
import { NAME } from "../lib/product.mjs";
import { defaultBranch, git, remoteTip } from "../lib/git.mjs";
import { endStage, readRecord, RecordError } from "../lib/record.mjs";
import { followRun, resolveShip, runIds, shipState, SKEW_MS } from "../lib/ship-outcome.mjs";

/** The environments `ship` deploys; anything else, production first, is refused. */
export const SHIP_ENVIRONMENTS = ["dev", "staging"];

/** The product's Runway deploy workflow, under `.github/workflows/`. */
export const DEPLOY_WORKFLOW = "deploy.yml";

const USAGE = `usage: ${NAME} ship <${SHIP_ENVIRONMENTS.join("|")}> [--workflow <file>] [--wait <minutes>] [--resolve] [--dry-run]`;

/** How often a followed run is polled. */
const POLL_MS = 10_000;

/**
 * Why `env` may not be shipped; empty means it may.
 * @param {string | undefined} env
 * @returns {string[]}
 */
export function environmentProblems(env) {
  if (env === undefined) return [USAGE];
  if (/^prod(uction)?$/i.test(env))
    return [
      "production is never shipped: it moves only by `runway promote <sha>`, approved in the production environment by the owner",
    ];
  if (!SHIP_ENVIRONMENTS.includes(env))
    return [`${env} is not an environment ship deploys (${SHIP_ENVIRONMENTS.join(", ")})`];
  return [];
}

/**
 * What a refused dispatch means: GitHub answers 422 when the workflow declares no `environment` input, 404 when the
 * default branch has no such workflow.
 * @param {string} file
 * @param {string} err  `gh`'s error line
 * @returns {string}
 */
export function dispatchProblem(file, err) {
  const path = `.github/workflows/${file}`;
  if (/Unexpected inputs?/i.test(err))
    return `${path} on the default branch takes no workflow_dispatch input \`environment\` (dev or staging): ${err}`;
  if (/HTTP 404/.test(err)) return `the default branch has no ${path}: ${err}`;
  return `the dispatch of ${path} failed: ${err}`;
}

/** The stages a task has landed by: only such a task's record takes the ship. */
const LANDED = ["land", "release", "ship"];

/** The issue key `root`'s branch names, if any. */
const taskKey = (/** @type {string} */ root) =>
  schemeFor(root).keys(git(root, ["branch", "--show-current"]).out)[0];

/**
 * Ends the ship stage in the record of the issue `root`'s branch names, when that task has landed (FR-14); with a
 * `ship` (a Runway product's outcome, STA-2137) it is appended (`replace`: it replaces the newest ship) and its outcome
 * sets the state; `commit: false` only writes the record.
 * @param {string} root
 * @param {import("../lib/ship-outcome.mjs").Ship} [ship]
 * @param {{ replace?: boolean, commit?: boolean }} [options]
 * @returns {string | undefined} why the record was not saved
 */
export function recordShip(root, ship, { replace = false, commit = true } = {}) {
  const key = taskKey(root);
  if (!key) return undefined;
  try {
    if (!LANDED.includes(readRecord(root, key)?.stage ?? "")) return undefined;
  } catch (error) {
    if (!(error instanceof RecordError)) throw error;
    return error.message;
  }
  if (!ship) return endStage(root, key, "ship");
  return endStage(root, key, "ship", {
    state: shipState(ship.outcome),
    change: (r) => {
      const ships = r.ships ?? [];
      return { ...r, ships: [...(replace ? ships.slice(0, -1) : ships), ship] };
    },
    commit,
  });
}

/** The exit of a ship's outcome: 0 success, 4 pending, 1 otherwise. */
const exitOf = (/** @type {string} */ outcome) =>
  outcome === "success" ? 0 : outcome === "pending" ? 4 : 1;

/** Prints `ship`'s outcome line. */
function report(/** @type {import("../lib/ship-outcome.mjs").Ship} */ ship) {
  const writes =
    ship.written === undefined ? "" : `; ${ship.written} KV row(s), ${ship.uploaded} upload(s)`;
  console.log(
    `${NAME} ship: ${ship.env} ${ship.outcome} at ${ship.sha?.slice(0, 12) ?? "an unknown revision"}${writes}${ship.problem ? ` (${ship.problem})` : ""}`,
  );
}

/**
 * `--resolve`: re-reads the newest ship to `env` in this task's record and, once its run has an outcome, writes it
 * back (STA-2137, contract 3.3).
 * @param {string} root
 * @param {string} env
 * @param {string} repo
 * @param {import("../lib/github.mjs").Api} api
 * @param {boolean} dry  read only, write nothing
 * @returns {number}
 */
function resolve(root, env, repo, api, dry) {
  const key = taskKey(root);
  /** @type {import("../lib/ship-outcome.mjs").Ship | undefined} */
  let ship;
  try {
    ship = key ? readRecord(root, key)?.ships?.at(-1) : undefined;
  } catch (error) {
    if (!(error instanceof RecordError)) throw error;
    console.error(`${NAME} ship: ${error.message}`);
    return 1;
  }
  if (!ship || ship.env !== env) {
    console.error(
      `${NAME} ship: ${key ? `${key.toUpperCase()}'s record` : "this branch names no task whose record"} has no newest ship to ${env} to resolve`,
    );
    return 2;
  }
  if (ship.outcome !== "pending") {
    report(ship);
    return exitOf(ship.outcome);
  }
  const resolved = resolveShip(api, repo, ship);
  report(resolved);
  if (resolved.outcome === "pending") {
    console.log(`  still pending; \`${NAME} ship ${env} --resolve\` reads it again`);
    return 4;
  }
  if (dry) {
    console.log(`${NAME} ship: would record it in ${key?.toUpperCase()}'s record`);
    return exitOf(resolved.outcome);
  }
  const unsaved = recordShip(root, resolved, { replace: true });
  if (unsaved) console.error(`${NAME} ship: warning: the record was not saved (${unsaved})`);
  return exitOf(resolved.outcome);
}

/** @param {string[]} args */
export async function run(args) {
  const dry = args.includes("--dry-run");
  const at = args.indexOf("--workflow");
  const workflow = at >= 0 ? args[at + 1] : DEPLOY_WORKFLOW;
  const w = args.indexOf("--wait");
  const wait = w >= 0 ? Number(args[w + 1]) : 10;
  const resolving = args.includes("--resolve");
  const env = args.find(
    (a, i) => !a.startsWith("--") && (at < 0 || i !== at + 1) && (w < 0 || i !== w + 1),
  );
  if (!Number.isFinite(wait) || wait < 0) {
    console.error(`${NAME} ship: --wait takes the minutes to wait, e.g. --wait 10`);
    return 2;
  }

  // Refused before anything is read or called.
  const refused = workflow ? environmentProblems(env) : [USAGE];
  if (refused.length) {
    for (const p of refused) console.error(`${NAME} ship: ${p}`);
    return 2;
  }

  const cwd = process.cwd();
  const root = git(cwd, ["rev-parse", "--show-toplevel"]).out || cwd;
  const { repo, api, problem } = connect(root);
  if (resolving && !problem && api)
    return resolve(root, /** @type {string} */ (env), /** @type {string} */ (repo), api, dry);
  const branch = defaultBranch(root);
  const tip = problem ? undefined : remoteTip(root, branch);
  if (problem || !api || !tip) {
    console.error(`${NAME} ship: ${problem ?? `origin has no ${branch} to ship`}`);
    return 2;
  }

  const target = `${repo}@${branch} (${tip.slice(0, 12)}) to ${env}`;
  if (dry) {
    console.log(`${NAME} ship: would dispatch ${workflow} for ${target}`);
    return 0;
  }
  const runway = existsSync(join(root, "runway.yaml"));
  // The runs listed before the dispatch are not its run, whatever else matches (another ship, another session).
  const before = runway ? runIds(api, /** @type {string} */ (repo), workflow, branch) : [];
  const dispatched = Date.now();
  const r = api("POST", `/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
    ref: branch,
    inputs: { environment: env },
    // GitHub answers 200 with the run it started (else 204, no body): the run is then known, not searched for.
    // Only a Runway product asks, so any other repository's dispatch stays as it was.
    ...(runway ? { return_run_details: true } : {}),
  });
  if (!r.ok) {
    console.error(`${NAME} ship: ${dispatchProblem(workflow, r.err)}`);
    return 1;
  }
  console.log(`${NAME} ship: dispatched ${workflow} for ${target}`);
  if (runway) {
    const id = Number(r.json?.workflow_run_id) || undefined;
    const at = new Date(dispatched).toISOString();
    // No run named yet: what a later read needs to find it.
    const finding = { workflow, branch, before };
    // The run is in the record at once, so an interrupted wait leaves what `--resolve` reads.
    const early = recordShip(
      root,
      {
        env: /** @type {string} */ (env),
        at,
        outcome: "pending",
        sha: tip,
        ...(id ? { run: id, ...(r.json?.html_url ? { url: r.json.html_url } : {}) } : finding),
      },
      { commit: false },
    );
    const followed = await followRun(api, /** @type {string} */ (repo), {
      workflow,
      branch,
      sha: tip,
      since: dispatched - SKEW_MS,
      before,
      env: /** @type {string} */ (env),
      run: id,
      polls: Math.max(1, Math.ceil((wait * 60_000) / POLL_MS)),
      pollMs: POLL_MS,
      log: console.log,
    });
    const ship = {
      ...followed,
      sha: followed.sha ?? tip,
      at,
      ...(followed.run ? {} : finding),
    };
    report(ship);
    // The pending entry written above is replaced; when it could not be written, nothing is.
    const unsaved = early ?? recordShip(root, ship, { replace: true });
    if (unsaved) console.error(`${NAME} ship: warning: the record was not saved (${unsaved})`);
    if (ship.outcome === "pending")
      console.log(
        `  still running after ${wait} min; \`${NAME} ship ${env} --resolve\` records it once it ends (\`${NAME} status\` shows it)`,
      );
    return exitOf(ship.outcome);
  }
  const unrecorded = recordShip(root);
  if (unrecorded) console.error(`${NAME} ship: warning: the record was not saved (${unrecorded})`);
  console.log(
    `  follow it: gh run list --repo ${repo} --workflow ${workflow} --event workflow_dispatch`,
  );
  return 0;
}
