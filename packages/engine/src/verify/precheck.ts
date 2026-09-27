/**
 * @stellum/engine — Pre-Execution Checker
 *
 * Validates spec is ready to start a task.
 * Pure function - no I/O.
 *
 * @see design.md Criterion 18
 */

import type {
  ApprovalPolicy,
  Artifact,
  ArtifactKind,
  Checksum,
  GitCommit,
  LedgerEntry,
  RiskClass,
} from "@vellum/protocol";
import { canonicalArtifactBody, computeChecksum, parseTaskItems } from "@vellum/protocol";
import { hasRequiredApprovals } from "../approval/verify.js";
import {
  approvalRecords,
  resolveApprovalSignals,
  type ApprovalCommitResolution,
} from "../approval/records.js";
import { extractCriteria, extractProperties } from "../coverage/validate.js";
import { parentTaskIds } from "../lifecycle/required-tasks.js";

/**
 * Pre-execution check result.
 */
export interface PreCheckResult {
  /** Whether the check passed */
  readonly passed: boolean;
  /** Error messages */
  readonly errors: readonly string[];
  /** Task binding to record (if passed) */
  readonly taskBinding: TaskBinding | null;
}

/**
 * Task binding payload.
 */
export interface TaskBinding {
  readonly taskIdentifier: string;
  readonly requirementsVersion: number;
  readonly requirementsChecksum: Checksum;
  readonly designVersion: number;
  readonly designChecksum: Checksum;
  readonly planVersion: number;
  readonly planChecksum: Checksum;
}

/** What approvals are verified against: the policy, the spec's risk class, the signal commits. */
export interface PreCheckApprovalContext {
  readonly policy: ApprovalPolicy | null;
  readonly riskClass: RiskClass;
  readonly gitCommits: ReadonlyMap<string, GitCommit>;
  /**
   * The commit that added each approval entry, resolved from git. When given,
   * it is the Approval Signal (see resolveApprovalSignals).
   */
  readonly approvalCommits?: ReadonlyMap<number, ApprovalCommitResolution>;
}

const ARTIFACT_LABEL: Record<ArtifactKind, string> = {
  requirements: "Requirements",
  design: "Design",
  tasks: "Tasks",
};

/**
 * Check if a task can be started (criterion 18).
 *
 * - 18.1: requirements.md, design.md and tasks.md exist.
 * - 18.2/18.3: each holds the approvals the policy requires, verified by
 *   verifyApproval against the artifact's current Artifact Checksum (computed
 *   from its body, never taken from its frontmatter). An approval of earlier
 *   content is reported as invalidated, naming both checksums.
 * - 18.4: the task exists in tasks.md, and every criterion and property its
 *   trailers cite is defined in requirements.md / design.md.
 *
 * @param artifacts - The spec's artifacts
 * @param ledger - The spec's ledger
 * @param taskIdentifier - Task to start
 * @param approval - Policy, risk class and signal commits to verify approvals with
 * @returns Pre-check result; the binding records the computed checksums
 */
export function preExecutionCheck(
  artifacts: readonly Artifact[],
  ledger: readonly LedgerEntry[],
  taskIdentifier: string,
  approval: PreCheckApprovalContext,
): PreCheckResult {
  const errors: string[] = [];

  // Criterion 18.1: Three artifacts exist
  const requirements = artifacts.find((a) => a.kind === "requirements");
  const design = artifacts.find((a) => a.kind === "design");
  const tasks = artifacts.find((a) => a.kind === "tasks");
  if (!requirements) errors.push("Missing requirements.md");
  if (!design) errors.push("Missing design.md");
  if (!tasks) errors.push("Missing tasks.md");
  if (!requirements || !design || !tasks) {
    return { passed: false, errors: Object.freeze(errors), taskBinding: null };
  }

  // Criteria 18.2 and 18.3: valid approvals bound to the current checksums
  const records = resolveApprovalSignals(approvalRecords(ledger), approval.approvalCommits).map(
    (resolved) => resolved.record,
  );
  const checksums = {
    requirements: computeChecksum(requirements.body),
    design: computeChecksum(design.body),
    tasks: computeChecksum(tasks.body),
  } as const;
  for (const kind of ["requirements", "design", "tasks"] as const) {
    const ofKind = records.filter((r) => r.artifact === kind);
    const status = hasRequiredApprovals(
      ofKind,
      approval.policy,
      approval.riskClass,
      kind,
      checksums[kind],
      approval.gitCommits,
    );
    if (status.met) continue;

    const stale = ofKind.find((r) => r.artifactChecksum !== checksums[kind]);
    if (status.required === 0) {
      errors.push(
        `${ARTIFACT_LABEL[kind]} approval requirement missing from the policy for risk class ${approval.riskClass}`,
      );
    } else if (status.count === 0 && stale) {
      errors.push(
        `${ARTIFACT_LABEL[kind]} approval invalidated: approved checksum ${stale.artifactChecksum}, current checksum ${checksums[kind]}`,
      );
    } else {
      errors.push(
        `${ARTIFACT_LABEL[kind]} not approved: ${status.count} of ${status.required} required valid approvals`,
      );
    }
  }

  // Criterion 18.4: the task exists and its references resolve
  const lines = parseTaskItems(canonicalArtifactBody(tasks.body));
  const task = lines.find((line) => line.identifier === taskIdentifier);
  if (!task) {
    errors.push(`Task ${taskIdentifier} not found in tasks.md`);
  } else if (parentTaskIds(lines).has(taskIdentifier)) {
    // A parent is a container: its sub-tasks are the units of work, and it is
    // complete when they are (see lifecycle/required-tasks).
    const subTasks = lines
      .filter((line) => (line.identifier as string).startsWith(`${taskIdentifier}.`))
      .map((line) => line.identifier);
    errors.push(
      `Task ${taskIdentifier} is a parent task; start one of its sub-tasks instead (${subTasks.join(", ")})`,
    );
  } else {
    const criteria = new Set(extractCriteria(canonicalArtifactBody(requirements.body)));
    const properties = new Set(extractProperties(canonicalArtifactBody(design.body)));
    for (const ref of task.requirementsTrailer ?? []) {
      if (!criteria.has(ref)) {
        errors.push(`Task ${taskIdentifier} cites criterion ${ref}, which requirements.md does not define`);
      }
    }
    for (const ref of task.propertiesTrailer ?? []) {
      if (!properties.has(ref)) {
        errors.push(`Task ${taskIdentifier} cites property ${ref}, which design.md does not define`);
      }
    }
  }

  if (errors.length > 0) {
    return { passed: false, errors: Object.freeze(errors), taskBinding: null };
  }

  return {
    passed: true,
    errors: [],
    taskBinding: {
      taskIdentifier,
      requirementsVersion: requirements.frontmatter.version,
      requirementsChecksum: checksums.requirements,
      designVersion: design.frontmatter.version,
      designChecksum: checksums.design,
      planVersion: tasks.frontmatter.version,
      planChecksum: checksums.tasks,
    },
  };
}

/**
 * Check if artifact checksums match a task binding (criterion 18.10).
 * Checksums are computed from the artifacts' bodies; a missing artifact is a
 * mismatch.
 */
export function checkTaskBinding(
  binding: TaskBinding,
  currentArtifacts: readonly Artifact[],
): { matches: true } | { matches: false; mismatchedArtifact: string } {
  const bound: ReadonlyArray<readonly [ArtifactKind, Checksum]> = [
    ["requirements", binding.requirementsChecksum],
    ["design", binding.designChecksum],
    ["tasks", binding.planChecksum],
  ];
  for (const [kind, checksum] of bound) {
    const artifact = currentArtifacts.find((a) => a.kind === kind);
    if (!artifact || computeChecksum(artifact.body) !== checksum) {
      return { matches: false, mismatchedArtifact: kind };
    }
  }
  return { matches: true };
}

/**
 * Validate a task binding entry.
 */
export function validateTaskBinding(binding: TaskBinding): boolean {
  return (
    typeof binding.taskIdentifier === "string" &&
    binding.taskIdentifier.length > 0 &&
    Number.isInteger(binding.requirementsVersion) &&
    binding.requirementsVersion >= 1 &&
    Number.isInteger(binding.designVersion) &&
    binding.designVersion >= 1 &&
    Number.isInteger(binding.planVersion) &&
    binding.planVersion >= 1
  );
}
