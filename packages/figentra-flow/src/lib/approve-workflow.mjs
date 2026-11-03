/**
 * Figentra Flow file contract:
 * Purpose: the approval workflow `sync` renders into a repository (STA-1856 FR-4). It is dispatched with `pr` and
 *   `head`, mints the approving App's token, downloads this exact package version, refuses unless the tarball's
 *   sha512 is the integrity the repository's lockfile pinned at render time, and runs `approve-check.mjs` from it. That script
 *   holds every rule, and its tests live here. The workflow runs in `APPROVE_ENVIRONMENT`, which must allow the
 *   default branch only; the check refuses when it does not.
 * Boundary: returns text; writes nothing. The workflow never checks out or runs the PR's code and never merges (auto
 *   merge does, after every required check).
 * Runtime: node
 * Governing contract: STA-1856 FR-4 (the security review of 2026-11-01).
 * Secrets: names the approving App's id and key secrets, which are distinct from any bot that pushes; holds no value.
 */
import { SETUP_NODE } from "./gate-workflow.mjs";
import { APPROVE_ENVIRONMENT, NAME, PACKAGE, REGISTRY } from "./product.mjs";

const APP_TOKEN =
  "actions/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510 # v3.3.0";

/**
 * The workflow's YAML.
 * @param {{ version: string, integrity?: string, appId: string, privateKey: string,
 *           trusted?: Record<string, string | string[]>, ownerOnly?: string[] }} options the package version to run
 *   and its lockfile integrity (`sha512-…`; without one the workflow refuses to run), the App secret names, the
 *   trusted check sources (context to a login or a list of logins) and the repository's extra owner-only globs
 */
export function approveWorkflow({
  version,
  integrity = "",
  appId,
  privateKey,
  trusted = {},
  ownerOnly = [],
}) {
  if (!/^(?:sha512-[A-Za-z0-9+/]+=*)?$/.test(integrity))
    throw new Error(`${PACKAGE}@${version}: "${integrity}" is not a sha512 integrity`);
  const pkg = `${PACKAGE}@${version}`;
  const scope =
    PACKAGE.startsWith("@") && REGISTRY ? ` --${PACKAGE.split("/")[0]}:registry=${REGISTRY}` : "";
  // JSON in a single-quoted YAML scalar: a quote is doubled.
  const yamlJson = (/** @type {unknown} */ v) => `'${JSON.stringify(v).replaceAll("'", "''")}'`;
  return `# Written by \`${NAME} sync\`; \`${NAME} land\` dispatches it when the ruleset requires a review (STA-1856).
# Every rule is in ${PACKAGE}'s approve-check.mjs, at the version below; \`${NAME} gate ci\` fails on a hand edit.
name: ${NAME} approve
run-name: ${NAME} approve PR \${{ inputs.pr }} at \${{ inputs.head }}

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

permissions: {}

concurrency:
  group: ${NAME}-approve-\${{ inputs.pr }}
  cancel-in-progress: false

jobs:
  approve:
    # The App's key is only in this environment; the check refuses unless it admits the default branch alone.
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
        run: |
          cd "$RUNNER_TEMP"
          [ -n "$INTEGRITY" ] || { echo "::error::no pinned integrity for ${pkg}; run ${NAME} sync where the lockfile resolves it"; exit 1; }
          file=$(npm pack --silent${scope} ${pkg} | tail -n 1)
          got="sha512-$(openssl dgst -sha512 -binary "$file" | base64 -w0)"
          [ "$got" = "$INTEGRITY" ] || { echo "::error::${pkg} is $got, not the pinned $INTEGRITY"; exit 1; }
          mkdir flow && tar -xzf "$file" -C flow
          node flow/package/src/lib/approve-check.mjs
`;
}
