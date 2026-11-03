/**
 * Figentra Flow file contract:
 * Purpose: hold `fflow plan` to STA-1945 FR-15: `--input` refuses a spec that is not approved for planning (or small)
 *   and hands the workflow the FRs, ACs, documents and size budget; `--record` writes tasks.md and records the plan
 *   stage only when `gate tasks` passes, every FR and AC is covered and each task holds its budget, naming each
 *   problem and writing nothing otherwise.
 * Boundary: temporary repositories with a local bare origin; no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945 FR-15, AC-21, P-020.
 */
// @covers sta-1945:FR-15 sta-1945:AC-21 sta-1945:P-020
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  DEFAULT_BUDGET,
  planInput,
  PlanError,
  recordPlan,
  run,
  taskFiles,
} from "../commands/plan.mjs";
import { readRecord, RecordError, recordPath } from "../lib/record.mjs";
import { parseTasks } from "../lib/spec-parse.mjs";
import { repo } from "./__fixtures__/repo.mjs";

const DIR = ".agents/specs/sta-7-x";

/** A clarified, keyed spec at `status`, with one FR and two ACs. */
const spec = (
  /** @type {string} */ status,
  /** @type {string} */ head = "",
  /** @type {string} */ clarified = "**Clarifications status**: complete\n",
) =>
  `# x\n\n**Status**: ${status}\n**Linear**: STA-7\n${clarified}${head}\n## Requirements\n\n` +
  `- **FR-001**: WHEN a THE b SHALL c.\n\n` +
  `## Acceptance criteria\n\n- **AC-001**: WHEN a THE b SHALL c.\n- **AC-002**: WHEN d THE e SHALL f.\n`;

const TASKS = `# Tasks

## Phase 1

- [ ] T001 Do it in \`a.mjs\` — covers: FR-001, AC-001
- [ ] T002 Then this in \`b.mjs\` — covers: AC-002 — deps: T001
`;

/** A repository whose STA-7 spec is `text`. */
function setup(t, /** @type {string} */ text) {
  const r = repo();
  t.after(r.dispose);
  mkdirSync(join(r.root, DIR), { recursive: true });
  writeFileSync(join(r.root, DIR, "spec.md"), text);
  writeFileSync(join(r.root, DIR, "plan.md"), "# plan\n");
  return r.root;
}

test("plan --input: the FRs, ACs, documents and budget of an approved spec; a draft, an unapproved big or a small spec is refused", (t) => {
  const root = setup(t, spec("Planned"));
  assert.deepEqual(planInput(root, "STA-7"), {
    frs: ["FR-001"],
    acs: ["AC-001", "AC-002"],
    files: [`${DIR}/spec.md`, `${DIR}/plan.md`],
    budget: DEFAULT_BUDGET,
  });
  assert.throws(() => planInput(setup(t, spec("Draft")), "STA-7"), /the spec is draft/);
  assert.throws(
    () => planInput(setup(t, spec("Clarified", "**Tier**: big\n**Approver**: owner\n")), "STA-7"),
    /needs the Clarified approval of a big spec/,
  );
  assert.throws(
    () => planInput(setup(t, spec("Clarified", "**Tier**: feature\n")), "STA-7"),
    /a feature spec names its `\*\*Approver\*\*`/,
    "the gate's own approval check, for the status planning moves the spec to",
  );
  assert.ok(
    planInput(setup(t, spec("Clarified", "**Tier**: feature\n**Approver**: owner\n")), "STA-7"),
  );
  assert.throws(
    () => planInput(setup(t, spec("Clarified", "", "")), "STA-7"),
    /`\*\*Clarifications status\*\*` is not `complete`/,
    "the gate's checkSpec",
  );
  assert.throws(
    () => planInput(setup(t, spec("Planned", "**Tier**: small\n")), "STA-7"),
    /small spec/,
  );
  assert.throws(() => planInput(root, "STA-9"), PlanError);
});

test("plan --record: tasks covering every FR and AC within the budget are written and the stage recorded", (t) => {
  const root = setup(t, spec("Planned"));
  assert.deepEqual(recordPlan(root, "STA-7", TASKS), []);
  assert.equal(readFileSync(join(root, DIR, "tasks.md"), "utf8"), TASKS);
  const record = readRecord(root, "sta-7");
  assert.equal(record?.stage, "plan");
  assert.equal(record?.state, "done");
});

test("plan --record: an uncovered AC, an unknown id, a task over budget or an unapproved feature spec is refused, and nothing is written", (t) => {
  const root = setup(t, spec("Planned"));
  const uncovered = TASKS.replace(" — covers: AC-002", " — covers: FR-001");
  assert.match(recordPlan(root, "STA-7", uncovered).join("\n"), /AC-002 is covered by no task/);
  assert.match(
    recordPlan(root, "STA-7", TASKS.replace("AC-002", "AC-009")).join("\n"),
    /covers AC-009, which spec\.md and plan\.md do not define/,
  );
  const files = Array.from({ length: DEFAULT_BUDGET + 1 }, (_, i) => `\`src/f${i}.mjs\``).join(
    ", ",
  );
  assert.match(
    recordPlan(root, "STA-7", TASKS.replace("in `a.mjs`", `in ${files}`)).join("\n"),
    new RegExp(`T001 names ${DEFAULT_BUDGET + 1} files, over the budget of ${DEFAULT_BUDGET}`),
  );
  assert.match(recordPlan(root, "STA-7", "# Tasks\n").join(), /no `- \[ \] T###` task lines/);
  assert.ok(!existsSync(join(root, DIR, "tasks.md")), "a refused plan writes no tasks.md");
  assert.equal(readRecord(root, "sta-7"), undefined, "nor the record");
  const feature = setup(t, spec("Planned", "**Tier**: feature\n**Approver**: owner\n"));
  assert.match(
    recordPlan(feature, "STA-7", TASKS).join(),
    /needs the Planned approval of a feature spec/,
  );
  assert.match(
    recordPlan(setup(t, spec("Clarified")), "STA-7", TASKS).join(),
    /the spec is clarified/,
  );
});

test("plan --record: a tasks.md that carries issue keys or progress is not replaced", (t) => {
  const root = setup(t, spec("Tasked"));
  for (const kept of [
    TASKS.replace("deps: T001", "deps: T001 [STA-8]"),
    TASKS.replace("- [ ] T001", "- [x] T001"),
  ]) {
    writeFileSync(join(root, DIR, "tasks.md"), kept);
    assert.match(
      recordPlan(root, "STA-7", TASKS).join(),
      /tasks\.md already carries issue keys or progress \(T00[12]\)/,
    );
    assert.equal(readFileSync(join(root, DIR, "tasks.md"), "utf8"), kept);
  }
  assert.equal(readRecord(root, "sta-7"), undefined);
});

test("plan --record: a record it cannot update refuses before tasks.md is written", (t) => {
  const root = setup(t, spec("Planned"));
  mkdirSync(dirname(recordPath(root, "sta-7")), { recursive: true });
  writeFileSync(recordPath(root, "sta-7"), "{ not json\n");
  assert.throws(() => recordPlan(root, "STA-7", TASKS), RecordError);
  assert.ok(!existsSync(join(root, DIR, "tasks.md")));
});

test("plan: usage, and a --record file that does not exist, are refused", () => {
  for (const args of [
    [],
    ["--input"],
    ["STA-7"],
    ["STA-7", "--input", "--record", "x.md"],
    ["STA-7", "--record"],
  ])
    assert.equal(run(args), 2, args.join(" "));
  assert.equal(run(["STA-7", "--record", join(tmpdir(), "fflow-no-such-tasks.md")]), 2);
});

test("plan: a task's files are its backticked paths with braces expanded, not its commands or other dotted names", () => {
  const [task] = parseTasks(
    "- [ ] T001 `fflow plan <key>` in `src/a.mjs`, `b.md` and `p/{stackra,neutral}/c.md`, " +
      "not `flow-tasks`, `fflow/gate`, `gate.shard` or `0.3.0` — covers: FR-001\n",
  );
  assert.deepEqual(taskFiles(task), ["src/a.mjs", "b.md", "p/stackra/c.md", "p/neutral/c.md"]);
});
