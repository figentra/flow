/**
 * Figentra Flow file contract:
 * Purpose: hold STA-1945's C6 to its contract: the stackra preset carries core's content (27 role agents beside the
 *   three stewards, 15 rules, 38 skills, 29 reference files, routing and models) and `sync` renders all of it, the
 *   skills beside the `flow-*` ones and the reference, routing and models always under `.agents/`, byte for byte; the
 *   neutral preset renders none of it; `renderReference` reads only the preset folder it is given.
 * Boundary: temporary folders; no network.
 * Runtime: node
 * Governing contract: STA-1945 (C6, D2).
 */
// @covers sta-1945:FR-7 sta-1945:FR-12 sta-1945:AC-7 sta-1945:P-010
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sync } from "../commands/sync.mjs";
import { FLOW_ASSETS } from "../lib/flow-dir.mjs";
import { installProblems, renderReference } from "../lib/render.mjs";

const STACKRA = join(FLOW_ASSETS, "presets", "stackra");
const quiet = { log: () => {} };

/**
 * A repository on `preset`, removed after the test.
 * @param {import("node:test").TestContext} t
 * @param {string} preset
 */
function repo(t, preset) {
  const root = mkdtempSync(join(tmpdir(), `flow-content-${preset}-`));
  t.after(() => rmSync(root, { recursive: true }));
  writeFileSync(join(root, "flow.config.json"), JSON.stringify({ version: 1, preset }));
  return root;
}

/** @param {string[]} files @param {string} prefix */
const under = (files, prefix) => files.filter((f) => f.startsWith(prefix));
/** @param {string[]} files @param {string} prefix the distinct first folder names under `prefix` */
const names = (files, prefix) => [
  ...new Set(under(files, prefix).map((f) => f.slice(prefix.length).split("/")[0])),
];

test("sync renders core's content from the stackra preset, file for file, and holds the install check", (t) => {
  const root = repo(t, "stackra");
  const { files } = sync(root, quiet);
  assert.equal(under(files, ".agents/agents/").length, 30, "27 role agents and the three stewards");
  assert.ok(files.includes(".agents/agents/security-tenancy-reviewer.md"));
  assert.equal(under(files, ".agents/rules/").length, 15);
  assert.ok(files.includes(".agents/rules/tenancy.md"));
  const skills = names(files, ".agents/skills/").filter((n) => !n.startsWith("flow-"));
  assert.equal(skills.length, 38);
  for (const skill of skills) assert.ok(files.includes(`.agents/skills/${skill}/SKILL.md`), skill);
  assert.equal(under(files, ".agents/reference/").length, 29);
  assert.ok(files.includes(".agents/reference/encore/encore-api/SKILL.md"));
  for (const path of [
    "skills/archify/bin/archify.mjs",
    "reference/encore/encore-api/LICENSE",
    "routing.yaml",
    "models.yaml",
  ])
    assert.equal(
      readFileSync(join(root, ".agents", path), "utf8"),
      readFileSync(join(STACKRA, path), "utf8"),
      path,
    );
  assert.deepEqual(installProblems(root), []);
});

test("direct: the skills go to .claude/skills; reference, routing and models stay under .agents/", (t) => {
  const root = repo(t, "stackra");
  const { files } = sync(root, { direct: true, ...quiet });
  assert.ok(files.includes(".claude/skills/tdd/SKILL.md"));
  assert.deepEqual(under(files, ".agents/skills/"), []);
  assert.ok(files.includes(".agents/routing.yaml"));
  assert.ok(files.includes(".agents/models.yaml"));
  assert.equal(under(files, ".agents/reference/").length, 29);
});

test("the neutral preset renders none of core's content", (t) => {
  const { files } = sync(repo(t, "neutral"), quiet);
  assert.deepEqual(
    names(files, ".agents/skills/").filter((n) => !n.startsWith("flow-")),
    [],
  );
  assert.deepEqual(under(files, ".agents/reference/"), []);
  assert.equal(files.includes(".agents/routing.yaml"), false);
  assert.equal(files.includes(".agents/models.yaml"), false);
});

test("renderReference reads only its preset folder; a missing file or folder renders nothing", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "flow-reference-"));
  t.after(() => rmSync(dir, { recursive: true }));
  assert.deepEqual([...renderReference({ presetDir: dir })], []);
  mkdirSync(join(dir, "reference/a"), { recursive: true });
  writeFileSync(join(dir, "reference/a/b.md"), "B\n");
  writeFileSync(join(dir, "reference/README.md"), "R\n");
  writeFileSync(join(dir, "models.yaml"), "tiers: []\n");
  assert.deepEqual(
    [...renderReference({ presetDir: dir })],
    [
      [".agents/reference/README.md", "R\n"],
      [".agents/reference/a/b.md", "B\n"],
      [".agents/models.yaml", "tiers: []\n"],
    ],
  );
});
