/**
 * Figentra Flow file contract:
 * Purpose: the standard CI workflow `sync` renders when the config has `ci`. One required check, `Quality Gate`: an
 *   aggregate job that passes when every job it needs passed or was skipped. `Code` runs gen and the turbo tasks, the
 *   members a pull request affects (`--affected`; every member when it touches `FULL_RUN_INPUTS`) or, on a push to the
 *   default branch, the nightly run and a manual
 *   run, everything; on a pull request it also checks the title with commitlint (a squash merge lands the title).
 *   `ci.filters` go on every turbo run; a task in `ci.concurrency` runs in a step of its own with that cap.
 *   `Integration`, with `ci.int`, runs the integration tasks beside a Postgres service, or with `ci.int.postgres:
 *   false` on the runner's Docker alone (suites that start their own, Testcontainers). The optional jobs and the
 *   OSV-Scanner dependency scan run on their own, outside the gate's `needs`.
 * Boundary: returns text; writes nothing. Every value from the owner-only config is written as JSON, which YAML reads
 *   back unchanged (`blockYaml`); only task names, caps and filters reach a `run:` line: the schema and this module
 *   refuse a task that is not a plain word (`TASK_PATTERN`), the schema a cap that is not an integer and a filter
 *   with anything a shell reads inside single quotes (`FILTER_PATTERN`). Every action Flow adds is pinned to a commit, as the infra lead's reference
 *   workflows pin it; a mise-action setup step with no `version` gets `MISE_VERSION`.
 * Runtime: node
 * Governing contract: the infra lead's standard CI (2026-11-09): core, pay and os CI as the reference.
 * Secrets: holds none. With `ci.turbo`, the jobs decrypt the sops scope ci/build/turbo by name (TURBO_API,
 *   TURBO_TOKEN, TURBO_TEAM, TURBO_REMOTE_CACHE_SIGNATURE_KEY) as themselves over OIDC; a repository's setup steps may
 *   name its own, as its CI does. No GitHub secret.
 */
import { blockYaml, CHECKOUT, pinnedMise } from "./baseline-workflow.mjs";
import { ConfigError, SCHEMA, TASK_PATTERN, validate } from "./config.mjs";
import { CI_CHECK, CONFIG_FILE, MISE_VERSION, NAME } from "./product.mjs";

// The pins the reference workflows (core, pay and os CI) use.
const CACHE = "actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0";
const MISE = "jdx/mise-action@9b200bcecbfd6303e69a4a261b2e09e3757440a7 # v5.2.0";
const DECRYPT =
  "figentra/stackra/.github/actions/secrets-decrypt@c8563c852108bb4759827e132b7e5b82b6ae33f4 # @stackra/runway@0.15.0";
const OSV_SCANNER = "aqua:google/osv-scanner@2.7.0";
/** The names the turbo remote cache reads from ci/build/turbo; nothing else in the scope reaches the job. */
const TURBO_NAMES = ["TURBO_API", "TURBO_TOKEN", "TURBO_TEAM", "TURBO_REMOTE_CACHE_SIGNATURE_KEY"];

/** What `ci` defaults to; `install`, `setup` and `afterInstall` fall back to `baseline`'s first. */
export const CI_DEFAULTS = {
  pr: ["typecheck", "lint", "test"],
  main: ["typecheck", "lint", "test", "build"],
  install: "pnpm install --frozen-lockfile",
  commitlint: true,
  turbo: false,
  runsOn: "ubuntu-24.04",
  timeoutMinutes: 30,
  branch: "main",
  nightly: "17 2 * * *",
  osv: true,
};

/** What `ci.int` defaults to. The Postgres values are the service's own test credentials, not secrets. */
export const INT_DEFAULTS = { tasks: ["test:int"], image: "postgres:17.6-alpine" };

/** The job ids Flow writes; an optional job may not take one. */
const JOBS = ["gate", "code", "int", "dependency-scan"];

/** The pull request condition, and its negation for the full runs (push, nightly, manual). */
const ON_PR = "github.event_name == 'pull_request'";
const OFF_PR = "github.event_name != 'pull_request'";
/** The same, for a step that runs after an earlier one in its job failed (`keepGoing`). */
const GOING_ON_PR = `\${{ !cancelled() && ${ON_PR} }}`;

/**
 * The paths whose change reaches every member: how the workspace builds or tests. `--affected` puts no member in
 * scope for them, so a pull request that changes only one would pass on zero tasks (pay#230); it runs everything.
 */
export const FULL_RUN_INPUTS = [
  ".github/",
  CONFIG_FILE,
  "turbo.json",
  "turbo.jsonc",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "package.json",
];

/** `FULL_RUN_INPUTS` as an extended regex over `git diff --name-only`: a folder by prefix, a file at the root. */
const FULL_RUN_PATTERN = `^(${FULL_RUN_INPUTS.map((p) =>
  p.endsWith("/") ? p.replaceAll(".", "\\.") : `${p.replaceAll(".", "\\.")}$`,
).join("|")})`;

/**
 * On a pull request, `full=true` when the change touches `FULL_RUN_INPUTS`; the affected pairs read it. The
 * pattern is Flow's own constant: no config value reaches the script.
 */
const SCOPE = `      - name: Scope
        id: scope
        if: ${ON_PR}
        run: |
          if git diff --name-only HEAD~1 HEAD | grep -qE '${FULL_RUN_PATTERN}'; then
            echo "full=true" >> "$GITHUB_OUTPUT"
            echo "::notice title=Scope::the change touches the workspace's build or test inputs; every member runs"
          fi
`;

/** An affected pair's two sides: the affected members on a pull request, unless `Scope` says every member. */
const AFFECTED_ON = `${ON_PR} && steps.scope.outputs.full != 'true'`;
const AFFECTED_OFF = `${OFF_PR} || steps.scope.outputs.full == 'true'`;

/**
 * Steps as block YAML under a job's `steps:`, each with its first key on the `- ` line.
 * @param {Record<string, unknown>[] | undefined} list
 */
const stepsYaml = (list) =>
  (list ?? []).map((s) => `      - ${blockYaml(pinnedMise(s), 8).slice(8)}`).join("");

/**
 * One step as block YAML.
 * @param {Record<string, unknown>} step
 */
const stepYaml = (step) => stepsYaml([step]);

/**
 * `step` that still runs after an earlier step in its job failed (but not once the run is cancelled), its own `if`
 * kept: a failing check must not hide the checks and tasks after it, and the job still fails at the end.
 * @param {Record<string, unknown>} step
 * @returns {Record<string, unknown>}
 */
function keepGoing(step) {
  const own =
    typeof step.if === "string" ? step.if.replace(/^\s*\$\{\{\s*|\s*\}\}\s*$/g, "") : undefined;
  return { ...step, if: `\${{ !cancelled()${own ? ` && (${own})` : ""} }}` };
}

/**
 * The task list, or a refusal: the names reach a `run:` line unquoted.
 * @param {string[]} tasks
 * @param {string} key the config key, for the message
 */
function taskWords(tasks, key) {
  const bad = tasks.filter((t) => !new RegExp(TASK_PATTERN).test(t));
  if (bad.length)
    throw new ConfigError(
      `ci.${key}: ${bad.map((t) => JSON.stringify(t)).join(", ")} is not a task name`,
    );
  return tasks.join(" ");
}

/**
 * Two steps: `tasks` for the members a pull request affects, against the base commit, and `full` otherwise. An empty
 * side has no step (a capped task that only one of `ci.pr` and `ci.main` names).
 * @param {string} name
 * @param {string} tasks
 * @param {string} full
 * @param {Record<string, string>} [env] each step's environment besides the base
 * @param {boolean} [going] run even after an earlier step of the job failed (`keepGoing`)
 * @param {string} [args] what follows the task names on both lines: `--concurrency`, the filters
 */
function affectedPair(name, tasks, full, env = {}, going = false, args = "") {
  const extra = Object.keys(env).length ? blockYaml(env, 10) : "";
  const affected = `      - name: ${name} (affected)
        if: ${going ? `\${{ !cancelled() && (${AFFECTED_ON}) }}` : `\${{ ${AFFECTED_ON} }}`}
        env:
          # A pull request checks out its merge into the base branch, so HEAD~1 is the base and the diff is the PR's own.
          TURBO_SCM_BASE: HEAD~1
${extra}        run: pnpm exec turbo run ${tasks}${args} --affected
`;
  const rest = `      - name: ${name}
        if: ${going ? `\${{ !cancelled() && (${AFFECTED_OFF}) }}` : `\${{ ${AFFECTED_OFF} }}`}
${extra ? `        env:\n${extra}` : ""}        run: pnpm exec turbo run ${full}${args}
`;
  return `${tasks ? affected : ""}${full ? rest : ""}`;
}

/**
 * The workflow's YAML.
 * @param {import("./config.mjs").CiConfig} ci
 * @param {{ install?: string, setup?: Record<string, unknown>[], afterInstall?: Record<string, unknown>[] }} [baseline]
 *   where `setup`, `install` and `afterInstall` come from when `ci` names none
 */
export function ciWorkflow(ci, baseline) {
  const problems = validate(SCHEMA.properties.ci, ci, "ci");
  if (problems.length) throw new ConfigError(problems.join("\n"));
  const c = { ...CI_DEFAULTS, ...ci };
  taskWords(c.pr, "pr");
  taskWords(c.main, "main");
  // A capped task runs in a step of its own with its `--concurrency`; the others share one step.
  const caps = ci.concurrency ?? {};
  const stray = Object.keys(caps).filter((t) => !c.pr.includes(t) && !c.main.includes(t));
  if (stray.length)
    throw new ConfigError(
      `ci.concurrency: ${stray.map((t) => JSON.stringify(t)).join(", ")} is in neither ci.pr nor ci.main`,
    );
  const shared = (/** @type {string[]} */ list) =>
    list.filter((t) => !Object.hasOwn(caps, t)).join(" ");
  const capped = [...new Set([...c.pr, ...c.main])].filter((t) => Object.hasOwn(caps, t));
  // The schema holds each filter to FILTER_PATTERN, so the single quotes are the whole shell reading.
  const filters = (ci.filters ?? []).map((f) => ` --filter='${f}'`).join("");
  const install = ci.install ?? baseline?.install ?? CI_DEFAULTS.install;
  const setup = stepsYaml(ci.setup ?? baseline?.setup);
  // After the install, before the tasks: a cache save that should only run once the install filled it, say.
  const afterInstall = stepsYaml(ci.afterInstall ?? baseline?.afterInstall);
  // The repository's own required checks, inside Code so Quality Gate holds them: `checks` after gen and before the
  // tasks (a format check, a PR-key check), `after` once the tasks ran (a validate that reads the build).
  const checks = stepsYaml(ci.checks?.map(keepGoing));
  const after = stepsYaml(ci.after?.map(keepGoing));
  const nightly = c.nightly === true ? CI_DEFAULTS.nightly : c.nightly;
  const optional = ci.optional ?? [];
  const ids = optional.map((o) => o.id);
  const taken = ids.filter((id, i) => JOBS.includes(id) || ids.indexOf(id) !== i);
  if (taken.length)
    throw new ConfigError(`ci.optional: the job id ${taken.join(", ")} is Flow's or used twice`);

  const head = (/** @type {string} */ id, /** @type {string} */ name, minutes = c.timeoutMinutes) =>
    `  ${id}:
    name: ${JSON.stringify(name)}
    runs-on: ${JSON.stringify(c.runsOn)}
    timeout-minutes: ${minutes}
`;
  const permissions = `    permissions:
      contents: read
      # for a setup step's OIDC sign-in (registry auth's sops decrypt) and the turbo cache's decrypt
      id-token: write
`;
  // The full history: `--affected` compares with the base commit.
  const checkout = (full = false) => `      - name: Checkout
        uses: ${CHECKOUT}
        with:
${full ? "          fetch-depth: 0\n" : ""}          persist-credentials: false
`;
  // Checkout, the repository's setup, the pnpm store cache, the install and the after-install steps.
  const prepare = (
    full = false,
  ) => `${checkout(full)}${full ? SCOPE : ""}${setup}      - name: pnpm store directory
        run: pnpm config set store-dir ~/.pnpm-store
      - name: pnpm store cache
        uses: ${CACHE}
        with:
          path: ~/.pnpm-store
          key: pnpm-store-\${{ runner.os }}-\${{ hashFiles('pnpm-lock.yaml') }}
          restore-keys: pnpm-store-\${{ runner.os }}-
${stepYaml({ name: "Install", run: install })}${afterInstall}`;
  // Skipped on a fork's pull request (no OIDC token there): turbo then uses its local cache only.
  const turbo = c.turbo
    ? `      - name: Turborepo remote cache (sops)
        if: \${{ !github.event.pull_request.head.repo.fork }}
        uses: ${DECRYPT}
        with:
          scope: ci/build/turbo
          names: ${TURBO_NAMES.join(",")}
`
    : "";
  // The title, not the commits: a squash merge lands the title. It arrives through the environment, never the script.
  const commitlint = c.commitlint
    ? `      - name: Pull request title (commitlint)
        if: ${GOING_ON_PR}
        env:
          PR_TITLE: \${{ github.event.pull_request.title }}
        run: printf '%s\\n' "$PR_TITLE" | pnpm exec commitlint
`
    : "";
  const gen =
    c.gen === false
      ? ""
      : typeof c.gen === "string"
        ? stepYaml(keepGoing({ name: "Gen", run: c.gen }))
        : affectedPair("Gen", "gen", "gen", {}, true, filters);
  const taskSteps = `${affectedPair("Tasks", shared(c.pr), shared(c.main), {}, true, filters)}${capped
    .map((t) =>
      affectedPair(
        `Task ${t}`,
        c.pr.includes(t) ? t : "",
        c.main.includes(t) ? t : "",
        {},
        true,
        ` --concurrency=${caps[t]}${filters}`,
      ),
    )
    .join("")}`;

  const code = `${head("code", "Code")}${permissions}    steps:
${prepare(true)}${commitlint}${turbo}${gen}${checks}${taskSteps}${after}`;

  let int = "";
  if (ci.int) {
    const tasks = taskWords(ci.int.tasks ?? INT_DEFAULTS.tasks, "int.tasks");
    // `postgres: false`: the suites start their own Postgres (Testcontainers) on the runner's Docker, so the job has
    // no service container and no database environment.
    const pg = ci.int.postgres;
    const own = typeof pg === "object" ? pg : {};
    const service = {
      postgres: {
        image: own.image ?? INT_DEFAULTS.image,
        env: { POSTGRES_PASSWORD: "postgres", POSTGRES_USER: "postgres", POSTGRES_DB: "test" },
        options:
          '--health-cmd "pg_isready -U postgres" --health-interval 5s --health-timeout 5s --health-retries 10',
        ports: ["5432:5432"],
      },
    };
    const env = {
      TESTBED_POSTGRES_HOST: "localhost",
      DATABASE_URL: "postgres://postgres:postgres@localhost:5432/test",
    };
    const services = pg === false ? "" : `    services:\n${blockYaml(service, 6)}`;
    int = `${head("int", "Integration")}${permissions}${services}    steps:
${prepare(true)}${turbo}${affectedPair("Integration tasks", tasks, tasks, pg === false ? {} : env, false, filters)}`;
  }

  // Their own jobs, never in the gate's `needs`: a failure shows on the run and blocks nothing.
  const extra = optional.map(
    (o) => `${head(o.id, o.name)}    continue-on-error: true
${permissions}    steps:
${o.needsInstall ? prepare() : checkout()}${stepsYaml(o.steps)}`,
  );

  // Known vulnerabilities in the lockfile, as pay's CI scans them: its own job, so a finding never skips the code
  // checks. mise runs before checkout, so the repository's mise.toml is not loaded.
  const osv = c.osv
    ? `${head("dependency-scan", "Dependency scan (OSV-Scanner)", 10)}    permissions:
      contents: read
    steps:
      - name: Toolchain (mise)
        uses: ${MISE}
        with:
          version: ${JSON.stringify(MISE_VERSION)}
          install_args: ${OSV_SCANNER}
          cache: false
      - name: Put osv-scanner on PATH
        run: dirname "$(mise exec ${OSV_SCANNER} -- which osv-scanner)" >> "$GITHUB_PATH"
${checkout()}      - name: Dependency scan (OSV-Scanner)
        run: osv-scanner scan source --lockfile=pnpm-lock.yaml
`
    : "";

  const needs = ci.int ? "[code, int]" : "[code]";
  const branch = JSON.stringify(c.branch);
  const schedule = nightly ? `  schedule:\n    - cron: ${JSON.stringify(nightly)}\n` : "";
  return `# Written by \`${NAME} sync\` from the config's \`ci\`; \`${NAME} gate ci\` fails on a hand edit.
# One required check, "${CI_CHECK}": it passes when every job it needs passed or was skipped.
name: ${NAME} ci

on:
  pull_request:
    branches: [${branch}]
  push:
    branches: [${branch}]
${schedule}  workflow_dispatch:

permissions: {}

concurrency:
  group: ${NAME}-ci-\${{ github.event.pull_request.number || github.sha }}
  cancel-in-progress: \${{ github.event_name == 'pull_request' }}

jobs:
  # The ruleset requires this job by name. It runs even when a job it needs failed, and fails unless each passed or
  # was skipped; the results arrive through the environment, never the script.
  gate:
    name: ${CI_CHECK}
    needs: ${needs}
    if: always()
    runs-on: ${JSON.stringify(c.runsOn)}
    timeout-minutes: 5
    permissions: {}
    steps:
      - name: Every job passed or was skipped
        env:
          NEEDS: \${{ toJSON(needs) }}
        run: |
          node -e '
            const failed = Object.entries(JSON.parse(process.env.NEEDS))
              .filter(([, job]) => !["success", "skipped"].includes(job.result));
            for (const [id, job] of failed) console.log("::error title=${CI_CHECK}::" + id + ": " + job.result);
            process.exit(failed.length ? 1 : 0);
          '

${code}${int ? `\n${int}` : ""}${extra.map((e) => `\n${e}`).join("")}${osv ? `\n${osv}` : ""}`;
}
