/**
 * Figentra Flow file contract:
 * Purpose: hold the mandatory policies (STA-1945 FR-5) to their contract: no override disables, replaces or
 *   configures one, on its id or on an output it lives in, and each refusal names the policy; an `extend` that adds
 *   rules is accepted and one that drops a preset rule, or extends a policy as text, is refused; `tightensOnly` holds
 *   exactly when every preset rule is kept.
 * Boundary: pure; no file, no process, no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945.
 */
// @covers sta-1945:FR-5 sta-1945:AC-5 sta-1945:P-008
import { test } from "node:test";
import assert from "node:assert/strict";

import { OWNER_ONLY } from "../lib/owner-only.mjs";
import {
  extended,
  MANDATORY,
  policyOf,
  policyProblems,
  PRESET_RULES,
  tightensOnly,
} from "../lib/policies.mjs";

/**
 * An override at `.flow/overrides/p/x.yml`.
 * @param {Record<string, unknown>} fields
 * @returns {import("../lib/overrides.mjs").Override}
 */
const override = (fields) =>
  /** @type {any} */ ({ id: "x", surface: "p", path: ".flow/overrides/p/x.yml", ...fields });

test("policies: the four mandatory policies; the owner-only rules are the owner-only list", () => {
  assert.deepEqual(MANDATORY, ["guard.secrets", "guard.tenancy", "owner-only", "guard.wiring"]);
  assert.equal(PRESET_RULES["owner-only"], OWNER_ONLY);
  assert.equal(policyOf(".github/CODEOWNERS"), "owner-only");
  assert.equal(policyOf(".claude/settings.json"), "guard.wiring");
  assert.equal(policyOf("guard.secrets"), "guard.secrets");
  assert.equal(policyOf(".agents/rules/worktrees.md"), undefined);
});

test("policyProblems: disable, replace and configure of a policy or its output are refused, naming the policy", () => {
  const found = policyProblems([
    override({ kind: "disable", target: "guard.secrets" }),
    override({ kind: "replace", target: ".github/CODEOWNERS", file: "f" }),
    override({ kind: "configure", target: "guard.tenancy", values: {} }),
    override({ kind: "disable", target: ".claude/settings.json" }),
    override({ kind: "disable", target: ".agents/rules/worktrees.md" }),
  ]);
  assert.deepEqual(found, [
    ".flow/overrides/p/x.yml: disable guard.secrets is refused: the mandatory policy guard.secrets cannot be disabled (only an `extend` of `guard.secrets` that adds `items` may change it)",
    ".flow/overrides/p/x.yml: replace .github/CODEOWNERS is refused: the mandatory policy owner-only cannot be replaced (only an `extend` of `owner-only` that adds `items` may change it)",
    ".flow/overrides/p/x.yml: configure guard.tenancy is refused: the mandatory policy guard.tenancy cannot be configured (only an `extend` of `guard.tenancy` that adds `items` may change it)",
    ".flow/overrides/p/x.yml: disable .claude/settings.json is refused: the mandatory policy guard.wiring cannot be disabled (no override may change it)",
  ]);
});

test("policyProblems: an extend that keeps every preset rule is accepted; one that loosens or edits text is refused", () => {
  const rules = { "owner-only": ["a/**", "b/**"] };
  assert.deepEqual(
    policyProblems([override({ kind: "extend", target: "owner-only", items: ["c/**"] })], rules),
    [],
  );
  assert.deepEqual(
    policyProblems(
      [
        override({ kind: "extend", target: "owner-only", items: ["c/**", "!a/**"] }),
        override({ kind: "extend", target: ".github/CODEOWNERS", text: "* @someone" }),
        override({ kind: "extend", target: "guard.wiring", items: ["x"] }),
      ],
      rules,
    ),
    [
      ".flow/overrides/p/x.yml: extend owner-only is refused: the mandatory policy owner-only would lose a/**; an extend may only tighten it",
      ".flow/overrides/p/x.yml: extend .github/CODEOWNERS is refused: the mandatory policy owner-only cannot be extended as text (only an `extend` of `owner-only` that adds `items` may change it)",
      ".flow/overrides/p/x.yml: extend guard.wiring is refused: the mandatory policy guard.wiring cannot be extended as text (no override may change it)",
    ],
  );
  assert.match(
    policyProblems([
      override({ kind: "extend", target: "owner-only", items: [`!${OWNER_ONLY[0]}`] }),
    ]).join(),
    /would lose \.github\/workflows\/\*\*/,
    "the preset's rules are the default",
  );
});

test("tightensOnly and extended: a superset tightens; dropping any rule does not", () => {
  assert.equal(tightensOnly(["a", "b"], ["b", "a", "c"]), true);
  assert.equal(tightensOnly(["a", "b"], ["a"]), false);
  assert.equal(tightensOnly([], []), true);
  assert.deepEqual(extended(["a", "b"], ["c", "a", "!b"]), ["a", "c"]);
});
