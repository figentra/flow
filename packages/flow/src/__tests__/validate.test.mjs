/**
 * Figentra Flow file contract:
 * Purpose: hold `fflow validate` to STA-1945 FR-1: it writes nothing; a valid config passes; it names each field that
 *   breaks the schema, invalid JSON, and a missing config; it refuses an invalid override, one on an unknown target,
 *   and one that breaks a mandatory policy, naming it (FR-4, FR-5).
 * Boundary: temporary folders; no process, no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945.
 */
// @covers sta-1945:FR-1 sta-1945:AC-1 sta-1945:P-001
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { report, validateRepo } from "../commands/validate.mjs";
import { governed, snapshot } from "./__fixtures__/governed.mjs";

/**
 * `validateRepo` of `root`, after proving it wrote nothing.
 * @param {string} root
 */
const problems = (root) => {
  const before = snapshot(root);
  const found = validateRepo(root).problems;
  assert.deepEqual(snapshot(root), before, "validate writes nothing");
  return found;
};

test("validate: a valid config passes; each field that breaks the schema is named", (t) => {
  const root = governed(t);
  assert.deepEqual(problems(root), []);
  assert.deepEqual(report(root, [], { log: () => {}, quiet: false }), { code: 0, line: "valid" });
  writeFileSync(
    join(root, "flow.config.json"),
    JSON.stringify({ version: 2, specs: { dirr: "x" }, clean: { budget: 0 } }),
  );
  assert.deepEqual(problems(root), [
    "flow.config.json: version: must be 1",
    "flow.config.json: specs.dirr: is not a known key",
    "flow.config.json: clean.budget: must be at least 1",
  ]);
  assert.equal(report(root, [], { log: () => {}, quiet: false }).code, 1);
  writeFileSync(join(root, "flow.config.json"), "{");
  assert.match(problems(root).join(), /flow\.config\.json: not valid JSON/);
  rmSync(join(root, "flow.config.json"));
  assert.deepEqual(problems(root), ["no flow.config.json (run `fflow init`)"]);
});

/**
 * Writes `files` under the repository's `.flow/overrides/`.
 * @param {string} root
 * @param {Record<string, string>} files
 */
function overrides(root, files) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, ".flow/overrides", path)), { recursive: true });
    writeFileSync(join(root, ".flow/overrides", path), text);
  }
}

// @covers sta-1945:FR-4 sta-1945:AC-4 sta-1945:P-007
test("validate: refuses a replace or disable without reason, owner or review, and an unknown target; warns on a whole-file override", (t) => {
  const root = governed(t);
  overrides(root, {
    "agents/ci.yml": "kind: disable\ntarget: .agents/agents/ci-steward.md\nowner: o\n",
    "rules/nowhere.yml": "kind: extend\ntarget: .agents/rules/nowhere.md\ntext: x\n",
    "commands/flow-plan.md": "Ours.\n",
  });
  assert.deepEqual(problems(root), [
    ".flow/overrides/agents/ci.yml: reason: is required",
    ".flow/overrides/agents/ci.yml: review: is required",
    ".flow/overrides/rules/nowhere.yml: extend .agents/rules/nowhere.md: fflow renders no such output (`fflow diff` lists them)",
  ]);
  assert.match(
    validateRepo(root).warnings.join(),
    /commands\/flow-plan\.md is a whole-file override read as `replace`/,
  );
  overrides(root, {
    "agents/ci.yml":
      "kind: disable\ntarget: .agents/agents/ci-steward.md\nowner: o\nreason: r\nreview: 2027-01-31\n",
    "rules/nowhere.yml": "kind: extend\ntarget: .agents/rules/worktrees.md\ntext: x\n",
  });
  assert.deepEqual(problems(root), []);
});

// @covers sta-1945:FR-5 sta-1945:AC-5 sta-1945:P-008
test("validate: refuses an override that disables, replaces or loosens a mandatory policy, naming it; accepts one that tightens", (t) => {
  const root = governed(t);
  overrides(root, {
    "policies/more.yml": 'kind: extend\ntarget: owner-only\nitems:\n  - "deploy/**"\n',
  });
  assert.deepEqual(problems(root), []);
  overrides(root, {
    "policies/less.yml": 'kind: extend\ntarget: owner-only\nitems:\n  - "!**/.env*"\n',
    "policies/off.yml":
      "kind: disable\ntarget: guard.secrets\nreason: r\nowner: o\nreview: 2027-01-31\n",
  });
  const found = problems(root).join("\n");
  assert.match(
    found,
    /policies\/less\.yml: extend owner-only is refused: the mandatory policy owner-only cannot drop a rule \(!\*\*\/\.env\*\)/,
  );
  assert.match(
    found,
    /policies\/off\.yml: disable guard\.secrets is refused: the mandatory policy guard\.secrets cannot be disabled/,
  );
  assert.equal(report(root, [], { log: () => {}, quiet: false }).code, 1);
});
