/**
 * Tests for the Effective Lifecycle State (criteria 5.10-5.12, 8.3).
 */

import { describe, expect, it } from "vitest";
import type { LedgerEntry } from "@vellum/protocol";
import { computeEffectiveLifecycleState, type EffectiveStateInput } from "../effective-state";
import {
  allArtifacts,
  approvalEntry,
  approvals,
  artifact,
  chain,
  commits,
  evidenceEntry,
  policyFor,
  verifiedLedger,
  DESIGN,
  REQUIREMENTS,
  TASKS,
} from "../../verify/__tests__/fixtures";

function input(overrides: Partial<EffectiveStateInput> = {}): EffectiveStateInput {
  return {
    artifacts: allArtifacts(),
    ledger: verifiedLedger(),
    recordedState: "VERIFICATION",
    policy: policyFor("standard"),
    riskClass: "standard",
    gitCommits: commits,
    ...overrides,
  };
}

describe("computeEffectiveLifecycleState", () => {
  it("is the recorded state when every precondition up to it holds", () => {
    expect(computeEffectiveLifecycleState(input())).toEqual({
      kind: "computed",
      state: "VERIFICATION",
      failedPrecondition: null,
    });
  });

  it("falls back to IN_REVIEW, naming the approvals, when none is recorded", () => {
    const result = computeEffectiveLifecycleState(
      input({ ledger: [], recordedState: "IN_PROGRESS" }),
    );
    expect(result.kind).toBe("computed");
    if (result.kind !== "computed") return;
    expect(result.state).toBe("IN_REVIEW");
    expect(result.failedPrecondition).toMatch(
      /IN_REVIEW → REQUIREMENTS_APPROVED: requirements.md has 0 of the 1/,
    );
  });

  it("puts a spec whose design changed after approval back in DESIGN_IN_REVIEW (criterion 8.3)", () => {
    const edited = [
      artifact("requirements", REQUIREMENTS),
      artifact("design", `${DESIGN}\nA later edit.\n`),
      artifact("tasks", TASKS),
    ];
    const result = computeEffectiveLifecycleState(input({ artifacts: edited }));
    expect(result).toMatchObject({ kind: "computed", state: "DESIGN_IN_REVIEW" });
  });

  it("holds a spec at DESIGN_IN_REVIEW when requirements were amended and approved again, but design was not (criterion 8.6)", () => {
    const edited = REQUIREMENTS.replace("A folder", "A file");
    const ledger = chain([...verifiedLedger(), approvalEntry(0, "requirements", edited)]);
    const result = computeEffectiveLifecycleState(
      input({
        artifacts: [
          artifact("requirements", edited),
          artifact("design", DESIGN),
          artifact("tasks", TASKS),
        ],
        ledger,
      }),
    );
    expect(result).toMatchObject({ kind: "computed", state: "DESIGN_IN_REVIEW" });
    if (result.kind !== "computed") return;
    expect(result.failedPrecondition).toMatch(
      /^DESIGN_IN_REVIEW → DESIGN_APPROVED: design.md has 0 of the 1 valid approvals .*; approval entry 2: SUPERSEDED_BY_UPSTREAM_AMENDMENT — design.md was approved while requirements.md was at /,
    );
  });

  it("reaches the recorded state again once design and plan are approved after the amendment", () => {
    const edited = REQUIREMENTS.replace("A folder", "A file");
    const ledger = chain([
      ...verifiedLedger(),
      approvalEntry(0, "requirements", edited),
      approvalEntry(0, "design", DESIGN),
      approvalEntry(0, "tasks", TASKS),
    ]);
    const result = computeEffectiveLifecycleState(
      input({
        artifacts: [
          artifact("requirements", edited),
          artifact("design", DESIGN),
          artifact("tasks", TASKS),
        ],
        ledger,
      }),
    );
    expect(result).toEqual({ kind: "computed", state: "VERIFICATION", failedPrecondition: null });
  });

  it("stops at PLAN_APPROVED when no task was started", () => {
    const result = computeEffectiveLifecycleState(
      input({ ledger: approvals(), recordedState: "IN_PROGRESS" }),
    );
    expect(result).toMatchObject({ kind: "computed", state: "PLAN_APPROVED" });
  });

  it("holds an approved plan that leaves a property uncited at PLAN_IN_REVIEW (criterion 20.3)", () => {
    const uncited = TASKS.replace(" <!-- properties: P2 -->", "");
    const ledger = chain([
      ...approvals().slice(0, 2),
      approvalEntry(0, "tasks", uncited),
    ]);
    const result = computeEffectiveLifecycleState(
      input({
        artifacts: allArtifacts({ tasks: uncited }),
        ledger,
        recordedState: "PLAN_APPROVED",
      }),
    );
    expect(result).toMatchObject({ kind: "computed", state: "PLAN_IN_REVIEW" });
    if (result.kind === "computed") {
      expect(result.failedPrecondition).toMatch(/Property P2 is cited by no task/);
    }
  });

  it("stops at IN_PROGRESS while a required task has no passing evidence", () => {
    const ledger = chain([...approvals(), evidenceEntry("1")]);
    const result = computeEffectiveLifecycleState(input({ ledger }));
    expect(result).toMatchObject({ kind: "computed", state: "IN_PROGRESS" });
    if (result.kind === "computed") expect(result.failedPrecondition).toMatch(/Required Task 2/);
  });

  it("treats a blocking Decision as blocking the transition", () => {
    const decision = {
      kind: "decision",
      id: 0,
      predecessor_digest: null,
      timestamp: "2026-09-26T12:00:00Z",
      decision: "hold",
      rationale: "waiting on legal",
      blocking: true,
    } as unknown as LedgerEntry;
    const result = computeEffectiveLifecycleState(
      input({ ledger: chain([...verifiedLedger(), decision]) }),
    );
    expect(result).toMatchObject({ kind: "computed", state: "IN_REVIEW" });
  });

  it("treats an Open Question marked blocking in design.md as blocking DESIGN_APPROVED", () => {
    const design = `${DESIGN}\n## Open questions\n\n1. **Blocking:** which store holds the ledger?\n`;
    const artifacts = [
      artifact("requirements", REQUIREMENTS),
      artifact("design", design),
      artifact("tasks", TASKS),
    ];
    // approvals bound to the edited design, so only the open question blocks
    const ledger = chain(
      approvals().map((entry) =>
        (entry as unknown as { artifact: string }).artifact === "design.md"
          ? ({ ...entry, artifact_checksum: artifacts[1]!.frontmatter.checksum } as unknown as LedgerEntry)
          : entry,
      ),
    );
    const result = computeEffectiveLifecycleState(
      input({ artifacts, ledger, recordedState: "DESIGN_APPROVED" }),
    );
    expect(result).toMatchObject({ kind: "computed", state: "DESIGN_IN_REVIEW" });
    if (result.kind === "computed") expect(result.failedPrecondition).toMatch(/Open Question/);
  });

  it("is INVALID for a recorded value outside the Lifecycle State Set (criterion 5.11)", () => {
    expect(computeEffectiveLifecycleState(input({ recordedState: "SHIPPED" }))).toMatchObject({
      kind: "computed",
      state: "INVALID",
      failedPrecondition: expect.stringContaining("SHIPPED"),
    });
  });

  it("is INVALID for a later artifact without an earlier one (criterion 5.12)", () => {
    const result = computeEffectiveLifecycleState(
      input({ artifacts: [artifact("design", DESIGN)], recordedState: "DESIGN_IN_REVIEW" }),
    );
    expect(result).toMatchObject({ kind: "computed", state: "INVALID" });
    if (result.kind === "computed") expect(result.failedPrecondition).toMatch(/requirements.md/);
  });

  it("does not claim VERIFIED without the verified history the Strict Verifier needs", () => {
    const result = computeEffectiveLifecycleState(input({ recordedState: "VERIFIED" }));
    expect(result).toMatchObject({ kind: "inconclusive", holdsThrough: "VERIFICATION" });
  });

  it("is VERIFIED when the Strict Verifier passes against the verified history", () => {
    const result = computeEffectiveLifecycleState(
      input({ recordedState: "VERIFIED", verifiedHistory: new Set(["c".repeat(40)]) }),
    );
    expect(result).toEqual({ kind: "computed", state: "VERIFIED", failedPrecondition: null });
  });

  it("does not claim a slice-3 state it cannot check", () => {
    const result = computeEffectiveLifecycleState(
      input({ recordedState: "MERGED", verifiedHistory: new Set(["c".repeat(40)]) }),
    );
    expect(result).toMatchObject({ kind: "inconclusive", holdsThrough: "VERIFIED" });
  });

  it("is never ahead of the recorded state", () => {
    const result = computeEffectiveLifecycleState(input({ recordedState: "IN_REVIEW" }));
    expect(result).toEqual({ kind: "computed", state: "IN_REVIEW", failedPrecondition: null });
  });
});
