/**
 * Figentra Flow file contract:
 * Purpose: hold the overrides (STA-1945 FR-4) to their contract: the shipped schema is `OVERRIDE_SCHEMA`; the loader
 *   reads each of the four kinds, refuses a `replace` or `disable` without `reason`, `owner` or `review`, a date that
 *   is not one, a misplaced file, invalid YAML and a missing replacement (a problem, never a throw), and reads a
 *   whole-file override as a legacy `replace`; each kind changes only its target; review dates are due 14 days ahead
 *   and expired after; an unknown target is named.
 * Boundary: temporary folders; no process, no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945.
 */
// @covers sta-1945:FR-4 sta-1945:AC-4 sta-1945:P-007
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  applyOverrides,
  configured,
  legacyWarnings,
  loadOverrides,
  OVERRIDE_SCHEMA,
  reviewState,
  shapedBy,
  targetProblems,
} from "../lib/overrides.mjs";

const PACKAGE_DIR = new URL("../..", import.meta.url).pathname;
const GOVERNED = "reason: ours\nowner: o\nreview: 2027-01-31\n";

/**
 * A repository holding `files` (path to text), removed after the test.
 * @param {{ after: (fn: () => void) => void }} t
 * @param {Record<string, string>} files
 */
function repo(t, files) {
  const root = mkdtempSync(join(tmpdir(), "flow-overrides-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

/**
 * An override as `loadOverrides` returns it.
 * @param {Record<string, unknown>} fields
 * @returns {import("../lib/overrides.mjs").Override}
 */
const override = (fields) =>
  /** @type {any} */ ({ id: "x", surface: "s", path: ".flow/overrides/s/x.yml", ...fields });

test("overrides: the shipped schema is OVERRIDE_SCHEMA", () => {
  assert.deepEqual(
    JSON.parse(readFileSync(join(PACKAGE_DIR, "schema", "override.schema.json"), "utf8")),
    OVERRIDE_SCHEMA,
  );
});

test("loadOverrides: no folder, no overrides; each of the four kinds reads, sorted by path", (t) => {
  assert.deepEqual(loadOverrides(repo(t, {})), { overrides: [], problems: [] });
  const root = repo(t, {
    ".flow/overrides/rules/a.yml":
      "kind: extend\ntarget: .agents/rules/worktrees.md\nitems:\n  - one\n",
    ".flow/overrides/rules/b.yml": "kind: configure\ntarget: gate\nvalues:\n  retries: 2\n",
    ".flow/overrides/rules/c.yml": `kind: replace\ntarget: rules/worktrees.md\nfile: rules/ours.txt\n${GOVERNED}`,
    ".flow/overrides/rules/ours.txt": "Ours.\n",
    ".flow/overrides/agents/d.yml": `kind: disable\ntarget: .agents/agents/ci-steward.md\n${GOVERNED}`,
  });
  const { overrides, problems } = loadOverrides(root);
  assert.deepEqual(problems, []);
  assert.deepEqual(
    overrides.map((o) => [o.path, o.surface, o.id, o.kind, o.target]),
    [
      [".flow/overrides/agents/d.yml", "agents", "d", "disable", ".agents/agents/ci-steward.md"],
      [".flow/overrides/rules/a.yml", "rules", "a", "extend", ".agents/rules/worktrees.md"],
      [".flow/overrides/rules/b.yml", "rules", "b", "configure", "gate"],
      [".flow/overrides/rules/c.yml", "rules", "c", "replace", "rules/worktrees.md"],
    ],
  );
  assert.deepEqual(overrides[2].values, { retries: 2 });
  assert.equal(overrides[3].review, "2027-01-31");
});

test("loadOverrides: replace and disable need reason, owner and review; each bad file is a problem, never a throw", (t) => {
  const root = repo(t, {
    ".flow/overrides/a/no-reason.yml": "kind: disable\ntarget: x\nowner: o\nreview: 2027-01-31\n",
    ".flow/overrides/a/bare.yml": "kind: replace\ntarget: x\nfile: f.md\n",
    ".flow/overrides/a/bad-date.yml":
      "kind: disable\ntarget: x\nreason: r\nowner: o\nreview: 2027-02-30\n",
    ".flow/overrides/a/kind.yml": "kind: remove\ntarget: x\n",
    ".flow/overrides/a/empty.yml": "kind: extend\ntarget: x\n",
    ".flow/overrides/a/both.yml": "kind: extend\ntarget: x\nitems:\n  - a\ntext: b\n",
    ".flow/overrides/a/yaml.yml": "kind: [extend\n",
    ".flow/overrides/a/outside.yml": `kind: replace\ntarget: x\nfile: ../../flow.config.json\n${GOVERNED}`,
    ".flow/overrides/a/template.yml": `kind: replace\ntarget: templates/plan-template.md\nfile: a/plan.md\n${GOVERNED}`,
    ".flow/overrides/a/plan.md": "Ours.\n",
    ".flow/overrides/top.yml": "kind: extend\ntarget: x\ntext: y\n",
  });
  const { overrides, problems } = loadOverrides(root);
  assert.deepEqual(overrides, []);
  const at = (/** @type {string} */ f) => `.flow/overrides/${f}`;
  assert.deepEqual(problems, [
    `${at("a/bad-date.yml")}: review: 2027-02-30 is not a date`,
    `${at("a/bare.yml")}: reason: is required`,
    `${at("a/bare.yml")}: owner: is required`,
    `${at("a/bare.yml")}: review: is required`,
    `${at("a/bare.yml")}: file: .flow/overrides/f.md does not exist`,
    `${at("a/both.yml")}: extend: takes \`items\` or \`text\`, not both`,
    `${at("a/empty.yml")}: extend: needs \`items\`, or \`text\` (with an optional \`section\`)`,
    `${at("a/kind.yml")}: (root).kind: must be one of extend, configure, replace, disable`,
    `${at("a/no-reason.yml")}: reason: is required`,
    `${at("a/outside.yml")}: file: ../../flow.config.json is outside .flow/overrides/`,
    `${at("a/template.yml")}: file: a template's replacement must be .flow/overrides/plan-template.md`,
    `${at("a/yaml.yml")}: line 1: a flow list that does not close`,
    `${at("top.yml")}: an override lives at .flow/overrides/<surface>/<id>.yml`,
  ]);
});

test("loadOverrides: a whole-file override no .yml names is a legacy replace of its preset source, with a warning", (t) => {
  const root = repo(t, {
    ".flow/overrides/commands/flow-plan.md": "Ours.\n",
    ".flow/overrides/agents/git-steward.md": "Ours.\n",
    ".flow/overrides/plan-template.md": "Ours.\n",
    ".flow/overrides/rules/named.md": "Ours.\n",
    ".flow/overrides/rules/r.yml": `kind: replace\ntarget: rules/worktrees.md\nfile: rules/named.md\n${GOVERNED}`,
    ".flow/overrides/notes/readme.md": "Not an override.\n",
  });
  const { overrides, problems } = loadOverrides(root);
  assert.deepEqual(problems, []);
  assert.deepEqual(
    overrides.filter((o) => o.legacy).map((o) => [o.target, o.file]),
    [
      ["agents/git-steward.md", "agents/git-steward.md"],
      ["commands/flow-plan.md", "commands/flow-plan.md"],
      ["templates/plan-template.md", "plan-template.md"],
    ],
  );
  const warnings = legacyWarnings(overrides);
  assert.equal(warnings.length, 3);
  assert.match(
    warnings[1],
    /^\.flow\/overrides\/commands\/flow-plan\.md is a whole-file override read as `replace` of commands\/flow-plan\.md: give it a \.yml/,
  );
});

test("applyOverrides: each kind changes only its target", (t) => {
  const root = repo(t, { ".flow/overrides/r/ours.md": "Ours.\n" });
  const files = new Map([
    ["a.md", "# A\n\n## One\n\n- first\n\n## Two\n\nTwo.\n"],
    ["b.md", "B.\n"],
    ["c.md", "C.\n"],
    ["d.md", "D.\n"],
  ]);
  const out = applyOverrides(
    files,
    [
      override({ kind: "extend", target: "a.md", section: "One", items: ["second"] }),
      override({ kind: "extend", target: "b.md", text: "More." }),
      override({ kind: "replace", target: "c.md", file: "r/ours.md" }),
      override({ kind: "disable", target: "d.md" }),
      override({ kind: "disable", target: "unknown.md" }),
      override({ kind: "configure", target: "a.md", values: { x: 1 } }),
    ],
    root,
  );
  assert.deepEqual(
    [...out],
    [
      ["a.md", "# A\n\n## One\n\n- first\n- second\n\n## Two\n\nTwo.\n"],
      ["b.md", "B.\nMore.\n"],
      ["c.md", "Ours.\n"],
    ],
  );
  assert.equal(files.size, 4, "the input is not changed");
});

test("configured: a configure override sets values in its own parameter block only", () => {
  const params = { gate: { retries: 1, box: "a" }, land: { retries: 1 } };
  assert.deepEqual(
    configured(params, [override({ kind: "configure", target: "gate", values: { retries: 3 } })]),
    { gate: { retries: 3, box: "a" }, land: { retries: 1 } },
  );
  assert.equal(params.gate.retries, 1, "the preset's blocks are not changed");
});

test("targetProblems: an unknown output, source, parameter block or parameter, and a missing section, are named", () => {
  const outputs = new Map([["a.md", "# A\n\n## One\n"]]);
  const known = { params: { gate: { retries: 1 } }, sources: new Set(["rules/worktrees.md"]) };
  const ok = [
    override({ kind: "extend", target: "a.md", section: "One", items: ["x"] }),
    override({ kind: "replace", target: "rules/worktrees.md", file: "f.md" }),
    override({ kind: "configure", target: "gate", values: { retries: 2 } }),
    override({ kind: "extend", target: "owner-only", items: ["x"] }),
    override({ kind: "replace", target: "commands/flow-x.md", file: "f.md", legacy: true }),
  ];
  assert.deepEqual(targetProblems(ok, outputs, known), []);
  assert.deepEqual(
    targetProblems(
      [
        override({ kind: "disable", target: "b.md" }),
        override({ kind: "extend", target: "a.md", section: "Two", items: ["x"] }),
        override({ kind: "replace", target: "rules/other.md", file: "f.md" }),
        override({ kind: "configure", target: "land", values: {} }),
        override({ kind: "configure", target: "gate", values: { box: "b" } }),
      ],
      outputs,
      known,
    ),
    [
      ".flow/overrides/s/x.yml: disable b.md: fflow renders no such output (`fflow diff` lists them)",
      '.flow/overrides/s/x.yml: extend a.md: it has no section "Two"',
      ".flow/overrides/s/x.yml: replace rules/other.md: the preset has no such source",
      ".flow/overrides/s/x.yml: configure land: the preset declares no such parameter block",
      ".flow/overrides/s/x.yml: configure gate: the preset declares no parameter box",
    ],
  );
});

test("reviewState: ok without a date and until 14 days before it, due from then through the day, expired after", () => {
  const now = new Date("2027-01-01T12:00:00Z");
  const on = (/** @type {string | undefined} */ review) => reviewState(override({ review }), now);
  assert.equal(on(undefined), "ok");
  assert.equal(on("2027-01-16"), "ok");
  assert.equal(on("2027-01-15"), "due");
  assert.equal(on("2027-01-01"), "due");
  assert.equal(on("2026-12-31"), "expired");
});

test("shapedBy: the overrides on an output, on its preset source, or extending the policy it holds", () => {
  const o = (/** @type {string} */ path, /** @type {Record<string, unknown>} */ f) =>
    override({ path, ...f });
  const overrides = [
    o("a", { kind: "replace", target: "commands/flow-plan.md", file: "f.md" }),
    o("b", { kind: "extend", target: ".claude/skills/flow-plan/SKILL.md", text: "x" }),
    o("c", { kind: "replace", target: "agents/git-steward.md", file: "f.md" }),
    o("d", { kind: "extend", target: "owner-only", items: ["x"] }),
  ];
  assert.deepEqual(shapedBy(overrides, ".claude/skills/flow-plan/SKILL.md"), ["a", "b"]);
  assert.deepEqual(shapedBy(overrides, ".opencode/commands/flow-plan.md"), ["a"]);
  assert.deepEqual(shapedBy(overrides, ".agents/agents/git-steward.md"), ["c"]);
  assert.deepEqual(shapedBy(overrides, ".github/CODEOWNERS"), ["d"]);
  assert.deepEqual(shapedBy(overrides, ".agents/skills/flow-tasks/SKILL.md"), []);
});
