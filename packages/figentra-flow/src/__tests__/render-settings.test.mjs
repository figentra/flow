/**
 * Figentra Flow file contract:
 * Purpose: hold `.claude/settings.json` to STA-1945 FR-7 and FR-19: the preset's settings with Flow's hooks first
 *   (the guard on every tool it checks, through `node` and the repository's guard bundle, so with no install (A-8),
 *   never `pnpm exec`; only when `session.pushAtEnd` opts in (STA-2131), the Stop hook writing the session's record
 *   and the SessionEnd hook committing and pushing it), each event's preset entries after them; the
 *   profile's `hooks` selects them by id, the guard always (FR-5); the session hooks exit 0 silently on a checkout
 *   with no install (STA-2131); the config's `claudeCode` adds only `enabledPlugins` and `extraKnownMarketplaces`;
 *   a preset without the surface renders nothing, and one whose surface is not JSON is a ConfigError naming the file.
 * Boundary: pure functions over the bundled presets and temporary folders; runs `sh` on a rendered hook command;
 *   no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945.
 */
// @covers sta-1945:FR-6 sta-1945:FR-7 sta-1945:FR-19 sta-1945:AC-6 sta-1945:AC-7 sta-1945:P-009 sta-1945:P-010
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ConfigError } from "../lib/config.mjs";
import { FLOW_ASSETS } from "../lib/flow-dir.mjs";
import { hookSettings, renderSettings, SETTINGS_FILE } from "../lib/render-settings.mjs";

const STACKRA = join(FLOW_ASSETS, "presets/stackra");
const NEUTRAL = join(FLOW_ASSETS, "presets/neutral");
const CLI = '"$CLAUDE_PROJECT_DIR/node_modules/@figentra-oss/flow/bin/fflow.mjs"';
/** The installed CLI's command for `args`, a no-op where nothing is installed. */
const cli = (/** @type {string} */ args) => `[ ! -f ${CLI} ] || node ${CLI} ${args}`;
const GUARD = 'node "$CLAUDE_PROJECT_DIR/.agents/hooks/fflow-guard.mjs"';
/** @param {string[]} hooks */
const profile = (hooks) => ({ name: "p", agents: ["*"], skills: ["*"], hooks });
const PUSH = { session: { pushAtEnd: true } };
/** @param {string} presetDir @param {string[]} [hooks] @param {Record<string, any>} [config] */
const settingsOf = (presetDir, hooks, config = {}) =>
  JSON.parse(
    renderSettings({
      root: "/repo",
      config,
      presetDir,
      ...(hooks ? { profile: profile(hooks) } : {}),
    }).get(SETTINGS_FILE) ?? "null",
  );

/** A preset folder holding only `surfaces/settings.json` with `text`, removed after the test. */
function preset(/** @type {import("node:test").TestContext} */ t, /** @type {string} */ text) {
  const dir = mkdtempSync(join(tmpdir(), "flow-settings-"));
  t.after(() => rmSync(dir, { recursive: true }));
  mkdirSync(join(dir, "surfaces"));
  writeFileSync(join(dir, "surfaces/settings.json"), text);
  return dir;
}

test("renderSettings: the stackra preset's permissions with Flow's guard and session hooks", () => {
  const surface = JSON.parse(readFileSync(join(STACKRA, "surfaces/settings.json"), "utf8"));
  const settings = settingsOf(STACKRA, undefined, PUSH);
  assert.deepEqual({ ...settings, hooks: undefined }, { ...surface, hooks: undefined });
  assert.ok(settings.permissions.allow.length > 0);
  assert.deepEqual(Object.keys(settings.hooks), [
    "PreToolUse",
    "PostToolUse",
    "UserPromptSubmit",
    "SessionStart",
    "Stop",
    "SessionEnd",
  ]);
  assert.deepEqual(settings.hooks.PreToolUse, [
    {
      matcher: "Bash|Write|Edit|MultiEdit|NotebookEdit|Read|Grep|Glob",
      hooks: [{ type: "command", command: `${GUARD} PreToolUse`, timeout: 5 }],
    },
  ]);
  for (const event of ["PostToolUse", "UserPromptSubmit", "SessionStart"])
    assert.equal(settings.hooks[event][0].hooks[0].command, `${GUARD} ${event}`);
  // FR-19: with `session.pushAtEnd`, every turn writes the record and the session's end commits and pushes it.
  assert.equal(settings.hooks.Stop[0].hooks[0].command, cli("session stop --save-only"));
  assert.equal(settings.hooks.SessionEnd[0].hooks[0].command, cli("session stop"));
  for (const entries of Object.values(settings.hooks))
    for (const entry of entries)
      for (const h of entry.hooks) assert.doesNotMatch(h.command, /pnpm|npx/, h.command);
});

test("renderSettings: by default no session hook: none commits, pushes or leaves the record uncommitted (STA-2131)", () => {
  for (const config of [{}, { session: {} }, { session: { pushAtEnd: false } }]) {
    const settings = settingsOf(STACKRA, undefined, config);
    assert.equal(settings.hooks.SessionEnd, undefined, JSON.stringify(config));
    assert.equal(settings.hooks.Stop, undefined, JSON.stringify(config));
    const commands = Object.values(settings.hooks).flatMap((entries) =>
      entries.flatMap((/** @type {any} */ e) => e.hooks.map((/** @type {any} */ h) => h.command)),
    );
    assert.deepEqual(
      commands.filter((c) => c.includes("session stop")),
      [],
    );
  }
  // a profile selecting the session hooks by id still needs the opt-in
  assert.deepEqual(Object.keys(settingsOf(NEUTRAL, ["session-save", "session-stop"]).hooks), [
    "PreToolUse",
  ]);
  assert.equal(hookSettings().SessionEnd, undefined);
  assert.equal(hookSettings().Stop, undefined);
});

test("renderSettings: the neutral preset gets the same hooks over its bare settings", () => {
  assert.equal(
    settingsOf(NEUTRAL).$schema,
    "https://json.schemastore.org/claude-code-settings.json",
  );
  assert.deepEqual(settingsOf(NEUTRAL).hooks, hookSettings());
  assert.deepEqual(settingsOf(NEUTRAL, undefined, PUSH).hooks, hookSettings(undefined, PUSH));
});

test("renderSettings: the profile's hooks select by id; the guard is mandatory", () => {
  assert.deepEqual(Object.keys(settingsOf(NEUTRAL, []).hooks), ["PreToolUse"]);
  assert.deepEqual(Object.keys(settingsOf(NEUTRAL, ["session-save", "session-stop"], PUSH).hooks), [
    "PreToolUse",
    "Stop",
    "SessionEnd",
  ]);
  assert.deepEqual(Object.keys(settingsOf(NEUTRAL, ["post-write"]).hooks), [
    "PreToolUse",
    "PostToolUse",
  ]);
});

test("renderSettings: a preset's own hooks follow Flow's for their event", (t) => {
  const own = { matcher: "Bash", hooks: [{ type: "command", command: "ours", timeout: 1 }] };
  const dir = preset(t, JSON.stringify({ hooks: { PreToolUse: [own], Notification: [own] } }));
  const settings = settingsOf(dir);
  assert.deepEqual(settings.hooks.PreToolUse.slice(1), [own]);
  assert.match(settings.hooks.PreToolUse[0].hooks[0].command, /fflow-guard\.mjs" PreToolUse$/);
  assert.deepEqual(settings.hooks.Notification, [own]);
});

test("renderSettings: no surface renders nothing; a surface that is not JSON is a ConfigError naming it", (t) => {
  const empty = mkdtempSync(join(tmpdir(), "flow-settings-none-"));
  t.after(() => rmSync(empty, { recursive: true }));
  assert.equal(renderSettings({ root: "/repo", config: {}, presetDir: empty }).size, 0);
  const dir = preset(t, "{ not json");
  assert.throws(
    () => settingsOf(dir),
    (e) => e instanceof ConfigError && e.message.includes(join(dir, "surfaces/settings.json")),
  );
});

test("renderSettings (STA-2131): the session hooks run the installed CLI, and exit 0 silently with no install", (t) => {
  const root = mkdtempSync(join(tmpdir(), "flow-settings-bare-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { Stop, SessionEnd } = settingsOf(STACKRA, undefined, PUSH).hooks;
  const run = (/** @type {string} */ command) =>
    spawnSync("sh", ["-c", command], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
      input: "{}",
      encoding: "utf8",
    });
  for (const command of [Stop[0].hooks[0].command, SessionEnd[0].hooks[0].command]) {
    const bare = run(command);
    assert.deepEqual([bare.status, bare.stdout, bare.stderr], [0, "", ""], command);
  }
  // Installed: the CLI runs with the hook's arguments.
  const bin = join(root, "node_modules/@figentra-oss/flow/bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "fflow.mjs"), "console.log(process.argv.slice(2).join(' '));\n");
  const installed = run(Stop[0].hooks[0].command);
  assert.equal(installed.status, 0);
  assert.equal(installed.stdout, "session stop --save-only\n");
});

test("renderSettings (STA-2131): claudeCode carries the plugins and marketplaces, and never hooks or permissions", () => {
  const marketplaces = {
    cloudflare: { source: { source: "github", repo: "cloudflare/skills" } },
  };
  const plugins = { "cloudflare@cloudflare": true, "finance@knowledge-work-plugins": false };
  const surface = JSON.parse(readFileSync(join(STACKRA, "surfaces/settings.json"), "utf8"));
  const settings = settingsOf(STACKRA, undefined, {
    claudeCode: {
      enabledPlugins: plugins,
      extraKnownMarketplaces: marketplaces,
      // Refused by the schema; the renderer ignores them even so.
      hooks: { Stop: [] },
      permissions: { allow: ["Bash(*)"] },
      env: { X: "1" },
    },
  });
  assert.deepEqual(settings.enabledPlugins, plugins);
  assert.deepEqual(settings.extraKnownMarketplaces, marketplaces);
  assert.deepEqual(settings.permissions, surface.permissions);
  assert.deepEqual(settings.env, surface.env);
  assert.deepEqual(settings.hooks, settingsOf(STACKRA).hooks);
  // Without the block, neither key appears.
  assert.equal("enabledPlugins" in settingsOf(STACKRA), false);
  assert.equal("extraKnownMarketplaces" in settingsOf(STACKRA), false);
  // A local marketplace could bring a plugin whose hooks run beside the guard's: refused.
  for (const source of ["directory", "file", undefined])
    assert.throws(
      () =>
        settingsOf(STACKRA, undefined, {
          claudeCode: {
            extraKnownMarketplaces: { local: { source: { source, path: "./.plugins" } } },
          },
        }),
      /claudeCode\.extraKnownMarketplaces\.local: a marketplace source is one of github, git, url/,
    );
});
