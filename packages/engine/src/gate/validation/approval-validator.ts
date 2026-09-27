/**
 * Approval Validator - the merge gate's view of approval verification.
 *
 * There is one approval verifier: `verifyApproval` in approval/verify.ts. This
 * module only adapts its result to the gate's error-list shape, so an approval
 * the gate accepts is exactly one strict verification and status accept:
 * signed by a key the Approval Policy lists for the approving identity
 * (criterion 7.3, `SIGNER_NOT_AUTHORIZED` otherwise), from a human session,
 * by an authorised approver at the spec's risk class, and bound to the
 * artifact's current checksum.
 *
 * Each approval's `artifactChecksum` is compared as a current-form checksum.
 * Approvals read from a ledger come through approvalRecords, which reads a
 * checksum recorded in an earlier form (Vellum 0.1.2's) against the artifact
 * in that form first.
 *
 * @see requirements.md Requirement 6.1
 */

import type {
  ApprovalPayload,
  ApprovalPolicy,
  ArtifactKind,
  Checksum,
  GitCommit,
  RiskClass,
} from "@vellum/protocol";
import {
  diagnoseInvalidApproval,
  verifyApproval,
  type ApprovalRejectionReason,
} from "../../approval/verify.js";
import { evaluateApprovals } from "../../approval/evaluate.js";

/**
 * Approval validation result.
 */
export interface ApprovalValidationResult {
  /** Whether the approval is valid */
  valid: boolean;
  /** Validation errors */
  errors: string[];
  /** Why verifyApproval rejected the approval (absent when valid or not verified) */
  reason?: ApprovalRejectionReason;
}

/**
 * Everything an approval is verified against.
 */
export interface ApprovalValidationContext {
  /** The Approval Policy; null when it is missing (no approval is then valid) */
  readonly policy: ApprovalPolicy | null;
  /** The spec's risk class, which selects the policy's approvers */
  readonly riskClass: RiskClass;
  /** Git commits keyed by SHA, holding each approval's signal commit */
  readonly commits: ReadonlyMap<string, GitCommit>;
  /** The current Artifact Checksum of each artifact present */
  readonly currentChecksums: ReadonlyMap<ArtifactKind, Checksum>;
}

/**
 * Validate one approval with verifyApproval.
 *
 * @param approval - Approval to validate
 * @param context - Policy, risk class, signal commits and current checksums
 * @returns Validation result
 */
export function validateApproval(
  approval: ApprovalPayload,
  context: ApprovalValidationContext,
): ApprovalValidationResult {
  const currentChecksum = context.currentChecksums.get(approval.artifact);
  if (currentChecksum === undefined) {
    return {
      valid: false,
      errors: [
        `Approval of ${approval.artifact} cannot be verified: ${approval.artifact}.md is not present`,
      ],
    };
  }

  const result = verifyApproval(
    approval,
    context.policy,
    context.riskClass,
    context.commits,
    currentChecksum,
  );
  if (result.valid) return { valid: true, errors: [] };
  return {
    valid: false,
    errors: [diagnoseInvalidApproval(approval, result)],
    reason: result.reason,
  };
}

/**
 * Check if an approval is stale.
 *
 * @param approval - Approval to check
 * @param currentChecksum - Current artifact checksum
 * @returns True if stale
 */
export function isApprovalStale(approval: ApprovalPayload, currentChecksum: string): boolean {
  return approval.artifactChecksum !== currentChecksum;
}

/**
 * Validate approvals for a set of artifacts.
 *
 * The set is judged as strict verification judges a ledger (see
 * approval/evaluate): an approval bound to an older checksum is history, not
 * an error, once the artifact's current text is approved again.
 *
 * @param approvals - Approvals to validate
 * @param context - Policy, risk class, signal commits and current checksums
 * @returns Validation result for all approvals
 */
export function validateApprovals(
  approvals: readonly ApprovalPayload[],
  context: ApprovalValidationContext,
): ApprovalValidationResult {
  const errors: string[] = [];

  const evaluation = evaluateApprovals(
    approvals,
    context.policy,
    context.riskClass,
    context.commits,
    context.currentChecksums,
  );
  for (const { record, standing } of evaluation.records) {
    if (standing.kind === "valid" || standing.kind === "superseded") continue;
    errors.push(...validateApproval(record, context).errors);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
