/**
 * Approvals and Task Bindings recorded by Vellum 0.1.2 (checksum form 1, no
 * `checksum_form` field) against artifacts whose form-1 and form-2 checksums
 * differ — wrapped prose and a run of blank lines — keep counting under this
 * version while the artifact is unchanged, and stop counting after a content
 * edit (decision 14 in 002's design). Every reader agrees: strict
 * verification, status, the effective state and the pre-execution check.
 */

import { describe, expect, it } from "vitest";
import type { Checksum, LedgerEntry } from "@vellum/protocol";
import { CHECKSUM_FORM, computeChecksum, computeChecksumInForm } from "@vellum/protocol";
import { approvalRecords } from "../../approval/records.js";
import { computeEffectiveLifecycleState } from "../../lifecycle/effective-state.js";
import { computeStatusReport } from "../../status/reporter.js";
import { checkTaskBinding, preExecutionCheck } from "../precheck.js";
import { strictVerify } from "../strict.js";
import {
  DESIGN,
  REQUIREMENTS,
  TASKS,
  allArtifacts,
  approvalEntry,
  approvalEntryV012,
  artifact,
  chain,
  commits,
  evidenceEntry,
  policyFor,
} from "./fixtures.js";

const policy = policyFor("standard");
const context = { policy, riskClass: "standard" as const, gitCommits: commits };

/** Bodies a person wrapped by hand, so their form-1 and form-2 checksums differ. */
const WRAPPED = {
  requirements: REQUIREMENTS.replace(
    "# Requirements\n",
    "# Requirements\n\nA spec whose introduction a person\nwrapped by hand.\n\n\n",
  ),
  design: DESIGN,
  tasks: TASKS.replace(
    "# Tasks\n",
    "# Tasks\n\nBuild both things, in order,\nand test each.\n\n\n",
  ),
};
const EDITED = WRAPPED.requirements.replace("A folder", "A file");

/** The three approvals exactly as 0.1.2 recorded them for WRAPPED. */
function v012Approvals(): LedgerEntry[] {
  return chain(
    (["requirements", "design", "tasks"] as const).map((kind, i) =>
      approvalEntryV012(i + 1, kind, WRAPPED[kind]),
    ),
  );
}

describe("the fixture", () => {
  it("has form-1 and form-2 checksums that differ for requirements and tasks", () => {
    expect(computeChecksumInForm(WRAPPED.requirements, 1)).not.toBe(
      computeChecksum(WRAPPED.requirements),
    );
    expect(computeChecksumInForm(WRAPPED.tasks, 1)).not.toBe(computeChecksum(WRAPPED.tasks));
    expect(EDITED).not.toBe(WRAPPED.requirements);
  });
});

describe("an approval recorded by Vellum 0.1.2 (form 1)", () => {
  it("stays valid for the unchanged artifact under strict verification", () => {
    const ledger = chain([...v012Approvals(), evidenceEntry("1"), evidenceEntry("2")]);
    const result = strictVerify(allArtifacts(WRAPPED), ledger, policy, commits, "standard");

    expect(result.findings).toEqual([]);
    expect(result.approvals).toEqual({ satisfied: 3, total: 3 });
    expect(result.result).toBe("PASS");
  });

  it("is invalid once the artifact's content changes", () => {
    const ledger = chain([...v012Approvals(), evidenceEntry("1"), evidenceEntry("2")]);
    const result = strictVerify(
      allArtifacts({ ...WRAPPED, requirements: EDITED }),
      ledger,
      policy,
      commits,
      "standard",
    );

    expect(result.result).toBe("FAIL");
    // Criterion 8.6: the design and plan approvals were given before the amendment
    expect(result.approvals).toEqual({ satisfied: 0, total: 3 });
    expect(result.findings.map((f) => f.message)).toContain(
      `Approval invalid: CHECKSUM_MISMATCH — requirements.md was approved at ${computeChecksumInForm(WRAPPED.requirements, 1)} and is now ${computeChecksum(EDITED)}`,
    );
  });

  it("counts toward status and the effective state", () => {
    const artifacts = allArtifacts(WRAPPED).map((a) =>
      artifact(a.kind, a.body, computeChecksumInForm(a.body, 1)),
    );
    const input = {
      artifacts,
      ledger: v012Approvals(),
      recordedState: "PLAN_APPROVED" as const,
      policy,
      riskClass: "standard" as const,
      gitCommits: commits,
    };
    const report = computeStatusReport({ ...input, specId: "001-x" });

    for (const kind of ["requirements", "design", "tasks"] as const) {
      expect(report.approvals[kind]).toEqual({ current: 1, required: 1, complete: true });
    }
    expect(computeEffectiveLifecycleState(input)).toMatchObject({
      kind: "computed",
      state: "PLAN_APPROVED",
    });
  });

  it("passes the pre-execution check, which binds the task in the current form", () => {
    const result = preExecutionCheck(allArtifacts(WRAPPED), v012Approvals(), "1", context);

    expect(result.errors).toEqual([]);
    expect(result.taskBinding).toMatchObject({
      requirementsChecksum: computeChecksum(WRAPPED.requirements),
      planChecksum: computeChecksum(WRAPPED.tasks),
      checksumForm: CHECKSUM_FORM,
    });
  });

  it("does not pass the pre-execution check after a content edit", () => {
    const result = preExecutionCheck(
      allArtifacts({ ...WRAPPED, requirements: EDITED }),
      v012Approvals(),
      "1",
      context,
    );

    expect(result.passed).toBe(false);
    expect(result.errors).toContain(
      `Requirements approval invalidated: approved checksum ${computeChecksumInForm(WRAPPED.requirements, 1)}, current checksum ${computeChecksum(EDITED)}`,
    );
  });

  it("with a form this version does not know binds nothing", () => {
    const unknown = {
      ...approvalEntryV012(1, "requirements", WRAPPED.requirements),
      checksum_form: 3,
    };
    const [record] = approvalRecords([unknown as unknown as LedgerEntry], allArtifacts(WRAPPED));

    expect(record?.checksumForm).toBeNull();
    expect(record?.artifactChecksum).not.toBe(computeChecksum(WRAPPED.requirements));
  });
});

describe("a new approval", () => {
  it("records form 2 and reads as recorded", () => {
    const entry = approvalEntry(1, "requirements", WRAPPED.requirements);
    const [record] = approvalRecords([entry], allArtifacts(WRAPPED));

    expect((entry as unknown as Record<string, unknown>).checksum_form).toBe(2);
    expect(record).toMatchObject({
      checksumForm: 2,
      artifactChecksum: computeChecksum(WRAPPED.requirements),
    });
  });

  it("recorded in form 2 is not accepted as a form-1 checksum", () => {
    const entry = {
      ...approvalEntry(1, "requirements", WRAPPED.requirements),
      artifact_checksum: computeChecksumInForm(WRAPPED.requirements, 1),
    };
    const result = strictVerify(
      allArtifacts(WRAPPED),
      chain([entry as LedgerEntry]),
      policy,
      commits,
      "standard",
    );

    expect(result.findings.map((f) => f.message)).toContain(
      `Approval invalid: CHECKSUM_MISMATCH — requirements.md was approved at ${computeChecksumInForm(WRAPPED.requirements, 1)} and is now ${computeChecksum(WRAPPED.requirements)}`,
    );
  });
});

describe("a Task Binding recorded by Vellum 0.1.2 (form 1)", () => {
  const binding = {
    taskIdentifier: "1",
    requirementsVersion: 1,
    requirementsChecksum: computeChecksumInForm(WRAPPED.requirements, 1),
    designVersion: 1,
    designChecksum: computeChecksumInForm(WRAPPED.design, 1),
    planVersion: 1,
    planChecksum: computeChecksumInForm(WRAPPED.tasks, 1),
    checksumForm: 1 as const,
  };

  it("matches the unchanged artifacts", () => {
    expect(checkTaskBinding(binding, allArtifacts(WRAPPED))).toEqual({ matches: true });
  });

  it("does not match after a content edit", () => {
    expect(checkTaskBinding(binding, allArtifacts({ ...WRAPPED, requirements: EDITED }))).toEqual({
      matches: false,
      mismatchedArtifact: "requirements",
    });
  });

  it("is compared in its own form: read as form 2 it would not match", () => {
    expect(checkTaskBinding({ ...binding, checksumForm: 2 }, allArtifacts(WRAPPED))).toEqual({
      matches: false,
      mismatchedArtifact: "requirements",
    });
    expect(checkTaskBinding({ ...binding, checksumForm: null }, allArtifacts(WRAPPED))).toEqual({
      matches: false,
      mismatchedArtifact: "requirements",
    });
  });

  it("a current binding records the checksums it compares", () => {
    const current = {
      ...binding,
      requirementsChecksum: computeChecksum(WRAPPED.requirements) as Checksum,
      designChecksum: computeChecksum(WRAPPED.design) as Checksum,
      planChecksum: computeChecksum(WRAPPED.tasks) as Checksum,
      checksumForm: CHECKSUM_FORM,
    };
    expect(checkTaskBinding(current, allArtifacts(WRAPPED))).toEqual({ matches: true });
  });
});
