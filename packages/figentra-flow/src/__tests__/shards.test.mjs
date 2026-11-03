/**
 * Figentra Flow file contract:
 * Purpose: hold the gate fan-out to STA-1945 FR-15 and the testbed contract: the workspace's packages dealt into at
 *   most one shard per box; one `run … --json` call per shard, all at once, with `gate.shard`'s `{filters}`; one
 *   `fflow/gate` post, green only when every shard exited 0 (AC-41); a shard with no free slot or healthy box (73,
 *   75) tried once more, then nothing posted; a runner without shards, or no `gate.shard`, refused before any box.
 * Boundary: temporary repositories with a local bare origin; the runner, the remote tip and the poster injected; no
 *   network, no box.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945 FR-15, AC-41, P-021; the testbed contract (STA-2042).
 */
// @covers sta-1945:FR-15 sta-1945:AC-41 sta-1945:P-021
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { gateRun } from "../commands/gate-run.mjs";
import { CONFIG_FILE } from "../lib/product.mjs";
import { combine, reportOf, shard, shardCommand, workspacePackages } from "../lib/shards.mjs";
import { CONFIG, repo, sh } from "./__fixtures__/repo.mjs";

const LINE =
  '{"region":"eu-west-1","box":"i-1","slot":"light","waitSeconds":1,"runSeconds":2,"exitCode":0}';

test("shard: sorted packages dealt round-robin into at most one group per box, none empty", () => {
  assert.deepEqual(shard(["c", "a", "b"], 2), [["a", "c"], ["b"]]);
  assert.deepEqual(shard(["a"], 5), [["a"]]);
  assert.deepEqual(shard(["a", "b"], 0), [["a", "b"]]);
  assert.deepEqual(shard([], 3), []);
  assert.equal(
    shardCommand("turbo run test {filters}", ["packages/a", "packages/c"]),
    "turbo run test --filter=./packages/a --filter=./packages/c",
  );
});

test("combine: green only when every shard exited 0; 73 or 75 is an infrastructure failure, never a test failure", () => {
  const report = reportOf(`job noise\n${LINE}\n`);
  assert.equal(report?.box, "i-1");
  assert.equal(reportOf("not json"), undefined);
  const green = combine([
    { packages: ["a"], code: 0, report },
    { packages: ["b"], code: 0 },
  ]);
  assert.deepEqual(green, {
    code: 0,
    lines: [
      "shard 1/2 [a]: exit 0 on eu-west-1 i-1 (light, waited 1s, ran 2s)",
      "shard 2/2 [b]: exit 0",
    ],
  });
  assert.equal(
    combine([
      { packages: ["a"], code: 0 },
      { packages: ["b"], code: 1 },
    ]).code,
    1,
  );
  assert.match(combine([{ packages: ["a"], code: 124 }]).lines[0], /3-hour limit/);
  const infra = combine([
    { packages: ["a"], code: 1 },
    { packages: ["b"], code: 75 },
  ]);
  assert.equal(infra.code, 75);
  assert.match(
    infra.infra ?? "",
    /shard 2\/2 \[b\]: exit 75 .*infrastructure failure.*nothing posted/,
  );
});

/** A GitHub-named repository with a three-package workspace and `gate.shard`, pushed. */
function workspace(
  t,
  /** @type {Record<string, unknown>} */ gate = { shard: "pnpm turbo run test {filters}" },
) {
  const r = repo({
    [CONFIG_FILE]: `${JSON.stringify({ ...CONFIG, gate }, null, 2)}\n`,
    "pnpm-workspace.yaml": 'packages:\n  - packages/*\n  - "!packages/skip"\n',
  });
  t.after(r.dispose);
  sh(r.root, "remote", "set-url", "origin", "git@github.com:figentra/flow.git");
  sh(r.root, "remote", "set-url", "--push", "origin", r.origin);
  for (const p of ["a", "b", "c", "skip"]) {
    mkdirSync(join(r.root, "packages", p), { recursive: true });
    writeFileSync(join(r.root, "packages", p, "package.json"), "{}\n");
  }
  mkdirSync(join(r.root, "packages", "docs"));
  writeFileSync(join(r.root, "packages", "docs", "README.md"), "no manifest\n");
  sh(r.root, "add", "-A");
  sh(r.root, "commit", "-q", "-m", "workspace");
  sh(r.root, "push", "-q", "origin", "main");
  const tip = (/** @type {string} */ _root, /** @type {string} */ branch) =>
    sh(r.origin, "rev-parse", `refs/heads/${branch}`);
  return { root: r.root, tip };
}

/**
 * A testbed stand-in: each shard's codes in turn (the last repeats), with the JSON line on stdout.
 * @param {Record<number, number[]>} codes by shard number, from 1
 */
function testbed(codes = {}) {
  /** @type {import("../adapters/runner/index.mjs").Job[]} */
  const calls = [];
  const tries = new Map();
  const runner = {
    kind: "command",
    wraps: false,
    program: "stackra",
    posts: /** @type {"caller"} */ ("caller"),
    run: () => assert.fail("a sharded gate never makes a single run"),
    start: async (/** @type {import("../adapters/runner/index.mjs").Job} */ job) => {
      calls.push(job);
      const n = Number(job.label.match(/shard (\d+)\//)?.[1]);
      const i = tries.get(n) ?? 0;
      tries.set(n, i + 1);
      const list = codes[n] ?? [0];
      return { code: list[Math.min(i, list.length - 1)], out: `${LINE}\n` };
    },
  };
  return { runner, calls };
}

test("gate run --shards: one --json call per shard with its filters, all at once, and one post, green only when each passed", async (t) => {
  const w = workspace(t);
  assert.deepEqual(workspacePackages(w.root), ["packages/a", "packages/b", "packages/c"]);
  const tb = testbed();
  /** @type {{ exit: string, log: string }[]} */
  const posts = [];
  const post = (/** @type {string} */ dir) => {
    posts.push({
      exit: readFileSync(join(dir, ".fflow-gate", "exit"), "utf8"),
      log: readFileSync(join(dir, ".fflow-gate", "log.txt"), "utf8"),
    });
    return 0;
  };
  const sha = sh(w.root, "rev-parse", "HEAD");
  const green = await gateRun({ cwd: w.root, tip: w.tip, runner: tb.runner, shards: 2, post });
  assert.deepEqual(green, { code: 0, sha });
  assert.deepEqual(
    tb.calls.map((c) => [c.label, c.command, c.flags]),
    [
      [
        `fflow gate figentra/flow@${sha.slice(0, 12)} shard 1/2`,
        "pnpm install --frozen-lockfile && pnpm turbo run test --filter=./packages/a --filter=./packages/c",
        ["--json"],
      ],
      [
        `fflow gate figentra/flow@${sha.slice(0, 12)} shard 2/2`,
        "pnpm install --frozen-lockfile && pnpm turbo run test --filter=./packages/b",
        ["--json"],
      ],
    ],
  );
  assert.equal(posts.length, 1);
  assert.equal(posts[0].exit, "0\n");
  assert.match(posts[0].log, /^shard 1\/2 \[packages\/a packages\/c\]: exit 0 on eu-west-1 i-1/m);

  const red = testbed({ 2: [1] });
  const failed = await gateRun({ cwd: w.root, tip: w.tip, runner: red.runner, shards: 3, post });
  assert.deepEqual(failed, { code: 1, sha });
  assert.equal(posts.length, 2, "still one post");
  assert.equal(posts[1].exit, "1\n");
});

test("gate run --shards: no slot or no healthy box is tried once more, then nothing is posted", async (t) => {
  const w = workspace(t);
  let posted = 0;
  const post = () => {
    posted++;
    return 0;
  };
  const retried = testbed({ 1: [73, 0] });
  assert.equal(
    (await gateRun({ cwd: w.root, tip: w.tip, runner: retried.runner, shards: 2, post })).code,
    0,
  );
  assert.equal(retried.calls.length, 3);
  assert.equal(posted, 1);
  const down = testbed({ 2: [75] });
  const result = await gateRun({ cwd: w.root, tip: w.tip, runner: down.runner, shards: 2, post });
  assert.equal(result.code, 75);
  assert.match(result.problem ?? "", /infrastructure failure.*nothing posted/);
  assert.equal(down.calls.length, 3, "shard 2 tried twice");
  assert.equal(posted, 1, "an infrastructure failure posts nothing");
});

test("gate run --shards: a runner that cannot shard, or no gate.shard, is refused before any box", async (t) => {
  const w = workspace(t);
  const tb = testbed();
  assert.match(
    (
      await gateRun({
        cwd: w.root,
        tip: w.tip,
        runner: { ...tb.runner, start: undefined },
        shards: 2,
      })
    ).problem ?? "",
    /--shards needs a command runner/,
  );
  const plain = workspace(t, { check: "pnpm verify" });
  assert.match(
    (await gateRun({ cwd: plain.root, tip: plain.tip, runner: tb.runner, shards: 2 })).problem ??
      "",
    /--shards needs "gate\.shard"/,
  );
  assert.equal(tb.calls.length, 0);
});
