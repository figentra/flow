/**
 * Figentra Flow file contract:
 * Purpose: the gate workflow `figentra-flow init --runner github-actions` writes into a repository, for the
 *   `github-actions` runner: a `workflow_dispatch` with `sha` and `branch`, whose run title carries the sha. Two jobs,
 *   so the change's code and the gate App's key never share one: `check` checks out the commit, runs the check
 *   command (`figentra-flow gate command`) with no secret and uploads its exit code and log; `post` never checks out
 *   the repository, takes the poster from the pinned `figentra-flow` package and posts `figentra-flow/gate` with the
 *   App's id and key from repository secrets.
 * Boundary: returns text; writes nothing. The product's names come from `product.mjs` (AC-042); every action is pinned
 *   to a commit.
 * Runtime: node
 * Governing contract: STA-1729 phase A (A3).
 * Secrets: names the repository secrets `<ENV_PREFIX>GATE_APP_ID` and `<ENV_PREFIX>GATE_PRIVATE_KEY`; holds no value.
 */
import {
  ENV_PREFIX,
  GATE_DIR,
  GATE_MARKER,
  NAME,
  PACKAGE,
  REGISTRY,
  STATUS_CONTEXT,
} from "./product.mjs";

const CHECKOUT = "actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0";
const SETUP_NODE = "actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0";
const UPLOAD = "actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2";
const DOWNLOAD = "actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2";

/**
 * The workflow's YAML.
 * @param {{ version: string }} options the `figentra-flow` version whose poster the `post` job runs
 */
export function gateWorkflow({ version }) {
  const pkg = `${PACKAGE}@${version}`;
  // A scoped package resolves from the registry it is published to; npm's default otherwise.
  const scope =
    PACKAGE.startsWith("@") && REGISTRY ? ` --${PACKAGE.split("/")[0]}:registry=${REGISTRY}` : "";
  const job = JSON.stringify({
    context: STATUS_CONTEXT,
    marker: GATE_MARKER,
    envPrefix: ENV_PREFIX,
  });
  return `# Written by \`${NAME} init --runner github-actions\`; \`${NAME} gate run\` dispatches it on the default branch.
# Two jobs, so the change's code never shares a job with the gate App's key.
name: ${STATUS_CONTEXT}
run-name: ${NAME} gate \${{ inputs.sha }}

on:
  workflow_dispatch:
    inputs:
      sha:
        description: The commit to check
        required: true
      branch:
        description: The branch whose tip it must still be when the status is posted
        required: true

permissions: {}

jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    permissions:
      contents: read
    env:
      COREPACK_ENABLE_DOWNLOAD_PROMPT: "0"
    steps:
      - uses: ${CHECKOUT}
        with:
          ref: \${{ inputs.sha }}
          fetch-depth: 0
          persist-credentials: false
      - uses: ${SETUP_NODE}
        with:
          node-version: 24
      - run: corepack enable
      - name: Check
        run: |
          mkdir -p ${GATE_DIR}
          date -u +%Y-%m-%dT%H:%M:%SZ > ${GATE_DIR}/started
          npx --yes${scope} --package=${pkg} ${NAME} gate command > "$RUNNER_TEMP/check.sh"
          set +e
          bash "$RUNNER_TEMP/check.sh" 2>&1 | tee ${GATE_DIR}/log.txt
          code=\${PIPESTATUS[0]}
          echo "$code" > ${GATE_DIR}/exit
          exit "$code"
      - if: always()
        uses: ${UPLOAD}
        with:
          name: ${NAME}-gate
          path: |
            ${GATE_DIR}/started
            ${GATE_DIR}/exit
            ${GATE_DIR}/log.txt
          retention-days: 3

  post:
    needs: check
    if: always()
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions: {}
    steps:
      - uses: ${DOWNLOAD}
        with:
          name: ${NAME}-gate
          path: ${GATE_DIR}
      - uses: ${SETUP_NODE}
        with:
          node-version: 24
      - name: Post ${STATUS_CONTEXT}
        env:
          ${ENV_PREFIX}GATE_APP_ID: \${{ secrets.${ENV_PREFIX}GATE_APP_ID }}
          ${ENV_PREFIX}GATE_PRIVATE_KEY: \${{ secrets.${ENV_PREFIX}GATE_PRIVATE_KEY }}
          SHA: \${{ inputs.sha }}
          BRANCH: \${{ inputs.branch }}
          REPOSITORY: \${{ github.repository }}
        run: |
          npm install --no-save --ignore-scripts${scope} --prefix "$RUNNER_TEMP/flow" ${pkg}
          cp "$RUNNER_TEMP/flow/node_modules/${PACKAGE}/src/lib/gate-post.mjs" ${GATE_DIR}/post.mjs
          node -e 'const j = ${job}; require("fs").writeFileSync(process.argv[1], JSON.stringify({ ...j, sha: process.env.SHA, branch: process.env.BRANCH, repository: process.env.REPOSITORY, startedAt: require("fs").readFileSync(process.argv[2], "utf8").trim() }))' ${GATE_DIR}/job.json ${GATE_DIR}/started
          set +e
          node ${GATE_DIR}/post.mjs
          code=$?
          # 0 and 1 are posted (green, red); 4 (not posted) and 5 (stale) fail this job.
          [ "$code" -le 1 ]
`;
}
