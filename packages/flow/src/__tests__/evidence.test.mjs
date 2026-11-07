/**
 * Figentra Flow file contract:
 * Purpose: hold a task's evidence to STA-1945 FR-23 and NFR-5: `runEvidence` records the command, exit code,
 *   duration, HEAD, a clean tree and an output digest (a failing run and a dirty tree are recorded too), and
 *   `secretLooking` refuses a command that carries or prints a secret before it runs, while ordinary checks pass.
 * Boundary: a temporary git repository; no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945 FR-23, NFR-5.
 */
// @covers sta-1945:FR-23 sta-1945:AC-23 sta-1945:P-028
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runEvidence, secretLooking } from "../lib/evidence.mjs";

function repo() {
  const root = mkdtempSync(join(tmpdir(), "flow-evidence-"));
  const git = (/** @type {string[]} */ args) =>
    spawnSync(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@t.test", "-c", "commit.gpgsign=false", ...args],
      { cwd: root },
    );
  git(["init", "-q"]);
  writeFileSync(join(root, "a.txt"), "a\n");
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "init"]);
  const head = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).stdout.trim();
  return { root, head };
}

test("runEvidence records a passing run on a clean HEAD", (t) => {
  const { root, head } = repo();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const at = new Date("2026-11-03T10:00:00Z");
  const e = runEvidence(root, "echo ok", { now: () => at });
  assert.deepEqual(
    { ...e, ms: 0 },
    {
      command: "echo ok",
      exit: 0,
      ms: 0,
      head,
      clean: true,
      digest: `sha256:${createHash("sha256").update("ok\n").digest("hex")}`,
      at: "2026-11-03T10:00:00.000Z",
    },
  );
  assert.ok(e.ms >= 0);
});

test("runEvidence records a failing run and a dirty tree", (t) => {
  const { root } = repo();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const failed = runEvidence(root, "echo no >&2; exit 3");
  assert.deepEqual([failed.exit, failed.clean], [3, true]);
  assert.equal(failed.digest, `sha256:${createHash("sha256").update("no\n").digest("hex")}`);
  writeFileSync(join(root, "b.txt"), "b\n");
  assert.deepEqual([runEvidence(root, "true").exit, runEvidence(root, "true").clean], [0, false]);
});

test("a command that dirties the tree is not clean evidence", (t) => {
  const { root } = repo();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const e = runEvidence(root, "echo x >> a.txt");
  assert.deepEqual([e.exit, e.clean], [0, false]);
});

test("secretLooking refuses literal secrets and secret-printing commands", () => {
  for (const command of [
    `curl -H "Authorization: Bearer ${"ab12".repeat(5)}" x`,
    `GITHUB_TOKEN=${"gh".repeat(5)} pnpm test`,
    "pnpm test --token abcdef",
    `echo ghp_${"a1".repeat(18)}`,
    `node x.mjs AKIA${"A".repeat(16)}`,
    "env",
    "env > leak.txt",
    "env>x",
    "env >> x",
    "/usr/bin/env",
    "env -0 | tee x",
    "pnpm test; export",
    "x=$(env)",
    "cat .env",
    "cat ./apps/web/.env.local",
    "echo $GITHUB_TOKEN",
    'echo "$TOKEN"',
    "printf %s ${NPM_TOKEN}",
    "pnpm test && printenv HOME",
    "/usr/bin/printenv",
    "infisical export --env=dev",
    "sops -d agents/LINEAR_API_KEY.enc.yaml",
    "sops --input-type yaml decrypt x.enc.yaml",
    "sops exec-env agents/X.enc.yaml 'pnpm test'",
    `node run.mjs ${"aB3".repeat(12)}`,
  ])
    assert.equal(secretLooking(command), true, command);
  for (const command of [
    "pnpm verify",
    "node --test src/__tests__/evidence.test.mjs",
    'GITHUB_TOKEN="$GH" pnpm test',
    "pnpm test --token $TOKEN",
    `git diff ${"a1b2c3d4".repeat(5)}`,
    "env NODE_ENV=test node --test",
    "set -e; pnpm test",
    "export CI=1 && pnpm test",
    "cp .env.example x && pnpm test",
    "node -e process.env.HOME",
    "sops updatekeys --yes x.enc.yaml",
    "echo ok && pnpm test --token $TOKEN",
    // shortcut: a reference whose name says nothing secret is out of scope (the guard's own rules cover it)
    "echo $HOME",
    "STACKRA_ENVIRONMENT_NAME_FOR_THE_TEST_RUN=1 pnpm test",
  ])
    assert.equal(secretLooking(command), false, command);
});

test("runEvidence refuses a secret-looking command before it runs", (t) => {
  const { root } = repo();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.throws(() => runEvidence(root, "printenv > leak.txt"), /secret/);
  assert.throws(() => runEvidence(root, "env > leak.txt"), /secret/);
  assert.throws(() => runEvidence(root, "env>leak.txt"), /secret/);
  assert.equal(existsSync(join(root, "leak.txt")), false);
});

test("a command that moves HEAD is not clean evidence, and reports the HEAD it ran on", (t) => {
  const { root, head } = repo();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const e = runEvidence(
    root,
    "git -c user.name=t -c user.email=t@t.test -c commit.gpgsign=false commit -q --allow-empty -m x",
  );
  assert.deepEqual([e.exit, e.head, e.clean], [0, head, false]);
});

test("a hung command times out with the reason, and ignored paths do not dirty the tree", (t) => {
  const { root } = repo();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const hung = runEvidence(root, "sleep 5", { timeoutMs: 200 });
  assert.equal(hung.exit, 1);
  assert.match(hung.error ?? "", /timed out/);
  assert.equal(runEvidence(root, "true").error, undefined);
  writeFileSync(join(root, "tasks.md"), "- [x] T001\n");
  assert.equal(runEvidence(root, "true", { ignore: ["tasks.md"] }).clean, true);
  assert.equal(runEvidence(root, "true").clean, false);
});
