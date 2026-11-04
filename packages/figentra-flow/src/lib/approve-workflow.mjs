/**
 * Figentra Flow file contract:
 * Purpose: the approval workflow `sync` renders into a repository (STA-1856 FR-4). It is dispatched with `pr` and
 *   `head`, mints the approving App's token, downloads this exact package version, refuses unless the tarball's
 *   sha512 is the integrity the repository's lockfile pinned at render time, and runs `approve-check.mjs` from it. That script
 *   holds every rule, and its tests live here. The workflow runs in `APPROVE_ENVIRONMENT`, which must allow the
 *   default branch only; the check refuses when it does not. With `verdict` (a `github-actions` runner and
 *   `secrets.oidc`, the L2 design's PR F) it also runs on the gate workflow's `workflow_run`: a `verdict` job, with
 *   `id-token: write` and no App secret, runs `verdict.mjs` from the same pinned tarball, which mints a `verdict`
 *   token over OIDC and posts the gate's status. Then every job runs only on the default branch and while the
 *   automation variable allows it (missing is frozen). Without `verdict` the file is today's, byte for byte.
 * Boundary: returns text; writes nothing. The workflow never checks out or runs the PR's code, never downloads an
 *   artifact, never puts event text in a `run:` block (hints go through `env`, and node checks them) and never merges
 *   (auto merge does, after every required check).
 * Runtime: node
 * Governing contract: STA-1856 FR-4 (the security review of 2026-11-01); the L2 design (PR F); STA-1945.
 * Secrets: names the approving App's id and key secrets, which are distinct from any bot that pushes; holds no value.
 *   The `verdict` job names none: its token comes from Infisical over the job's OIDC token, in process.
 */
import { SETUP_NODE } from "./gate-workflow.mjs";
import {
  APPROVE_ENVIRONMENT,
  AUTOMATION_RUNS,
  AUTOMATION_VARIABLE,
  NAME,
  PACKAGE,
  REGISTRY,
  STATUS_CONTEXT,
} from "./product.mjs";

const APP_TOKEN =
  "actions/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510 # v3.3.0";

/**
 * The `verdict` job's inputs: the gate workflow's path, the owner, the default branch and the Infisical coordinates.
 * @typedef {{ gatePath: string, owner?: string, defaultBranch: string,
 *             oidc: import("./app-token.mjs").Oidc }} Verdict
 */

/**
 * The workflow's YAML.
 * @param {{ version: string, integrity?: string, appId: string, privateKey: string,
 *           trusted?: Record<string, string | string[]>, ownerOnly?: string[], verdict?: Verdict }} options the
 *   package version to run and its lockfile integrity (`sha512-…`; without one the workflow refuses to run), the App
 *   secret names, the trusted check sources (context to a login or a list of logins), the repository's extra
 *   owner-only globs and, for a `github-actions` runner with `secrets.oidc`, the `verdict` job's inputs
 */
export function approveWorkflow({
  version,
  integrity = "",
  appId,
  privateKey,
  trusted = {},
  ownerOnly = [],
  verdict,
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
  // With the verdict's event, every job runs on the default branch only, and only while automation is not frozen.
  const guard = verdict
    ? `github.ref == 'refs/heads/${verdict.defaultBranch}' && (${AUTOMATION_RUNS.map((v) => `vars.${AUTOMATION_VARIABLE} == '${v}'`).join(" || ")})`
    : "";
  return `# Written by \`${NAME} sync\`; \`${NAME} land\` dispatches it when the ruleset requires a review (STA-1856).
# Every rule is in ${PACKAGE}'s approve-check.mjs, at the version below; \`${NAME} gate ci\` fails on a hand edit.
name: ${NAME} approve
${
  verdict
    ? `run-name: \${{ github.event_name == 'workflow_dispatch' && format('${NAME} approve PR {0} at {1}', inputs.pr, inputs.head) || '${NAME} verdict' }}`
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
  verdict
    ? `  # The gate workflow's runs on PRs; main's copy of this file reads each one (\`verdict\` below).
  workflow_run:
    workflows: [${JSON.stringify(STATUS_CONTEXT)}]
    types: [completed]
`
    : ""
}
permissions: {}
${
  verdict
    ? ""
    : `
concurrency:
  group: ${NAME}-approve-\${{ inputs.pr }}
  cancel-in-progress: false
`
}
jobs:
  approve:
${
  verdict
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
          app-id: \${{ secrets.${appId} }}
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
${packageRun("approve-check.mjs")}${verdict ? verdictJob(verdict, guard, packageRun, yamlJson, integrity) : ""}`;
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
          INTEGRITY: '${integrity}'
${packageRun("verdict.mjs")}`;
}
