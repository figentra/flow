/**
 * Figentra Flow file contract:
 * Purpose: `fflow ship <dev|staging> [--workflow <file>] [--dry-run]`: ships the tip of the default branch to
 *   dev or staging by dispatching the product's Runway deploy workflow (`.github/workflows/deploy.yml`, input
 *   `environment`), so the deploy runs in CI from a commit of main, in that GitHub environment, as every Runway deploy
 *   does. Production is refused outright: it moves only by `runway promote <sha>`, behind the production
 *   environment's approval, which is the owner's. Run in a landed task's checkout (its record at `land`, `release` or
 *   `ship`), a dispatch ends the ship stage in Flow's record there, committed and pushed (`recordShip`, STA-1945 FR-14).
 * Boundary: reads origin's tip, then makes one dispatch through the configured GitHub credentials; it builds and
 *   deploys nothing itself and never sends a `sha` (a promote's input). GitHub itself refuses an input the workflow
 *   does not declare, so the workflow is not parsed here. The record is written only on a task's branch, and a failed
 *   commit or push only warns.
 * Runtime: node
 * Governing contract: Stackra ADR 0352 (decision 6), ADR 0170; STA-1729 (FR-8, AC-014, AC-015); STA-1945 (FR-14).
 * Secrets: none here; the token stays inside `gh` or the wrapper.
 */
import { schemeFor } from "../adapters/tracker/index.mjs";
import { connect } from "./land.mjs";
import { NAME } from "../lib/product.mjs";
import { defaultBranch, git, remoteTip } from "../lib/git.mjs";
import { endStage, readRecord, RecordError } from "../lib/record.mjs";

/** The environments `ship` deploys; anything else, production first, is refused. */
export const SHIP_ENVIRONMENTS = ["dev", "staging"];

/** The product's Runway deploy workflow, under `.github/workflows/`. */
export const DEPLOY_WORKFLOW = "deploy.yml";

const USAGE = `usage: ${NAME} ship <${SHIP_ENVIRONMENTS.join("|")}> [--workflow <file>] [--dry-run]`;

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
 * Ends the ship stage in the record of the issue `root`'s branch names, when that task has landed (FR-14).
 * @param {string} root
 * @returns {string | undefined} why the record was not saved
 */
export function recordShip(root) {
  const key = schemeFor(root).keys(git(root, ["branch", "--show-current"]).out)[0];
  if (!key) return undefined;
  try {
    if (!LANDED.includes(readRecord(root, key)?.stage ?? "")) return undefined;
  } catch (error) {
    if (!(error instanceof RecordError)) throw error;
    return error.message;
  }
  return endStage(root, key, "ship");
}

/** @param {string[]} args */
export async function run(args) {
  const dry = args.includes("--dry-run");
  const at = args.indexOf("--workflow");
  const workflow = at >= 0 ? args[at + 1] : DEPLOY_WORKFLOW;
  const env = args.find((a, i) => !a.startsWith("--") && (at < 0 || i !== at + 1));

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
  const r = api("POST", `/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
    ref: branch,
    inputs: { environment: env },
  });
  if (!r.ok) {
    console.error(`${NAME} ship: ${dispatchProblem(workflow, r.err)}`);
    return 1;
  }
  console.log(`${NAME} ship: dispatched ${workflow} for ${target}`);
  const unrecorded = recordShip(root);
  if (unrecorded) console.error(`${NAME} ship: warning: the record was not saved (${unrecorded})`);
  console.log(
    `  follow it: gh run list --repo ${repo} --workflow ${workflow} --event workflow_dispatch`,
  );
  return 0;
}
