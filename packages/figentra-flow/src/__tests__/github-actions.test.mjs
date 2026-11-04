/**
 * Figentra Flow file contract:
 * Purpose: hold the `github-actions` runner and its workflow to AC-038 and the L2 design (PR F): the runner dispatches
 *   nothing, finds the gate workflow's `pull_request` run for the head, follows it, and maps the gate's status from a
 *   gate login, newer than the run, to 0 or 1 (pending, never posted, cancelled, timed out or no run is 4; no
 *   `apps.gate` is 2); the workflow runs on PR events with one read-only `check` job, checks out the head without
 *   credentials, names no secret, uploads nothing and pins every action; `init --runner github-actions` writes the
 *   workflow and a starter config, never over an existing one.
 * Boundary: temporary folders; the GitHub API, sleep and clock injected; no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1729 phase A (A3); the L2 design (PR F); STA-1945.
 */
// @covers sta-1729:FR-9 sta-1729:FR-11 sta-1729:AC-038
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { GATE_WORKFLOW, githubActionsRunner } from "../adapters/runner/github-actions.mjs";
import { runnerFor } from "../adapters/runner/index.mjs";
import { initGithubActions } from "../commands/init.mjs";
import { ConfigError } from "../lib/config.mjs";
import { gateWorkflow } from "../lib/gate-workflow.mjs";
import { CONFIG_FILE, ENV_PREFIX, PACKAGE, STATUS_CONTEXT } from "../lib/product.mjs";

const SHA = "a".repeat(40);
const GATE = "figentra-flow[bot]";
const JOB = {
  dir: "/tmp/job",
  command: "x",
  label: "l",
  flags: [],
  sha: SHA,
  branch: "feat/x",
  repository: "acme/app",
  base: "main",
};
const RUN_DONE = new Date(2_000_000).toISOString();

/**
 * A GitHub whose PR run goes through `statuses` and ends with `conclusion`, then carries `posted` on the head.
 * @param {{ runStates?: string[], conclusion?: string, appears?: boolean,
 *           posted?: { state: string, creator?: string, created_at?: string, description?: string }[] }} [script]
 */
function actions(script = {}) {
  const {
    runStates = ["queued", "in_progress", "completed"],
    conclusion = "success",
    appears = true,
    posted = [{ state: "success" }],
  } = script;
  /** @type {{ method: string, path: string, body?: any }[]} */
  const calls = [];
  let polls = 0;
  const run = (/** @type {string} */ status) => ({
    id: 77,
    html_url: "https://github.com/acme/app/actions/runs/77",
    updated_at: RUN_DONE,
    status,
    conclusion: status === "completed" ? conclusion : null,
  });
  /** @type {import("../lib/github.mjs").Api} */
  const api = (method, path, body) => {
    calls.push({ method, path, body });
    if (path.includes("/runs?"))
      return { ok: true, json: { workflow_runs: appears ? [run(runStates[0])] : [] }, err: "" };
    if (path.includes("/statuses"))
      return {
        ok: true,
        json: posted.map((p) => ({
          context: STATUS_CONTEXT,
          creator: { login: p.creator ?? GATE },
          created_at: p.created_at ?? new Date(2_000_001).toISOString(),
          state: p.state,
          description: p.description ?? "",
        })),
        err: "",
      };
    polls++;
    return { ok: true, json: run(runStates[Math.min(polls, runStates.length - 1)]), err: "" };
  };
  return { api, calls };
}

const options = (/** @type {any} */ api, /** @type {object} */ extra = {}) => ({
  api,
  sleep: () => {},
  now: () => 1_000_000,
  log: () => {},
  gate: GATE,
  ...extra,
});

test("github-actions: dispatches nothing, finds the PR run for the head, follows it, and reads the gate login's status", () => {
  const { api, calls } = actions();
  assert.equal(githubActionsRunner({ kind: "github-actions" }, options(api)).run(JOB), 0);
  assert.equal(
    calls.some((c) => c.method !== "GET"),
    false,
    "only reads",
  );
  assert.equal(
    calls[0].path,
    `/repos/acme/app/actions/workflows/${GATE_WORKFLOW}/runs?event=pull_request&head_sha=${SHA}&per_page=1`,
  );
  assert.ok(calls.some((c) => c.path === "/repos/acme/app/actions/runs/77"));
  assert.ok(calls.some((c) => c.path.startsWith(`/repos/acme/app/commits/${SHA}/statuses`)));
});

test("github-actions: failure or error is 1; pending, another login's, an older one, no run, or a cancelled run is 4", () => {
  const run = (/** @type {any} */ script, /** @type {object} */ extra = {}) =>
    githubActionsRunner(
      { kind: "github-actions", workflow: "gate.yml" },
      options(actions(script).api, extra),
    ).run(JOB);
  assert.equal(run({ posted: [{ state: "failure" }] }), 1);
  assert.equal(run({ posted: [{ state: "error" }] }), 1);
  assert.equal(run({ posted: [{ state: "pending", description: "the owner reviews it" }] }), 4);
  // A status from anyone but the gate App, or from before this run, never counts.
  let t = 1_000_000;
  const clock = { sleep: () => void (t += 60_000), now: () => t };
  assert.equal(run({ posted: [{ state: "success", creator: "someone" }] }, clock), 4);
  t = 1_000_000;
  assert.equal(
    run({ posted: [{ state: "success", created_at: new Date(1_000).toISOString() }] }, clock),
    4,
  );
  t = 1_000_000;
  assert.equal(run({ posted: [] }, clock), 4);
  assert.equal(run({ appears: false }), 4);
  assert.equal(run({ conclusion: "cancelled" }), 4);
  assert.equal(run({}, { gate: undefined }), 2, "no apps.gate: nothing is trusted");
  assert.throws(
    () => githubActionsRunner({ kind: "github-actions", workflow: "../x.yml" }),
    ConfigError,
  );
});

test("github-actions: a run that does not finish in time is 4, never green", () => {
  let t = 1_000_000;
  const { api } = actions({ runStates: ["in_progress"] });
  const runner = githubActionsRunner(
    { kind: "github-actions" },
    { ...options(api), sleep: () => void (t += 60_000), now: () => t, timeoutMs: 5 * 60_000 },
  );
  assert.equal(runner.run(JOB), 4);
});

test("github-actions: runnerFor hands the runner the gate App's logins", (t) => {
  const root = mkdtempSync(join(tmpdir(), "flow-gha-runner-"));
  t.after(() => rmSync(root, { recursive: true }));
  const runner = (/** @type {any} */ apps) =>
    runnerFor(root, { runner: { kind: "github-actions" }, apps }).runner;
  assert.equal(runner(undefined)?.run(JOB), 2, "no apps.gate: refused before any call");
  // With the logins it goes on to GitHub, which this folder has no credentials for.
  assert.throws(() => runner({ gate: { login: GATE } })?.run(JOB), ConfigError);
});

test("workflow: PR events, one read-only check job, no secret, no upload, no post; actions are pinned", () => {
  const yaml = gateWorkflow({ version: "1.2.3" });
  assert.match(
    yaml,
    /^on:\n {2}pull_request:\n {4}types: \[opened, synchronize, reopened, ready_for_review\]$/m,
  );
  assert.doesNotMatch(
    yaml,
    /workflow_dispatch|pull_request_target|secrets\.|upload-artifact|^ {2}post:/m,
  );
  assert.doesNotMatch(yaml, new RegExp(`${ENV_PREFIX}GATE_`));
  assert.deepEqual(
    [...yaml.split(/^jobs:$/m)[1].matchAll(/^ {2}([\w-]+):$/gm)].map((m) => m[1]),
    ["check"],
    "one job",
  );
  assert.match(yaml, /^ {4}permissions:\n {6}contents: read\n {4}env:/m);
  assert.match(yaml, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(yaml, /persist-credentials: false/);
  assert.match(yaml, new RegExp(`^name: ${STATUS_CONTEXT}$`, "m"));
  // npx names the binary: the package carries two (fflow and figentra-flow)
  assert.ok(yaml.includes(`--package=${PACKAGE}@1.2.3 fflow gate command`));
  for (const [, ref] of yaml.matchAll(/uses: [\w/-]+@(\S+)/g)) assert.match(ref, /^[0-9a-f]{40}$/);
  assert.match(yaml, /^permissions: \{\}$/m);
});

test("init --runner github-actions: writes the workflow and a starter config; refuses an existing workflow without --force", (t) => {
  const root = mkdtempSync(join(tmpdir(), "flow-init-gha-"));
  t.after(() => rmSync(root, { recursive: true }));
  const first = initGithubActions(root, { version: "1.2.3" });
  assert.equal(first.problem, undefined);
  assert.ok(
    readFileSync(join(root, ".github/workflows", GATE_WORKFLOW), "utf8").includes(
      `${PACKAGE}@1.2.3`,
    ),
  );
  assert.deepEqual(JSON.parse(readFileSync(join(root, CONFIG_FILE), "utf8")).runner, {
    kind: "github-actions",
  });
  // No repository secret: main's approval workflow posts the verdict.
  assert.doesNotMatch(first.lines.join("\n"), new RegExp(`${ENV_PREFIX}GATE_`));
  assert.match(first.lines.join("\n"), /secrets\.oidc/);
  assert.match(initGithubActions(root).problem ?? "", /--force/);
  // An existing config is never edited; the step is named instead.
  writeFileSync(join(root, CONFIG_FILE), JSON.stringify({ version: 1 }));
  const again = initGithubActions(root, { force: true });
  assert.deepEqual(JSON.parse(readFileSync(join(root, CONFIG_FILE), "utf8")), { version: 1 });
  assert.match(again.lines.join("\n"), /set "runner"/);
});
