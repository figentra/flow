/**
 * Figentra Flow file contract:
 * Purpose: hold the manual sandbox workflow (`sandbox-workflow.mjs`) to its contract:
 *   - only `workflow_dispatch` starts it (no push, pull request or schedule), with `permissions: {}` at the top and
 *     one job in the owner-gated environment (`sandbox` unless named), never touching `fflow-ci.yml`'s gate;
 *   - the job checks out without credentials, runs the setup (else `baseline`'s) and the install, then the command
 *     with its env and each named secret as `${{ secrets.NAME }}`, and uploads the evidence even after a failure;
 *   - an env value holding `${{`, a name that is not an environment variable's, or a name in both env and secrets
 *     is a ConfigError;
 *   - `sync` renders `fflow-sandbox.yml` only with `ci.sandbox`.
 * Boundary: renders text and parses it with Flow's own YAML reader; one temporary folder for `sync`.
 * Runtime: node
 * Governing contract: the leader's FLOW-CI brief (2026-11-10): `ci.sandbox`, owner-triggered, never by an agent.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sync } from "../commands/sync.mjs";
import { ConfigError } from "../lib/config.mjs";
import { SANDBOX_WORKFLOW } from "../lib/product.mjs";
import { sandboxWorkflow } from "../lib/sandbox-workflow.mjs";
import { parseYaml } from "../lib/yaml.mjs";

/** Pay's connector certification on Stripe's test mode (PAY, pay#232). */
const PAY = {
  name: "Connector sandbox (Stripe)",
  run: "pnpm exec turbo run test --filter=@figentra/pay-connector-certification",
  env: { PAY_CONNECTOR_SANDBOX: "1", CERTIFICATION_WRITE: "1" },
  secrets: ["STRIPE_SANDBOX_SECRET_KEY", "STRIPE_SANDBOX_WEBHOOK_SECRET"],
  artifact: { name: "certification", path: "packages/connectors/certification/CERTIFICATION.md" },
};

test("sandbox: a manual run only, in the owner-gated environment, never on a push or a pull request", () => {
  const yml = sandboxWorkflow({ sandbox: PAY });
  assert.equal(
    yml.split("\n")[0],
    "# Written by `fflow sync` from the config's `ci.sandbox`; `fflow gate ci` fails on a hand edit.",
  );
  const wf = parseYaml(yml);
  assert.equal(wf.name, "fflow sandbox");
  assert.deepEqual(Object.keys(wf.on), ["workflow_dispatch"]);
  assert.deepEqual(wf.permissions, {});
  assert.deepEqual(Object.keys(wf.jobs), ["sandbox"]);
  const job = wf.jobs.sandbox;
  assert.equal(job.name, "Connector sandbox (Stripe)");
  assert.equal(job.environment, "sandbox");
  assert.equal(job["timeout-minutes"], 30);
  assert.deepEqual(job.permissions, { contents: "read", "id-token": "write" });
  assert.equal(
    parseYaml(sandboxWorkflow({ sandbox: { ...PAY, environment: "stripe-test" } })).jobs.sandbox
      .environment,
    "stripe-test",
  );
});

test("sandbox: the command gets its env and each named secret, and the evidence is uploaded after a failure", () => {
  const steps = parseYaml(sandboxWorkflow({ sandbox: PAY })).jobs.sandbox.steps;
  const names = steps.map((/** @type {any} */ s) => s.name);
  assert.equal(names[0], "Checkout");
  assert.equal(steps[0].with["persist-credentials"], false);
  assert.ok(names.indexOf("Install") < names.indexOf(PAY.name));
  const run = steps.find((/** @type {any} */ s) => s.name === PAY.name);
  assert.equal(run.run, PAY.run);
  assert.deepEqual(run.env, {
    PAY_CONNECTOR_SANDBOX: "1",
    CERTIFICATION_WRITE: "1",
    STRIPE_SANDBOX_SECRET_KEY: "${{ secrets.STRIPE_SANDBOX_SECRET_KEY }}",
    STRIPE_SANDBOX_WEBHOOK_SECRET: "${{ secrets.STRIPE_SANDBOX_WEBHOOK_SECRET }}",
  });
  const evidence = steps.at(-1);
  assert.equal(evidence.name, "Evidence");
  assert.equal(evidence.if, "${{ !cancelled() }}");
  assert.match(evidence.uses, /^actions\/upload-artifact@[0-9a-f]{40}$/);
  assert.deepEqual(evidence.with, {
    name: "certification",
    path: "packages/connectors/certification/CERTIFICATION.md",
    "if-no-files-found": "error",
    "retention-days": 90,
  });
  // no run: line holds an expression; the secrets arrive through the environment
  for (const s of steps) assert.ok(!/\$\{\{/.test(s.run ?? ""), s.name);
  // without an artifact there is no upload; the setup and install fall back to baseline's
  const bare = parseYaml(
    sandboxWorkflow(
      { sandbox: { name: "S", run: "pnpm test:sandbox" } },
      {
        install: "pnpm install --frozen-lockfile --filter=!x",
        setup: [{ name: "Registry auth", uses: "./.github/actions/registry-auth" }],
      },
    ),
  ).jobs.sandbox.steps;
  assert.ok(!bare.some((/** @type {any} */ s) => s.name === "Evidence"));
  assert.equal(
    bare.find((/** @type {any} */ s) => s.name === "Install").run,
    "pnpm install --frozen-lockfile --filter=!x",
  );
  assert.ok(bare.some((/** @type {any} */ s) => s.name === "Registry auth"));
  assert.ok(!("env" in bare.find((/** @type {any} */ s) => s.name === "S")));
});

test("sandbox: an expression in env, a bad name or a name in env and secrets is a ConfigError", () => {
  for (const sandbox of [
    { ...PAY, env: { X: "${{ secrets.OTHER }}" } },
    { ...PAY, env: { "bad-name": "1" } },
    { ...PAY, secrets: ["lower"] },
    { ...PAY, env: { STRIPE_SANDBOX_SECRET_KEY: "sk" } },
  ])
    assert.throws(
      () => sandboxWorkflow(/** @type {any} */ ({ sandbox })),
      ConfigError,
      JSON.stringify(sandbox),
    );
  assert.throws(() => sandboxWorkflow({}), ConfigError);
});

test("sync renders fflow-sandbox.yml only with `ci.sandbox`", (t) => {
  const root = mkdtempSync(join(tmpdir(), "flow-sandbox-sync-"));
  t.after(() => rmSync(root, { recursive: true }));
  const path = `.github/workflows/${SANDBOX_WORKFLOW}`;
  writeFileSync(
    join(root, "flow.config.json"),
    JSON.stringify({ version: 1, preset: "neutral", ci: {} }),
  );
  assert.ok(!sync(root, { log: () => {} }).files.includes(path));
  writeFileSync(
    join(root, "flow.config.json"),
    JSON.stringify({ version: 1, preset: "neutral", ci: { sandbox: PAY } }),
  );
  sync(root, { log: () => {} });
  assert.match(readFileSync(join(root, path), "utf8"), /^name: fflow sandbox$/m);
});
