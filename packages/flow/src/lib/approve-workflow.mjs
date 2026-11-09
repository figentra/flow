/**
 * Figentra Flow file contract:
 * Purpose: the approval workflow `sync` renders into a repository (STA-1856 FR-4). It is dispatched with `pr` and
 *   `head`, mints the approving App's token, downloads this exact package version, refuses unless the tarball's
 *   sha512 is the integrity the repository's lockfile pinned at render time, and runs `approve-check.mjs` from it. That script
 *   holds every rule, and its tests live here. The workflow runs in `APPROVE_ENVIRONMENT`, which must allow the
 *   default branch only; the check refuses when it does not. With `verdict` (a `github-actions` runner and
 *   `secrets.oidc`, the L2 design's PR F) it also runs on the gate workflow's `workflow_run`: a `verdict` job, with
 *   `id-token: write` and no App secret, decrypts the gate App's id and key (`secrets.oidc.decrypt` and `scope`,
 *   after mise, which the decrypt needs) and runs `verdict.mjs` from the same pinned tarball, which mints a `verdict`
 *   token and posts the gate's status. Then every job runs only on the default branch and while the
 *   automation variable allows it (missing is frozen). With `lane` (`secrets.oidc`, the L2 design's PR D) events run
 *   it: a `cancel` job removes `LAND_LABEL` on a push (with the job's token, so it starts nothing, and even while frozen,
 *   since it only withdraws), a keyless `route` job wakes on the label, a `/fflow land` comment, the gate's success
 *   status, a listed workflow's success, ready-for-review or the schedule and says whether any PR asks to land, then
 *   `approve` (`approve-check.mjs` with `MODE=event`, automation `on`) and `merge` (`merge.mjs`, `on` or `merge-only`)
 *   mint their own tokens from the same decrypt, one at a time per repository; the dispatched job stays as `approve-dispatch`, the
 *   one-release fallback. Without `verdict` and `lane` the file is today's, byte for byte.
 * Boundary: returns text; writes nothing. The workflow never checks out or runs the PR's code, never downloads an
 *   artifact and never puts event text in a `run:` block (it reaches a step through `env` only). It has no `push`,
 *   `pull_request`, `workflow_call` or `repository_dispatch` trigger. Dispatched, it never merges (auto merge does,
 *   after every required check); with `lane`, only `merge.mjs` merges, at the approved head.
 * Runtime: node
 * Governing contract: STA-1856 FR-4 (the security review of 2026-11-01); the L2 design (PR D, PR F); STA-1945;
 *   Stackra ADR 0525 (sops).
 * Secrets: names the approving App's id and key secrets, which are distinct from any bot that pushes; holds no value.
 *   The `verdict`, `approve` and `merge` event jobs name no repository secret: their decrypt step puts
 *   `<prefix>GATE_APP_ID` and `<prefix>GATE_PRIVATE_KEY` in the job's environment, masked, and the token is minted
 *   in process.
 */
import { SETUP_NODE } from "./gate-workflow.mjs";
import {
  APPROVE_ENVIRONMENT,
  AUTOMATION_RUNS,
  AUTOMATION_VARIABLE,
  ENV_PREFIX,
  LAND_COMMAND,
  LAND_LABEL,
  MISE_VERSION,
  NAME,
  NEVER_TOLERATED,
  PACKAGE,
  REGISTRY,
  STATUS_CONTEXT,
} from "./product.mjs";

const APP_TOKEN =
  "actions/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510 # v3.3.0";
// The decrypt installs sops with mise, so mise goes on PATH first; it installs nothing itself and caches nothing.
const MISE = "jdx/mise-action@9b200bcecbfd6303e69a4a261b2e09e3757440a7 # v5.2.0";

/**
 * Where the event jobs' gate App key comes from (`secrets.oidc`, kind `sops`): the decrypt action, pinned to a commit,
 * and the scope it decrypts the App's id and key from.
 * @typedef {{ decrypt: string, scope: string }} Decrypt
 * The `verdict` job's inputs: the gate workflow's path, the owner, the default branch and the decrypt.
 * @typedef {{ gatePath: string, owner?: string, defaultBranch: string, oidc: Decrypt }} Verdict
 * The event lane's inputs: the default branch, the decrypt, the owner, the workflows whose success wakes
 * it (`approve.workflows`), the App slugs that may ask for a land (`approve.requesters`) and the AI review's App slugs.
 * @typedef {{ defaultBranch: string, oidc: Decrypt, owner?: string, workflows?: string[],
 *             requesters?: string[], reviewers?: string[] }} Lane
 */

/**
 * The steps before a keyed job's script: mise for the decrypt, then the decrypt of the gate App's id and key.
 * @param {Decrypt} d
 */
const decryptSteps = (d) => `      - uses: ${MISE}
        with:
          version: ${MISE_VERSION}
          install: false
          cache: false
      - name: Gate App key
        uses: ${d.decrypt}
        with:
          scope: ${d.scope}
          names: ${ENV_PREFIX}GATE_APP_ID,${ENV_PREFIX}GATE_PRIVATE_KEY
`;

/**
 * Refuses a decrypt that is not an action pinned to a commit with a plain scope, since both are rendered into YAML.
 * @param {string} what
 * @param {Decrypt | undefined} d
 */
function checkDecrypt(what, d) {
  if (!/^(?!.*\.\.)[\w-]+\/[\w.-]+(?:\/[\w.-]+)*@[0-9a-f]{40}$/.test(d?.decrypt ?? ""))
    throw new Error(
      `${what}: secrets.oidc.decrypt is not an action pinned to a commit: ${JSON.stringify(d?.decrypt)}`,
    );
  if (!/^[\w-]+(?:\/[\w-]+)*$/.test(d?.scope ?? ""))
    throw new Error(`${what}: secrets.oidc.scope is not a scope: ${JSON.stringify(d?.scope)}`);
}

/**
 * The workflow's YAML.
 * @param {{ version: string, integrity?: string, appId: string, privateKey: string,
 *           trusted?: Record<string, string | string[]>, ownerOnly?: string[], verdict?: Verdict,
 *           lane?: Lane, tolerate?: string[] }} options the package version to run and its lockfile integrity
 *   (`sha512-…`; without one the workflow refuses to run), the App secret names, the trusted check sources (context
 *   to a login or a list of logins), the repository's extra owner-only globs, for a `github-actions` runner with
 *   `secrets.oidc` the `verdict` job's inputs and, with `secrets.oidc`, the event lane's, and the required checks a
 *   red main may excuse (`approve.tolerate`; none by default)
 */
export function approveWorkflow({
  version,
  integrity = "",
  appId,
  privateKey,
  trusted = {},
  ownerOnly = [],
  tolerate = [],
  verdict,
  lane,
}) {
  if (!/^(?:sha512-[A-Za-z0-9+/]+=*)?$/.test(integrity))
    throw new Error(`${PACKAGE}@${version}: "${integrity}" is not a sha512 integrity`);
  const never = tolerate.filter((c) => NEVER_TOLERATED.includes(c));
  if (never.length)
    throw new Error(`approve.tolerate lists ${never.join(", ")}, which a red main never excuses`);
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
  const events = verdict ?? lane;
  // With events, every job runs on the default branch only, and only while automation is not frozen.
  const ref = events ? `github.ref == 'refs/heads/${events.defaultBranch}'` : "";
  const guard = events
    ? `${ref} && (${AUTOMATION_RUNS.map((v) => `vars.${AUTOMATION_VARIABLE} == '${v}'`).join(" || ")})`
    : "";
  // What approves runs only while automation is fully on (`merge-only` merges what was approved before).
  const guardOn = `${ref} && vars.${AUTOMATION_VARIABLE} == '${AUTOMATION_RUNS[0]}'`;
  const woken = [...(lane?.workflows ?? []), ...(verdict ? [STATUS_CONTEXT] : [])];
  return `# Written by \`${NAME} sync\`; ${lane ? `events run it: the ${LAND_LABEL} label or a \`${LAND_COMMAND}\` comment asks for a land` : `\`${NAME} land\` dispatches it when the ruleset requires a review`} (STA-1856).
# Every rule is in ${PACKAGE}'s approve-check.mjs, at the version below; \`${NAME} gate ci\` fails on a hand edit.
name: ${NAME} approve
${
  events
    ? `run-name: \${{ github.event_name == 'workflow_dispatch' && format('${NAME} approve PR {0} at {1}', inputs.pr, inputs.head) || '${NAME} ${lane ? "approve" : "verdict"}' }}`
    : `run-name: ${NAME} approve PR \${{ inputs.pr }} at \${{ inputs.head }}`
}

on:
  workflow_dispatch:
    inputs:
      pr:
        description: Pull request number
        required: true
        type: number
      head:
        description: The head SHA the caller checked; the approval is refused if the PR moved since
        required: true
        type: string
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
${
  events
    ? ""
    : `
concurrency:
  group: ${NAME}-approve-\${{ inputs.pr }}
  cancel-in-progress: false
`
}
jobs:
  approve${lane ? "-dispatch" : ""}:
${
  events
    ? `    if: github.event_name == 'workflow_dispatch' && ${guard}
    concurrency:
      group: ${NAME}-approve-\${{ inputs.pr }}
      cancel-in-progress: false
`
    : ""
}    # The App's key is only in this environment; the check refuses unless it admits the default branch alone.
    environment: ${APPROVE_ENVIRONMENT}
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions:
      actions: read
      checks: read
      contents: read
      pull-requests: read
      statuses: read
    steps:
      - uses: ${SETUP_NODE}
        with:
          node-version: 24
      - name: App token
        id: app
        uses: ${APP_TOKEN}
        with:
          client-id: \${{ secrets.${appId} }}
          private-key: \${{ secrets.${privateKey} }}
          permission-pull-requests: write
      - name: Check and approve
        env:
          GITHUB_TOKEN: \${{ github.token }}
          APP_TOKEN: \${{ steps.app.outputs.token }}
          APPROVER: \${{ steps.app.outputs.app-slug }}[bot]
          REPO: \${{ github.repository }}
          PR: \${{ inputs.pr }}
          EXPECTED_HEAD: \${{ inputs.head }}
          ENVIRONMENT: ${APPROVE_ENVIRONMENT}
          RUN_URL: \${{ github.server_url }}/\${{ github.repository }}/actions/runs/\${{ github.run_id }}
          INTEGRITY: '${integrity}'
          TRUSTED: ${yamlJson(trusted)}
          OWNER_ONLY_EXTRA: ${yamlJson(ownerOnly)}
          TOLERATE: ${yamlJson(tolerate)}
${packageRun("approve-check.mjs")}${
    lane
      ? laneJobs({
          lane,
          ref,
          guard,
          guardOn,
          packageRun,
          yamlJson,
          integrity,
          trusted,
          ownerOnly,
          tolerate,
        })
      : ""
  }${verdict ? verdictJob(verdict, guard, packageRun, integrity) : ""}`;
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
  checkDecrypt("verdict", v.oidc);
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
  checkDecrypt("lane", l.oidc);
}

/**
 * The event lane's jobs: `cancel`, `route`, `approve` and `merge` (the L2 design, PR D).
 * @param {{ lane: Lane, ref: string, guard: string, guardOn: string, packageRun: (script: string) => string,
 *           yamlJson: (v: unknown) => string, integrity: string, trusted: Record<string, string | string[]>,
 *           ownerOnly: string[], tolerate: string[] }} input
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
  tolerate,
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
${decryptSteps(lane.oidc)}      - name: ${step}
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
          INTEGRITY: '${integrity}'
          TRUSTED: ${yamlJson(trusted)}
          OWNER_ONLY_EXTRA: ${yamlJson(ownerOnly)}
          TOLERATE: ${yamlJson(tolerate)}
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
 * @param {string} integrity
 */
function verdictJob(v, guard, packageRun, integrity) {
  return `
  verdict:
    # No App secret here: the decrypt step signs in with this job's OIDC token; verdict.mjs mints a statuses-only
    # Flow App token in process.
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
${decryptSteps(v.oidc)}      - name: Post ${STATUS_CONTEXT}
        env:
          GITHUB_TOKEN: \${{ github.token }}
          RUN_ID: \${{ github.event.workflow_run.id }}
          AUTOMATION: \${{ vars.${AUTOMATION_VARIABLE} }}
          GATE_PATH: ${v.gatePath}
          OWNER: '${v.owner ?? ""}'
          DEFAULT_BRANCH: ${v.defaultBranch}
          INTEGRITY: '${integrity}'
${packageRun("verdict.mjs")}`;
}
