/**
 * @vellum/engine — Approval standing: the one rule every reader applies
 *
 * An artifact is amended after it was approved (a plan converged, a
 * requirement clarified), and the human approves the new text. The ledger
 * then holds two approvals of the artifact: the old one, bound to a checksum
 * the artifact no longer has, and the new one, bound to its current checksum.
 *
 * The old approval is history, not a finding. Only approvals bound to the
 * current checksum count toward the required number (criterion 7.11; the
 * design's glossary: an Invalidated Approval is "not counted toward approval
 * requirements"), and an approval bound to an older checksum is reported as
 * an Invalidated Approval (criterion 8.2) only while it still matters — while
 * the artifact lacks the approvals the policy requires and the approver has
 * not approved the current text. Every other rejection (unsigned, forged,
 * wrong key, assistant session, unauthorised) is always reported: an old
 * record that could never have been valid is a finding however old it is.
 *
 * An approval of design or tasks also stops counting when an artifact
 * upstream of it is amended after it was given (criteria 8.6, 8.7): it is then
 * reported as an Invalidated Approval with the reason
 * SUPERSEDED_BY_UPSTREAM_AMENDMENT, naming the amended artifact, until the
 * chain is approved again.
 *
 * Strict verification, status, check (through the effective state), plan
 * approval (through the effective state), the pre-execution check and the
 * merge and review gates all decide from this.
 *
 * Pure function - no I/O.
 *
 * @see requirements.md Criteria 7.11, 8.1, 8.2, 8.6, 8.7
 */

import type {
  ApprovalPolicy,
  ArtifactKind,
  Checksum,
  GitCommit,
  RiskClass,
} from "@vellum/protocol";
import {
  getRequiredApprovalCount,
  matchesApprover,
  verifyApproval,
  type ApprovalRejectionReason,
  type ApprovalVerificationResult,
  type RequiredApprovalsResult,
} from "./verify.js";

/** The fields of an approval record the verifier reads. */
export interface EvaluatedApprovalInput {
  readonly approver: string;
  readonly artifact: ArtifactKind;
  readonly artifactChecksum: Checksum;
  readonly signalCommit: string;
}

/**
 * The reason reported for an approval given before an upstream artifact was
 * amended (criteria 8.6, 8.7): the approval is otherwise valid, but the text
 * upstream of it is no longer the text it was given against.
 */
export const SUPERSEDED_BY_UPSTREAM_AMENDMENT = "SUPERSEDED_BY_UPSTREAM_AMENDMENT";

/**
 * The artifacts upstream of each artifact (criteria 8.6, 8.7): an amendment
 * of requirements voids the design and plan approvals given before it, and
 * an amendment of design voids the plan approvals given before it.
 */
export const UPSTREAM_ARTIFACTS: Readonly<Record<ArtifactKind, readonly ArtifactKind[]>> = {
  requirements: [],
  design: ["requirements"],
  tasks: ["requirements", "design"],
};

/** Where one approval record stands against the artifacts as they are now. */
export type ApprovalStanding =
  /** Bound to the current checksum and valid: counts. */
  | { readonly kind: "valid" }
  /**
   * Valid when given, but no longer current, and the artifact's current text
   * is approved (by the policy's count, or by this approver again). History:
   * neither counted nor reported.
   *
   * Without `upstream`, the record is bound to an older checksum of its own
   * artifact and the checksums are that artifact's. With `upstream`, the
   * record was given before `upstream` was amended and the checksums are the
   * upstream artifact's: the one it was given against and the current one.
   */
  | {
      readonly kind: "superseded";
      readonly approvedChecksum: Checksum;
      readonly currentChecksum: Checksum;
      readonly upstream?: ArtifactKind;
    }
  /**
   * Bound to an older checksum and not replaced: an Invalidated Approval
   * (criterion 8.2). Reported, naming the artifact and both checksums.
   */
  | {
      readonly kind: "invalidated";
      readonly approvedChecksum: Checksum;
      readonly currentChecksum: Checksum;
    }
  /**
   * Bound to its artifact's current checksum and valid when given, but given
   * while `upstream` had other text than it has now (criteria 8.6, 8.7), and
   * not replaced: an Invalidated Approval whose reason is
   * SUPERSEDED_BY_UPSTREAM_AMENDMENT. The checksums are the upstream
   * artifact's: the one the approval was given against, and the current one.
   */
  | {
      readonly kind: "upstream-amended";
      readonly reason: typeof SUPERSEDED_BY_UPSTREAM_AMENDMENT;
      readonly upstream: ArtifactKind;
      readonly approvedChecksum: Checksum;
      readonly currentChecksum: Checksum;
    }
  /** Rejected for a reason other than the checksum: always reported. */
  | { readonly kind: "rejected"; readonly reason: ApprovalRejectionReason }
  /** The approved artifact is not present: always reported. */
  | { readonly kind: "artifact-missing" };

/** One record with its standing. */
export interface EvaluatedApproval<R extends EvaluatedApprovalInput> {
  readonly record: R;
  readonly standing: ApprovalStanding;
}

/** Every record's standing and each present artifact's requirement. */
export interface ApprovalEvaluation<R extends EvaluatedApprovalInput> {
  /** The records in the order given. */
  readonly records: readonly EvaluatedApproval<R>[];
  /** For each artifact present, whether its current text holds the required approvals. */
  readonly artifacts: ReadonlyMap<ArtifactKind, RequiredApprovalsResult>;
}

/** The upstream amendment an approval was given before. */
interface UpstreamAmendment {
  readonly upstream: ArtifactKind;
  readonly approvedChecksum: Checksum;
  readonly currentChecksum: Checksum;
}

/**
 * Decide each approval record's standing and each present artifact's
 * approval requirement, from the records, the policy, the signal commits and
 * the artifacts' current checksums.
 *
 * `records` are in ledger order: which upstream text an approval was given
 * against is read from the order (criteria 8.6, 8.7). An approval of design
 * or tasks counts only while, for each artifact upstream of it, the latest
 * authentic approval of that upstream artifact recorded before it binds the
 * upstream artifact's current checksum. Authentic means valid but for its
 * checksum: an unsigned or forged record neither voids nor restores anything.
 * So amending requirements voids the design and plan approvals given before
 * the amendment; re-approving requirements, then design, then tasks, restores
 * them. When no upstream approval precedes an approval, there is no upstream
 * text it was given against, and this rule does not apply.
 *
 * `currentChecksums` holds an entry for each artifact that is present.
 */
export function evaluateApprovals<R extends EvaluatedApprovalInput>(
  records: readonly R[],
  policy: ApprovalPolicy | null,
  riskClass: RiskClass,
  gitCommits: ReadonlyMap<string, GitCommit>,
  currentChecksums: ReadonlyMap<ArtifactKind, Checksum>,
): ApprovalEvaluation<R> {
  const verdicts = records.map((record) => {
    const current = currentChecksums.get(record.artifact);
    return current === undefined
      ? { record, current, result: null }
      : { record, current, result: verifyApproval(record, policy, riskClass, gitCommits, current) };
  });

  const authentic = (result: ApprovalVerificationResult | null): boolean =>
    result !== null && (result.valid || result.reason === "CHECKSUM_MISMATCH");

  const amendmentBefore = (index: number, kind: ArtifactKind): UpstreamAmendment | null => {
    for (const upstream of UPSTREAM_ARTIFACTS[kind]) {
      const currentChecksum = currentChecksums.get(upstream);
      if (currentChecksum === undefined) continue;
      let approvedChecksum: Checksum | undefined;
      for (let i = 0; i < index; i++) {
        const earlier = verdicts[i]!;
        if (earlier.record.artifact === upstream && authentic(earlier.result)) {
          approvedChecksum = earlier.record.artifactChecksum;
        }
      }
      if (approvedChecksum !== undefined && approvedChecksum !== currentChecksum) {
        return { upstream, approvedChecksum, currentChecksum };
      }
    }
    return null;
  };

  const amendments = verdicts.map(({ record, result }, index) =>
    result?.valid === true ? amendmentBefore(index, record.artifact) : null,
  );
  const counts = (index: number): boolean =>
    verdicts[index]!.result?.valid === true && amendments[index] === null;

  // Approvers who hold a counting approval of each artifact's current text.
  const renewed = new Map<ArtifactKind, string[]>();
  verdicts.forEach(({ record }, index) => {
    if (!counts(index)) return;
    const approvers = renewed.get(record.artifact) ?? [];
    if (!approvers.some((approver) => matchesApprover(approver, record.approver))) {
      renewed.set(record.artifact, [...approvers, record.approver]);
    }
  });

  // Criterion 7.11: N counting approvals from N distinct authorised approvers.
  const artifacts = new Map<ArtifactKind, RequiredApprovalsResult>();
  for (const kind of currentChecksums.keys()) {
    const required = getRequiredApprovalCount(policy, riskClass, kind);
    const count = renewed.get(kind)?.length ?? 0;
    artifacts.set(kind, { met: required > 0 && count >= required, count, required });
  }

  const replaced = (record: R): boolean =>
    artifacts.get(record.artifact)?.met === true ||
    (renewed.get(record.artifact) ?? []).some((approver) =>
      matchesApprover(approver, record.approver),
    );

  const evaluated = verdicts.map(({ record, current, result }, index): EvaluatedApproval<R> => {
    if (current === undefined || result === null) {
      return { record, standing: { kind: "artifact-missing" } };
    }
    if (result.valid) {
      const amendment = amendments[index];
      if (amendment === null || amendment === undefined) {
        return { record, standing: { kind: "valid" } };
      }
      return {
        record,
        standing: replaced(record)
          ? { kind: "superseded", ...amendment }
          : { kind: "upstream-amended", reason: SUPERSEDED_BY_UPSTREAM_AMENDMENT, ...amendment },
      };
    }
    if (result.reason !== "CHECKSUM_MISMATCH") {
      return { record, standing: { kind: "rejected", reason: result.reason } };
    }
    const checksums = { approvedChecksum: record.artifactChecksum, currentChecksum: current };
    return {
      record,
      standing: replaced(record)
        ? { kind: "superseded", ...checksums }
        : { kind: "invalidated", ...checksums },
    };
  });

  return { records: Object.freeze(evaluated), artifacts };
}

/**
 * One line naming why an approval does not count, for a standing that is
 * reported: `invalidated`, `upstream-amended`, `rejected` or
 * `artifact-missing`. Null for a standing that is not reported.
 */
export function describeStanding(
  record: EvaluatedApprovalInput,
  standing: ApprovalStanding,
): string | null {
  switch (standing.kind) {
    case "valid":
    case "superseded":
      return null;
    case "invalidated":
      return `CHECKSUM_MISMATCH — ${record.artifact}.md was approved at ${standing.approvedChecksum} and is now ${standing.currentChecksum}`;
    case "upstream-amended":
      return `${standing.reason} — ${record.artifact}.md was approved while ${standing.upstream}.md was at ${standing.approvedChecksum}; ${standing.upstream}.md has since been amended to ${standing.currentChecksum}`;
    case "rejected":
      return standing.reason;
    case "artifact-missing":
      return `approved artifact ${record.artifact}.md is not present`;
  }
}
