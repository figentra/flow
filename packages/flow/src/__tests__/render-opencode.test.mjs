/**
 * Figentra Flow file contract:
 * Purpose: hold the OpenCode projection to STA-1945 FR-7: the stackra preset renders `opencode.jsonc` and the guard
 *   plugin as in the preset; the neutral preset renders neither. The plugin asks the repository's guard bundle, as
 *   Claude Code's hook does, with no install (A-8): a side door is refused (an ask too), the rest allowed; it fails
 *   closed (STA-2131): a missing bundle, a timeout, a kill, a non-zero exit, no output or output that is not an
 *   answer denies, naming why; a grep carries its searched folder and file filter, so the path rules apply to it;
 *   its shell refusal prints the reason without running any of the refused command.
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
  searched,
} from "../../assets/flow/presets/stackra/surfaces/opencode/plugins/fflow-guard.mjs";
import { FLOW_ASSETS } from "../lib/flow-dir.mjs";
import { GUARD_FILE, guardBundle } from "../lib/render-guard.mjs";
import { OPENCODE_FILE, renderOpencode } from "../lib/render-opencode.mjs";
import { repo, sh } from "./__fixtures__/repo.mjs";

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
  const out = renderOpencode({
    root: "/repo",
    config: { surfaces: { opencode: true } },
    presetDir: STACKRA,
  });
  assert.deepEqual([...out.keys()], [OPENCODE_FILE, ".opencode/plugins/fflow-guard.mjs"]);
  assert.equal(
    out.get(OPENCODE_FILE),
    readFileSync(join(STACKRA, "surfaces/opencode.jsonc"), "utf8"),
  );
  assert.equal(
    out.get(".opencode/plugins/fflow-guard.mjs"),
    readFileSync(join(STACKRA, "surfaces/opencode/plugins/fflow-guard.mjs"), "utf8"),
  );
  assert.equal(
    renderOpencode({ root: "/repo", config: { surfaces: { opencode: true } }, presetDir: NEUTRAL })
      .size,
    0,
  );
  // Opt-in: unset, a repository whose lock has no opencode.jsonc gets none of it.
  assert.equal(renderOpencode({ root: "/repo", config: {}, presetDir: STACKRA }).size, 0);
});

test("guard plugin: asks the repository's guard bundle; a side door is refused, the rest allowed", (t) => {
  const root = installed(t);
  assert.match(refusal(root, root, "shell", "gh pr merge 12") ?? "", /fflow land/);
  assert.equal(refusal(root, root, "shell", "git status"), undefined);
  assert.equal(refusal(root, root, "webfetch", "https://example.com"), undefined);
});

test("guard plugin (STA-2131): fails closed when the bundle is missing or does not answer", (t) => {
  // `sync` writes the bundle beside the plugin and it needs no install, so a missing one is a broken checkout.
  const bare = repo();
  t.after(bare.dispose);
  assert.match(
    refusal(bare.root, bare.root, "shell", "git status") ?? "",
    /fflow-guard\.mjs is missing; `fflow sync` writes it, so the call is denied/,
  );
  const root = installed(t);
  for (const [body, why] of /** @type {[string, RegExp][]} */ ([
    ["setTimeout(() => {}, 10000);", /timed out after 1500 ms/],
    ["process.kill(process.pid, 'SIGKILL');", /was killed \(SIGKILL\)/],
    ["process.exit(3);", /exited 3/],
    ["", /printed nothing/],
    ["console.log('ok');", /not JSON/],
    ["console.log(JSON.stringify({ hookSpecificOutput: {} }));", /gave no decision/],
  ])) {
    writeFileSync(join(root, GUARD_FILE), body);
    assert.match(refusal(root, root, "shell", "git status", {}, 1500) ?? "", why, body);
  }
});

test("guard plugin (STA-2131): a grep carries its folder and filter, so the secret paths apply to it", async (t) => {
  const root = installed(t);
  assert.deepEqual(searched("grep", { pattern: "x", path: "src", include: "*.ts" }), {
    path: "src",
    glob: "*.ts",
  });
  assert.deepEqual(searched("glob", { pattern: "*.ts", path: "src", include: "x" }), {
    path: "src",
  });
  assert.deepEqual(searched("grep", undefined), {});
  const deny = /Secrets guard/;
  assert.match(
    refusal(root, root, "grep", "BEGIN", searched("grep", { path: join(root, ".dev.vars") })) ?? "",
    deny,
  );
  assert.match(
    refusal(root, root, "grep", "BEGIN", searched("grep", { path: root, include: "*.pem" })) ?? "",
    deny,
  );
  assert.equal(refusal(root, root, "grep", "BEGIN", searched("grep", { path: root })), undefined);
  // Through the permission hook, from the evaluation's metadata.
  /** @type {Record<string, (e: any) => void>} */
  const hooks = {};
  await plugin.setup({
    location: { directory: root },
    permission: { hook: async (/** @type {string} */ n, /** @type {any} */ cb) => (hooks[n] = cb) },
    shell: { hook: async (/** @type {string} */ n, /** @type {any} */ cb) => (hooks[n] = cb) },
  });
  const e = {
    action: "grep",
    resources: ["BEGIN"],
    metadata: { pattern: "BEGIN", path: join(root, ".env") },
    effect: "allow",
  };
  hooks.evaluate(e);
  assert.equal(e.effect, "deny");
});

test("guard plugin (STA-2136): the stackra tables hold OpenCode to core's executor layer and its worktree", (t) => {
  const r = repo();
  t.after(r.dispose);
  const wt = join(r.root, "..", "wt");
  sh(r.root, "worktree", "add", "-q", "-b", "feature/x", wt);
  for (const dir of [r.root, wt]) {
    mkdirSync(join(dir, ".agents/hooks"), { recursive: true });
    writeFileSync(join(dir, GUARD_FILE), guardBundle(STACKRA));
  }
  // The executor rules core's OpenCode guard passes, and its executor layer.
  assert.match(refusal(wt, wt, "shell", "npx cowsay hi") ?? "", /registry code/);
  assert.match(refusal(wt, wt, "shell", "pnpm bot:gh -- pr view 1") ?? "", /lead's/);
  assert.ok(refusal(wt, wt, "shell", "curl -s https://example.com"));
  assert.equal(refusal(wt, wt, "shell", "git status"), undefined);
  // Edits: inside the session's worktree only, and never in the main checkout unless STACKRA_ALLOW_MAIN=1.
  assert.equal(refusal(wt, wt, "edit", "notes.md"), undefined);
  assert.equal(refusal(wt, wt, "edit", join(wt, "notes.md")), undefined);
  assert.match(
    refusal(wt, wt, "edit", join(r.root, "README.md")) ?? "",
    /outside this session's worktree/,
  );
  assert.match(
    refusal(wt, wt, "edit", "../main/README.md") ?? "",
    /outside this session's worktree/,
  );
  assert.match(refusal(r.root, r.root, "edit", "README.md") ?? "", /main checkout/);
  const before = process.env.STACKRA_ALLOW_MAIN;
  process.env.STACKRA_ALLOW_MAIN = "1";
  try {
    assert.equal(refusal(r.root, r.root, "edit", "README.md"), undefined);
  } finally {
    if (before === undefined) delete process.env.STACKRA_ALLOW_MAIN;
    else process.env.STACKRA_ALLOW_MAIN = before;
  }
  // Reading is not editing: the main checkout stays readable.
  assert.equal(refusal(r.root, r.root, "read", "README.md"), undefined);
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
