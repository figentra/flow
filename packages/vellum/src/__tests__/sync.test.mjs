/**
 * Vellum file contract:
 * Purpose: hold the order of `vellum sync`'s specify calls to their contract.
 * Boundary: pure function; never runs specify; node:test and node:assert.
 * Runtime: node
 * Governing contract: ADR 0022 (tests live in tests folders); ADR 0182 (testing strategy).
 */
// @covers sta-163:FR-001
import { test } from "node:test";
import assert from "node:assert/strict";
import { steps } from "../commands/sync.mjs";

test("installs or updates each preset from .agents/speckit, disables the workflow, renders OpenCode then Claude", () => {
  assert.deepEqual(steps(["stackra"], ["stackra"]), [
    ["preset", "update", "stackra", "--dev", ".agents/speckit/presets/stackra"],
    ["workflow", "disable", "speckit"],
    ["integration", "use", "opencode"],
    ["integration", "use", "claude"],
  ]);
  assert.deepEqual(steps(["stackra"], [])[0], [
    "preset",
    "add",
    "--dev",
    ".agents/speckit/presets/stackra",
  ]);
});

test("a repo without its own preset source syncs from the bundled one", () => {
  assert.deepEqual(steps(["stackra"], [], "/pkg/assets/presets")[0], [
    "preset",
    "add",
    "--dev",
    "/pkg/assets/presets/stackra",
  ]);
});
