/**
 * Figentra Flow file contract:
 * Purpose: hold the guard bundle to STA-1945 NFR-2 as amended by A-8 (STA-2131): `sync` writes
 *   `.agents/hooks/fflow-guard.mjs` and locks it; the rendered Claude Code hooks and the OpenCode plugin run that
 *   file; it imports only `node:` modules and, in a folder with no node_modules, denies a side door, allows the rest,
 *   gives the preset's prompt hints and runs the plan gate, on the stackra and the neutral preset; `check` names a
 *   hand edit.
 * Boundary: temporary folders; the bundle runs as a child process; no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945; STA-2131.
 */
// @covers sta-1945:NFR-2 sta-1945:FR-5 sta-1945:FR-7
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { check } from "../commands/check.mjs";
import { sync } from "../commands/sync.mjs";
import { readLock } from "../lib/lock.mjs";
import { GUARD_FILE } from "../lib/render-guard.mjs";
import { governed } from "./__fixtures__/governed.mjs";
import { CONFIG } from "./__fixtures__/repo.mjs";

const quiet = { log: () => {} };
const EVENTS = ["PreToolUse", "PostToolUse", "UserPromptSubmit", "SessionStart"];

/** A synced repository on `preset`, with the fixture's tracker. */
function synced(/** @type {import("node:test").TestContext} */ t, /** @type {string} */ preset) {
  const root = governed(t, { config: { ...CONFIG, preset } });
  sync(root, { direct: true, ...quiet });
  return root;
}

/**
 * Runs the repository's bundle for `event` on `payload`, from the repository; the hook's answer, or undefined.
 * @param {string} root
 * @param {string} event
 * @param {Record<string, unknown>} payload
 */
function hook(root, event, payload) {
  const r = spawnSync(process.execPath, [join(root, GUARD_FILE), event], {
    cwd: root,
    input: JSON.stringify({ cwd: root, ...payload }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput : undefined;
}

test("guard bundle: the rendered hooks and the OpenCode plugin run the repository's file", (t) => {
  const root = synced(t, "stackra");
  const read = (/** @type {string} */ p) => readFileSync(join(root, p), "utf8");
  const settings = JSON.parse(read(".claude/settings.json"));
  for (const event of EVENTS)
    assert.equal(
      settings.hooks[event][0].hooks[0].command,
      `node "$CLAUDE_PROJECT_DIR/${GUARD_FILE}" ${event}`,
    );
  assert.match(
    read(".opencode/plugins/fflow-guard.mjs"),
    /join\(root, "\.agents\/hooks\/fflow-guard\.mjs"\)/,
  );
  assert.ok(readLock(root)?.files[GUARD_FILE], "the bundle is locked");
});

for (const preset of ["stackra", "neutral"])
  test(`guard bundle: with no install it denies a side door and allows the rest (${preset})`, (t) => {
    const root = synced(t, preset);
    assert.ok(!existsSync(join(root, "node_modules")));
    const imports = readFileSync(join(root, GUARD_FILE), "utf8").match(/^import .*$/gm);
    assert.deepEqual(imports, ['import { registerHooks } from "node:module";']);
    const bash = (/** @type {string} */ command) =>
      hook(root, "PreToolUse", { tool_name: "Bash", tool_input: { command } });
    const denied = bash("gh pr merge 12");
    assert.equal(denied?.permissionDecision, "deny");
    assert.match(denied?.permissionDecisionReason, /Blocked command: gh pr merge 12$/);
    assert.equal(bash("git status"), undefined);
    assert.equal(
      hook(root, "PreToolUse", { tool_name: "Read", tool_input: { file_path: join(root, ".env") } })
        ?.permissionDecision,
      "deny",
    );
  });

test("guard bundle: the stackra preset's hints and plan gate run from the bundle", (t) => {
  const root = synced(t, "stackra");
  const hint = hook(root, "UserPromptSubmit", { prompt: "write an adr for this decision" });
  assert.match(hint?.additionalContext ?? "", /docs-adr-steward/);
  spawnSync("git", ["init", "-q", "-b", "figentra/sta-7-thing", root]);
  const write = () =>
    hook(root, "PreToolUse", {
      tool_name: "Write",
      tool_input: { file_path: join(root, "packages/a/src/a.ts"), content: "x" },
    });
  const gated = write();
  assert.equal(gated?.permissionDecision, "deny", gated?.permissionDecisionReason);
  assert.match(gated?.permissionDecisionReason, /^Plan gate: /);
  const dir = join(root, ".agents/specs/sta-7-thing");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "plan.md"), "# Plan\n");
  writeFileSync(
    join(dir, "spec.md"),
    "**Linear**: STA-7\n**Clarifications status**: complete\n\n## Impact\n\n- **Lane**: none\n",
  );
  // The gate's own check ran: it names the unanswered Impact fields, so its modules loaded from the bundle.
  assert.match(write()?.permissionDecisionReason, /Impact: `Apps touched` is missing/);
});

test("guard bundle: check names a hand edit", (t) => {
  const root = synced(t, "neutral");
  const named = () => check(root).problems.filter((p) => p.includes(GUARD_FILE));
  assert.deepEqual(named(), []);
  writeFileSync(join(root, GUARD_FILE), `${readFileSync(join(root, GUARD_FILE), "utf8")}// ours\n`);
  assert.match(named().join("\n"), /\.agents\/hooks\/fflow-guard\.mjs differs/);
});
