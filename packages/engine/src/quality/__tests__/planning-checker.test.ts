/**
 * Tests for planning-checker.ts
 * @see requirements.md Requirement 3.1-3.8
 */

import { describe, it, expect } from "vitest";
import { parseTasks, checkPlanCoverage } from "../planning-checker";

describe("parseTasks", () => {
  it("parses simple task", () => {
    const tasksText = `
- [ ] 1. Create the file
`;

    const tasks = parseTasks(tasksText);

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ id: "1", title: "Create the file", state: "pending" });
  });

  it("parses task with Requirements trailer", () => {
    const tasksText = `
- [ ] 1. Create the file
_Requirements: 1.1, 1.2_
`;

    const tasks = parseTasks(tasksText);

    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.referenced_criteria).toEqual(["1.1", "1.2"]);
  });

  it("reads the Kiro trailers written on the task line itself", () => {
    const tasks = parseTasks(
      "  - [ ] 2.3* Property test (spec-executor) _Requirements: 2.1, 2.2_ _Properties: 2_\n",
    );
    expect(tasks[0]).toMatchObject({
      title: "Property test (spec-executor)",
      referenced_criteria: ["2.1", "2.2"],
      referenced_properties: ["2"],
      executor: "spec-executor",
    });
  });

  it("reads trailers on wrapped lines and in a nested Kiro bullet, as the protocol does", () => {
    const tasks = parseTasks(
      [
        "- [ ] 1. Parent",
        "  - [ ] 1.1 Write the parser for the whole input, wrapped by a",
        "        formatter (spec-executor) _Requirements: 1.1,",
        "        1.2_",
        "  - [ ] 1.2 Test the parser (spec-executor)",
        "    - _Requirements: 2.1_",
        "    - _Properties: 3_",
      ].join("\n"),
    );
    expect(tasks.map((t) => [t.id, t.referenced_criteria, t.referenced_properties, t.executor])).toEqual([
      ["1", undefined, undefined, undefined],
      ["1.1", ["1.1", "1.2"], undefined, "spec-executor"],
      ["1.2", ["2.1"], ["3"], "spec-executor"],
    ]);
  });

  it("marks test tasks", () => {
    const tasksText = `
- [ ] 1. Write tests for feature
`;

    const tasks = parseTasks(tasksText);

    expect(tasks[0]?.is_test).toBe(true);
  });
});

describe("checkPlanCoverage", () => {
  it("finds no issues with complete plan", () => {
    const requirements = `
### Requirement 1: Respond

#### Acceptance Criteria

1. WHEN triggered, THE System SHALL respond.
`;

    const design = `
## Correctness Properties

Property 1: Test property
**Validates: Requirements 1.1**
`;

    const tasks = `
- [ ] 1.1 Implement feature (spec-executor)
_Requirements: 1.1_

- [ ] 1.2 Write tests (spec-executor) <!-- properties: P1 -->
_Requirements: 1.1_

- [ ] 1.3 Write documentation (spec-executor)
_Requirements: 1.1_

- [ ] 1.4 Release (spec-executor)
_Requirements: 1.1_
`;

    const findings = checkPlanCoverage(requirements, design, tasks, "tasks.md");

    // May have warnings for missing migration/rollback but no errors
    const errors = findings.filter((f) => f.severity === "error");
    expect(errors).toHaveLength(0);
  });

  it("reports criterion not referenced", () => {
    const requirements = `
### Requirement 1: Respond

#### Acceptance Criteria

1. WHEN triggered, THE System SHALL respond.

2. WHEN requested, THE System SHALL process.
`;

    const design = ``;
    const tasks = `
- [ ] 1. Implement (spec-executor)
_Requirements: 1.1_
`;

    const findings = checkPlanCoverage(requirements, design, tasks, "tasks.md");

    const unreferenced = findings.filter((f) => f.rule_id === "CRITERION_NOT_REFERENCED");
    expect(unreferenced.map((f) => f.criterion_reference)).toEqual(["1.2"]);
  });

  it("reports task without executor", () => {
    const requirements = `
### Requirement 1: Respond

#### Acceptance Criteria

1. WHEN triggered, THE System SHALL respond.
`;

    const design = ``;
    const tasks = `
- [ ] 1. Do something
_Requirements: 1.1_
`;

    const findings = checkPlanCoverage(requirements, design, tasks, "tasks.md");

    expect(findings.some((f) => f.message.includes("no executor"))).toBe(true);
  });

  it("reports missing migration task", () => {
    const design = `
## Migration Strategy

Migration steps here.
`;

    const tasks = `
- [ ] 1.1 Implement feature
`;

    const findings = checkPlanCoverage("", design, tasks, "tasks.md");

    expect(findings.some((f) => f.message.includes("migration task"))).toBe(true);
  });

  it("reports missing rollback task", () => {
    const design = `
## Rollback Strategy

Rollback steps here.
`;

    const tasks = `
- [ ] 1.1 Implement feature
`;

    const findings = checkPlanCoverage("", design, tasks, "tasks.md");

    expect(findings.some((f) => f.message.includes("rollback task"))).toBe(true);
  });
});

describe("checkPlanCoverage — checks that need Policy or change context (criteria 3.4, 3.7, 3.8)", () => {
  const requirements = `
### Requirement 1: Respond

#### Acceptance Criteria

1. WHEN triggered, THE System SHALL respond.
`;
  const tasks = `
- [ ] 1.1 Implement feature (spec-executor)
_Requirements: 1.1_
`;
  const rules = (findings: { rule_id: string }[]) => findings.map((f) => f.rule_id);

  it("reports the checks it could not run instead of passing or failing them", () => {
    const findings = checkPlanCoverage(requirements, "", tasks, "tasks.md");
    const notRun = findings.filter((f) => f.rule_id === "CHECK_NOT_RUN");

    expect(notRun.map((f) => f.criterion_reference)).toEqual(["3.4", "3.7", "3.8"]);
    expect(notRun.every((f) => f.severity === "info")).toBe(true);
    expect(rules(findings)).not.toContain("MISSING_DOCUMENTATION_TASK");
    expect(rules(findings)).not.toContain("MISSING_RELEASE_TASK");
  });

  it("requires a documentation task only when the change adds a published surface", () => {
    expect(
      rules(checkPlanCoverage(requirements, "", tasks, "tasks.md", { addsPublishedSurface: true })),
    ).toContain("MISSING_DOCUMENTATION_TASK");
    expect(
      rules(
        checkPlanCoverage(requirements, "", tasks, "tasks.md", { addsPublishedSurface: false }),
      ),
    ).not.toContain("MISSING_DOCUMENTATION_TASK");
  });

  it("requires a release task only when the Policy requires a release", () => {
    expect(
      rules(checkPlanCoverage(requirements, "", tasks, "tasks.md", { releaseRequired: true })),
    ).toContain("MISSING_RELEASE_TASK");
    expect(
      rules(checkPlanCoverage(requirements, "", tasks, "tasks.md", { releaseRequired: false })),
    ).not.toContain("MISSING_RELEASE_TASK");
  });
});

describe("checkPlanCoverage — properties (criterion 3.2)", () => {
  const requirements = `
### Requirement 1: Respond

#### Acceptance Criteria

1. WHEN triggered, THE System SHALL respond.
`;
  const design = `
**Property 1: Responds**
**Validates: Requirements 1.1**
`;

  it("accepts a property cited by a test task's properties trailer", () => {
    const tasks = `
- [ ] 1.1 Write tests for the response (spec-executor) <!-- properties: P1 -->
_Requirements: 1.1_
`;
    const findings = checkPlanCoverage(requirements, design, tasks, "tasks.md");
    expect(findings.map((f) => f.rule_id)).not.toContain("PROPERTY_NO_TEST_TASK");
  });

  it("reports a property no test task cites", () => {
    const tasks = `
- [ ] 1.1 Implement the response (spec-executor) <!-- properties: P1 -->
_Requirements: 1.1_
`;
    const findings = checkPlanCoverage(requirements, design, tasks, "tasks.md");
    expect(findings.map((f) => f.rule_id)).toContain("PROPERTY_NO_TEST_TASK");
  });
});
