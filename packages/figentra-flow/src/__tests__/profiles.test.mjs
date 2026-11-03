/**
 * Figentra Flow file contract:
 * Purpose: hold profiles to STA-1945 FR-6: `resolveProfile` takes the named profile, else the preset's default, else
 *   an implicit `default` selecting all, and refuses an unknown name by naming the preset's profiles; `selects` honours
 *   `"*"`; both presets declare their profiles (stackra per D3); and `sync` renders only the selected profile's skills
 *   and agents and records the profile in the lock.
 * Boundary: temporary folders; no process, no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945.
 */
// @covers sta-1945:FR-6 sta-1945:AC-6 sta-1945:P-009
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { sync } from "../commands/sync.mjs";
import { ConfigError } from "../lib/config.mjs";
import { FLOW_ASSETS } from "../lib/flow-dir.mjs";
import { readLock } from "../lib/lock.mjs";
import { resolveProfile, selects } from "../lib/profiles.mjs";
import { parseYaml } from "../lib/yaml.mjs";
import { governed, OWN_PRESET } from "./__fixtures__/governed.mjs";

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
  assert.throws(
    () => sync(neutral, { direct: true, log: () => {} }),
    (e) => e instanceof ConfigError && /the preset's profiles are default/.test(e.message),
  );
});
