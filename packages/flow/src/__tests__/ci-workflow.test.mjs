/**
 * Figentra Flow file contract:
 * Purpose: hold the standard CI workflow (`ci-workflow.mjs`) to the infra lead's content:
 *   - the header line `gate ci` checks, `permissions: {}` at the top, and the triggers: pull requests (marking a draft
 *     ready included) and pushes to the default branch, the nightly schedule (present by default, absent with
 *     `nightly: false`) and manual runs;
 *   - the defaults render `Quality Gate`, which needs `code` only, runs always and reads the results from the
 *     environment, and `Code`, with the turbo tasks `--affected` on a pull request only;
 *   - `ci.int` adds the `Integration` job with its Postgres service, and joins the gate's `needs`;
 *   - optional jobs and the OSV-Scanner scan are `continue-on-error` or apart, never in the gate's `needs`;
 *   - the pull request title reaches commitlint through the environment: no `run:` line holds `${{`;
 *   - `ci.setup` falls back to `baseline.setup`; `ci.turbo` decrypts only the turbo names;
 *   - a task name that is not a plain word, or an optional job taking Flow's id, is a ConfigError;
 *   - `sync` renders `fflow-ci.yml` only with `ci` configured;
 *   - a `ci.render` entry adds a job (required unless `required: false`) that builds the site, installs Playwright at
 *     its pin and runs `fflow render` with the entry as JSON in `FFLOW_RENDER`; a taken id or a bad value is refused.
 * Boundary: renders text and parses it with Flow's own YAML reader; one temporary folder for `sync`.
 * Runtime: node
 * Governing contract: the infra lead's standard CI (2026-11-09).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sync } from "../commands/sync.mjs";
import { ciWorkflow, FULL_RUN_INPUTS, PLAYWRIGHT } from "../lib/ci-workflow.mjs";
import { ConfigError } from "../lib/config.mjs";
import { CI_CHECK, CI_WORKFLOW } from "../lib/product.mjs";
import { parseYaml } from "../lib/yaml.mjs";

/** An optional job, as the os repository's mobile line would write one. */
const opt = {
  id: "mobile",
  name: "Mobile app (Uniwind Pro)",
  steps: [{ name: "Mobile", run: "pnpm exec turbo run build --filter=@figentra/os-mobile" }],
};

/** Every step of every job, with its job id. */
const allSteps = (/** @type {any} */ wf) =>
  Object.entries(wf.jobs).flatMap(([id, job]) =>
    /** @type {any[]} */ (/** @type {any} */ (job).steps).map((s) => ({ id, ...s })),
  );

test("ci: the header, top-level permissions and the triggers, the nightly schedule included", () => {
  const yml = ciWorkflow({});
  assert.equal(
    yml.split("\n")[0],
    "# Written by `fflow sync` from the config's `ci`; `fflow gate ci` fails on a hand edit.",
  );
  const wf = parseYaml(yml);
  assert.equal(wf.name, "fflow ci");
  assert.deepEqual(wf.permissions, {});
  assert.deepEqual(wf.on.pull_request, {
    branches: ["main"],
    types: ["opened", "synchronize", "reopened", "ready_for_review"],
  });
  assert.deepEqual(wf.on.push, { branches: ["main"] });
  assert.deepEqual(wf.on.schedule, [{ cron: "17 2 * * *" }]);
  assert.ok("workflow_dispatch" in wf.on);
  assert.equal(wf.concurrency["cancel-in-progress"], "${{ github.event_name == 'pull_request' }}");
  assert.deepEqual(parseYaml(ciWorkflow({ nightly: "5 4 * * 1" })).on.schedule, [
    { cron: "5 4 * * 1" },
  ]);
  assert.ok(!("schedule" in parseYaml(ciWorkflow({ nightly: false })).on));
  assert.deepEqual(parseYaml(ciWorkflow({ branch: "trunk" })).on.push, { branches: ["trunk"] });
});

test("ci: the defaults render Quality Gate, needing code only, and Code", () => {
  const wf = parseYaml(ciWorkflow({}));
  const { gate, code } = wf.jobs;
  assert.equal(gate.name, CI_CHECK);
  assert.deepEqual(gate.needs, ["code"]);
  assert.equal(gate.if, "always()");
  assert.deepEqual(gate.permissions, {});
  assert.equal(gate.steps[0].env.NEEDS, "${{ toJSON(needs) }}");
  assert.match(gate.steps[0].run, /\["success", "skipped"\]\.includes\(job\.result\)/);
  assert.equal(code.name, "Code");
  assert.equal(code["runs-on"], "ubuntu-24.04");
  assert.equal(code["timeout-minutes"], 30);
  assert.deepEqual(code.permissions, { contents: "read", "id-token": "write" });
  assert.equal(code.steps[0].with["persist-credentials"], false);
  assert.ok(!("int" in wf.jobs));
  // the pnpm store cache before the install
  const names = code.steps.map((/** @type {any} */ s) => s.name);
  assert.ok(names.indexOf("pnpm store cache") < names.indexOf("Install"));
  const cache = code.steps.find((/** @type {any} */ s) => s.name === "pnpm store cache");
  assert.equal(cache.with.key, "pnpm-store-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}");
  assert.equal(cache.with["restore-keys"], "pnpm-store-${{ runner.os }}-");
  const install = code.steps.find((/** @type {any} */ s) => s.name === "Install");
  assert.equal(install.run, "pnpm install --frozen-lockfile");
  // the OSV scan is its own job, outside the gate's needs
  assert.equal(wf.jobs["dependency-scan"].name, "Dependency scan (OSV-Scanner)");
  assert.ok(!("dependency-scan" in parseYaml(ciWorkflow({ osv: false })).jobs));
});

test("ci: --affected only on a pull request; push, nightly and manual runs take the main tasks", () => {
  const steps = parseYaml(ciWorkflow({})).jobs.code.steps;
  const affected = steps.filter((/** @type {any} */ s) => /--affected/.test(s.run ?? ""));
  assert.deepEqual(
    affected.map((/** @type {any} */ s) => [s.if, s.run]),
    [
      [
        "${{ !cancelled() && (github.event_name == 'pull_request' && steps.scope.outputs.full != 'true') }}",
        "pnpm exec turbo run gen --affected",
      ],
      [
        "${{ !cancelled() && (github.event_name == 'pull_request' && steps.scope.outputs.full != 'true') }}",
        "pnpm exec turbo run typecheck lint test --affected",
      ],
    ],
  );
  const full = steps.filter(
    (/** @type {any} */ s) =>
      s.if ===
      "${{ !cancelled() && (github.event_name != 'pull_request' || steps.scope.outputs.full == 'true') }}",
  );
  assert.deepEqual(
    full.map((/** @type {any} */ s) => s.run),
    ["pnpm exec turbo run gen", "pnpm exec turbo run typecheck lint test build"],
  );
  const own = parseYaml(ciWorkflow({ pr: ["lint"], main: ["lint", "build"], gen: "pnpm gen" })).jobs
    .code.steps;
  assert.deepEqual(
    own
      .filter((/** @type {any} */ s) => s.name !== "Scope" && /turbo|gen/.test(s.run ?? ""))
      .map((/** @type {any} */ s) => s.run),
    ["pnpm gen", "pnpm exec turbo run lint --affected", "pnpm exec turbo run lint build"],
  );
  const noGen = parseYaml(ciWorkflow({ gen: false })).jobs.code.steps;
  assert.ok(!noGen.some((/** @type {any} */ s) => /\bgen\b/.test(s.run ?? "")));
});

test("ci: a pull request that touches the workspace's build or test inputs runs every member, not --affected", () => {
  const wf = parseYaml(ciWorkflow({ int: {} }));
  for (const job of ["code", "int"]) {
    const steps = wf.jobs[job].steps;
    const at = steps.findIndex((/** @type {any} */ s) => s.name === "Scope");
    // right after the full-history checkout, before setup and the install, on a pull request only
    assert.equal(steps[at - 1].name, "Checkout");
    assert.equal(steps[at - 1].with["fetch-depth"], 0);
    assert.equal(steps[at].id, "scope");
    assert.equal(steps[at].if, "github.event_name == 'pull_request'");
    assert.match(steps[at].run, /git diff --name-only HEAD~1 HEAD \| grep -qE/);
    assert.match(steps[at].run, /echo "full=true" >> "\$GITHUB_OUTPUT"/);
  }
  // the pattern: a folder by prefix, a file at the root only
  const run = wf.jobs.code.steps.find((/** @type {any} */ s) => s.name === "Scope").run;
  const pattern = new RegExp(/grep -qE '([^']+)'/.exec(run)?.[1] ?? "");
  for (const path of FULL_RUN_INPUTS.map((p) => (p.endsWith("/") ? `${p}workflows/ci.yml` : p)))
    assert.ok(pattern.test(path), path);
  for (const path of [
    "services/pay/package.json",
    "apps/web/turbo.jsonc",
    "src/a.ts",
    "docs/.github.md",
  ])
    assert.ok(!pattern.test(path), path);
  // an optional job takes no scope: it has no affected pair
  const opt = parseYaml(
    ciWorkflow({ optional: [{ id: "x", name: "X", steps: [{ run: "true" }] }] }),
  );
  assert.ok(!opt.jobs.x.steps.some((/** @type {any} */ s) => s.name === "Scope"));
});

test("ci: the PR title reaches commitlint through the environment; no run: line holds ${{", () => {
  const wf = parseYaml(ciWorkflow({ int: {}, turbo: true, optional: [opt] }));
  const lint = wf.jobs.code.steps.find((/** @type {any} */ s) => /commitlint/.test(s.run ?? ""));
  assert.equal(lint.if, "${{ !cancelled() && github.event_name == 'pull_request' }}");
  assert.equal(lint.env.PR_TITLE, "${{ github.event.pull_request.title }}");
  assert.equal(lint.run, `printf '%s\\n' "$PR_TITLE" | pnpm exec commitlint`);
  for (const s of allSteps(wf)) assert.ok(!/\$\{\{/.test(s.run ?? ""), `${s.id}: ${s.name}`);
  const off = parseYaml(ciWorkflow({ commitlint: false })).jobs.code.steps;
  assert.ok(!off.some((/** @type {any} */ s) => /commitlint/.test(s.run ?? "")));
});

test("ci: int adds the Postgres service and joins the gate's needs", () => {
  const wf = parseYaml(ciWorkflow({ int: {} }));
  assert.deepEqual(wf.jobs.gate.needs, ["code", "int"]);
  const int = wf.jobs.int;
  assert.equal(int.name, "Integration");
  assert.equal(int.services.postgres.image, "postgres:17.6-alpine");
  assert.deepEqual(int.services.postgres.env, {
    POSTGRES_PASSWORD: "postgres",
    POSTGRES_USER: "postgres",
    POSTGRES_DB: "test",
  });
  assert.match(int.services.postgres.options, /^--health-cmd "pg_isready -U postgres" /);
  assert.deepEqual(int.services.postgres.ports, ["5432:5432"]);
  const tasks = int.steps.filter((/** @type {any} */ s) => /turbo run/.test(s.run ?? ""));
  assert.deepEqual(
    tasks.map((/** @type {any} */ s) => s.run),
    ["pnpm exec turbo run test:int --affected", "pnpm exec turbo run test:int"],
  );
  for (const s of tasks) {
    assert.equal(s.env.TESTBED_POSTGRES_HOST, "localhost");
    assert.equal(s.env.DATABASE_URL, "postgres://postgres:postgres@localhost:5432/test");
  }
  const own = parseYaml(
    ciWorkflow({ int: { tasks: ["test:pg"], postgres: { image: "postgres:18-alpine" } } }),
  ).jobs.int;
  assert.equal(own.services.postgres.image, "postgres:18-alpine");
  assert.ok(own.steps.some((/** @type {any} */ s) => s.run === "pnpm exec turbo run test:pg"));
});

test("ci: int with postgres false has no service container and no database env (Testcontainers)", () => {
  const wf = parseYaml(ciWorkflow({ int: { postgres: false } }));
  assert.deepEqual(wf.jobs.gate.needs, ["code", "int"]);
  const int = wf.jobs.int;
  assert.ok(!("services" in int));
  const tasks = int.steps.filter((/** @type {any} */ s) => /turbo run/.test(s.run ?? ""));
  assert.deepEqual(
    tasks.map((/** @type {any} */ s) => s.run),
    ["pnpm exec turbo run test:int --affected", "pnpm exec turbo run test:int"],
  );
  for (const s of tasks) {
    assert.ok(!("DATABASE_URL" in (s.env ?? {})));
    assert.ok(!("TESTBED_POSTGRES_HOST" in (s.env ?? {})));
  }
  // the affected run keeps its base commit
  assert.equal(tasks[0].env.TURBO_SCM_BASE, "HEAD~1");
  // `true` is the default service
  assert.equal(
    parseYaml(ciWorkflow({ int: { postgres: true } })).jobs.int.services.postgres.image,
    "postgres:17.6-alpine",
  );
  assert.throws(() => ciWorkflow(/** @type {any} */ ({ int: { postgres: "yes" } })), ConfigError);
});

test("ci: optional jobs are continue-on-error and never in the gate's needs", () => {
  const wf = parseYaml(
    ciWorkflow({
      int: {},
      optional: [
        opt,
        {
          id: "validate",
          name: "Validate structure",
          steps: [{ run: "pnpm validate" }],
          needsInstall: true,
        },
      ],
    }),
  );
  assert.deepEqual(wf.jobs.gate.needs, ["code", "int"]);
  assert.equal(wf.jobs.mobile.name, "Mobile app (Uniwind Pro)");
  assert.equal(wf.jobs.mobile["continue-on-error"], true);
  assert.deepEqual(
    wf.jobs.mobile.steps.map((/** @type {any} */ s) => s.name),
    ["Checkout", "Mobile"],
  );
  assert.equal(wf.jobs.validate["continue-on-error"], true);
  const names = wf.jobs.validate.steps.map((/** @type {any} */ s) => s.name);
  assert.ok(names.indexOf("Install") >= 0 && names.indexOf("Install") < names.length - 1);
  assert.equal(wf.jobs.validate.steps.at(-1).run, "pnpm validate");
  assert.throws(() => ciWorkflow({ optional: [{ ...opt, id: "code" }] }), ConfigError);
  assert.throws(() => ciWorkflow({ optional: [opt, opt] }), ConfigError);
});

test("ci: setup, install and afterInstall fall back to baseline's; ci's own win", () => {
  const auth = { name: "Registry auth", uses: "./.github/actions/registry-auth" };
  const save = {
    name: "Save",
    uses: "actions/cache/save@0000000000000000000000000000000000000000",
  };
  const fromBaseline = parseYaml(
    ciWorkflow(
      {},
      { setup: [auth], install: "pnpm install --child-concurrency=1", afterInstall: [save] },
    ),
  ).jobs.code.steps;
  // Checkout, then Scope (pull requests only), then the setup
  assert.deepEqual(fromBaseline[2], auth);
  const at = fromBaseline.findIndex((/** @type {any} */ s) => s.name === "Install");
  assert.equal(fromBaseline[at].run, "pnpm install --child-concurrency=1");
  assert.deepEqual(fromBaseline[at + 1], save);
  const own = { name: "Own setup", run: "echo own" };
  const fromCi = parseYaml(ciWorkflow({ setup: [own] }, { setup: [auth] })).jobs.code.steps;
  assert.deepEqual(fromCi[2], own);
  assert.ok(!fromCi.some((/** @type {any} */ s) => s.name === "Registry auth"));
});

test("ci: turbo decrypts ci/build/turbo by name before the tasks, and only when asked", () => {
  const steps = parseYaml(ciWorkflow({ turbo: true })).jobs.code.steps;
  const at = steps.findIndex((/** @type {any} */ s) => s.name === "Turborepo remote cache (sops)");
  assert.ok(at > 0);
  assert.match(
    steps[at].uses,
    /^figentra\/stackra\/\.github\/actions\/secrets-decrypt@[0-9a-f]{40}$/,
  );
  assert.deepEqual(steps[at].with, {
    scope: "ci/build/turbo",
    names: "TURBO_API,TURBO_TOKEN,TURBO_TEAM,TURBO_REMOTE_CACHE_SIGNATURE_KEY",
  });
  assert.ok(at < steps.findIndex((/** @type {any} */ s) => /turbo run/.test(s.run ?? "")));
  assert.doesNotMatch(ciWorkflow({}), /secrets-decrypt/);
});

test("ci: a task name that is not a plain word is a ConfigError", () => {
  for (const ci of [
    { pr: ["lint; curl evil"] },
    { main: ["build", "$(id)"] },
    { int: { tasks: ["test:int && echo"] } },
  ])
    assert.throws(() => ciWorkflow(/** @type {any} */ (ci)), ConfigError);
  assert.doesNotThrow(() => ciWorkflow({ pr: ["test:int", "@scope/pkg:build", "a.b/c-d_e"] }));
});

test("sync renders fflow-ci.yml only with `ci`", (t) => {
  const root = mkdtempSync(join(tmpdir(), "flow-ci-sync-"));
  t.after(() => rmSync(root, { recursive: true }));
  const path = `.github/workflows/${CI_WORKFLOW}`;
  writeFileSync(join(root, "flow.config.json"), JSON.stringify({ version: 1, preset: "neutral" }));
  assert.ok(!sync(root, { log: () => {} }).files.includes(path));
  writeFileSync(
    join(root, "flow.config.json"),
    JSON.stringify({ version: 1, preset: "neutral", ci: {} }),
  );
  sync(root, { log: () => {} });
  assert.match(readFileSync(join(root, path), "utf8"), /^name: fflow ci$/m);
});

// Core's and os's own `baseline` blocks (core main; os's 0.11.0 prep), so the render is checked against what the two
// repositories will feed it, Uniwind's `${{ }}` conditions included.
const FIXTURES = join(import.meta.dirname, "__fixtures__", "ci");
const baselineOf = (/** @type {string} */ repo) =>
  JSON.parse(readFileSync(join(FIXTURES, `${repo}-baseline.json`), "utf8"));

test("ci: core's baseline renders with the turbo cache and the integration job", () => {
  const baseline = baselineOf("core");
  const wf = parseYaml(ciWorkflow({ turbo: true, int: {} }, baseline));
  assert.deepEqual(wf.jobs.gate.needs, ["code", "int"]);
  const steps = wf.jobs.code.steps;
  assert.equal(
    steps.find((/** @type {any} */ s) => s.name === "Toolchain (mise)").uses,
    baseline.setup[0].uses,
  );
  assert.equal(steps.find((/** @type {any} */ s) => s.name === "Install").run, baseline.install);
  assert.ok(steps.some((/** @type {any} */ s) => s.with?.scope === "ci/build/turbo"));
  assert.ok(wf.jobs.int.services.postgres);
  assert.equal(wf.jobs["dependency-scan"].name, "Dependency scan (OSV-Scanner)");
});

test("ci: os's baseline renders its Uniwind steps unchanged, and a mobile job stays out of the gate", () => {
  const baseline = baselineOf("os");
  const wf = parseYaml(
    ciWorkflow(
      {
        optional: [
          {
            id: "mobile",
            name: "Mobile apps (Uniwind Pro)",
            needsInstall: true,
            steps: [
              { name: "Mobile build", run: "pnpm exec turbo run build --filter=@figentra/mobile" },
            ],
          },
        ],
      },
      baseline,
    ),
  );
  assert.deepEqual(wf.jobs.gate.needs, ["code"]);
  const steps = wf.jobs.code.steps;
  const cache = steps.find((/** @type {any} */ s) => s.id === "uniwind-cache");
  assert.equal(
    cache.with.key,
    baseline.setup.find((/** @type {any} */ s) => s.id === "uniwind-cache").with.key,
  );
  const save = steps.find((/** @type {any} */ s) => s.name === "Uniwind Pro download cache (save)");
  assert.equal(save.if, baseline.afterInstall[1].if);
  assert.equal(save["continue-on-error"], true);
  assert.equal(steps.find((/** @type {any} */ s) => s.name === "Install").run, baseline.install);
  assert.equal(wf.jobs.mobile["continue-on-error"], true);
  assert.ok(wf.jobs.mobile.steps.some((/** @type {any} */ s) => s.id === "uniwind-cache"));
});

test("ci: checks run inside Code after gen and before the tasks, after once they ran; both stay under Quality Gate", () => {
  const wf = parseYaml(
    ciWorkflow({
      checks: [{ name: "Format check", run: "pnpm format:check" }],
      after: [{ name: "Validate", run: "pnpm validate" }],
    }),
  );
  const names = wf.jobs.code.steps.map((/** @type {any} */ s) => s.name);
  const at = (/** @type {string} */ name) => names.indexOf(name);
  assert.ok(at("Gen") < at("Format check") && at("Format check") < at("Tasks (affected)"));
  assert.ok(at("Tasks") < at("Validate"));
  assert.equal(names.at(-1), "Validate");
  assert.deepEqual(wf.jobs.gate.needs, ["code"]);
  assert.equal(wf.jobs.code["continue-on-error"], undefined);
});

test("ci: a failing check hides nothing after it; every check and task in Code runs unless the run is cancelled", () => {
  const wf = parseYaml(
    ciWorkflow({
      checks: [
        { name: "Linear key check", if: "github.event_name == 'pull_request'", run: "node x.mjs" },
        { name: "Format check", run: "pnpm format:check" },
      ],
      after: [{ name: "Boundaries", if: "${{ always() }}", run: "pnpm boundaries" }],
    }),
  );
  const byName = Object.fromEntries(
    wf.jobs.code.steps.map((/** @type {any} */ s) => [s.name, s.if]),
  );
  assert.equal(
    byName["Linear key check"],
    "${{ !cancelled() && (github.event_name == 'pull_request') }}",
  );
  assert.equal(byName["Format check"], "${{ !cancelled() }}");
  assert.equal(byName.Boundaries, "${{ !cancelled() && (always()) }}");
  for (const name of ["Gen (affected)", "Gen", "Tasks (affected)", "Tasks"])
    assert.match(byName[name], /^\$\{\{ !cancelled\(\) && /);
  assert.equal(byName.Install, undefined);
});

test("ci: filters go on every turbo run; a capped task runs in its own step, on the side that names it", () => {
  const wf = parseYaml(
    ciWorkflow({
      pr: ["lint", "typecheck"],
      main: ["lint", "typecheck", "build"],
      filters: ["!@figentra/mobile", "...[HEAD~1]"],
      concurrency: { typecheck: 2 },
      int: {},
    }),
  );
  const runs = Object.fromEntries(
    wf.jobs.code.steps.map((/** @type {any} */ s) => [s.name, s.run]),
  );
  const f = "--filter='!@figentra/mobile' --filter='...[HEAD~1]'";
  assert.equal(runs["Gen (affected)"], `pnpm exec turbo run gen ${f} --affected`);
  assert.equal(runs.Gen, `pnpm exec turbo run gen ${f}`);
  assert.equal(runs["Tasks (affected)"], `pnpm exec turbo run lint ${f} --affected`);
  assert.equal(runs.Tasks, `pnpm exec turbo run lint build ${f}`);
  assert.equal(
    runs["Task typecheck (affected)"],
    `pnpm exec turbo run typecheck --concurrency=2 ${f} --affected`,
  );
  assert.equal(runs["Task typecheck"], `pnpm exec turbo run typecheck --concurrency=2 ${f}`);
  const int = wf.jobs.int.steps.filter((/** @type {any} */ s) => /turbo run/.test(s.run ?? ""));
  for (const s of int) assert.ok(s.run.includes(f), s.name);
  // a cap on a task only one side names: that side's step alone; both sides capped: no shared step
  const one = parseYaml(
    ciWorkflow({ pr: ["lint"], main: ["lint", "build"], concurrency: { build: 1 } }),
  ).jobs.code.steps.map((/** @type {any} */ s) => s.name);
  assert.ok(one.includes("Task build") && !one.includes("Task build (affected)"));
  const all = parseYaml(
    ciWorkflow({ pr: ["lint"], main: ["lint"], concurrency: { lint: 3 } }),
  ).jobs.code.steps.map((/** @type {any} */ s) => s.name);
  assert.ok(!all.includes("Tasks") && !all.includes("Tasks (affected)"));
  assert.ok(all.includes("Task lint") && all.includes("Task lint (affected)"));
  // without either option the render is unchanged
  assert.equal(ciWorkflow({ filters: [], concurrency: {} }), ciWorkflow({}));
});

test("ci: a filter a shell would read, a cap that is not a positive integer, or a cap on no task is a ConfigError", () => {
  for (const ci of [
    { filters: ["x' && curl evil '"] },
    { filters: ["$(id)"] },
    { filters: ["a b"] },
    { concurrency: { typecheck: 0 } },
    { concurrency: { typecheck: "2" } },
    { concurrency: { deploy: 2 } },
    { concurrency: { constructor: 2 } },
  ])
    assert.throws(() => ciWorkflow(/** @type {any} */ (ci)), ConfigError, JSON.stringify(ci));
  assert.doesNotThrow(() =>
    ciWorkflow({ filters: ["./services/*", "{./apps/web}...", "@scope/pkg^...", "!@a/b"] }),
  );
});

test("ci: a render entry adds a job that builds the site, installs pinned Playwright and runs fflow render", () => {
  const site = {
    id: "site",
    name: "Site render (Playwright)",
    build: "node site/src/build.mjs",
    dir: "site/dist",
    locales: ["en", "ar"],
    heights: [800, 844],
    requests: [{ url: "/", status: 302, location: "/en/" }],
  };
  const wf = parseYaml(ciWorkflow({ render: [site] }));
  // a required proof: in the gate's needs, not continue-on-error
  assert.deepEqual(wf.jobs.gate.needs, ["code", "site"]);
  const job = wf.jobs.site;
  assert.equal(job.name, "Site render (Playwright)");
  assert.ok(!("continue-on-error" in job));
  const byName = Object.fromEntries(job.steps.map((/** @type {any} */ s) => [s.name, s]));
  assert.ok(byName.Install, "the workspace install, for fflow and the build");
  assert.equal(byName["Build the site"].run, "node site/src/build.mjs");
  assert.equal(byName.Playwright.env.PLAYWRIGHT_VERSION, PLAYWRIGHT);
  assert.match(byName.Playwright.run, /--no-package-lock "playwright@\$PLAYWRIGHT_VERSION"/);
  assert.match(byName.Playwright.run, /playwright" install --with-deps chromium/);
  const render = byName["Render every page"];
  assert.equal(render.run, "pnpm exec fflow render");
  assert.equal(render.env.NODE_PATH, "${{ runner.temp }}/playwright/node_modules");
  assert.deepEqual(JSON.parse(render.env.FFLOW_RENDER), {
    dir: "site/dist",
    out: ".fflow/render/site",
    locales: ["en", "ar"],
    heights: [800, 844],
    requests: [{ url: "/", status: 302, location: "/en/" }],
  });
  const shots = byName.Screenshots;
  assert.equal(shots.if, "${{ !cancelled() }}");
  assert.match(shots.uses, /^actions\/upload-artifact@[0-9a-f]{40}$/);
  assert.equal(shots.with.name, "site-screenshots");
  assert.equal(shots.with.path, ".fflow/render/site");
  // only Flow's own words reach a run: line; the entry's values arrive through the environment
  for (const s of job.steps) assert.ok(!/site\/dist|\/en\//.test(s.run ?? ""), s.name);

  // not required: beside the gate; no build step when none is named; its own Playwright pin
  const loose = parseYaml(
    ciWorkflow({
      render: [
        {
          id: "docs",
          name: "Docs render",
          dir: "apps/docs/out",
          playwright: "1.55.0",
          required: false,
        },
      ],
    }),
  );
  assert.deepEqual(loose.jobs.gate.needs, ["code"]);
  assert.equal(loose.jobs.docs["continue-on-error"], true);
  assert.ok(!loose.jobs.docs.steps.some((/** @type {any} */ s) => s.name === "Build the site"));
  assert.equal(
    loose.jobs.docs.steps.find((/** @type {any} */ s) => s.name === "Playwright").env
      .PLAYWRIGHT_VERSION,
    "1.55.0",
  );
  // with int, the gate needs code, int and the required renders
  assert.deepEqual(parseYaml(ciWorkflow({ int: {}, render: [site] })).jobs.gate.needs, [
    "code",
    "int",
    "site",
  ]);
});

test("ci: a render entry is refused on a taken id, a locale, a width or a pin that is not one", () => {
  for (const render of [
    [{ id: "code", name: "X", dir: "d" }],
    [
      { id: "a", name: "A", dir: "d" },
      { id: "a", name: "B", dir: "e" },
    ],
    [{ id: "site", name: "X", dir: "d", locales: ["EN"] }],
    [{ id: "site", name: "X", dir: "d", widths: [10] }],
    [{ id: "site", name: "X", dir: "d", playwright: "latest" }],
    [{ id: "site", name: "X", dir: "d", requests: [{ url: "no-slash", status: 200 }] }],
    [{ id: "site", name: "X" }],
  ])
    assert.throws(
      () => ciWorkflow(/** @type {any} */ ({ render })),
      ConfigError,
      JSON.stringify(render),
    );
  assert.throws(
    () =>
      ciWorkflow(
        /** @type {any} */ ({ optional: [opt], render: [{ id: "mobile", name: "M", dir: "d" }] }),
      ),
    ConfigError,
  );
  // without render the workflow is unchanged
  assert.equal(ciWorkflow({ render: [] }), ciWorkflow({}));
});
