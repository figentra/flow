/**
 * Figentra Flow file contract:
 * Purpose: hold the preset port to AC-041 and AC-045: the configuration picks the preset (`neutral` without one or
 *   without a config file, a path for the repository's own); the neutral preset names no ADR, product,
 *   tracker or script of ours; the gate holds a neutral spec to the shared rules only (no Impact, Constitution Check,
 *   deploy modes, properties, routes or path floors), while `stackra` keeps them; a neutral repository renders its
 *   own `flow-*` skills.
 * Boundary: temporary folders; no `specify`, no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1729 phase A (A5).
 */
// @covers sta-1729:FR-11 sta-1729:AC-041 sta-1945:FR-15
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  checkPlan,
  checkSpec,
  checkTasks,
  computedTier,
  presetId,
  presetOf,
  RULES,
} from "../commands/gate.mjs";
import { keyScheme } from "../adapters/tracker/index.mjs";
import { sync } from "../commands/sync.mjs";
import { FLOW_ASSETS, presetDir } from "../lib/flow-dir.mjs";
import { digestOf } from "../lib/lock.mjs";
import { installProblems, VERBS } from "../lib/render.mjs";
import { CONFIG_FILE } from "../lib/product.mjs";

const NEUTRAL = join(FLOW_ASSETS, "presets/neutral");
/** The commands that read a spec folder first; the gate workflow reads none. */
const SPEC_VERBS = VERBS.filter((v) => v !== "gate");
/** @returns {string[]} */
const walk = (/** @type {string} */ dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );

test("preset choice: the config's preset, else neutral (config file or not), or a path", (t) => {
  const root = mkdtempSync(join(tmpdir(), "flow-preset-"));
  t.after(() => rmSync(root, { recursive: true }));
  assert.equal(presetOf(root), "neutral", "no stackra fallback without a config file (AC-045)");
  assert.equal(presetDir(root), NEUTRAL);
  writeFileSync(join(root, CONFIG_FILE), JSON.stringify({ version: 1 }));
  assert.equal(presetOf(root), "neutral");
  assert.equal(presetDir(root), NEUTRAL);
  writeFileSync(join(root, CONFIG_FILE), JSON.stringify({ version: 1, preset: "stackra" }));
  assert.equal(presetDir(root), join(FLOW_ASSETS, "presets/stackra"));
  writeFileSync(
    join(root, CONFIG_FILE),
    JSON.stringify({ version: 1, preset: "tools/presets/ours" }),
  );
  assert.equal(presetDir(root), join(root, "tools/presets/ours"));
});

test("neutral preset: wraps every gated command and names no ADR, product, tracker or script of ours", () => {
  for (const file of walk(NEUTRAL))
    assert.doesNotMatch(
      readFileSync(file, "utf8"),
      /\bADR\b|Stackra|Figentra|Linear|\bSTA-|\bpnpm\b(?!-lock)/,
      file,
    );
  for (const verb of SPEC_VERBS)
    assert.ok(
      readFileSync(join(NEUTRAL, `commands/flow-${verb}.md`), "utf8").includes(
        "## Workflow: feature directory",
      ),
      verb,
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

test("a neutral repository renders the neutral flow-* skills and passes the install check", (t) => {
  const root = mkdtempSync(join(tmpdir(), "flow-neutral-"));
  t.after(() => rmSync(root, { recursive: true }));
  sync(root, { direct: true, log: () => {} });
  for (const verb of SPEC_VERBS)
    assert.match(
      readFileSync(join(root, `.claude/skills/flow-${verb}/SKILL.md`), "utf8"),
      /## Workflow: feature directory/,
    );
  assert.deepEqual(installProblems(root), []);
});

test("sync: an unedited flow-* skill the last sync rendered and this one does not goes; nothing else does (STA-1945 FR-15)", (t) => {
  const root = mkdtempSync(join(tmpdir(), "flow-stale-"));
  t.after(() => rmSync(root, { recursive: true }));
  sync(root, { direct: true, log: () => {} });
  const files = {
    ".claude/skills/flow-tasks/SKILL.md": "rendered\n",
    ".opencode/commands/flow-tasks.md": "edited since\n",
    "notes.md": "rendered\n",
  };
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(join(root, p, ".."), { recursive: true });
    writeFileSync(join(root, p), text);
  }
  const lock = JSON.parse(readFileSync(join(root, ".flow/lock.json"), "utf8"));
  const old = Object.fromEntries(Object.keys(files).map((p) => [p, digestOf("rendered\n")]));
  writeFileSync(
    join(root, ".flow/lock.json"),
    JSON.stringify({ ...lock, files: { ...lock.files, ...old } }),
  );
  const { removed } = sync(root, { direct: true, log: () => {} });
  assert.deepEqual(removed, [".claude/skills/flow-tasks/SKILL.md"]);
  assert.ok(!existsSync(join(root, ".claude/skills/flow-tasks")), "its folder goes too");
  assert.ok(existsSync(join(root, ".opencode/commands/flow-tasks.md")), "an edited one stays");
  assert.ok(existsSync(join(root, "notes.md")), "only flow-* skills and commands go");
  assert.deepEqual(installProblems(root), []);
});

test("presetId: a bundled preset is its name; a repository's own folder is the id its preset.yml declares", (t) => {
  const root = mkdtempSync(join(tmpdir(), "flow-preset-id-"));
  t.after(() => rmSync(root, { recursive: true }));
  assert.equal(presetId("neutral", root), "neutral");
  mkdirSync(join(root, "presets/ours"), { recursive: true });
  writeFileSync(
    join(root, "presets/ours/preset.yml"),
    'schema_version: "1.0"\npreset:\n  id: "stackra"\n',
  );
  assert.equal(
    presetId("presets/ours", root),
    "stackra",
    "a copy of stackra keeps Stackra's rules",
  );
  assert.equal(presetId("presets/missing", root), undefined);
});
