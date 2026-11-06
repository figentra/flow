/**
 * Figentra Flow file contract:
 * Purpose: hold the OpenCode projection to STA-1945 FR-7: the stackra preset renders `opencode.jsonc` and the guard
 *   plugin as in the preset; the neutral preset renders neither. The plugin asks the repository's guard bundle, as
 *   Claude Code's hook does, with no install (A-8): a side door is refused (an ask too), the rest allowed, a
 *   repository without the bundle allowed; its shell refusal prints the reason without running any of the refused
 *   command.
 * Boundary: temporary git repositories; runs `node` (the guard bundle) and `sh`; no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945.
 */
// @covers sta-1945:FR-7 sta-1945:AC-7 sta-1945:P-010
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import plugin, {
  refusal,
} from "../../assets/flow/presets/stackra/surfaces/opencode/plugins/fflow-guard.mjs";
import { FLOW_ASSETS } from "../lib/flow-dir.mjs";
import { GUARD_FILE, guardBundle } from "../lib/render-guard.mjs";
import { OPENCODE_FILE, renderOpencode } from "../lib/render-opencode.mjs";
import { repo } from "./__fixtures__/repo.mjs";

const STACKRA = join(FLOW_ASSETS, "presets/stackra");
const NEUTRAL = join(FLOW_ASSETS, "presets/neutral");

/** A repository holding the guard bundle `sync` writes, and no install. */
function installed(/** @type {import("node:test").TestContext} */ t) {
  const r = repo();
  t.after(r.dispose);
  mkdirSync(join(r.root, ".agents/hooks"), { recursive: true });
  writeFileSync(join(r.root, GUARD_FILE), guardBundle(NEUTRAL));
  return r.root;
}

test("renderOpencode: the stackra preset's opencode.jsonc and guard plugin, as in the preset", () => {
  const out = renderOpencode({ root: "/repo", config: {}, presetDir: STACKRA });
  assert.deepEqual([...out.keys()], [OPENCODE_FILE, ".opencode/plugins/fflow-guard.mjs"]);
  assert.equal(
    out.get(OPENCODE_FILE),
    readFileSync(join(STACKRA, "surfaces/opencode.jsonc"), "utf8"),
  );
  assert.equal(
    out.get(".opencode/plugins/fflow-guard.mjs"),
    readFileSync(join(STACKRA, "surfaces/opencode/plugins/fflow-guard.mjs"), "utf8"),
  );
  assert.equal(renderOpencode({ root: "/repo", config: {}, presetDir: NEUTRAL }).size, 0);
});

test("guard plugin: asks the repository's guard bundle; a side door is refused, the rest allowed", (t) => {
  const root = installed(t);
  assert.match(refusal(root, root, "shell", "gh pr merge 12") ?? "", /fflow land/);
  assert.equal(refusal(root, root, "shell", "git status"), undefined);
  assert.equal(refusal(root, root, "webfetch", "https://example.com"), undefined);
  // No bundle yet (before `sync`): allowed, as Claude Code allows on a hook that cannot run.
  const bare = repo();
  t.after(bare.dispose);
  assert.equal(refusal(bare.root, bare.root, "shell", "gh pr merge 12"), undefined);
});

test("guard plugin: denies at the permission layer and replaces a refused shell command with its reason", async (t) => {
  const root = installed(t);
  /** @type {Record<string, (e: any) => void>} */
  const hooks = {};
  await plugin.setup({
    location: { directory: root },
    permission: { hook: async (/** @type {string} */ n, /** @type {any} */ cb) => (hooks[n] = cb) },
    shell: { hook: async (/** @type {string} */ n, /** @type {any} */ cb) => (hooks[n] = cb) },
  });
  const evaluation = { action: "shell", resources: ["gh pr merge 12"], effect: "allow" };
  hooks.evaluate(evaluation);
  assert.equal(evaluation.effect, "deny");
  const command = `gh pr merge 12 "$(touch pwned)" 'x'`;
  const call = { command, cwd: root };
  hooks["create.before"](call);
  assert.notEqual(call.command, command);
  const r = spawnSync("sh", ["-c", call.command], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 126);
  assert.match(r.stderr, /gh pr merge 12 "\$\(touch pwned\)" 'x'/);
  assert.ok(!existsSync(join(root, "pwned")), "nothing of the refused command runs");
});
