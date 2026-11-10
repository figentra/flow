/**
 * Figentra Flow file contract:
 * Purpose: the manual sandbox workflow `sync` renders when the config has `ci.sandbox`: one job that runs a command
 *   against a provider's sandbox (Pay's connector certification on Stripe's test mode, say), with the named secrets,
 *   and uploads what it wrote as the evidence. Only `workflow_dispatch` starts it, never a push or a pull request, and
 *   it is never in `Quality Gate`'s needs. The job runs in a GitHub environment (`sandbox` unless named) whose
 *   reviewers the owner sets, so every dispatch waits for the owner's approval and the secrets can live there.
 * Boundary: returns text; writes nothing. Every config value is written as JSON, which YAML reads back unchanged;
 *   only `run` is a command, as `ci.checks` steps are. A secret reaches the job only through `secrets`, by name, as
 *   `${{ secrets.NAME }}`: an env value holding `${{` is refused, so no expression slips another secret in.
 * Runtime: node
 * Governing contract: the leader's FLOW-CI brief (2026-11-10): `ci.sandbox`, owner-triggered, never by an agent.
 * Secrets: names only; the owner sets the values in the environment or the repository.
 */
import { blockYaml, CHECKOUT, pinnedMise } from "./baseline-workflow.mjs";
import { CI_DEFAULTS } from "./ci-workflow.mjs";
import { ConfigError } from "./config.mjs";
import { NAME } from "./product.mjs";

const CACHE = "actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0";
const UPLOAD = "actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2";

/** What `ci.sandbox` defaults to. */
export const SANDBOX_DEFAULTS = { environment: "sandbox", timeoutMinutes: 30 };

/** An environment variable's name, as the job's `env` and a secret's name take it. */
const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;

/**
 * Steps as block YAML under a job's `steps:`, each with its first key on the `- ` line.
 * @param {Record<string, unknown>[] | undefined} list
 */
const stepsYaml = (list) =>
  (list ?? []).map((s) => `      - ${blockYaml(pinnedMise(s), 8).slice(8)}`).join("");

/**
 * The workflow's YAML.
 * @param {import("./config.mjs").CiConfig} ci with `sandbox` set
 * @param {{ install?: string, setup?: Record<string, unknown>[], afterInstall?: Record<string, unknown>[] }} [baseline]
 *   where `setup`, `install` and `afterInstall` come from when `ci` names none, as in `fflow-ci.yml`
 */
export function sandboxWorkflow(ci, baseline) {
  const sandbox = ci.sandbox;
  if (!sandbox) throw new ConfigError("ci.sandbox: not configured");
  const env = sandbox.env ?? {};
  const secrets = sandbox.secrets ?? [];
  const badNames = [...Object.keys(env), ...secrets].filter((n) => !ENV_NAME.test(n));
  if (badNames.length)
    throw new ConfigError(
      `ci.sandbox: ${badNames.map((n) => JSON.stringify(n)).join(", ")} is not an environment variable name`,
    );
  const both = secrets.filter((n) => n in env);
  if (both.length)
    throw new ConfigError(`ci.sandbox: ${both.join(", ")} is in both env and secrets`);
  const expressions = Object.keys(env).filter((k) => String(env[k]).includes("${{"));
  if (expressions.length)
    throw new ConfigError(
      `ci.sandbox.env: ${expressions.join(", ")} holds an expression; name a secret in ci.sandbox.secrets instead`,
    );

  const install = ci.install ?? baseline?.install ?? CI_DEFAULTS.install;
  const runsOn = ci.runsOn ?? CI_DEFAULTS.runsOn;
  const environment = sandbox.environment ?? SANDBOX_DEFAULTS.environment;
  const minutes = sandbox.timeoutMinutes ?? SANDBOX_DEFAULTS.timeoutMinutes;
  const stepEnv = {
    ...env,
    ...Object.fromEntries(secrets.map((n) => [n, `\${{ secrets.${n} }}`])),
  };
  const run = `      - ${blockYaml(
    {
      name: sandbox.name,
      ...(Object.keys(stepEnv).length ? { env: stepEnv } : {}),
      run: sandbox.run,
    },
    8,
  ).slice(8)}`;
  const artifact = sandbox.artifact
    ? `      - name: Evidence
        if: \${{ !cancelled() }}
        uses: ${UPLOAD}
        with:
${blockYaml({ name: sandbox.artifact.name, path: sandbox.artifact.path, "if-no-files-found": "error", "retention-days": 90 }, 10)}`
    : "";

  return `# Written by \`${NAME} sync\` from the config's \`ci.sandbox\`; \`${NAME} gate ci\` fails on a hand edit.
# A manual run only: never on a push or a pull request, never in Quality Gate's needs. The job runs in the
# ${JSON.stringify(environment)} environment, whose reviewers the owner sets, so every dispatch waits for the owner.
name: ${NAME} sandbox

on:
  workflow_dispatch:

permissions: {}

concurrency:
  group: ${NAME}-sandbox
  cancel-in-progress: false

jobs:
  sandbox:
    name: ${JSON.stringify(sandbox.name)}
    runs-on: ${JSON.stringify(runsOn)}
    timeout-minutes: ${minutes}
    environment: ${JSON.stringify(environment)}
    permissions:
      contents: read
      # for a setup step's OIDC sign-in (registry auth's sops decrypt)
      id-token: write
    steps:
      - name: Checkout
        uses: ${CHECKOUT}
        with:
          persist-credentials: false
${stepsYaml(ci.setup ?? baseline?.setup)}      - name: pnpm store directory
        run: pnpm config set store-dir ~/.pnpm-store
      - name: pnpm store cache
        uses: ${CACHE}
        with:
          path: ~/.pnpm-store
          key: pnpm-store-\${{ runner.os }}-\${{ hashFiles('pnpm-lock.yaml') }}
          restore-keys: pnpm-store-\${{ runner.os }}-
${stepsYaml([{ name: "Install", run: install }])}${stepsYaml(ci.afterInstall ?? baseline?.afterInstall)}${run}${artifact}`;
}
