/**
 * Figentra Flow file contract:
 * Purpose: hold profiles to STA-1945 FR-6: `resolveProfile` takes the named profile, else the preset's default, else
 *   an implicit `default` selecting all, and refuses an unknown name by naming the preset's profiles, a missing
 *   `default` and a malformed profile; `selects` honours `"*"`; both presets declare their profiles (stackra per D3);
 *   `sync` renders only the selected profile's skills and agents, records the profile in the lock, and refuses, writing
 *   nothing, an unknown profile or an unreadable preset.yml; `validate` and `check` name an unknown profile, and
 *   `check` a profile changed without a sync; the overrides apply to what the profile selects, and one on an output
 *   it drops is refused (FR-4).
 * Boundary: temporary folders; no process, no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945.
 */
// @covers sta-1945:FR-6 sta-1945:AC-6 sta-1945:P-009
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { check } from "../commands/check.mjs";
import { sync } from "../commands/sync.mjs";
import { validateRepo } from "../commands/validate.mjs";
import { ConfigError } from "../lib/config.mjs";
import { FLOW_ASSETS } from "../lib/flow-dir.mjs";
import { readLock, writeLock } from "../lib/lock.mjs";
import { resolveProfile, selects } from "../lib/profiles.mjs";
import { parseYaml } from "../lib/yaml.mjs";
import { governed, OWN_PRESET, snapshot } from "./__fixtures__/governed.mjs";

const ALL = ["*"];
const manifest = (/** @type {string} */ preset) =>
  parseYaml(readFileSync(join(FLOW_ASSETS, "presets", preset, "preset.yml"), "utf8"));

/** A preset.yml with a `lean` profile (one agent, two skills) and a `full` one. */
const LEAN = `preset:
  id: "ours"
default: full
profiles:
  lean:
    agents: [git-steward]
    skills: [flow-specify, flow-plan]
    hooks: []
  full:
    agents: ["*"]
    skills: ["*"]
    hooks: ["*"]
`;

test("resolveProfile: the named profile, else the preset's default, else an implicit default selecting all", () => {
  const yml = parseYaml(LEAN);
  assert.deepEqual(resolveProfile(yml, "lean"), {
    name: "lean",
    agents: ["git-steward"],
    skills: ["flow-specify", "flow-plan"],
    hooks: [],
  });
  assert.equal(resolveProfile(yml).name, "full");
  const implicit = { name: "default", agents: ALL, skills: ALL, hooks: ALL };
  assert.deepEqual(resolveProfile({ preset: { id: "x" } }), implicit);
  assert.deepEqual(resolveProfile(undefined, "default"), implicit);
});

test("resolveProfile: an unknown name is a ConfigError naming the preset's profiles", () => {
  assert.throws(
    () => resolveProfile(parseYaml(LEAN), "brand"),
    (e) =>
      e instanceof ConfigError &&
      /"brand" is unknown: the preset's profiles are lean, full/.test(e.message),
  );
  assert.throws(
    () => resolveProfile(undefined, "brand"),
    (e) => e instanceof ConfigError && /declares no profiles/.test(e.message),
  );
  assert.throws(
    () => resolveProfile({ profiles: { x: { agents: "git-steward" } } }, "x"),
    (e) => e instanceof ConfigError && /agents must be a list of names/.test(e.message),
  );
});

test("resolveProfile: profiles without a `default` need a name; a malformed profile is named as malformed", () => {
  const noDefault = { profiles: { lean: { agents: ALL }, full: { agents: ALL } } };
  for (const yml of [noDefault, { ...noDefault, default: null }])
    assert.throws(
      () => resolveProfile(yml),
      (e) =>
        e instanceof ConfigError &&
        /declares profiles but no `default`: set `profile` .* one of lean, full/.test(e.message),
    );
  assert.equal(resolveProfile(noDefault, "lean").name, "lean");
  for (const entry of [null, 1, "all", ["*"]])
    assert.throws(
      () => resolveProfile({ profiles: { lean: entry } }, "lean"),
      (e) =>
        e instanceof ConfigError &&
        /profile "lean" must be a map of agents, skills and hooks/.test(e.message),
    );
  assert.throws(
    () => resolveProfile({ profiles: ["lean"] }, "lean"),
    (e) => e instanceof ConfigError && /profiles must be a map/.test(e.message),
  );
  // An inherited key is not a profile.
  assert.throws(() => resolveProfile(parseYaml(LEAN), "toString"), /"toString" is unknown/);
});

test("selects: a listed id or `*`", () => {
  const lean = resolveProfile(parseYaml(LEAN), "lean");
  assert.equal(selects(lean, "agents", "git-steward"), true);
  assert.equal(selects(lean, "agents", "ci-steward"), false);
  assert.equal(selects(lean, "hooks", "plan-gate"), false);
  assert.equal(selects(resolveProfile(parseYaml(LEAN)), "hooks", "plan-gate"), true);
});

test("presets: stackra declares D3's profiles with `framework` the default; neutral one `default` selecting all", () => {
  const stackra = manifest("stackra");
  assert.deepEqual(Object.keys(stackra.profiles), [
    "framework",
    "platform",
    "product",
    "brand",
    "starter",
  ]);
  assert.equal(resolveProfile(stackra).name, "framework");
  for (const name of Object.keys(stackra.profiles)) resolveProfile(stackra, name);
  assert.deepEqual(resolveProfile(manifest("neutral")), {
    name: "default",
    agents: ALL,
    skills: ALL,
    hooks: ALL,
  });
});

test("sync: renders only the named profile's skills and agents, and the lock records the profile", (t) => {
  const root = governed(t, { own: true, config: { profile: "lean" } });
  writeFileSync(join(root, OWN_PRESET, "preset.yml"), LEAN);
  const { files } = sync(root, { direct: true, log: () => {} });
  assert.deepEqual(files.toSorted(), [
    ".claude/agents/git-steward.md",
    ".claude/rules/worktrees.md",
    ".claude/skills/flow-plan/SKILL.md",
    ".claude/skills/flow-specify/SKILL.md",
    ".opencode/commands/flow-plan.md",
    ".opencode/commands/flow-specify.md",
  ]);
  assert.equal(readLock(root)?.profile, "lean");
});

test("sync: with no profile named, the preset's default applies; an unknown one is refused", (t) => {
  const own = governed(t, { own: true });
  writeFileSync(join(own, OWN_PRESET, "preset.yml"), LEAN);
  sync(own, { direct: true, log: () => {} });
  assert.equal(readLock(own)?.profile, "full");
  const neutral = governed(t, { config: { profile: "brand" } });
  const before = snapshot(neutral);
  assert.throws(
    () => sync(neutral, { direct: true, log: () => {} }),
    (e) => e instanceof ConfigError && /the preset's profiles are default/.test(e.message),
  );
  assert.deepEqual(snapshot(neutral), before, "a refused sync writes nothing");
});

test("sync: a repository's own preset.yml outside the YAML subset is refused, not read as selecting all", (t) => {
  const root = governed(t, { own: true });
  writeFileSync(join(root, OWN_PRESET, "preset.yml"), `${LEAN}anchor: &x 1\n`);
  const before = snapshot(root);
  assert.throws(
    () => sync(root, { direct: true, log: () => {} }),
    (e) => e instanceof ConfigError && /presets\/ours\/preset\.yml: line 13:/.test(e.message),
  );
  assert.deepEqual(snapshot(root), before, "a refused sync writes nothing");
  assert.match(validateRepo(root).problems.join(), /preset\.yml: line 13:/);
});

test("validate and check: an unknown profile is a problem, as sync would refuse it", (t) => {
  const root = governed(t, { config: { profile: "brand" } });
  const unknown = /profile "brand" is unknown: the preset's profiles are default/;
  assert.match(validateRepo(root).problems.join(), unknown);
  assert.match(check(root).problems.join(), unknown);
});

test("check: a profile changed without a sync differs from the lock's", (t) => {
  const root = governed(t, { own: true, config: { profile: "lean" } });
  writeFileSync(join(root, OWN_PRESET, "preset.yml"), LEAN);
  sync(root, { direct: true, log: () => {} });
  assert.deepEqual(check(root).problems, []);
  const config = join(root, "flow.config.json");
  writeFileSync(config, JSON.stringify({ version: 1, preset: OWN_PRESET, profile: "full" }));
  assert.deepEqual(check(root).problems, [
    'the profile is "full" but .flow/lock.json records "lean" (run `fflow sync`)',
  ]);
  // A lock from before profiles records "*", which any profile matches until the next sync.
  const lock = /** @type {import("../lib/lock.mjs").Lock} */ (readLock(root));
  writeLock(root, { ...lock, profile: "*" });
  assert.deepEqual(check(root).problems, []);
});

/**
 * Writes one override under the repository's `.flow/overrides/`.
 * @param {string} root
 * @param {string} path
 * @param {string} text
 */
function override(root, path, text) {
  mkdirSync(join(root, ".flow/overrides", path, ".."), { recursive: true });
  writeFileSync(join(root, ".flow/overrides", path), text);
}

// @covers sta-1945:FR-4
test("sync: the overrides apply to what the profile selects; validate refuses one on an output it drops", (t) => {
  const root = governed(t, { own: true, config: { profile: "lean" } });
  writeFileSync(join(root, OWN_PRESET, "preset.yml"), LEAN);
  override(
    root,
    "agents/git.yml",
    "kind: extend\ntarget: .claude/agents/git-steward.md\ntext: Ours.\n",
  );
  sync(root, { direct: true, log: () => {} });
  assert.match(readFileSync(join(root, ".claude/agents/git-steward.md"), "utf8"), /Ours\.\n$/);
  const lock = readLock(root);
  assert.equal(lock?.profile, "lean");
  assert.notEqual(lock?.overrides, "");
  assert.deepEqual(check(root).problems, []);
  override(
    root,
    "agents/ci.yml",
    "kind: extend\ntarget: .claude/agents/ci-steward.md\ntext: Ours.\n",
  );
  assert.deepEqual(validateRepo(root).problems, [
    ".flow/overrides/agents/ci.yml: extend .claude/agents/ci-steward.md: fflow renders no such output (`fflow diff` lists them)",
  ]);
  // An unknown profile is named once; the overrides' targets wait until it resolves.
  const config = join(root, "flow.config.json");
  writeFileSync(config, JSON.stringify({ version: 1, preset: OWN_PRESET, profile: "brand" }));
  const found = validateRepo(root).problems;
  assert.equal(found.length, 1);
  assert.match(found[0], /profile "brand" is unknown/);
  assert.match(check(root).problems.join(), /profile "brand" is unknown/);
});
