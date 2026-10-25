/**
 * Review Gate - evaluates review gates for requirements, design, and plan artifacts.
 *
 * A review gate runs the Quality Checker on the artifact under review and
 * checks the artifact holds the approvals the policy requires, and binds its
 * result to the artifact's version and current checksum (004 criteria 5.1-5.4).
 *
 * @see requirements.md Requirements 5.1-5.4
 */

import type {
  ApprovalPolicy,
  Artifact,
  ArtifactKind,
  GitCommit,
  LedgerEntry,
} from "@vellum/protocol";
import { computeChecksum } from "@vellum/protocol";
import {
  approvalRecords,
  resolveApprovalSignals,
  type ApprovalCommitResolution,
} from "../approval/records.js";
import { evaluateApprovals } from "../approval/evaluate.js";
import { runQualityChecks } from "../quality/index.js";
import type { AdrStatus } from "../quality/section-checker.js";
import type { GateEvaluationResult, GateRunnerOptions } from "./index";
import { GateOutcome } from "./gate-outcome.js";

/** What approvals are verified against. */
export interface GateApprovalInputs {
  /** The spec's ledger */
  readonly ledger: readonly LedgerEntry[];
  /** The Approval Policy; null when missing */
  readonly policy: ApprovalPolicy | null;
  /** Approval signal commits, keyed by SHA */
  readonly gitCommits: ReadonlyMap<string, GitCommit>;
  /** The commit that added each approval entry, keyed by entry id */
  readonly approvalCommits?: ReadonlyMap<number, ApprovalCommitResolution>;
}

/** What a review gate evaluates, as the caller read it from the repository. */
export interface ReviewGateInputs {
  /** The spec's artifacts: the one under review, and earlier ones for cross-reference */
  readonly artifacts?: readonly Artifact[];
  /** Ledger, policy and git context for the approval check */
  readonly approvals?: GateApprovalInputs;
  /** ADR number to status, for design.md's ADR citations */
  readonly adrs?: ReadonlyMap<string, AdrStatus>;
}

const ARTIFACT_OF: Record<"requirements" | "design" | "plan", ArtifactKind> = {
  requirements: "requirements",
  design: "design",
  plan: "tasks",
};

/**
 * Review gate for a single artifact.
 */
export class ReviewGate {
  constructor(
    private readonly kind: "requirements" | "design" | "plan",
    private readonly options: GateRunnerOptions,
    private readonly inputs: ReviewGateInputs = {},
  ) {}

  /**
   * Evaluate the review gate.
   *
   * @returns Gate evaluation result
   */
  evaluate(): GateEvaluationResult {
    const gateId = `${this.kind}-review`;
    const artifactKind = ARTIFACT_OF[this.kind];
    const artifactPath = `.agents/specs/${this.options.spec_slug}/${artifactKind}.md`;
    const outcome = new GateOutcome(artifactPath);

    const byKind = new Map((this.inputs.artifacts ?? []).map((a) => [a.kind, a] as const));
    const artifact = byKind.get(artifactKind);
    if (!artifact) {
      const reason =
        this.inputs.artifacts === undefined
          ? "the spec's artifacts were not supplied"
          : `${artifactKind}.md is not present`;
      outcome.skip("quality checks (criterion 5.1)", reason);
      outcome.skip("required approvals (criterion 5.3)", reason);
      return this.result(gateId, outcome, null, null);
    }

    const checksum = computeChecksum(artifact.body);
    const version = artifact.frontmatter.version;

    // Quality checks (criterion 5.1)
    const quality = runQualityChecks({
      filePath: artifactPath,
      content: artifact.body,
      kind: this.kind,
      version,
      ...(byKind.get("requirements")
        ? { requirementsContent: byKind.get("requirements")!.body }
        : {}),
      ...(byKind.get("design") ? { designContent: byKind.get("design")!.body } : {}),
      ...(this.inputs.adrs ? { adrs: this.inputs.adrs } : {}),
    });
    outcome.findings.push(...quality.findings);
    for (const skipped of quality.not_checked) {
      outcome.skip(`quality: ${skipped.check}`, skipped.reason);
    }

    // Required approvals of this version (criterion 5.3)
    const approvals = this.inputs.approvals;
    if (!approvals) {
      outcome.skip(
        "required approvals (criterion 5.3)",
        "the ledger, policy and approval signal commits were not supplied",
      );
    } else {
      const records = resolveApprovalSignals(
        approvalRecords(approvals.ledger, this.inputs.artifacts ?? []),
        approvals.approvalCommits,
      ).flatMap((resolved) => (resolved.problem === undefined ? [resolved.record] : []));
      const required = evaluateApprovals(
        records,
        approvals.policy,
        this.options.risk_class,
        approvals.gitCommits,
        new Map([...byKind].map(([kind, a]) => [kind, computeChecksum(a.body)] as const)),
      ).artifacts.get(artifactKind)!;
      if (!required.met) {
        outcome.finding(
          "MISSING_APPROVAL",
          required.required === 0
            ? `The policy names no required approvals for ${artifactKind} at risk class ${this.options.risk_class}`
            : `${artifactKind} has ${required.count} of ${required.required} required valid approvals at its current checksum`,
        );
      }
    }

    return this.result(gateId, outcome, version, checksum);
  }

  private result(
    gateId: string,
    outcome: GateOutcome,
    version: number | null,
    checksum: string | null,
  ): GateEvaluationResult {
    return {
      gate_id: gateId,
      status: outcome.status(),
      findings: outcome.findings,
      not_checked: outcome.notChecked,
      artifact_version: version,
      artifact_checksum: checksum,
    };
  }
}
