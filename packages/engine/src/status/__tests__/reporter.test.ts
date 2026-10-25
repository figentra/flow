/**
 * computeStatusReport counts only valid approvals and evidenced required
 * tasks, and reports the Effective Lifecycle State it computed from them.
 */

import { describe, expect, it } from "vitest";
import type { GitCommit } from "@vellum/protocol";
import { computeStatusReport, formatStatusHuman } from "../reporter.js";
import {
  allArtifacts,
  approvals,
  chain,
  commits,
  evidenceEntry,
  policyFor,
  REQUIREMENTS,
  verifiedLedger,
} from "../../verify/__tests__/fixtures.js";

const base = {
  specId: "001-x",
  recordedState: "IN_PROGRESS" as const,
  policy: policyFor("standard"),
  riskClass: "standard" as const,
  gitCommits: commits,
};

describe("computeStatusReport", () => {
  it("reports valid approvals, verified tasks and an intact ledger", () => {
    const report = computeStatusReport({
      ...base,
      artifacts: allArtifacts(),
      ledger: verifiedLedger(),
    });

    // Every precondition up to the recorded IN_PROGRESS holds
    expect(report.effectiveState).toBe("IN_PROGRESS");
    expect(report.effective).toEqual({
      kind: "computed",
      state: "IN_PROGRESS",
      failedPrecondition: null,
    });
    expect(report.approvals.requirements).toEqual({ current: 1, required: 1, complete: true });
    expect(report.verification).toEqual({ required: 2, completed: 2, failed: 0, complete: true });
    expect(report.ledger).toEqual({ entries: 5, valid: true, failures: [] });
  });

  it("does not count an approval whose signal commit is unsigned by a policy key", () => {
    const unsigned = new Map<string, GitCommit>(
      [...commits].map(([sha, commit]) => {
        const { signer: _drop, ...rest } = commit;
        return [sha, rest];
      }),
    );
    const report = computeStatusReport({
      ...base,
      gitCommits: unsigned,
      artifacts: allArtifacts(),
      ledger: approvals(),
    });

    expect(report.approvals.requirements).toEqual({ current: 0, required: 1, complete: false });
  });

  it("does not count an approval of content that changed since", () => {
    const report = computeStatusReport({
      ...base,
      artifacts: allArtifacts({ requirements: REQUIREMENTS.replace("A folder", "A file") }),
      ledger: approvals(),
    });

    expect(report.approvals.requirements.current).toBe(0);
    // Criterion 8.6: the design and plan approvals were given before the amendment
    expect(report.approvals.design.current).toBe(0);
    expect(report.approvals.tasks.current).toBe(0);
  });

  it("counts failed attempts separately from verified tasks", () => {
    const report = computeStatusReport({
      ...base,
      artifacts: allArtifacts(),
      ledger: chain([...approvals(), evidenceEntry("1", 2)]),
    });

    expect(report.verification).toEqual({ required: 2, completed: 0, failed: 1, complete: false });
  });

  it("reports an effective state behind the recorded one, naming the failed precondition", () => {
    const report = computeStatusReport({ ...base, artifacts: allArtifacts(), ledger: [] });
    expect(report.recordedState).toBe("IN_PROGRESS");
    expect(report.effectiveState).toBe("IN_REVIEW");

    const text = formatStatusHuman(report);
    expect(text).toContain("Effective state: IN_REVIEW");
    expect(text).toContain("failed precondition: IN_REVIEW → REQUIREMENTS_APPROVED");
    expect(text).toContain("Tasks verified: 0/2");
  });

  it("reports an undecidable effective state as null, not as the recorded state", () => {
    const report = computeStatusReport({
      ...base,
      recordedState: "VERIFIED",
      artifacts: allArtifacts(),
      ledger: verifiedLedger(),
    });
    expect(report.effectiveState).toBeNull();
    expect(report.effective).toMatchObject({ kind: "inconclusive", holdsThrough: "VERIFICATION" });
    expect(formatStatusHuman(report)).toContain("Effective state: INCONCLUSIVE");
  });
});
