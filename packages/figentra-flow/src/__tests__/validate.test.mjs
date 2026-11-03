/**
 * Figentra Flow file contract:
 * Purpose: hold `fflow validate` to STA-1945 FR-1: it writes nothing; a valid config passes; it names each field that
 *   breaks the schema, invalid JSON, and a missing config.
 * Boundary: temporary folders; no process, no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945.
 */
// @covers sta-1945:FR-1 sta-1945:AC-1 sta-1945:P-001
import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
