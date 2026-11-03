/**
 * Figentra Flow file contract:
 * Purpose: hold `parseTasks` to STA-1945 FR-23 and FR-25: the four markers (`[ ]` not started, `[~]` queued, `[-]` in
 *   progress, `[x]` done), an optional task (`T012*`) and a checkpoint (`Checkpoint: <command>`), struck or keyed.
 * Boundary: pure function; node:test and node:assert.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945 FR-23, FR-25.
 */
// @covers sta-1945:FR-23 sta-1945:FR-25 sta-1945:AC-27 sta-1945:P-028 sta-1945:P-030
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseTasks } from "../lib/spec-parse.mjs";

test("parseTasks reads the four markers; only [x] is done", () => {
  const tasks = parseTasks(
    "## Phase 1\n- [ ] T001 a\n- [~] T002 b\n- [-] T003 c\n- [x] T004 d\n- [X] T005 e\n- [?] T006 f\n",
  );
  assert.deepEqual(
    tasks.map((t) => [t.id, t.marker, t.done]),
    [
      ["T001", " ", false],
      ["T002", "~", false],
      ["T003", "-", false],
      ["T004", "x", true],
      ["T005", "x", true],
    ],
  );
});

test("parseTasks reads an optional task, struck or not", () => {
  const [opt, struck, plain] = parseTasks(
    "- [ ] T012* [P] Polish in `a.mjs` — covers: FR-001\n- [ ] ~~T013*~~ gone\n- [ ] T014 Do — covers: FR-002\n",
  );
  assert.deepEqual(
    [opt.id, opt.optional, opt.parallel, opt.paths, opt.covers],
    ["T012", true, true, ["a.mjs"], ["FR-001"]],
  );
  assert.deepEqual([struck.id, struck.optional, struck.struck], ["T013", true, true]);
  assert.deepEqual([plain.optional, plain.checkpoint], [false, undefined]);
});

test("parseTasks reads a checkpoint's command, which is not a path", () => {
  const [a, b, c] = parseTasks(
    [
      "## Phase 2",
      "- [ ] T020 Checkpoint: `pnpm verify` [STA-9]",
      "- [x] T021 Checkpoint: node --test — deps: T020",
      "- [ ] T022 Checkpoint:",
    ].join("\n"),
  );
  assert.deepEqual(
    [a.checkpoint, a.paths, a.key, a.phase, a.done],
    ["pnpm verify", [], "STA-9", "Phase 2", false],
  );
  assert.deepEqual([b.checkpoint, b.deps, b.done], ["node --test", ["T020"], true]);
  assert.equal(c.checkpoint, "");
});
