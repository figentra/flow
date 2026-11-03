/**
 * Figentra Flow file contract:
 * Purpose: hold scope drift (STA-1945 FR-30) to its contract: a changed file no live task names, by its path or a
 *   folder ending in `/`, is drift; tests, changesets and lockfiles never are; a struck task names nothing.
 * Boundary: pure; no file, git or network access; node:test and node:assert.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945 FR-30.
 */
// FR-30's scope part only, so FR-30 and P-034 are not claimed until contract drift (T047) and edited approvals (T048) land.
// @covers sta-1945:AC-32
import { test } from "node:test";
import assert from "node:assert/strict";

import { scopeDrift } from "../lib/scope-drift.mjs";

const task = (/** @type {string[]} */ paths, struck = false) => ({ paths, struck });

test("scope drift: files no live task names, by path or folder", () => {
  const tasks = [task(["src/a.mjs", "docs/"]), task(["src/gone.mjs"], true)];
  assert.deepEqual(
    scopeDrift(["src/a.mjs", "docs/guide/x.md", "src/b.mjs", "src/gone.mjs", "docsx/y.md"], tasks),
    ["src/b.mjs", "src/gone.mjs", "docsx/y.md"],
  );
  assert.deepEqual(scopeDrift([], tasks), []);
});

test("scope drift: tests, changesets and lockfiles are always in scope", () => {
  assert.deepEqual(
    scopeDrift(
      [
        "src/__tests__/a.test.mjs",
        "lib/b.spec.ts",
        ".changeset/brave-fox.md",
        "pnpm-lock.yaml",
        "packages/x/package-lock.json",
        "go.sum",
        ".changeset/config.json",
      ],
      [],
    ),
    [".changeset/config.json"],
  );
});
