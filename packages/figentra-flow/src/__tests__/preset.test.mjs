/**
 * Figentra Flow file contract:
 * Purpose: hold the preset port to AC-041: the configuration picks the preset (`neutral` without one, `stackra` for a
 *   repository with no config file, a path for the repository's own); the neutral preset names no ADR, product,
 *   tracker or script of ours; the gate holds a neutral spec to the shared rules only (no Impact, Constitution Check,
 *   deploy modes, properties, routes or path floors), while `stackra` keeps them; the tripwire reads the neutral wrap.
 * Boundary: temporary folders; no `specify`, no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1729 phase A (A5).
 */
// @covers sta-1729:FR-11 sta-1729:AC-041
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  checkPlan,
  checkSpec,
  checkTasks,
  computedTier,
  MARKERS,
  presetOf,
  RULES,
  tripwire,
  WRAPPED,
} from "../commands/gate.mjs";
import { keyScheme } from "../adapters/tracker/index.mjs";
import { ASSETS, presetSource } from "../commands/sync.mjs";
import { CONFIG_FILE } from "../lib/product.mjs";

const NEUTRAL = join(ASSETS, "presets/neutral");
/** @returns {string[]} */
const walk = (/** @type {string} */ dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );

test("preset choice: the config's preset, neutral for a config without one, stackra with no config file, a path", (t) => {
  const root = mkdtempSync(join(tmpdir(), "flow-preset-"));
  t.after(() => rmSync(root, { recursive: true }));
  assert.equal(presetOf(root), "stackra");
  assert.deepEqual(presetSource(root).presets, ["stackra"]);
  writeFileSync(join(root, CONFIG_FILE), JSON.stringify({ version: 1 }));
  assert.equal(presetOf(root), "neutral");
  assert.deepEqual(presetSource(root), { dir: join(ASSETS, "presets"), presets: ["neutral"] });
  writeFileSync(join(root, CONFIG_FILE), JSON.stringify({ version: 1, preset: "stackra" }));
  assert.deepEqual(presetSource(root).presets, ["stackra"]);
  writeFileSync(
    join(root, CONFIG_FILE),
    JSON.stringify({ version: 1, preset: "tools/presets/ours" }),
  );
  assert.deepEqual(presetSource(root), { dir: join(root, "tools/presets"), presets: ["ours"] });
});

test("neutral preset: wraps every gated command and names no ADR, product, tracker or script of ours", () => {
  for (const file of walk(NEUTRAL))
    assert.doesNotMatch(
      readFileSync(file, "utf8"),
      /\bADR\b|Stackra|Figentra|Linear|\bSTA-|pnpm/,
      file,
    );
  for (const name of WRAPPED)
    assert.ok(
      readFileSync(join(NEUTRAL, `commands/speckit.${name}.md`), "utf8").includes(MARKERS.neutral),
      name,
    );
  assert.match(readFileSync(join(NEUTRAL, "preset.yml"), "utf8"), /id: "neutral"/);
});

test("neutral rules: the shared checks stay; Stackra's Impact, constitution, deploy modes, properties, routes and floors go", () => {
  const keys = keyScheme({ kind: "github-issues", branchPrefix: "work" });
  const spec =
    "**Issue**: GH-7\n**Clarifications status**: complete\n\n- **FR-001**: WHEN x THE y SHALL z.\n";
  assert.deepEqual(checkSpec(spec, keys, RULES.neutral), []);
  assert.match(checkSpec(spec, keys, RULES.stackra).join(), /Impact/);
  assert.match(
    checkSpec("**Clarifications status**: pending\n", keys, RULES.neutral).join(),
    /Clarifications status/,
  );
  assert.deepEqual(checkPlan("# Plan\n", spec, RULES.neutral), []);
  assert.match(checkPlan("# Plan\n", spec, RULES.stackra).join(), /Constitution Check/);
  const tasks = "- [ ] T001 Do it in `a.mjs` — covers: FR-001\n";
  assert.deepEqual(checkTasks(tasks, { spec, rules: RULES.neutral }), []);
  assert.match(checkTasks(tasks, { spec, rules: RULES.stackra }).join(), /route/);
  const migration = [{ status: "A", path: "x/database/migrations/1.ts" }];
  assert.equal(computedTier(migration, RULES.neutral).tier, "trivial");
  assert.equal(computedTier(migration, RULES.stackra).tier, "feature");
});

test("tripwire: a neutral repository's rendered commands carry the neutral wrap", (t) => {
  const root = mkdtempSync(join(tmpdir(), "flow-trip-neutral-"));
  t.after(() => rmSync(root, { recursive: true }));
  for (const name of WRAPPED) {
    mkdirSync(join(root, `.claude/skills/speckit-${name}`), { recursive: true });
    const text = `${MARKERS.neutral}\nexplicitly provided \`SPECIFY_FEATURE_DIRECTORY\` (x), use it as-is\n`;
    writeFileSync(join(root, `.claude/skills/speckit-${name}/SKILL.md`), text);
  }
  assert.deepEqual(tripwire(root, "neutral"), []);
  assert.match(tripwire(root, "stackra").join(), /lost the preset's wrap/);
});
