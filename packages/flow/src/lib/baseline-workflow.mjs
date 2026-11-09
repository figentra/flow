/**
 * Figentra Flow file contract:
 * Purpose: the baseline workflow `sync` renders when the config has `baseline` (STA-1942 FR-5). One job, `Baseline`:
 *   the repository's own setup steps, its install, one `turbo run <tasks> --continue --summarize`, then `gate baseline
 *   save`; a push to the default branch uploads the results as that commit's baseline, a pull request checks against
 *   the nearest one. Its checkout pin and YAML helpers are shared with the CI workflow (`ci-workflow.mjs`).
 * Boundary: returns text; writes nothing. The setup and after-install steps come from the owner-only config, as block YAML with their
 *   values unchanged, except that a `jdx/mise-action` step with no `version` gets `MISE_VERSION` (an unpinned
 *   mise-action downloads the latest mise, which once returned 504 for hours); every action Flow adds is pinned to
 *   a commit.
 * Runtime: node
 * Governing contract: STA-1942 FR-5 and FR-6.
 * Secrets: holds none; a repository's setup steps may name its own, as its CI does.
 */
import { artifactName } from "./baseline.mjs";
import { BASELINE_CHECK, GATE_DIR, MISE_VERSION, NAME } from "./product.mjs";

export const CHECKOUT = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1";
const UPLOAD = "actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2";

/**
 * `step` with the pinned mise version when it is a mise-action step that names none; a step's own `version` wins.
 * @param {Record<string, unknown>} step
 * @returns {Record<string, unknown>}
 */
export function pinnedMise(step) {
  if (typeof step.uses !== "string" || !step.uses.startsWith("jdx/mise-action@")) return step;
  const options = /** @type {Record<string, unknown>} */ (step.with ?? {});
  return "version" in options ? step : { ...step, with: { ...options, version: MISE_VERSION } };
}

/** What `baseline` defaults to. */
export const BASELINE_DEFAULTS = {
  tasks: ["lint", "typecheck", "test", "build"],
  install: "pnpm install --frozen-lockfile",
  branch: "main",
};

/**
 * A config value as block YAML at `indent`. Every scalar is written as JSON, which YAML reads back unchanged as a
 * double-quoted string, number, boolean or null: nothing is reinterpreted.
 * @param {unknown} value an object or an array
 * @param {number} indent
 * @returns {string}
 */
export function blockYaml(value, indent) {
  const pad = " ".repeat(indent);
  const entries = Array.isArray(value)
    ? value.map((v) => ["-", v])
    : Object.entries(/** @type {object} */ (value)).map(([k, v]) => [
        `${/^[\w-]+$/.test(k) ? k : JSON.stringify(k)}:`,
        v,
      ]);
  return entries
    .map(([head, v]) =>
      v === null || typeof v !== "object"
        ? `${pad}${head} ${JSON.stringify(v)}\n`
        : Object.keys(v).length === 0
          ? `${pad}${head} ${Array.isArray(v) ? "[]" : "{}"}\n`
          : `${pad}${head}\n${blockYaml(v, indent + 2)}`,
    )
    .join("");
}

/**
 * The workflow's YAML.
 * @param {{ tasks?: string[], install?: string, setup?: Record<string, unknown>[],
 *   afterInstall?: Record<string, unknown>[], branch?: string }} baseline
 */
export function baselineWorkflow(baseline) {
  const { tasks, install, branch } = { ...BASELINE_DEFAULTS, ...baseline };
  // A step is written as block YAML (the YAML standard, STA-299, refuses flow mappings), its first key on the `- ` line.
  const steps = (/** @type {Record<string, unknown>[] | undefined} */ list) =>
    (list ?? []).map((s) => `      - ${blockYaml(pinnedMise(s), 8).slice(8)}`).join("");
  const setup = steps(baseline.setup);
  // After the install, before the tasks: a cache save that should only run once the install filled it, say.
  const afterInstall = steps(baseline.afterInstall);
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
      # for a setup step's OIDC sign-in (registry auth's sops decrypt), as the repository's own CI has
      id-token: write
    steps:
      - uses: ${CHECKOUT}
        with:
          persist-credentials: false
${setup}      - name: Install
        run: ${install}
${afterInstall}      # Failures are judged against main's baseline, so the run itself never fails the job.
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
