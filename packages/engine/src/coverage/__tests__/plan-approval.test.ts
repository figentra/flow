/**
 * decidePlanApproval: coverage gates plan approval (criteria 20.1, 20.2, 20.4, 20.7).
 */

import { describe, expect, it } from "vitest";
import { decidePlanApproval } from "../plan-approval.js";
import { allArtifacts, artifact, DESIGN, TASKS } from "../../verify/__tests__/fixtures.js";

describe("decidePlanApproval", () => {
  it("approves a plan that covers every criterion and cites every property", () => {
    const decision = decidePlanApproval(allArtifacts());
    expect(decision.approvable).toBe(true);
    expect(decision.coverage?.examined).toEqual({ criteria: 2, properties: 2, tasks: 2 });
  });

  it("refuses a plan leaving a criterion uncovered and a property uncited, naming each", () => {
    const tasks = TASKS.replace("<!-- criteria: 1.2 --> <!-- properties: P2 -->", "");
    const decision = decidePlanApproval(allArtifacts({ tasks }));
    expect(decision).toMatchObject({
      approvable: false,
      problems: [
        "Criterion 1.2 is referenced by no task's requirements trailer",
        "Property P2 is cited by no task",
      ],
    });
  });

  it("refuses when requirements.md yields zero criteria (INCONCLUSIVE)", () => {
    const decision = decidePlanApproval(allArtifacts({ requirements: "# Requirements\n\nNone yet.\n" }));
    expect(decision).toMatchObject({
      approvable: false,
      problems: ["requirements.md yields zero criteria; coverage is INCONCLUSIVE"],
    });
  });

  it("refuses when an artifact the coverage needs is missing, naming it", () => {
    const decision = decidePlanApproval([artifact("design", DESIGN), artifact("tasks", TASKS)]);
    expect(decision).toEqual({
      approvable: false,
      problems: ["requirements.md is missing, so the plan's coverage cannot be evaluated"],
      coverage: null,
    });
  });

  it("reads trailers a formatter wrapped onto continuation lines (prettier --prose-wrap always)", () => {
    const tasks = [
      "# Tasks",
      "",
      "- [ ] 1 Build the first thing, described at a length that a formatter",
      "      wraps with a hanging indent _Requirements:",
      "      1.1_ _Properties: 1_",
      "- [x] 2 Build the second thing",
      "      <!-- criteria: 1.2 --> <!-- properties: P2 -->",
      "",
    ].join("\n");
    const decision = decidePlanApproval(allArtifacts({ tasks }));
    expect(decision.approvable).toBe(true);
    expect(decision.coverage?.examined).toEqual({ criteria: 2, properties: 2, tasks: 2 });
  });

  it("reads the Kiro IDE's nested trailer bullets under each task", () => {
    const tasks = [
      "# Tasks",
      "",
      "- [ ] 1. Build the first thing",
      "  - Write the module",
      "  - _Requirements: 1.1_",
      "  - _Properties: 1_",
      "",
      "- [ ] 2. Build the second thing",
      "  - _Requirements: 1.2_",
      "  - _Properties: 2_",
      "",
    ].join("\n");
    const decision = decidePlanApproval(allArtifacts({ tasks }));
    expect(decision.approvable).toBe(true);
    expect(decision.coverage?.criteria.map((c) => [c.id, c.coveredBy])).toEqual([
      ["1.1", ["1"]],
      ["1.2", ["2"]],
    ]);
  });

  it("still refuses a wrapped or nested plan whose trailer does not name a criterion", () => {
    const tasks = [
      "# Tasks",
      "",
      "- [ ] 1. Build the first thing _Requirements: 1.1_",
      "  _Properties: 1, 2_",
      "- [ ] 2. Build the second thing",
      "  - A detail that mentions 1.2 but is no trailer",
      "",
    ].join("\n");
    expect(decidePlanApproval(allArtifacts({ tasks }))).toMatchObject({
      approvable: false,
      problems: ["Criterion 1.2 is referenced by no task's requirements trailer"],
    });
  });
});
