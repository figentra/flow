/**
 * Figentra Flow file contract:
 * Purpose: hold STA-1942 to its contract:
 *   - the turbo reader passes only a task that ran and exited 0, marks one that never ran `skip`, and drops
 *     `<NONEXISTENT>`;
 *   - a PR passes when its failed set is a subset of main's; a new failure, a new task that fails, a task main ran
 *     but the PR dropped or skipped, a red must-pass task, or more failures than main has, blocks it; a fixed task
 *     is a gain;
 *   - STA-1945 FR-22: a gain (failed or never ran on main, passes now) is counted; a failure newly reached behind a
 *     repaired upstream task of its own package is reported with that task and does not block; a plain regression
 *     and a failure in an unrelated package still block; the `--json` shape;
 *   - the 0.2.2 rename: `sync` renames the old config file once (failing when both exist) and removes the old-named
 *     workflows; the old binary prints one notice;
 *   - the baseline search walks the ancestors, ignores an artifact a pull request run or another branch made, and
 *     fails closed when it finds none;
 *   - `sync` renders the workflow only with `baseline` configured, with the repository's setup steps verbatim.
 * Boundary: canned run summaries (trimmed from a real turbo 2.11.9 summary) and a stubbed GitHub; temporary folders.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1942; STA-1945 FR-22.
 */
// @covers sta-1942:FR-1 sta-1942:FR-2 sta-1942:FR-3 sta-1942:FR-4 sta-1942:FR-5 sta-1942:FR-6 sta-1942:FR-7 sta-1942:FR-8 sta-1945:FR-22
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { run } from "../commands/gate-baseline.mjs";
import { sync } from "../commands/sync.mjs";
import {
  artifactName,
  compare,
  findBaseline,
  NEEDS,
  READERS,
  summaryTable,
} from "../lib/baseline.mjs";
import { loadConfig } from "../lib/config.mjs";
import { BASELINE_WORKFLOW } from "../lib/product.mjs";
import { parseYaml } from "../lib/yaml.mjs";

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

test("the turbo reader: exit 0 passes, a failure fails, a task that never ran is skip; <NONEXISTENT> is no task", () => {
  const s = summary({ "a#lint": 0, "a#typecheck": 2, "a#test": undefined });
  s.tasks.push({ taskId: "b#build", task: "build", package: "b", command: "<NONEXISTENT>" });
  assert.deepEqual(READERS.turbo(s), { "a#lint": "pass", "a#typecheck": "fail", "a#test": "skip" });
});

test("compare: the subset passes, a new failure and a new failing task fail, a fixed task is listed", () => {
  const main = READERS.turbo(summary({ "a#lint": 2, "a#test": 1, "b#build": 0 }));
  // the subset: still failing what main fails
  assert.deepEqual(
    compare(main, READERS.turbo(summary({ "a#lint": 2, "a#test": 1, "b#build": 0 }))),
    {
      ok: true,
      newFailures: [],
      missing: [],
      mustPassFailures: [],
      gains: [],
      newlyReached: [],
      stillFailing: ["a#lint", "a#test"],
      debt: { base: 2, pr: 2 },
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
  assert.deepEqual(better.gains, ["a#lint"]);
  assert.match(
    summaryTable(better, "abc"),
    /\| none \| none \| none \| `a#lint` \| none \| `a#test` \|/,
  );
  assert.match(summaryTable(better, "abc"), /not a release certificate/);
});

test("compare: a task main ran but the PR dropped or skipped blocks, even one red on main", () => {
  const main = READERS.turbo(summary({ "a#lint": 2, "a#test": 0, "b#build": 0 }));
  // deleting a#lint (red on main) and b#build would shrink the failures but not the inventory
  const dropped = compare(main, READERS.turbo(summary({ "a#test": 0 })));
  assert.equal(dropped.ok, false);
  assert.deepEqual(dropped.missing, ["a#lint", "b#build"]);
  // a task that is listed but never ran counts as missing, not as fixed
  const skipped = compare(
    main,
    READERS.turbo(summary({ "a#lint": undefined, "a#test": 0, "b#build": 0 })),
  );
  assert.deepEqual([skipped.ok, skipped.missing, skipped.gains], [false, ["a#lint"], []]);
});

test("compare: a must-pass task blocks when red, even when it is red on main", () => {
  const main = READERS.turbo(summary({ "api#test:isolation": 1, "a#lint": 2 }));
  const pr = READERS.turbo(summary({ "api#test:isolation": 1, "a#lint": 2 }));
  assert.equal(compare(main, pr).ok, true);
  const strict = compare(main, pr, { mustPass: ["*#test:isolation", "*#secrets"] });
  assert.deepEqual([strict.ok, strict.mustPassFailures], [false, ["api#test:isolation"]]);
  // missing from the PR is not green either
  const gone = compare(main, READERS.turbo(summary({ "a#lint": 2 })), { mustPass: ["api#*"] });
  assert.deepEqual(gone.mustPassFailures, ["api#test:isolation"]);
});

test("compare: the failure count may not grow, even through tasks main skipped", () => {
  const main = { "a#lint": "fail", "b#test": "skip" };
  // b#test never ran on main: its failure here is new, and the debt grows from 1 to 2
  const r = compare(/** @type {any} */ (main), { "a#lint": "fail", "b#test": "fail" });
  assert.deepEqual([r.ok, r.newFailures, r.debt], [false, ["b#test"], { base: 1, pr: 2 }]);
});

test("compare: a gain is counted; a failure newly reached behind a repaired upstream task does not block", () => {
  // main: a#build failed, so a#test never ran; b#test is red
  const base = { "a#build": "fail", "a#test": "skip", "b#test": "fail" };
  const needs = { "a#test": ["a#build", "b#build"] };
  const pr = { "a#build": "pass", "a#test": "fail", "b#test": "fail" };
  const r = compare(/** @type {any} */ (base), /** @type {any} */ (pr), { needs });
  assert.deepEqual(
    [r.ok, r.gains, r.newFailures, r.newlyReached, r.debt],
    [true, ["a#build"], [], [{ task: "a#test", unblockedBy: "a#build" }], { base: 2, pr: 1 }],
  );
  assert.match(summaryTable(r, "abc"), /`a#test \(unblocked by a#build\)`/);
  // the same failure with no upstream link, or an upstream in another package, is a regression
  assert.deepEqual(compare(/** @type {any} */ (base), /** @type {any} */ (pr)).newFailures, [
    "a#test",
  ]);
  const other = compare(/** @type {any} */ (base), /** @type {any} */ (pr), {
    needs: { "a#test": ["b#build"] },
  });
  assert.deepEqual([other.ok, other.newFailures], [false, ["a#test"]]);
  // a task newly reached that passes is a gain too
  const fixedPr = { ...pr, "a#test": "pass" };
  const green = compare(/** @type {any} */ (base), /** @type {any} */ (fixedPr), { needs });
  assert.deepEqual([green.ok, green.gains, green.newlyReached], [true, ["a#build", "a#test"], []]);
  // two deep: the upstream itself never ran on main, and its newly passing makes it a gain that unblocks
  const chain = compare(
    /** @type {any} */ ({ "a#gen": "fail", "a#build": "skip", "a#test": "skip" }),
    /** @type {any} */ ({ "a#gen": "pass", "a#build": "pass", "a#test": "fail" }),
    { needs: { "a#build": ["a#gen"], "a#test": ["a#build"] } },
  );
  assert.deepEqual(
    [chain.ok, chain.gains, chain.newlyReached],
    [true, ["a#build", "a#gen"], [{ task: "a#test", unblockedBy: "a#build" }]],
  );
});

test("compare: a task that passed on main and fails now blocks, and so does a failure in an unrelated package", () => {
  const needs = { "a#test": ["a#build"], "c#test": ["a#build"] };
  const base = { "a#build": "fail", "a#test": "pass", "c#test": "skip" };
  const pr = { "a#build": "pass", "a#test": "fail", "c#test": "fail" };
  const r = compare(/** @type {any} */ (base), /** @type {any} */ (pr), { needs });
  assert.deepEqual([r.ok, r.newFailures, r.newlyReached], [false, ["a#test", "c#test"], []]);
});

test("the turbo reader keeps each task's upstream tasks, and `check --json` prints the result", async (t) => {
  const s = summary({ "a#build": 0, "a#test": 1 });
  /** @type {any} */ (s.tasks[1]).dependencies = ["a#build", "^build"];
  assert.deepEqual(NEEDS.turbo(s), { "a#test": ["a#build", "^build"] });
  const root = mkdtempSync(join(tmpdir(), "flow-baseline-json-"));
  t.after(() => rmSync(root, { recursive: true }));
  const mainDir = join(root, "main");
  mkdirSync(mainDir);
  mkdirSync(join(root, ".fflow-gate"));
  const write = (/** @type {string} */ f, /** @type {any} */ o) =>
    writeFileSync(f, JSON.stringify(o));
  write(join(mainDir, "baseline.json"), {
    tasks: { "a#build": "fail", "a#test": "skip" },
  });
  write(join(root, ".fflow-gate/baseline.json"), {
    tasks: { "a#build": "pass", "a#test": "fail" },
    needs: { "a#test": ["a#build"] },
  });
  /** @type {string[]} */
  const out = [];
  const code = await run(["check", "--base", A, "--json"], {
    root,
    env: { GITHUB_REPOSITORY: "o/r", GITHUB_STEP_SUMMARY: join(root, "s.md") },
    log: () => {},
    out: (x) => out.push(x),
    api: github({
      ancestors: [A],
      artifacts: { [artifactName(A)]: [artifact(A, 9)] },
      events: { 9: "push" },
    }),
    download: () => mainDir,
  });
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(out[0]), {
    ok: true,
    newFailures: [],
    missing: [],
    mustPassFailures: [],
    gains: ["a#build"],
    newlyReached: [{ task: "a#test", unblockedBy: "a#build" }],
    stillFailing: [],
    debt: { base: 1, pr: 0 },
    baselineSha: A,
  });
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
    readFileSync(join(root, ".fflow-gate/baseline.json")),
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
  assert.match(
    readFileSync(step, "utf8"),
    /blocked \(1 blocking task\(s\); failures 1 → 2\)[\s\S]*`b#test`/,
  );
  // no baseline anywhere: closed
  const closed = { ...deps, api: github({ ancestors: [A], artifacts: {}, events: {} }) };
  assert.equal(await run(["check", "--base", A], closed), 1);
  assert.match(readFileSync(step, "utf8"), /no baseline[\s\S]*fails closed/);
});

test("sync renders the baseline workflow only with `baseline`, with the setup steps verbatim", (t) => {
  const root = mkdtempSync(join(tmpdir(), "flow-baseline-sync-"));
  t.after(() => rmSync(root, { recursive: true }));
  const file = join(root, ".github/workflows", BASELINE_WORKFLOW);
  writeFileSync(join(root, "flow.config.json"), JSON.stringify({ version: 1, preset: "neutral" }));
  assert.ok(
    !sync(root, { log: () => {} }).files.includes(`.github/workflows/${BASELINE_WORKFLOW}`),
  );
  const setup = {
    name: "Registry auth",
    uses: "./.github/actions/registry-auth",
    with: { token: "${{ secrets.T }}", install_args: "node pnpm", depth: 2, lfs: false, empty: {} },
  };
  writeFileSync(
    join(root, "flow.config.json"),
    JSON.stringify({
      version: 1,
      preset: "neutral",
      baseline: { tasks: ["lint", "test"], setup: [setup] },
    }),
  );
  sync(root, { log: () => {} });
  const yml = readFileSync(file, "utf8");
  assert.match(yml, /^ {4}name: Baseline$/m);
  // the setup step is block YAML (STA-299 refuses flow mappings) and reads back as the config wrote it
  assert.doesNotMatch(yml, /^\s*- \{/m);
  assert.deepEqual(parseYaml(yml).jobs.baseline.steps[1], setup);
  assert.match(yml, /turbo run lint test --continue --summarize \|\| true/);
  assert.match(yml, /name: fflow-baseline-\$\{\{ github\.sha \}\}/);
  assert.match(yml, /gate baseline check --base "\$BASE_SHA"/);
  assert.doesNotMatch(yml, /pull_request_target|persist-credentials: true/);
});

test("the fflow rename: sync renames the old config once, removes the old workflows, refuses both configs", (t) => {
  const root = mkdtempSync(join(tmpdir(), "flow-rename-"));
  t.after(() => rmSync(root, { recursive: true }));
  const old = {
    $schema: "./node_modules/@figentra-oss/flow/schema/figentra-flow.config.schema.json",
    version: 1,
    preset: "neutral",
  };
  writeFileSync(join(root, "figentra-flow.config.json"), JSON.stringify(old));
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  writeFileSync(join(root, ".github/workflows/figentra-flow-approve.yml"), "name: old\n");
  assert.match(loadConfig(root).warnings.join(), /old name/);
  sync(root, { log: () => {} });
  assert.ok(!existsSync(join(root, "figentra-flow.config.json")));
  assert.ok(!existsSync(join(root, ".github/workflows/figentra-flow-approve.yml")));
  assert.match(
    readFileSync(join(root, "flow.config.json"), "utf8"),
    /schema\/flow\.config\.schema\.json/,
  );
  writeFileSync(join(root, "figentra-flow.config.json"), JSON.stringify(old));
  assert.throws(() => sync(root, { log: () => {} }), /both exist/);
  assert.match(loadConfig(root).errors.join(), /both exist/);
});

test("the old binary prints one notice, then runs fflow", () => {
  const bin = join(dirname(fileURLToPath(import.meta.url)), "../../bin/figentra-flow.mjs");
  const r = spawnSync(process.execPath, [bin, "--help"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.equal(r.stderr.match(/is now `fflow`/g)?.length, 1);
  assert.match(r.stderr, /usage: fflow </);
});
