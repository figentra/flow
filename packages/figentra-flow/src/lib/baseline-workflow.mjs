/**
 * Figentra Flow file contract:
 * Purpose: the baseline workflow `sync` renders when the config has `baseline` (STA-1942 FR-5). One job, `Baseline`:
 *   the repository's own setup steps, its install, one `turbo run <tasks> --continue --summarize`, then `gate baseline
 *   save`; a push to the default branch uploads the results as that commit's baseline, a pull request checks against
 *   the nearest one.
 * Boundary: returns text; writes nothing. The setup steps come verbatim from the owner-only config; every action Flow
 *   adds is pinned to a commit.
 * Runtime: node
 * Governing contract: STA-1942 FR-5 and FR-6.
 * Secrets: holds none; a repository's setup steps may name its own, as its CI does.
 */
import { artifactName } from "./baseline.mjs";
import { BASELINE_CHECK, GATE_DIR, NAME } from "./product.mjs";

const CHECKOUT = "actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0";
const UPLOAD = "actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2";

/** What `baseline` defaults to. */
export const BASELINE_DEFAULTS = {
  tasks: ["lint", "typecheck", "test", "build"],
  install: "pnpm install --frozen-lockfile",
  branch: "main",
};

/**
 * The workflow's YAML.
 * @param {{ tasks?: string[], install?: string, setup?: Record<string, unknown>[], branch?: string }} baseline
 */
export function baselineWorkflow(baseline) {
  const { tasks, install, branch } = { ...BASELINE_DEFAULTS, ...baseline };
  // A step is a JSON object, which is a YAML flow mapping: no re-indenting, nothing reinterpreted.
  const setup = (baseline.setup ?? []).map((s) => `      - ${JSON.stringify(s)}\n`).join("");
  return `# Written by \`${NAME} sync\` from the config's \`baseline\` (STA-1942); \`${NAME} gate ci\` fails on a hand edit.
# One check, "${BASELINE_CHECK}": a pull request passes when it fails no task that passed on main.
name: ${NAME} baseline

on:
  push:
    branches: [${branch}]
  pull_request:
    branches: [${branch}]

permissions: {}

concurrency:
  group: ${NAME}-baseline-\${{ github.event.pull_request.number || github.sha }}
  cancel-in-progress: \${{ github.event_name == 'pull_request' }}

jobs:
  baseline:
    name: ${BASELINE_CHECK}
    runs-on: ubuntu-latest
    timeout-minutes: 60
    permissions:
      contents: read
      actions: read
      # for a setup step's OIDC login (registry auth through Infisical), as the repository's own CI has
      id-token: write
    steps:
      - uses: ${CHECKOUT}
        with:
          persist-credentials: false
${setup}      - name: Install
        run: ${install}
      # Failures are judged against main's baseline, so the run itself never fails the job.
      - name: Tasks
        run: pnpm exec turbo run ${tasks.join(" ")} --continue --summarize || true
      - name: Results
        run: pnpm exec ${NAME} gate baseline save
      - if: github.event_name == 'push'
        uses: ${UPLOAD}
        with:
          name: ${artifactName("${{ github.sha }}")}
          path: ${GATE_DIR}/baseline.json
          retention-days: 90
      - if: github.event_name == 'pull_request'
        name: Compare with main
        env:
          GITHUB_TOKEN: \${{ github.token }}
          GH_TOKEN: \${{ github.token }}
          BASE_SHA: \${{ github.event.pull_request.base.sha }}
        run: pnpm exec ${NAME} gate baseline check --base "$BASE_SHA"
`;
}
