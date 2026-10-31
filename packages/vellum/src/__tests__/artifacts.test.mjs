/**
 * Vellum file contract:
 * Purpose: hold the artifact guard to AC-043: a change adding files under `.cache/`, `node_modules/`, `dist/`,
 *   `.turbo/` or `coverage/` (at any depth), or a file over the size limit, is named; the configuration's `artifacts`
 *   replaces both; ordinary source and deletions pass; `vellum gate run` refuses such a change before any box, and
 *   `vellum land`'s rules carry the problems.
 * Boundary: temporary repositories with a local bare origin; the runner injected; no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1729 phase A (AC-043).
 */
// @covers sta-1729:FR-11 sta-1729:AC-043
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { gateRun } from "../commands/gate-run.mjs";
import { landRules } from "../commands/land.mjs";
import { artifactProblems, matches } from "../lib/artifacts.mjs";
import { CONFIG_FILE } from "../lib/product.mjs";
import { repo, sh } from "./__fixtures__/repo.mjs";

/** Writes `files` (path → text) under `root` and commits them on a new branch `x`. */
function change(/** @type {string} */ root, /** @type {Record<string, string>} */ files) {
  sh(root, "checkout", "-q", "-b", "x");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  sh(root, "add", "-A", "-f");
  sh(root, "commit", "-q", "-m", "change");
  return sh(root, "rev-parse", "HEAD");
}

test("matches: a folder at any depth, or a glob on the name or the path", () => {
  assert.equal(matches(".cache/pnpm/v11/x", ".cache/"), true);
  assert.equal(matches("packages/a/node_modules/b/index.js", "node_modules/"), true);
  assert.equal(matches("src/distance.mjs", "dist/"), false);
  assert.equal(matches("a/b/c.tsbuildinfo", "*.tsbuildinfo"), true);
  assert.equal(matches("a/b/c.ts", "a/*/c.ts"), true);
});

test("artifacts: build output and an oversized file are named; source passes", (t) => {
  const r = repo();
  t.after(r.dispose);
  const head = change(r.root, {
    "src/ok.mjs": "export {};\n",
    ".cache/pnpm/blob": "x\n",
    "packages/a/dist/index.js": "x\n",
    "big.bin": "x".repeat(2048),
  });
  const problems = artifactProblems(r.root, "origin/main", head, {
    paths: [".cache/", "dist/"],
    maxBytes: 1024,
  });
  assert.deepEqual(problems.map((p) => p.split(":")[0]).sort(), [
    ".cache/pnpm/blob",
    "big.bin",
    "packages/a/dist/index.js",
  ]);
  assert.match(problems.join(), /must not be committed/);
  assert.match(problems.join(), /over the 0\.0 MB limit/);
  assert.deepEqual(
    artifactProblems(r.root, "origin/main", head, { paths: [], maxBytes: 1_000_000 }),
    [],
  );
});

test("gate run: a change carrying artifacts is refused before any box", async (t) => {
  const r = repo();
  t.after(r.dispose);
  sh(r.root, "remote", "set-url", "origin", "git@github.com:figentra/vellum.git");
  sh(r.root, "remote", "set-url", "--push", "origin", r.origin);
  const head = change(r.root, { "coverage/lcov.info": "x\n" });
  sh(r.root, "push", "-q", "origin", "x");
  let ran = 0;
  const result = await gateRun({ cwd: r.root, tip: () => head, runner: () => ++ran });
  assert.equal(result.code, 2);
  assert.match(result.problem ?? "", /coverage\/lcov\.info: build or tool output/);
  assert.equal(ran, 0);
});

test("gate run: the configuration's artifacts replace the defaults", async (t) => {
  const r = repo({
    [CONFIG_FILE]: JSON.stringify({ version: 1, artifacts: { paths: ["generated/"] } }),
  });
  t.after(r.dispose);
  sh(r.root, "remote", "set-url", "origin", "git@github.com:figentra/vellum.git");
  const head = change(r.root, { "generated/x.ts": "x\n", "coverage/ok.txt": "fine here\n" });
  const result = await gateRun({ cwd: r.root, tip: () => head, runner: () => 0 });
  assert.match(result.problem ?? "", /generated\/x\.ts/);
  assert.doesNotMatch(result.problem ?? "", /coverage/);
});

test("land rules: the artifact problems refuse the PR", () => {
  const pr = {
    state: "open",
    title: "fix: x",
    base: { ref: "main" },
    head: { sha: "c".repeat(40) },
  };
  const statuses = [
    { context: "vellum/gate", state: "success", creator: { login: "stackra-gate[bot]" } },
  ];
  const problems = landRules({
    pr,
    statuses,
    base: "main",
    required: true,
    artifacts: [".cache/x: build or tool output (.cache/) must not be committed"],
  });
  assert.deepEqual(problems, [".cache/x: build or tool output (.cache/) must not be committed"]);
});
