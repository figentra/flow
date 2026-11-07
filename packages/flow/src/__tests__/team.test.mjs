/**
 * Figentra Flow file contract:
 * Purpose: hold the agent roster to AC-046 and AC-047: the YAML subset reads a roster in the shape Figentra's uses and
 *   refuses what it does not support by line; the shipped schemas are `ROSTER_SCHEMA` and `ROLE_SCHEMA`; a valid
 *   roster has no problems; each cross-file rule (duplicate id, label, file id, unknown or self `reviewed_by`, unknown
 *   `tests_run_by`, an `approves` line naming a kept category) is one problem; no `team` means no roster.
 * Boundary: temporary folders; no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1729 phase 7.
 */
// @covers sta-1729:FR-12 sta-1729:AC-046 sta-1729:AC-047
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CONFIG_FILE } from "../lib/product.mjs";
import { loadTeam, ROLE_SCHEMA, ROSTER_SCHEMA } from "../lib/team.mjs";
import { parseYaml, YamlError } from "../lib/yaml.mjs";

const PACKAGE_DIR = new URL("../..", import.meta.url).pathname;

const ROSTER = `# a comment
version: 1
owner:
  keeps: [product, money, security] # trailing
rules:
  reviewer_not_builder: true
  tests_run_by: qa
roles:
  - id: backend
    label: role:backend
    file: backend.yaml
  - id: reviewer
    label: role:reviewer
    file: reviewer.yaml
  - id: qa
    label: role:qa
    file: qa.yaml
`;

const role = (/** @type {string} */ id, /** @type {string} */ extra = "") => `id: ${id}
label: role:${id}
purpose: >-
  Builds things,
  carefully.
changes:
  - repo: acme/app
    paths: [src/**, "docs/**"]
approves:
  - a module's internal design
reviewed_by: [reviewer]
sessions:
  - "Backend: one" # support
${extra}`;

/**
 * A repository with a roster; `files` override or add role files.
 * @param {Record<string, string>} [files]
 */
function repo(files = {}) {
  const root = mkdtempSync(join(tmpdir(), "flow-team-"));
  mkdirSync(join(root, "team"));
  writeFileSync(join(root, CONFIG_FILE), JSON.stringify({ version: 1, team: "team/roster.yaml" }));
  const all = {
    "roster.yaml": ROSTER,
    "backend.yaml": role("backend"),
    "reviewer.yaml": role("reviewer").replace("reviewed_by: [reviewer]", "reviewed_by: [backend]"),
    "qa.yaml": role("qa"),
    ...files,
  };
  for (const [name, text] of Object.entries(all)) writeFileSync(join(root, "team", name), text);
  return { root, dispose: () => rmSync(root, { recursive: true, force: true }) };
}

test("yaml: the roster's subset reads; unsupported forms are refused by line", () => {
  assert.deepEqual(parseYaml(role("backend")), {
    id: "backend",
    label: "role:backend",
    purpose: "Builds things, carefully.",
    changes: [{ repo: "acme/app", paths: ["src/**", "docs/**"] }],
    approves: ["a module's internal design"],
    reviewed_by: ["reviewer"],
    sessions: ["Backend: one"],
  });
  assert.deepEqual(parseYaml("a:\n  [x, y]\nb: []\nc: |\n  one\n  two\nd:\n- 1\n- 'it''s'\n"), {
    a: ["x", "y"],
    b: [],
    c: "one\ntwo\n",
    d: [1, "it's"],
  });
  for (const [text, line] of [
    ["a: &x 1\n", 1],
    ["a: 1\na: 2\n", 2],
    ["a: [[1]]\n", 1],
    ["a:\n  b: 1\n    c: 2\n", 3],
    ["a: 1\n---\nb: 2\n", 2],
  ])
    assert.throws(
      () => parseYaml(String(text)),
      (/** @type {any} */ e) => {
        assert.ok(e instanceof YamlError);
        assert.match(e.message, new RegExp(`^line ${line}:`));
        return true;
      },
    );
});

test("team: the shipped schemas are ROSTER_SCHEMA and ROLE_SCHEMA", () => {
  const read = (/** @type {string} */ name) =>
    JSON.parse(readFileSync(join(PACKAGE_DIR, "schema", name), "utf8"));
  assert.deepEqual(read("team.roster.schema.json"), ROSTER_SCHEMA);
  assert.deepEqual(read("team.role.schema.json"), ROLE_SCHEMA);
});

test("team: no `team` in the configuration means no roster", (t) => {
  const root = mkdtempSync(join(tmpdir(), "flow-team-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(loadTeam(root), undefined);
});

test("team check: a valid roster has no problems", (t) => {
  const r = repo();
  t.after(r.dispose);
  const team = loadTeam(r.root);
  assert.deepEqual(team?.problems, []);
  assert.deepEqual([...(team?.roles.keys() ?? [])], ["backend", "reviewer", "qa"]);
});

test("team check: each cross-file rule is one problem", (t) => {
  const r = repo({
    "roster.yaml": ROSTER.replace("tests_run_by: qa", "tests_run_by: nobody")
      .replace("label: role:qa", "label: qa")
      .concat("  - id: backend\n    label: role:backend\n    file: backend.yaml\n"),
    "backend.yaml": role("backend")
      .replace("reviewed_by: [reviewer]", "reviewed_by: [backend, ghost]")
      .replace("- a module's internal design", "- pricing of plans\n  - Security reviews"),
    "qa.yaml": role("quality"),
  });
  t.after(r.dispose);
  const problems = loadTeam(r.root)?.problems.join("\n") ?? "";
  for (const expected of [
    /role `backend` is listed twice/,
    /role `qa` has label `qa`, not `role:qa`/,
    /qa\.yaml: id `quality` does not match the roster's `qa`/,
    /role `backend` reviews itself/,
    /reviewed_by names an unknown role `ghost`/,
    /rules\.tests_run_by names an unknown role `nobody`/,
    /approves "Security reviews", which names `security`/,
  ])
    assert.match(problems, expected);
  assert.doesNotMatch(problems, /pricing/, "only the owner's own keeps count");
});

test("team check: a missing file, bad YAML and a schema problem are reported, not thrown", (t) => {
  const r = repo({
    "qa.yaml": "id: qa\n  bad: indent\n",
    "reviewer.yaml": "id: reviewer\nlabel: role:reviewer\n",
  });
  t.after(r.dispose);
  rmSync(join(r.root, "team", "backend.yaml"));
  const problems = loadTeam(r.root)?.problems.join("\n") ?? "";
  assert.match(problems, /team\/backend\.yaml: not found/);
  assert.match(problems, /team\/qa\.yaml: line 2: unexpected indentation/);
  assert.match(problems, /team\/reviewer\.yaml: purpose: is required/);
});
