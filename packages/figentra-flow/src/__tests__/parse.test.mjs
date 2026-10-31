/**
 * Figentra Flow file contract:
 * Purpose: hold `figentra-flow parse`'s choice of parser by file name to its contract.
 * Boundary: pure function; node:test and node:assert.
 * Runtime: node
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../commands/parse.mjs";

test("parse picks the parser from the file name", () => {
  assert.deepEqual(parse("tasks.md", "## Phase 1\n- [x] T001 Do — covers: FR-001\n")[0], {
    line: 2,
    id: "T001",
    done: true,
    struck: false,
    parallel: false,
    covers: ["FR-001"],
    route: undefined,
    deps: [],
    paths: [],
    key: undefined,
    phase: "Phase 1",
  });
  assert.deepEqual(parse("plan.md", "- **P-001**: x — Validates: FR-001, FR-002\n"), {
    "P-001": ["FR-001", "FR-002"],
  });
  assert.deepEqual(parse("routing.yaml", "tasks:\n  spec-task:\n    x: 1\n"), ["spec-task"]);
  assert.deepEqual(parse("spec.md", "- **FR-001**: a\n- ~~**FR-002**~~: b\n").FR, {
    live: ["FR-001"],
    struck: ["FR-002"],
  });
});
