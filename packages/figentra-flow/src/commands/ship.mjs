/**
 * Figentra Flow file contract:
 * Purpose: `fflow ship <dev|staging> [--workflow <file>] [--wait <minutes>] [--dry-run]`: ships the tip of the
 *   default branch to dev or staging by dispatching the product's Runway deploy workflow
 *   (`.github/workflows/deploy.yml`, input `environment`), so the deploy runs in CI from a commit of main, in that GitHub environment, as every Runway deploy
 *   does. Production is refused outright: it moves only by `runway promote <sha>`, behind the production
 *   environment's approval, which is the owner's. Run in a landed task's checkout (its record at `land`, `release` or
 *   `ship`), a dispatch ends the ship stage in Flow's record there, committed and pushed (`recordShip`, STA-1945 FR-14).
 *   In a Runway product (a `runway.yaml` at the root) it then follows the run it started for up to `--wait` minutes
 *   (default 10) and records its outcome from the `runway-outcome-<env>` artifact (`lib/ship-outcome.mjs`, STA-2137): the
 *   stage is done only on success, active while the run is pending (`fflow status` re-reads it), else failed; a run
 *   without the artifact is `no outcome artifact`. Exit 0 on success, 4 pending, 1 otherwise. Without `runway.yaml`
 *   the dispatch alone ends the stage, as before.
 * Boundary: reads origin's tip, then makes one dispatch through the configured GitHub credentials (then only reads
 *   the run and its artifact); it builds and deploys nothing itself and never sends a `sha` (a promote's input).
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
import { followRun, runIds, shipState, SKEW_MS } from "../lib/ship-outcome.mjs";

/** The environments `ship` deploys; anything else, production first, is refused. */
export const SHIP_ENVIRONMENTS = ["dev", "staging"];

/** The product's Runway deploy workflow, under `.github/workflows/`. */
export const DEPLOY_WORKFLOW = "deploy.yml";

const USAGE = `usage: ${NAME} ship <${SHIP_ENVIRONMENTS.join("|")}> [--workflow <file>] [--wait <minutes>] [--dry-run]`;

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

/**
 * Ends the ship stage in the record of the issue `root`'s branch names, when that task has landed (FR-14); with a
 * `ship` (a Runway product's outcome, STA-2137) it is appended and its outcome sets the state.
 * @param {string} root
 * @param {import("../lib/ship-outcome.mjs").Ship} [ship]
 * @returns {string | undefined} why the record was not saved
 */
export function recordShip(root, ship) {
  const key = schemeFor(root).keys(git(root, ["branch", "--show-current"]).out)[0];
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
    change: (r) => ({ ...r, ships: [...(r.ships ?? []), ship] }),
  });
}

/** @param {string[]} args */
export async function run(args) {
  const dry = args.includes("--dry-run");
  const at = args.indexOf("--workflow");
  const workflow = at >= 0 ? args[at + 1] : DEPLOY_WORKFLOW;
  const w = args.indexOf("--wait");
  const wait = w >= 0 ? Number(args[w + 1]) : 10;
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
  });
  if (!r.ok) {
    console.error(`${NAME} ship: ${dispatchProblem(workflow, r.err)}`);
    return 1;
  }
  console.log(`${NAME} ship: dispatched ${workflow} for ${target}`);
  if (runway) {
    const followed = await followRun(api, /** @type {string} */ (repo), {
      workflow,
      branch,
      sha: tip,
      since: dispatched - SKEW_MS,
      before,
      env: /** @type {string} */ (env),
      polls: Math.max(1, Math.ceil((wait * 60_000) / POLL_MS)),
      pollMs: POLL_MS,
      log: console.log,
    });
    const ship = {
      ...followed,
      sha: followed.sha ?? tip,
      at: new Date(dispatched).toISOString(),
      // No run listed yet: what `fflow status` needs to find it later.
      ...(followed.run ? {} : { workflow, branch, before }),
    };
    const writes =
      ship.written === undefined ? "" : `; ${ship.written} KV row(s), ${ship.uploaded} upload(s)`;
    console.log(
      `${NAME} ship: ${env} ${ship.outcome} at ${ship.sha.slice(0, 12)}${writes}${ship.problem ? ` (${ship.problem})` : ""}`,
    );
    const unsaved = recordShip(root, ship);
    if (unsaved) console.error(`${NAME} ship: warning: the record was not saved (${unsaved})`);
    if (ship.outcome === "pending")
      console.log(`  still running after ${wait} min; \`${NAME} status\` re-reads it`);
    return ship.outcome === "success" ? 0 : ship.outcome === "pending" ? 4 : 1;
  }
  const unrecorded = recordShip(root);
  if (unrecorded) console.error(`${NAME} ship: warning: the record was not saved (${unrecorded})`);
  console.log(
    `  follow it: gh run list --repo ${repo} --workflow ${workflow} --event workflow_dispatch`,
  );
  return 0;
}
