/**
 * Figentra Flow file contract:
 * Purpose: hold the `github-actions` runner and its workflow to AC-038: the runner dispatches on the default branch
 *   with the sha and branch, finds its run by title, follows it, and maps the jobs (post not succeeding is 4, then
 *   check decides 0 or 1; cancelled, timed out or never found is 4; a failed dispatch is 2); the workflow keeps the
 *   gate App's secrets out of the job that runs the change, checks out without credentials and pins every action;
 *   `init --runner github-actions` writes the workflow and a starter config, never over an existing one.
 * Boundary: temporary folders; the GitHub API, sleep and clock injected; no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1729 phase A (A3).
 */
// @covers sta-1729:FR-9 sta-1729:FR-11 sta-1729:AC-038
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { GATE_WORKFLOW, githubActionsRunner } from "../adapters/runner/github-actions.mjs";
import { initGithubActions } from "../commands/init.mjs";
import { ConfigError } from "../lib/config.mjs";
import { gateWorkflow } from "../lib/gate-workflow.mjs";
import { CONFIG_FILE, ENV_PREFIX, PACKAGE } from "../lib/product.mjs";

const SHA = "a".repeat(40);
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

/**
 * A GitHub whose run goes through `statuses` and ends with the given run conclusion and job conclusions.
 * @param {{ statuses?: string[], conclusion?: string, jobs?: Record<string, string>, dispatchOk?: boolean,
 *           appears?: boolean }} [script]
 */
function actions(script = {}) {
  const {
    statuses = ["queued", "in_progress", "completed"],
    conclusion = "success",
    jobs = { check: "success", post: "success" },
    dispatchOk = true,
    appears = true,
  } = script;
  /** @type {{ method: string, path: string, body?: any }[]} */
  const calls = [];
  let polls = 0;
  const run = (/** @type {string} */ status) => ({
    id: 77,
    html_url: "https://github.com/acme/app/actions/runs/77",
    display_title: `figentra-flow gate ${SHA}`,
    created_at: new Date(1_000_000).toISOString(),
    status,
    conclusion: status === "completed" ? conclusion : null,
  });
  /** @type {import("../lib/github.mjs").Api} */
  const api = (method, path, body) => {
    calls.push({ method, path, body });
    if (path.endsWith("/dispatches"))
      return { ok: dispatchOk, json: undefined, err: dispatchOk ? "" : "HTTP 404" };
    if (path.includes("/runs?"))
      return { ok: true, json: { workflow_runs: appears ? [run(statuses[0])] : [] }, err: "" };
    if (path.endsWith("/jobs"))
      return {
        ok: true,
        json: { jobs: Object.entries(jobs).map(([name, c]) => ({ name, conclusion: c })) },
        err: "",
      };
    polls++;
    return { ok: true, json: run(statuses[Math.min(polls, statuses.length - 1)]), err: "" };
  };
  return { api, calls };
}

const options = (/** @type {any} */ api) => ({
  api,
  sleep: () => {},
  now: () => 1_000_000,
  log: () => {},
});

test("github-actions: dispatches on the default branch with sha and branch, follows the run, green when both jobs pass", () => {
  const { api, calls } = actions();
  assert.equal(githubActionsRunner({ kind: "github-actions" }, options(api)).run(JOB), 0);
  assert.deepEqual(calls[0], {
    method: "POST",
    path: `/repos/acme/app/actions/workflows/${GATE_WORKFLOW}/dispatches`,
    body: { ref: "main", inputs: { sha: SHA, branch: "feat/x" } },
  });
  assert.ok(calls.some((c) => c.path === "/repos/acme/app/actions/runs/77/jobs"));
});

test("github-actions: a red check is 1; a post that did not succeed, a cancelled run or a missing run is 4; a failed dispatch is 2", () => {
  const run = (/** @type {any} */ script) =>
    githubActionsRunner(
      { kind: "github-actions", workflow: "gate.yml" },
      options(actions(script).api),
    ).run(JOB);
  assert.equal(run({ jobs: { check: "failure", post: "success" } }), 1);
  assert.equal(run({ jobs: { check: "success", post: "failure" } }), 4);
  assert.equal(run({ conclusion: "cancelled" }), 4);
  assert.equal(run({ appears: false }), 4);
  assert.equal(run({ dispatchOk: false }), 2);
  assert.throws(
    () => githubActionsRunner({ kind: "github-actions", workflow: "../x.yml" }),
    ConfigError,
  );
});

test("github-actions: a run that does not finish in time is 4, never green", () => {
  let t = 1_000_000;
  const { api } = actions({ statuses: ["in_progress"] });
  const runner = githubActionsRunner(
    { kind: "github-actions" },
    { api, sleep: () => void (t += 60_000), now: () => t, timeoutMs: 5 * 60_000, log: () => {} },
  );
  assert.equal(runner.run(JOB), 4);
});

test("workflow: the change's job holds no secret and no credential; the post job never checks out; actions are pinned", () => {
  const yaml = gateWorkflow({ version: "1.2.3" });
  const [head, post] = yaml.split(/^ {2}post:$/m);
  assert.ok(post, "a post job");
  assert.equal(/secrets\./.test(head), false, "no secret in the check job");
  assert.match(
    post,
    new RegExp(
      `${ENV_PREFIX}GATE_PRIVATE_KEY: \\$\\{\\{ secrets\\.${ENV_PREFIX}GATE_PRIVATE_KEY \\}\\}`,
    ),
  );
  assert.equal(/actions\/checkout/.test(post), false, "the post job runs no repository code");
  assert.match(head, /persist-credentials: false/);
  assert.match(yaml, /run-name: figentra-flow gate \$\{\{ inputs\.sha \}\}/);
  assert.ok(post.includes(`${PACKAGE}@1.2.3`), "the post job pins the poster's package");
  // npx names the binary: the package carries two (figentra-flow and fflow)
  assert.ok(head.includes(`--package=${PACKAGE}@1.2.3 figentra-flow gate command`));
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
  assert.match(first.lines.join("\n"), new RegExp(`${ENV_PREFIX}GATE_APP_ID`));
  assert.match(initGithubActions(root).problem ?? "", /--force/);
  // An existing config is never edited; the step is named instead.
  writeFileSync(join(root, CONFIG_FILE), JSON.stringify({ version: 1 }));
  const again = initGithubActions(root, { force: true });
  assert.deepEqual(JSON.parse(readFileSync(join(root, CONFIG_FILE), "utf8")), { version: 1 });
  assert.match(again.lines.join("\n"), /set "runner"/);
});
