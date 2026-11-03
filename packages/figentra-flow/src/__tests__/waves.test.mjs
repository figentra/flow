/**
 * Figentra Flow file contract:
 * Purpose: hold the wave graph to STA-1945 FR-24 and FR-25: deps come first, no two tasks of a wave share a path, a
 *   wave holds at most five tasks, a checkpoint runs alone with nothing below it starting before it, a cycle is
 *   refused, and `nextWave` holds a wave while one of its tasks is unfinished, skipping only an optional task left
 *   `[ ]`.
 * Boundary: pure; no files.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945 FR-24, FR-25, AC-25, AC-26, P-029, P-030.
 */
// @covers sta-1945:FR-24 sta-1945:FR-25 sta-1945:AC-25 sta-1945:AC-26 sta-1945:P-029 sta-1945:P-030
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseTasks } from "../lib/spec-parse.mjs";
import { MAX_PARALLEL, nextWave, waves, WaveError } from "../lib/waves.mjs";

const TASKS = `# Tasks

## Phase 1

- [ ] T001 One in \`a.mjs\` — covers: FR-1
- [ ] T002 Two in \`b.mjs\` — covers: FR-1
- [ ] T003 Three in \`a.mjs\` — covers: FR-1
- [ ] T004 Four in \`c.mjs\` — covers: FR-1 — deps: T002
- [ ] T005 Checkpoint: \`pnpm test\`

## Phase 2

- [ ] T006* Six in \`d.mjs\` — covers: FR-1
- [ ] ~~T007 Struck in \`a.mjs\`~~ — covers: FR-1
- [ ] T008 Eight in \`e.mjs\` — covers: FR-1
`;

/** TASKS with each `id: marker` pair set. */
const marked = (/** @type {Record<string, string>} */ markers) =>
  parseTasks(
    Object.entries(markers).reduce(
      (text, [id, m]) => text.replace(new RegExp(`\\[ \\] (~~)?${id}`), `[${m}] $1${id}`),
      TASKS,
    ),
  );

test("waves: deps first, no shared path in a wave, a checkpoint alone with nothing below it before it (P-029, P-030)", () => {
  assert.deepEqual(waves(parseTasks(TASKS)), [
    ["T001", "T002"],
    ["T003", "T004"],
    ["T005"],
    ["T006", "T008"],
  ]);
});

test("waves: a wave holds at most five tasks; a cycle is refused", () => {
  const many = Array.from({ length: 7 }, (_, i) => `- [ ] T10${i} In \`f${i}.mjs\``).join("\n");
  const sizes = waves(parseTasks(many)).map((w) => w.length);
  assert.deepEqual(sizes, [MAX_PARALLEL, 2]);
  const cycle = "- [ ] T001 A in `a.mjs` — deps: T002\n- [ ] T002 B in `b.mjs` — deps: T001\n";
  assert.throws(() => waves(parseTasks(cycle)), WaveError);
  // a task above a checkpoint cannot wait for one below it
  const inverted =
    "- [ ] T001 A in `a.mjs` — deps: T003\n- [ ] T002 Checkpoint: `true`\n- [ ] T003 C in `c.mjs`\n";
  assert.throws(() => waves(parseTasks(inverted)), WaveError);
});

test("nextWave: a failed or dead task holds its wave and restarts there (AC-25, AC-26)", () => {
  assert.deepEqual(nextWave(parseTasks(TASKS)), { wave: 1, ids: ["T001", "T002"] });
  // T001 done, T002 failed (still [-]): the next wave never starts
  assert.deepEqual(nextWave(marked({ T001: "x", T002: "-" })), { wave: 1, ids: ["T002"] });
  // a dead session's queued and started tasks: the wave restarts at its first unfinished one
  assert.deepEqual(nextWave(marked({ T001: "x", T002: "x", T003: "~", T004: "-" })), {
    wave: 2,
    ids: ["T003", "T004"],
  });
  assert.deepEqual(nextWave(marked({ T001: "x", T002: "x", T003: "x", T004: "x" })), {
    wave: 3,
    ids: ["T005"],
  });
});

test("nextWave: an optional task left [ ] does not hold the build; one started does (P-030)", () => {
  const before = { T001: "x", T002: "x", T003: "x", T004: "x", T005: "x" };
  assert.deepEqual(nextWave(marked(before)), { wave: 4, ids: ["T006", "T008"] });
  assert.equal(nextWave(marked({ ...before, T008: "x" })), undefined);
  assert.deepEqual(nextWave(marked({ ...before, T006: "-", T008: "x" })), {
    wave: 4,
    ids: ["T006"],
  });
});
