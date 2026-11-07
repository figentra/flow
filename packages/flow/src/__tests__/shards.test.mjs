/**
 * Figentra Flow file contract:
 * Purpose: hold the gate fan-out to STA-1945 FR-15 and the testbed contract: the workspace's packages dealt into at
 *   most one shard per box; one `run … --json` call per shard, all at once, with `gate.shard`'s `{filters}`; one
 *   `fflow/gate` post, green only when every shard exited 0 (AC-41) and red when one failed; a shard with no free slot
 *   or healthy box (73, 75) tried once more, then nothing posted unless another shard failed; the spec gate on the
 *   first shard only; every `*` segment of a workspace pattern expanded, and a pattern, `packages` or folder it
 *   cannot read refused, never skipped; a runner without shards, no `gate.shard`, no workspace or a `--shards` outside
 *   1 to 12 refused before any box.
 * Boundary: temporary repositories with a local bare origin; the runner, the remote tip and the poster injected; no
 *   network, no box.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945 FR-15, AC-41, P-021; the testbed contract (STA-2042).
 */
// @covers sta-1945:FR-15 sta-1945:AC-41 sta-1945:P-021
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { gateRun, run } from "../commands/gate-run.mjs";
import { CONFIG_FILE, PACKAGE } from "../lib/product.mjs";
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

test("combine: green only when every shard exited 0; 73, 75 or 130 is an infrastructure failure, never a test failure", () => {
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
    { packages: ["a"], code: 0 },
    { packages: ["b"], code: 75 },
  ]);
  assert.equal(infra.code, 75);
  assert.match(
    infra.infra ?? "",
    /shard 2\/2 \[b\]: exit 75 .*infrastructure failure.*nothing posted/,
  );
  const red = combine([
    { packages: ["a"], code: 73 },
    { packages: ["b"], code: 1 },
  ]);
  assert.equal(red.code, 1, "a shard that truly failed is red, though another found no slot");
  assert.equal(red.infra, undefined);
  const stopped = combine([
    { packages: ["a"], code: 0 },
    { packages: ["b"], code: 130 },
  ]);
  assert.equal(stopped.code, 130);
  assert.match(stopped.infra ?? "", /exit 130 .*stopped by a signal.*nothing posted/);
});

test("workspacePackages: every `*` segment expands (`packages/*/*`); a glob it cannot read, a `packages` that is not a list or an unsafe folder is a problem, never skipped", (t) => {
  const root = mkdtempSync(join(tmpdir(), "fflow-shards-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const yaml = (/** @type {string} */ text) =>
    writeFileSync(join(root, "pnpm-workspace.yaml"), text);
  assert.equal(workspacePackages(root), undefined, "no workspace file");
  for (const p of ["apps/web", "packages/x/a", "packages/x/b", "packages/x/skip", "packages/y/c"]) {
    mkdirSync(join(root, p), { recursive: true });
    writeFileSync(join(root, p, "package.json"), "{}\n");
  }
  mkdirSync(join(root, "packages/y/node_modules/dep"), { recursive: true });
  writeFileSync(join(root, "packages/y/node_modules/dep/package.json"), "{}\n");
  mkdirSync(join(root, "packages/y/docs"));
  yaml('packages:\n  - apps/*\n  - packages/*/*\n  - "!packages/x/skip"\n');
  assert.deepEqual(workspacePackages(root), {
    packages: ["apps/web", "packages/x/a", "packages/x/b", "packages/y/c"],
  });
  for (const glob of ["packages/**", "packages/?/a", "packages/{x,y}/*", "../other/*"]) {
    yaml(`packages:\n  - apps/*\n  - "${glob}"\n`);
    const found = workspacePackages(root);
    assert.match(
      found && "problem" in found ? found.problem : "",
      new RegExp(`\`${glob.replace(/[?*{}.]/g, "\\$&")}\``),
    );
  }
  for (const text of ["", "packages: apps/*\n", "packages:\n  - 1\n"]) {
    yaml(text);
    const found = workspacePackages(root);
    assert.match(found && "problem" in found ? found.problem : "", /is not a list/);
  }
  mkdirSync(join(root, "apps/my app"));
  writeFileSync(join(root, "apps/my app/package.json"), "{}\n");
  yaml("packages:\n  - apps/*\n");
  const unsafe = workspacePackages(root);
  assert.match(unsafe && "problem" in unsafe ? unsafe.problem : "", /`apps\/my app` has a name/);
});

/**
 * A GitHub-named repository with a three-package workspace and `gate.shard`, pushed; `yaml` null leaves out
 * `pnpm-workspace.yaml`, and `files` adds files.
 * @param {any} t
 * @param {{ gate?: Record<string, unknown>, yaml?: string | null, files?: Record<string, string> }} [options]
 */
function workspace(
  t,
  {
    gate = { shard: "pnpm turbo run test {filters}" },
    yaml = 'packages:\n  - packages/*\n  - "!packages/skip"\n',
    files = {},
  } = {},
) {
  const r = repo({
    [CONFIG_FILE]: `${JSON.stringify({ ...CONFIG, gate }, null, 2)}\n`,
    ...(yaml === null ? {} : { "pnpm-workspace.yaml": yaml }),
    ...files,
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
  assert.deepEqual(workspacePackages(w.root), {
    packages: ["packages/a", "packages/b", "packages/c"],
  });
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
  const mixed = testbed({ 1: [1], 2: [75] });
  const red = await gateRun({ cwd: w.root, tip: w.tip, runner: mixed.runner, shards: 2, post });
  assert.equal(red.code, 1);
  assert.equal(red.problem, undefined);
  assert.equal(posted, 2, "a shard that truly failed is posted red, though another found no box");
});

test("gate run --shards: only the first shard runs the spec gate", async (t) => {
  const w = workspace(t, {
    files: { "package.json": `${JSON.stringify({ devDependencies: { [PACKAGE]: "0.3.0" } })}\n` },
  });
  const tb = testbed();
  await gateRun({ cwd: w.root, tip: w.tip, runner: tb.runner, shards: 3, post: () => 0 });
  assert.deepEqual(
    tb.calls.map((c) => c.command.endsWith("&& pnpm exec fflow gate ci")),
    [true, false, false],
  );
});

test("gate run --shards: a runner that cannot shard, no gate.shard or no readable workspace is refused before any box", async (t) => {
  const w = workspace(t);
  const tb = testbed();
  const refused = async (/** @type {{ root: string, tip: any }} */ at, runner = tb.runner) => {
    const r = await gateRun({ cwd: at.root, tip: at.tip, runner, shards: 2 });
    assert.equal(r.code, 2);
    return r.problem ?? "";
  };
  assert.match(
    await refused(w, { ...tb.runner, start: undefined }),
    /--shards needs a command runner/,
  );
  assert.match(
    await refused(w, { ...tb.runner, posts: /** @type {any} */ ("box") }),
    /--shards needs a command runner/,
  );
  assert.match(
    await refused(workspace(t, { gate: { check: "pnpm verify" } })),
    /--shards needs "gate\.shard"/,
  );
  for (const yaml of [null, "", "packages: []\n"])
    assert.match(
      await refused(workspace(t, { yaml })),
      /needs pnpm-workspace\.yaml naming the packages|is not a list/,
    );
  assert.match(
    await refused(workspace(t, { yaml: "packages:\n  - packages/**\n" })),
    /--shards: pnpm-workspace\.yaml: `packages\/\*\*`/,
  );
  assert.equal(tb.calls.length, 0);
});

test("gate run: --shards outside 1 to 12, or not a number, is a usage error", async () => {
  for (const n of ["0", "13", "2.5", "x"]) assert.equal(await run(["--shards", n]), 2, n);
  assert.equal(await run(["--shards"]), 2);
});
