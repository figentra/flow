/**
 * @vellum/engine — Status Reporter Logic
 *
 * Generates status reports for specs.
 * Pure function - no I/O.
 *
 * @see design.md Criterion 6
 */

import type {
  ApprovalPolicy,
  Artifact,
  ArtifactKind,
  GitCommit,
  LedgerEntry,
  LedgerHead,
  LedgerIntegrityFailure,
  LifecycleState,
  RiskClass,
} from "@vellum/protocol";
import {
  canonicalArtifactBody,
  computeChecksum,
  isEarlierFormChecksum,
  parseTaskItems,
} from "@vellum/protocol";
import {
  approvalRecords,
  resolveApprovalSignals,
  type ApprovalCommitResolution,
} from "../approval/records.js";
import { countValidApprovals, getRequiredApprovalCount } from "../approval/verify.js";
import { checkLedgerIntegrity } from "../ledger/integrity.js";
import {
  computeEffectiveLifecycleState,
  type EffectiveState,
} from "../lifecycle/effective-state.js";
import { requiredTasks } from "../lifecycle/required-tasks.js";

/**
 * Status report for a spec.
 *
 * The Effective Lifecycle State (criteria 5.10, 6.1) is computed from the
 * artifacts, approvals, evidence and ledger (computeEffectiveLifecycleState).
 * When a precondition cannot be decided it is `null`, and `effective` says
 * which state was shown to hold and why the next could not be decided. The
 * next permitted transition (criterion 6.5) is not computed by this engine
 * version.
 */
export interface StatusReport {
  /** Spec ID */
  readonly specId: string;
  /** Recorded lifecycle state (requirements.md frontmatter) */
  readonly recordedState: LifecycleState;
  /** Effective Lifecycle State; null when a precondition could not be decided */
  readonly effectiveState: LifecycleState | null;
  /** How the effective state was reached: the failed precondition, or why it is inconclusive */
  readonly effective: EffectiveState;
  /** Artifact versions */
  readonly artifacts: {
    readonly requirements?: ArtifactStatus;
    readonly design?: ArtifactStatus;
    readonly tasks?: ArtifactStatus;
  };
  /** Valid approvals per artifact, verified as strict verification does */
  readonly approvals: ApprovalStatusReport;
  /** Required tasks and their evidence */
  readonly verification: VerificationStatus;
  /** Ledger integrity, tail included when the head was supplied */
  readonly ledger: LedgerStatus;
}

/**
 * Artifact status in report.
 */
export interface ArtifactStatus {
  readonly version: number;
  readonly state: LifecycleState;
  /** The Artifact Checksum of the body as it is now */
  readonly checksum: string;
  /** Whether the frontmatter's recorded checksum equals the current one */
  readonly checksumCurrent: boolean;
  /**
   * Whether the frontmatter records the unchanged body's checksum in an
   * earlier form (stamped by Vellum 0.1.2): not stale for content, and
   * `npx vellum stamp` brings it to the current form without a new version.
   */
  readonly checksumEarlierForm: boolean;
}

/**
 * Approval status in report.
 */
export interface ApprovalStatusReport {
  readonly requirements: ApprovalCount;
  readonly design: ApprovalCount;
  readonly tasks: ApprovalCount;
}

/**
 * Approval count.
 */
export interface ApprovalCount {
  /** Valid approvals (signed by a policy key of an authorised approver, bound to the current checksum) */
  readonly current: number;
  /** Approvals the policy requires at the spec's risk class (0: none configured) */
  readonly required: number;
  readonly complete: boolean;
}

/**
 * Verification status.
 */
export interface VerificationStatus {
  /** Required (non-optional) tasks in tasks.md */
  readonly required: number;
  /** Required tasks with an Evidence Entry that exited 0 */
  readonly completed: number;
  /** Evidence Entries that exited non-zero (failed attempts) */
  readonly failed: number;
  readonly complete: boolean;
}

/** Ledger status. */
export interface LedgerStatus {
  readonly entries: number;
  readonly valid: boolean;
  readonly failures: readonly LedgerIntegrityFailure[];
}

/** Everything the status of one spec is computed from. */
export interface StatusInput {
  readonly specId: string;
  readonly artifacts: readonly Artifact[];
  readonly ledger: readonly LedgerEntry[];
  readonly recordedState: LifecycleState;
  readonly policy: ApprovalPolicy | null;
  readonly riskClass: RiskClass;
  readonly gitCommits: ReadonlyMap<string, GitCommit>;
  readonly ledgerHead?: LedgerHead | null;
  readonly approvalCommits?: ReadonlyMap<number, ApprovalCommitResolution>;
  /** The verified commit and its ancestors; without it VERIFIED cannot be decided */
  readonly verifiedHistory?: ReadonlySet<string>;
}

/**
 * Compute status report for a spec.
 * Pure function consuming artifacts, ledger and what storage read from git.
 */
export function computeStatusReport(input: StatusInput): StatusReport {
  const byKind = new Map(input.artifacts.map((a) => [a.kind, a] as const));

  const artifacts: {
    requirements?: ArtifactStatus;
    design?: ArtifactStatus;
    tasks?: ArtifactStatus;
  } = {};
  for (const kind of KINDS) {
    const artifact = byKind.get(kind);
    if (artifact) artifacts[kind] = getArtifactStatus(artifact);
  }

  const records = resolveApprovalSignals(approvalRecords(input.ledger, input.artifacts), input.approvalCommits).map(
    (resolved) => resolved.record,
  );
  const approvalFor = (kind: ArtifactKind): ApprovalCount => {
    const artifact = byKind.get(kind);
    const required = getRequiredApprovalCount(input.policy, input.riskClass, kind);
    const current = artifact
      ? countValidApprovals(
          records,
          input.policy,
          input.riskClass,
          kind,
          computeChecksum(artifact.body),
          input.gitCommits,
        )
      : 0;
    return { current, required, complete: required > 0 && current >= required };
  };

  const integrity = checkLedgerIntegrity(input.ledger, input.ledgerHead);
  const effective = computeEffectiveLifecycleState({
    artifacts: input.artifacts,
    ledger: input.ledger,
    recordedState: input.recordedState,
    policy: input.policy,
    riskClass: input.riskClass,
    gitCommits: input.gitCommits,
    ...(input.ledgerHead !== undefined ? { ledgerHead: input.ledgerHead } : {}),
    ...(input.approvalCommits ? { approvalCommits: input.approvalCommits } : {}),
    ...(input.verifiedHistory ? { verifiedHistory: input.verifiedHistory } : {}),
  });

  return {
    specId: input.specId,
    recordedState: input.recordedState,
    effectiveState: effective.kind === "computed" ? effective.state : null,
    effective,
    artifacts,
    approvals: {
      requirements: approvalFor("requirements"),
      design: approvalFor("design"),
      tasks: approvalFor("tasks"),
    },
    verification: computeVerificationStatus(input.ledger, byKind.get("tasks")),
    ledger: {
      entries: input.ledger.length,
      valid: integrity.valid,
      failures: integrity.failures,
    },
  };
}

const KINDS: readonly ArtifactKind[] = ["requirements", "design", "tasks"];

function checksumNote(status: ArtifactStatus): string {
  if (status.checksumCurrent) return "";
  return status.checksumEarlierForm
    ? " — frontmatter checksum is in an earlier form (body unchanged); run npx vellum stamp to update it"
    : " — frontmatter checksum is stale";
}

/**
 * Get artifact status.
 */
function getArtifactStatus(artifact: Artifact): ArtifactStatus {
  const checksum = computeChecksum(artifact.body);
  return {
    version: artifact.frontmatter.version,
    state: artifact.frontmatter.state,
    checksum,
    checksumCurrent: artifact.frontmatter.checksum === checksum,
    checksumEarlierForm: isEarlierFormChecksum(artifact.frontmatter.checksum, artifact.body),
  };
}

/**
 * Compute verification status: required tasks from tasks.md against the
 * ledger's evidence.
 */
function computeVerificationStatus(
  ledger: readonly LedgerEntry[],
  tasks: Artifact | undefined,
): VerificationStatus {
  const passed = new Set<string>();
  let failed = 0;
  for (const entry of ledger) {
    if (entry.kind !== "evidence") continue;
    const evidence = entry as unknown as {
      readonly task_id?: unknown;
      readonly exit_status?: unknown;
    };
    if (evidence.exit_status === 0 && typeof evidence.task_id === "string") {
      passed.add(evidence.task_id);
    } else if (evidence.exit_status !== 0) {
      failed++;
    }
  }

  const required = tasks
    ? requiredTasks(
        parseTaskItems(canonicalArtifactBody(tasks.body)),
      ).map((line) => line.identifier as string)
    : [];
  const completed = required.filter((id) => passed.has(id)).length;

  return {
    required: required.length,
    completed,
    failed,
    complete: required.length > 0 && completed === required.length,
  };
}

/**
 * Format status report as JSON.
 */
export function formatStatusJson(report: StatusReport): string {
  return JSON.stringify(report, null, 2);
}

/**
 * Format status report for CLI.
 */
export function formatStatusHuman(report: StatusReport): string {
  const lines: string[] = [];

  lines.push(`Spec: ${report.specId}`);
  lines.push(`Recorded state: ${report.recordedState}`);
  const effective = report.effective;
  if (effective.kind === "computed") {
    lines.push(`Effective state: ${effective.state}`);
    if (effective.failedPrecondition !== null) {
      lines.push(`  failed precondition: ${effective.failedPrecondition}`);
    }
  } else {
    lines.push(`Effective state: INCONCLUSIVE — holds through ${effective.holdsThrough}`);
    lines.push(`  undecided: ${effective.reason}`);
  }

  lines.push(``);
  lines.push(`Artifacts:`);
  for (const kind of KINDS) {
    const status = report.artifacts[kind];
    lines.push(
      status
        ? `  ${kind}: v${status.version} (${status.state})${checksumNote(status)}`
        : `  ${kind}: missing`,
    );
  }

  lines.push(``);
  lines.push(`Valid approvals:`);
  for (const kind of KINDS) {
    const count = report.approvals[kind];
    lines.push(
      `  ${kind}: ${count.current}/${count.required}${count.required === 0 ? " (policy requires none configured)" : ""}`,
    );
  }

  lines.push(``);
  lines.push(
    `Tasks verified: ${report.verification.completed}/${report.verification.required} (failed attempts: ${report.verification.failed})`,
  );
  lines.push(
    `Ledger: ${report.ledger.entries} entries, ${report.ledger.valid ? "intact" : "INTEGRITY FAILURE"}`,
  );
  for (const failure of report.ledger.failures) {
    lines.push(`  entry ${failure.entry_id}: ${failure.message}`);
  }

  return lines.join("\n");
}
