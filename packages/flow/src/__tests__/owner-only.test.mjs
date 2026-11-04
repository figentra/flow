/**
 * Figentra Flow file contract:
 * Purpose: hold the owner-only list to STA-1945 FR-4: a repository's overrides (`.flow/overrides/**`) are the owner's,
 *   at any depth, and the generated CODEOWNERS asks the owner for them.
 * Boundary: pure; no file, no process, no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1856; STA-1945.
 */
// @covers sta-1945:FR-4 sta-1945:AC-4 sta-1945:P-007
import { test } from "node:test";
import assert from "node:assert/strict";

import { codeowners, ownerOnlyPaths } from "../lib/owner-only.mjs";

test("owner-only: every file under .flow/overrides/ is the owner's; the rest of .flow/ is not", () => {
  assert.deepEqual(
    ownerOnlyPaths([
      ".flow/overrides/rules/worktrees.yml",
      ".flow/overrides/plan-template.md",
      ".flow/Overrides/commands/flow-plan.md",
      ".flow/constitution.md",
      ".flow/lock.json",
    ]),
    [
      ".flow/overrides/rules/worktrees.yml",
      ".flow/overrides/plan-template.md",
      ".flow/Overrides/commands/flow-plan.md",
    ],
  );
});

test("CODEOWNERS: asks the owner for .flow/overrides/", () => {
  assert.ok(codeowners("o").split("\n").includes("/.flow/overrides/** @o"));
});
