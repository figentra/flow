/**
 * Figentra Flow file contract:
 * Purpose: the gate workflow `fflow init --runner github-actions` writes into a repository, for the
 *   `github-actions` runner: each push to a PR runs one `check` job, which checks out the head without credentials
 *   and runs the check command (`fflow gate command`) with a read-only token and no secret. It posts nothing: main's
 *   approval workflow (its `verdict` job, `approve-workflow.mjs`) reads the `check` job's conclusion from the API on
 *   `workflow_run` and posts `fflow/gate` as the Flow App (the L2 design, PR F).
 * Boundary: returns text; writes nothing. The product's names come from `product.mjs` (AC-042); every action is pinned
 *   to a commit.
 * Runtime: node
 * Governing contract: STA-1729 phase A (A3); the L2 design (PR F); STA-1945.
 * Secrets: none; the workflow names none.
 */
import { NAME, PACKAGE, REGISTRY, STATUS_CONTEXT } from "./product.mjs";

const CHECKOUT = "actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0";
export const SETUP_NODE = "actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0";

/** The job whose conclusion is the gate's verdict (`verdict.mjs` and the runner read it by this name). */
export const CHECK_JOB = "check";

/**
 * The workflow's YAML. Its `name` is the status context, which the approval workflow's `workflow_run` names.
 * @param {{ version: string }} options the `fflow` version whose check command the job runs
 */
export function gateWorkflow({ version }) {
  const pkg = `${PACKAGE}@${version}`;
  // A scoped package resolves from the registry it is published to; npm's default otherwise.
  const scope =
    PACKAGE.startsWith("@") && REGISTRY ? ` --${PACKAGE.split("/")[0]}:registry=${REGISTRY}` : "";
  return `# Written by \`${NAME} init --runner github-actions\`; every push to a PR runs it.
# It runs the change's code with a read-only token and posts nothing: main's approval workflow posts ${STATUS_CONTEXT}.
name: ${STATUS_CONTEXT}

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

permissions: {}

jobs:
  ${CHECK_JOB}:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    permissions:
      contents: read
    env:
      COREPACK_ENABLE_DOWNLOAD_PROMPT: "0"
    steps:
      - uses: ${CHECKOUT}
        with:
          ref: \${{ github.event.pull_request.head.sha }}
          fetch-depth: 0
          persist-credentials: false
      - uses: ${SETUP_NODE}
        with:
          node-version: 24
      - run: corepack enable
      - name: Check
        run: |
          npx --yes${scope} --package=${pkg} ${NAME} gate command > "$RUNNER_TEMP/check.sh"
          bash "$RUNNER_TEMP/check.sh"
`;
}
