/**
 * Scenario 15 — parent-task markers (decision 15 in 002's design). A parent
 * is `[-]` once any sub-task starts. A parent with at least one required
 * sub-task is `[x]` when its required sub-tasks are verified, its optional
 * ones done or not. A parent whose sub-tasks are all optional is `[x]` only
 * when every one of them is verified. Markers are outside the Artifact
 * Checksum, so the plan approval still counts throughout.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveAll } from "./support/lifecycle.js";
import { TestRepo } from "./support/repo.js";
import { DESIGN, PASSING_COMMAND, REQUIREMENTS, SLUG, TASKS } from "./support/spec.js";

/** The fixture plan plus an optional sub-task under parent 3 and an all-optional parent 4. */
const WITH_EXTRAS = TASKS.replace(
  "**Total leaf tasks:** 5 · **Optional leaf tasks:** 0 · **Waves:** 4",
  "**Total leaf tasks:** 8 · **Optional leaf tasks:** 3 · **Waves:** 5",
)
  .replace(
    "_Requirements: 2.1_ _Properties: 3_\n",
    "_Requirements: 2.1_ _Properties: 3_\n  - [ ]* 3.3 Document the farewell option in src/greet.mjs _Requirements: 2.1_\n\n- [ ] 4. Extras\n  - [ ]* 4.1 Document greet() in src/greet.mjs _Requirements: 1.1_\n  - [ ]* 4.2 Document the empty-name refusal in src/greet.mjs _Requirements: 1.2_\n",
  )
  .replace(
    '{ "id": 3, "tasks": ["3.2"] }',
    '{ "id": 3, "tasks": ["3.2"] },\n    { "id": 4, "tasks": ["3.3", "4.1", "4.2"] }',
  );

describe("scenario 15: parent markers for required and all-optional parents", () => {
  let repo: TestRepo;
  const run = (id: string) => {
    const start = repo.vellum(["task", "start", SLUG, id]);
    expect(start.stderr).toBe("");
    expect(start.status).toBe(0);
    const complete = repo.vellum(["task", "complete", SLUG, id, "--command", PASSING_COMMAND]);
    expect(complete.status).toBe(0);
    return { start, complete };
  };

  beforeAll(() => {
    expect(WITH_EXTRAS).toContain("- [ ] 4. Extras");
    expect(WITH_EXTRAS).toContain('"3.3", "4.1", "4.2"');
    repo = TestRepo.create();
    repo.writeSpec({ requirements: REQUIREMENTS, design: DESIGN, tasks: WITH_EXTRAS });
    repo.commitAll(`docs: spec ${SLUG} with optional extras`);
    approveAll(repo);
  });
  afterAll(() => repo?.dispose());

  it("a parent with required sub-tasks is [x] once they are verified, its optional sub-task undone", () => {
    const first = run("3.1");
    expect(first.start.stdout).toContain("parent 3 marked [-] too");
    expect(repo.marker("3")).toBe("-");
    const last = run("3.2");
    expect(last.complete.stdout).toContain("every required sub-task of task 3 is verified");
    expect([repo.marker("3"), repo.marker("3.3")]).toEqual(["x", " "]);
  });

  it("an all-optional parent stays [-] until every optional sub-task is verified, then is [x]", () => {
    expect(repo.marker("4")).toBe(" ");
    const first = run("4.1");
    expect(first.start.stdout).toContain("parent 4 marked [-] too");
    expect(first.complete.stdout).not.toContain("task 4");
    expect([repo.marker("4"), repo.marker("4.1"), repo.marker("4.2")]).toEqual(["-", "x", " "]);

    const last = run("4.2");
    expect(last.complete.stdout).toContain("every sub-task of task 4 is verified (all are optional)");
    expect([repo.marker("4"), repo.marker("4.2")]).toEqual(["x", "x"]);
  });

  it("the marker changes leave the plan approval valid: verify passes once the required tasks are done", () => {
    for (const id of ["1.1", "1.2", "1.3", "2"]) run(id);
    repo.commitAll(`chore: record ${SLUG} evidence`);
    const verify = repo.vellum(["verify", SLUG, "--strict", "--json"]);
    expect(JSON.parse(verify.stdout).specs[0].findings).toEqual([]);
    expect(verify.status).toBe(0);
    expect(repo.marker("1")).toBe("x");
  });
});
