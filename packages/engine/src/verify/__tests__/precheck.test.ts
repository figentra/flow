/**
 * preExecutionCheck verifies approvals against the current checksums, and
 * that the task exists and its references resolve (criterion 18).
 */

import { describe, expect, it } from "vitest";
import { computeChecksum } from "@vellum/protocol";
import { checkTaskBinding, preExecutionCheck } from "../precheck.js";
import {
  allArtifacts,
  approvalEntry,
  approvals,
  artifact,
  BODIES,
  chain,
  commits,
  policyFor,
  REQUIREMENTS,
  TASKS,
} from "./fixtures.js";

const context = { policy: policyFor("standard"), riskClass: "standard" as const, gitCommits: commits };

describe("preExecutionCheck", () => {
  it("passes an approved spec and binds the computed checksums", () => {
    const artifacts = allArtifacts().map((a) => artifact(a.kind, a.body, "f".repeat(64)));

    const result = preExecutionCheck(artifacts, approvals(), "1", context);

    expect(result.errors).toEqual([]);
    expect(result.passed).toBe(true);
    // The frontmatter claims "fff…"; the binding records what the body hashes to.
    expect(result.taskBinding?.requirementsChecksum).toBe(computeChecksum(BODIES.requirements));
    expect(result.taskBinding?.designChecksum).toBe(computeChecksum(BODIES.design));
    expect(result.taskBinding?.planChecksum).toBe(computeChecksum(BODIES.tasks));
  });

  it("refuses when requirements changed after approval, naming both checksums", () => {
    const edited = REQUIREMENTS.replace("A folder", "A file");

    const result = preExecutionCheck(allArtifacts({ requirements: edited }), approvals(), "1", context);

    expect(result.passed).toBe(false);
    // Criterion 8.6: the design and plan approvals given before the amendment are void too
    const was = computeChecksum(REQUIREMENTS);
    const now = computeChecksum(edited);
    expect(result.errors).toEqual([
      `Requirements approval invalidated: approved checksum ${was}, current checksum ${now}`,
      `Design approval invalidated: SUPERSEDED_BY_UPSTREAM_AMENDMENT — design.md was approved while requirements.md was at ${was}; requirements.md has since been amended to ${now}`,
      `Tasks approval invalidated: SUPERSEDED_BY_UPSTREAM_AMENDMENT — tasks.md was approved while requirements.md was at ${was}; requirements.md has since been amended to ${now}`,
    ]);
  });

  it("does not count an approval from an identity the policy does not authorise", () => {
    const ledger = chain([
      approvalEntry(1, "requirements", BODIES.requirements, "mallory@example.com"),
      ...approvals().slice(1),
    ]);

    const result = preExecutionCheck(allArtifacts(), ledger, "1", context);

    expect(result.passed).toBe(false);
    expect(result.errors).toEqual(["Requirements not approved: 0 of 1 required valid approvals"]);
  });

  it("refuses a task that tasks.md does not contain", () => {
    const result = preExecutionCheck(allArtifacts(), approvals(), "9", context);

    expect(result.errors).toEqual(["Task 9 not found in tasks.md"]);
  });

  it("refuses a parent task, naming its sub-tasks", () => {
    const nested = `# Tasks

- [ ] 1. Build it
  - [ ] 1.1 Build the first thing <!-- criteria: 1.1 --> <!-- properties: P1 -->
  - [ ] 1.2 Build the second thing <!-- criteria: 1.2 --> <!-- properties: P2 -->
- [ ] 2. Checkpoint: ensure all tests pass
`;
    const ledger = chain([...approvals().slice(0, 2), approvalEntry(3, "tasks", nested)]);
    const artifacts = allArtifacts({ tasks: nested });

    expect(preExecutionCheck(artifacts, ledger, "1", context).errors).toEqual([
      "Task 1 is a parent task; start one of its sub-tasks instead (1.1, 1.2)",
    ]);
    expect(preExecutionCheck(artifacts, ledger, "1.1", context).passed).toBe(true);
    expect(preExecutionCheck(artifacts, ledger, "2", context).passed).toBe(true);
  });

  it("refuses a task citing a criterion or property that is not defined", () => {
    const dangling = TASKS.replace("<!-- criteria: 1.1 -->", "<!-- criteria: 1.1, 7.3 -->").replace(
      "<!-- properties: P1 -->",
      "<!-- properties: P1, P9 -->",
    );
    const ledger = chain([...approvals().slice(0, 2), approvalEntry(3, "tasks", dangling)]);

    const result = preExecutionCheck(allArtifacts({ tasks: dangling }), ledger, "1", context);

    expect(result.errors).toEqual([
      "Task 1 cites criterion 7.3, which requirements.md does not define",
      "Task 1 cites property P9, which design.md does not define",
    ]);
  });
});

describe("checkTaskBinding", () => {
  const binding = preExecutionCheck(allArtifacts(), approvals(), "1", context).taskBinding!;

  it("matches the artifacts it was made from", () => {
    expect(checkTaskBinding(binding, allArtifacts())).toEqual({ matches: true });
  });

  it("detects a body edit even when the frontmatter still claims the old checksum", () => {
    const edited = artifact(
      "requirements",
      REQUIREMENTS.replace("A folder", "A file"),
      computeChecksum(REQUIREMENTS),
    );
    const current = [edited, ...allArtifacts().slice(1)];

    expect(checkTaskBinding(binding, current)).toEqual({
      matches: false,
      mismatchedArtifact: "requirements",
    });
  });

  it("treats a missing artifact as a mismatch", () => {
    expect(checkTaskBinding(binding, allArtifacts().slice(0, 2))).toEqual({
      matches: false,
      mismatchedArtifact: "tasks",
    });
  });
});
