/**
 * Figentra Flow file contract:
 * Purpose: the approval workflow `sync` renders into a repository (STA-1856 FR-4, the L2 design). Events run it, never
 *   a dispatch. Every job downloads this exact package version, refuses unless the tarball's sha512 is the integrity
 *   the repository's lockfile pinned at render time, and runs one script from it; those scripts hold every rule, and
 *   their tests live here. The jobs run in `APPROVE_ENVIRONMENT`, which must allow the default branch only, only on
 *   the default branch and only while the automation variable allows it (missing is frozen). With `lane`
 *   (`secrets.oidc`, the L2 design's PR D): a `cancel` job removes `LAND_LABEL` on a push (with the job's token, so it
 *   starts nothing, and even while frozen, since it only withdraws), a keyless `route` job wakes on the label, a
 *   `/fflow land` comment, the gate's success status, a listed workflow's success, ready-for-review or the schedule
 *   and says whether any PR asks to land, then `approve` (`approve-check.mjs` with `MODE=event`, automation `on`) and
 *   `merge` (`merge.mjs`, `on` or `merge-only`) mint their own tokens over OIDC, one at a time per repository. With
 *   `verdict` (a `github-actions` runner and `secrets.oidc`, the L2 design's PR F) a `verdict` job runs on the gate
 *   workflow's `workflow_run`, mints a `verdict` token over OIDC and posts the gate's status. The dispatched
 *   `approve-dispatch` job and the approving App's secrets it read are gone (the L2 design's PR G, STA-1945 FR-36).
 * Boundary: returns text; writes nothing. The workflow never checks out or runs the PR's code, never downloads an
 *   artifact and never puts event text in a `run:` block (it reaches a step through `env` only). It has no `push`,
 *   `pull_request`, `workflow_dispatch`, `workflow_call` or `repository_dispatch` trigger; only `merge.mjs` merges, at
 *   the approved head.
 * Runtime: node
 * Governing contract: STA-1856 FR-4 (the security review of 2026-11-01); the L2 design (PR D, PR F, PR G); STA-1945
 *   FR-36 and AC-50.
 * Secrets: names none. Every job's token comes from Infisical over the job's OIDC token, in process.
 */
import { SETUP_NODE } from "./gate-workflow.mjs";
import {
  APPROVE_ENVIRONMENT,
  AUTOMATION_RUNS,
  AUTOMATION_VARIABLE,
  LAND_COMMAND,
  LAND_LABEL,
  NAME,
  OIDC_IDENTITY_VARIABLE,
  PACKAGE,
  REGISTRY,
  STATUS_CONTEXT,
} from "./product.mjs";

/**
 * The `verdict` job's inputs: the gate workflow's path, the owner, the default branch and the Infisical coordinates.
 * @typedef {{ gatePath: string, owner?: string, defaultBranch: string,
 *             oidc: import("./app-token.mjs").Oidc }} Verdict
 * The event lane's inputs: the default branch, the Infisical coordinates, the owner, the workflows whose success wakes
 * it (`approve.workflows`), the App slugs that may ask for a land (`approve.requesters`) and the AI review's App slugs.
 * @typedef {{ defaultBranch: string, oidc: import("./app-token.mjs").Oidc, owner?: string, workflows?: string[],
 *             requesters?: string[], reviewers?: string[] }} Lane
 */

/**
 * The workflow's YAML.
 * @param {{ version: string, integrity?: string, trusted?: Record<string, string | string[]>, ownerOnly?: string[],
 *           verdict?: Verdict, lane?: Lane }} options the package version to run and its lockfile integrity
 *   (`sha512-…`; without one the workflow refuses to run), the trusted check sources (context to a login or a list of
 *   logins), the repository's extra owner-only globs, for a `github-actions` runner with `secrets.oidc` the `verdict`
 *   job's inputs and, with `secrets.oidc`, the event lane's
 * @throws {Error} with neither `lane` nor `verdict`: there is no dispatched fallback to render
 */
export function approveWorkflow({
  version,
  integrity = "",
  trusted = {},
  ownerOnly = [],
  verdict,
  lane,
}) {
  if (!/^(?:sha512-[A-Za-z0-9+/]+=*)?$/.test(integrity))
    throw new Error(`${PACKAGE}@${version}: "${integrity}" is not a sha512 integrity`);
  const pkg = `${PACKAGE}@${version}`;
  const scope =
    PACKAGE.startsWith("@") && REGISTRY ? ` --${PACKAGE.split("/")[0]}:registry=${REGISTRY}` : "";
  // JSON in a single-quoted YAML scalar: a quote is doubled.
  const yamlJson = (/** @type {unknown} */ v) => `'${JSON.stringify(v).replaceAll("'", "''")}'`;
  // The integrity-checked package step every job shares: only the pinned tarball's `script` runs.
  const packageRun = (/** @type {string} */ script) => `        run: |
          cd "$RUNNER_TEMP"
          [ -n "$INTEGRITY" ] || { echo "::error::no pinned integrity for ${pkg}; run ${NAME} sync where the lockfile resolves it"; exit 1; }
          file=$(npm pack --silent${scope} ${pkg} | tail -n 1)
          got="sha512-$(openssl dgst -sha512 -binary "$file" | base64 -w0)"
          [ "$got" = "$INTEGRITY" ] || { echo "::error::${pkg} is $got, not the pinned $INTEGRITY"; exit 1; }
          mkdir flow && tar -xzf "$file" -C flow
          node flow/package/src/lib/${script}
`;
  if (verdict) checkVerdict(verdict);
  if (lane) checkLane(lane);
  const events = lane ?? verdict;
  if (!events)
    throw new Error(
      `${pkg}: the approval workflow needs secrets.oidc (the event lane or the verdict job); the dispatched fallback is retired`,
    );
  // Every job runs on the default branch only, and only while automation is not frozen.
  const ref = `github.ref == 'refs/heads/${events.defaultBranch}'`;
  const guard = `${ref} && (${AUTOMATION_RUNS.map((v) => `vars.${AUTOMATION_VARIABLE} == '${v}'`).join(" || ")})`;
  // What approves runs only while automation is fully on (`merge-only` merges what was approved before).
  const guardOn = `${ref} && vars.${AUTOMATION_VARIABLE} == '${AUTOMATION_RUNS[0]}'`;
  const woken = [...(lane?.workflows ?? []), ...(verdict ? [STATUS_CONTEXT] : [])];
  return `# Written by \`${NAME} sync\`; ${lane ? `events run it: the ${LAND_LABEL} label or a \`${LAND_COMMAND}\` comment asks for a land` : "the gate workflow's runs wake it"} (STA-1856).
# Every rule is in ${PACKAGE}'s scripts, at the version below; \`${NAME} gate ci\` fails on a hand edit.
name: ${NAME} approve
run-name: ${NAME} ${lane ? "approve" : "verdict"}

on:
${
  lane
    ? `  # A land request, and what can unblock one; each run sweeps every request, so a lost event loses nothing.
  pull_request_target:
    types: [labeled, synchronize, ready_for_review]
  status:
  issue_comment:
    types: [created]
  schedule:
    - cron: "7,22,37,52 * * * *"
`
    : ""
}${
    woken.length
      ? `  # ${verdict ? "The gate workflow's runs on PRs; main's copy of this file reads each one (`verdict` below)." : "A listed workflow's success wakes the lane."}
  workflow_run:
    workflows: [${woken.map((w) => JSON.stringify(w)).join(", ")}]
    types: [completed]
`
      : ""
  }
permissions: {}

jobs:${
    lane
      ? laneJobs({ lane, ref, guard, guardOn, packageRun, yamlJson, integrity, trusted, ownerOnly })
      : ""
  }${verdict ? verdictJob(verdict, guard, packageRun, yamlJson, integrity) : ""}`;
}

const BRANCH = /^(?!.*\.\.)[\w.-]+(?:\/[\w.-]+)*$/;

/**
 * Refuses verdict inputs that are not plain names, since each is rendered into YAML.
 * @param {Verdict} v
 */
function checkVerdict(v) {
  if (!BRANCH.test(v.defaultBranch ?? ""))
    throw new Error(
      `verdict: the default branch is not a branch name: ${JSON.stringify(v.defaultBranch)}`,
    );
  if (!/^\.github\/workflows\/[\w.-]+\.ya?ml$/.test(v.gatePath ?? ""))
    throw new Error(
      `verdict: the gate workflow is not a workflow path: ${JSON.stringify(v.gatePath)}`,
    );
  if (v.owner !== undefined && !/^[\w-]+$/.test(v.owner))
    throw new Error(`verdict: the owner is not a login: ${JSON.stringify(v.owner)}`);
}

const SLUG = /^[\w-]+$/;

/**
 * Refuses lane inputs that are not plain names, since each is rendered into YAML.
 * @param {Lane} l
 */
function checkLane(l) {
  if (!BRANCH.test(l.defaultBranch ?? ""))
    throw new Error(
      `lane: the default branch is not a branch name: ${JSON.stringify(l.defaultBranch)}`,
    );
  if (l.owner !== undefined && !SLUG.test(l.owner))
    throw new Error(`lane: the owner is not a login: ${JSON.stringify(l.owner)}`);
  for (const w of l.workflows ?? [])
    if (!/^[\w .()-]+$/.test(w))
      throw new Error(
        `lane: approve.workflows holds a name that is not plain: ${JSON.stringify(w)}`,
      );
  for (const s of [...(l.requesters ?? []), ...(l.reviewers ?? [])])
    if (!SLUG.test(s)) throw new Error(`lane: ${JSON.stringify(s)} is not an App slug`);
}

/**
 * The event lane's jobs: `cancel`, `route`, `approve` and `merge` (the L2 design, PR D).
 * @param {{ lane: Lane, ref: string, guard: string, guardOn: string, packageRun: (script: string) => string,
 *           yamlJson: (v: unknown) => string, integrity: string, trusted: Record<string, string | string[]>,
 *           ownerOnly: string[] }} input
 */
function laneJobs({
  lane,
  ref,
  guard,
  guardOn,
  packageRun,
  yamlJson,
  integrity,
  trusted,
  ownerOnly,
}) {
  const keyed = (
    /** @type {string} */ name,
    /** @type {string} */ ifs,
    /** @type {string} */ group,
    /** @type {string} */ step,
    /** @type {string} */ script,
    /** @type {string} */ extra,
  ) => `
  ${name}:
${ifs}
    environment: ${APPROVE_ENVIRONMENT}
    runs-on: ubuntu-latest
    timeout-minutes: 15
    # One run at a time per repository; a newer pending run replaces an older one, which loses nothing.
    concurrency:
      group: ${group}
      cancel-in-progress: false
    permissions:
      actions: read
      checks: read
      contents: read
      issues: read
      pull-requests: read
      statuses: read
      id-token: write
    steps:
      - uses: ${SETUP_NODE}
        with:
          node-version: 24
      - name: ${step}
        env:
          GITHUB_TOKEN: \${{ github.token }}
${extra}          REPO: \${{ github.repository }}
          ENVIRONMENT: ${APPROVE_ENVIRONMENT}
          RUN_URL: \${{ github.server_url }}/\${{ github.repository }}/actions/runs/\${{ github.run_id }}
          AUTOMATION: \${{ vars.${AUTOMATION_VARIABLE} }}
          DEFAULT_BRANCH: ${lane.defaultBranch}
          OWNER: '${lane.owner ?? ""}'
          REQUESTERS: ${yamlJson(lane.requesters ?? [])}
          REVIEWERS: ${yamlJson(lane.reviewers ?? [])}
          OIDC: ${yamlJson(lane.oidc)}
          ${OIDC_IDENTITY_VARIABLE}: \${{ vars.${OIDC_IDENTITY_VARIABLE} }}
          INTEGRITY: '${integrity}'
          TRUSTED: ${yamlJson(trusted)}
          OWNER_ONLY_EXTRA: ${yamlJson(ownerOnly)}
${packageRun(script)}`;
  return `
  cancel:
    # A push withdraws the land request. The job's token starts no workflow; it runs even while frozen, since it only
    # withdraws.
    if: github.event_name == 'pull_request_target' && github.event.action == 'synchronize' && contains(github.event.pull_request.labels.*.name, '${LAND_LABEL}') && ${ref}
    runs-on: ubuntu-latest
    timeout-minutes: 2
    permissions:
      pull-requests: write
    steps:
      - name: Withdraw the land request
        env:
          GH_TOKEN: \${{ github.token }}
          REPO: \${{ github.repository }}
          PR: \${{ github.event.pull_request.number }}
        run: gh api -X DELETE "repos/$REPO/issues/$PR/labels/${encodeURIComponent(LAND_LABEL)}" --silent

  route:
    # No key: whether any open PR asks to land. The events below only wake it; approve and merge read everything again.
    if: >-
      ${guard} && (
      (github.event_name == 'pull_request_target' && (github.event.action == 'ready_for_review' || github.event.label.name == '${LAND_LABEL}')) ||
      (github.event_name == 'status' && github.event.context == '${STATUS_CONTEXT}' && github.event.state == 'success') ||
      (github.event_name == 'issue_comment' && github.event.issue.pull_request && (startsWith(github.event.comment.body, '${LAND_COMMAND}') || startsWith(github.event.comment.body, 'AI-REVIEW:'))) ||
      (github.event_name == 'workflow_run' && github.event.workflow_run.conclusion == 'success') ||
      github.event_name == 'schedule')
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions:
      contents: read
      issues: read
      pull-requests: read
    outputs:
      any: \${{ steps.route.outputs.any }}
    steps:
      - uses: ${SETUP_NODE}
        with:
          node-version: 24
      - name: Find the land requests
        id: route
        env:
          GITHUB_TOKEN: \${{ github.token }}
          REPO: \${{ github.repository }}
          DEFAULT_BRANCH: ${lane.defaultBranch}
          INTEGRITY: '${integrity}'
${packageRun("land-route.mjs")}${keyed(
    "approve",
    `    needs: route
    if: needs.route.outputs.any == 'true' && ${guardOn}`,
    `${NAME}-approve`,
    "Check and approve each land request",
    "approve-check.mjs",
    "          MODE: event\n",
  )}${keyed(
    "merge",
    `    needs: [route, approve]
    if: \${{ !cancelled() && needs.route.outputs.any == 'true' && needs.approve.result != 'cancelled' && ${guard} }}`,
    `${NAME}-merge`,
    "Merge each approved land request",
    "merge.mjs",
    "",
  )}`;
}

/**
 * The `verdict` job: on the gate workflow's completed run, main's copy posts the gate's status as the Flow App.
 * @param {Verdict} v
 * @param {string} guard the default-branch and automation condition
 * @param {(script: string) => string} packageRun
 * @param {(v: unknown) => string} yamlJson
 * @param {string} integrity
 */
function verdictJob(v, guard, packageRun, yamlJson, integrity) {
  return `
  verdict:
    # No App secret here: verdict.mjs mints a statuses-only Flow App token over this job's OIDC token, in process.
    if: github.event_name == 'workflow_run' && ${guard}
    environment: ${APPROVE_ENVIRONMENT}
    runs-on: ubuntu-latest
    timeout-minutes: 5
    # Per head, so gates on different PRs never cancel one another's verdict.
    concurrency:
      group: ${NAME}-verdict-\${{ github.event.workflow_run.head_sha }}
      cancel-in-progress: false
    permissions:
      actions: read
      contents: read
      pull-requests: read
      id-token: write
    steps:
      - uses: ${SETUP_NODE}
        with:
          node-version: 24
      - name: Post ${STATUS_CONTEXT}
        env:
          GITHUB_TOKEN: \${{ github.token }}
          RUN_ID: \${{ github.event.workflow_run.id }}
          AUTOMATION: \${{ vars.${AUTOMATION_VARIABLE} }}
          GATE_PATH: ${v.gatePath}
          OWNER: '${v.owner ?? ""}'
          DEFAULT_BRANCH: ${v.defaultBranch}
          OIDC: ${yamlJson(v.oidc)}
          ${OIDC_IDENTITY_VARIABLE}: \${{ vars.${OIDC_IDENTITY_VARIABLE} }}
          INTEGRITY: '${integrity}'
${packageRun("verdict.mjs")}`;
}
