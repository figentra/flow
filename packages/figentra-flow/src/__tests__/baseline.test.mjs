/**
 * Figentra Flow file contract:
 * Purpose: hold STA-1942 to its contract:
 *   - the turbo reader passes only a task that ran and exited 0, and skips `<NONEXISTENT>`;
 *   - a PR passes when its failed set is a subset of main's; a new failure, or a new task that fails, fails it; a
 *     fixed task passes and is listed;
 *   - the baseline search walks the ancestors, ignores an artifact a pull request run or another branch made, and
 *     fails closed when it finds none;
 *   - `sync` renders the workflow only with `baseline` configured, with the repository's setup steps verbatim.
 * Boundary: canned run summaries (trimmed from a real turbo 2.11.9 summary) and a stubbed GitHub; temporary folders.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1942.
 */
// @covers sta-1942:FR-1 sta-1942:FR-2 sta-1942:FR-3 sta-1942:FR-4 sta-1942:FR-5 sta-1942:FR-6 sta-1942:FR-7
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "../commands/gate-baseline.mjs";
import { sync } from "../commands/sync.mjs";
import { artifactName, compare, findBaseline, READERS, summaryTable } from "../lib/baseline.mjs";
import { BASELINE_WORKFLOW } from "../lib/product.mjs";

/** A turbo run summary: `exit` per task id, `undefined` for a task that never ran. */
const summary = (/** @type {Record<string, number | undefined>} */ exit) => ({
  version: "1",
  turboVersion: "2.11.9",
  tasks: Object.entries(exit).map(([taskId, code]) => ({
    taskId,
    task: taskId.split("#")[1],
    package: taskId.split("#")[0],
    command: "oxlint .",
    ...(code === undefined ? {} : { execution: { startTime: 1, endTime: 2, exitCode: code } }),
  })),
});

test("the turbo reader: exit 0 passes; a failure or a task that never ran fails; <NONEXISTENT> is no task", () => {
  const s = summary({ "a#lint": 0, "a#typecheck": 2, "a#test": undefined });
  s.tasks.push({ taskId: "b#build", task: "build", package: "b", command: "<NONEXISTENT>" });
  assert.deepEqual(READERS.turbo(s), { "a#lint": "pass", "a#typecheck": "fail", "a#test": "fail" });
});

test("compare: the subset passes, a new failure and a new failing task fail, a fixed task is listed", () => {
  const main = READERS.turbo(summary({ "a#lint": 2, "a#test": 1, "b#build": 0 }));
  // the subset: still failing what main fails
  assert.deepEqual(
    compare(main, READERS.turbo(summary({ "a#lint": 2, "a#test": 1, "b#build": 0 }))),
    {
      ok: true,
      newFailures: [],
      fixed: [],
      stillFailing: ["a#lint", "a#test"],
    },
  );
  // a new failure: b#build passed on main
  const worse = compare(main, READERS.turbo(summary({ "a#lint": 2, "a#test": 1, "b#build": 1 })));
  assert.equal(worse.ok, false);
  assert.deepEqual(worse.newFailures, ["b#build"]);
  // a new task that fails
  const added = compare(
    main,
    READERS.turbo(summary({ "a#lint": 2, "a#test": 1, "b#build": 0, "c#test": 1 })),
  );
  assert.deepEqual(added.newFailures, ["c#test"]);
  // a fixed task passes
  const better = compare(main, READERS.turbo(summary({ "a#lint": 0, "a#test": 1, "b#build": 0 })));
  assert.equal(better.ok, true);
  assert.deepEqual(better.fixed, ["a#lint"]);
  assert.match(summaryTable(better, "abc"), /\| none \| `a#lint` \| `a#test` \|/);
});

/** A stubbed GitHub: ancestors of `base`, and artifacts by name. */
function github(
  /** @type {{ ancestors: string[], artifacts: Record<string, any[]>, events: Record<number, string> }} */ g,
) {
  return async (/** @type {string} */ _method, /** @type {string} */ path) => {
    if (path === "/repos/o/r") return { ok: true, json: { default_branch: "main" } };
    if (path.startsWith("/repos/o/r/commits?"))
      return { ok: true, json: g.ancestors.map((sha) => ({ sha })) };
    const name = new URLSearchParams(path.split("?")[1]).get("name");
    if (name) return { ok: true, json: { artifacts: g.artifacts[name] ?? [] } };
    const id = Number(path.split("/").at(-1));
    return { ok: true, json: { event: g.events[id] } };
  };
}

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const artifact = (/** @type {string} */ sha, /** @type {number} */ id, branch = "main") => ({
  expired: false,
  workflow_run: { id, head_sha: sha, head_branch: branch },
});

test("findBaseline: the nearest ancestor's push baseline; a PR run's or another branch's is ignored", async () => {
  const api = github({
    ancestors: [A, B, C],
    artifacts: {
      // A: one planted by a pull request run, one pushed to another branch
      [artifactName(A)]: [artifact(A, 1), artifact(A, 2, "feature")],
      [artifactName(B)]: [artifact(B, 3)],
    },
    events: { 1: "pull_request", 2: "push", 3: "push" },
  });
  assert.deepEqual(await findBaseline({ api, repo: "o/r", base: A }), {
    sha: B,
    runId: 3,
    name: artifactName(B),
  });
  const none = await findBaseline({
    api: github({ ancestors: [A, C], artifacts: {}, events: {} }),
    repo: "o/r",
    base: A,
  });
  assert.deepEqual(none, { searched: [A, C] });
});

test("gate baseline: save, then check passes on the subset, fails on a new failure, fails closed without one", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "flow-baseline-"));
  t.after(() => rmSync(root, { recursive: true }));
  mkdirSync(join(root, ".turbo", "runs"), { recursive: true });
  const step = join(root, "summary.md");
  const env = { GITHUB_REPOSITORY: "o/r", GITHUB_SHA: B, GITHUB_STEP_SUMMARY: step };
  const log = () => {};
  // main's baseline, as the push run saved it
  const mainDir = join(root, "main");
  mkdirSync(mainDir);
  writeFileSync(
    join(root, ".turbo/runs/1.json"),
    JSON.stringify(summary({ "a#lint": 2, "b#test": 0 })),
  );
  assert.equal(await run(["save"], { root, env, log }), 0);
  writeFileSync(
    join(mainDir, "baseline.json"),
    readFileSync(join(root, ".figentra-flow-gate/baseline.json")),
  );
  const deps = {
    root,
    env,
    log,
    api: github({
      ancestors: [A, B],
      artifacts: { [artifactName(B)]: [artifact(B, 9)] },
      events: { 9: "push" },
    }),
    download: () => mainDir,
  };
  // the PR fails only what main fails
  assert.equal(
    await run(["save", "--summary", join(root, ".turbo/runs/1.json")], { root, env, log }),
    0,
  );
  assert.equal(await run(["check", "--base", A], deps), 0);
  // the PR breaks b#test
  writeFileSync(join(root, "pr.json"), JSON.stringify(summary({ "a#lint": 2, "b#test": 1 })));
  assert.equal(await run(["save", "--summary", join(root, "pr.json")], { root, env, log }), 0);
  assert.equal(await run(["check", "--base", A], deps), 1);
  assert.match(readFileSync(step, "utf8"), /1 new failure\(s\)[\s\S]*`b#test`/);
  // no baseline anywhere: closed
  const closed = { ...deps, api: github({ ancestors: [A], artifacts: {}, events: {} }) };
  assert.equal(await run(["check", "--base", A], closed), 1);
  assert.match(readFileSync(step, "utf8"), /no baseline[\s\S]*fails closed/);
});

test("sync renders the baseline workflow only with `baseline`, with the setup steps verbatim", (t) => {
  const root = mkdtempSync(join(tmpdir(), "flow-baseline-sync-"));
  t.after(() => rmSync(root, { recursive: true }));
  const file = join(root, ".github/workflows", BASELINE_WORKFLOW);
  writeFileSync(
    join(root, "figentra-flow.config.json"),
    JSON.stringify({ version: 1, preset: "neutral" }),
  );
  assert.ok(
    !sync(root, { log: () => {} }).files.includes(`.github/workflows/${BASELINE_WORKFLOW}`),
  );
  const setup = {
    name: "Registry auth",
    uses: "./.github/actions/registry-auth",
    with: { token: "${{ secrets.T }}" },
  };
  writeFileSync(
    join(root, "figentra-flow.config.json"),
    JSON.stringify({
      version: 1,
      preset: "neutral",
      baseline: { tasks: ["lint", "test"], setup: [setup] },
    }),
  );
  sync(root, { log: () => {} });
  const yml = readFileSync(file, "utf8");
  assert.match(yml, /^ {4}name: Baseline$/m);
  assert.ok(yml.includes(`      - ${JSON.stringify(setup)}\n`));
  assert.match(yml, /turbo run lint test --continue --summarize \|\| true/);
  assert.match(yml, /name: figentra-flow-baseline-\$\{\{ github\.sha \}\}/);
  assert.match(yml, /gate baseline check --base "\$BASE_SHA"/);
  assert.doesNotMatch(yml, /pull_request_target|persist-credentials: true/);
});
