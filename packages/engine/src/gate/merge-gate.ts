/**
 * Merge Gate - evaluates merge gate requirements.
 *
 * @see requirements.md Requirements 6.1-6.6
 */

import type { ArtifactKind, GitCommit } from "@vellum/protocol";
import { computeChecksum } from "@vellum/protocol";
import { approvalRecords, resolveApprovalSignals } from "../approval/records.js";
import { evaluateApprovals } from "../approval/evaluate.js";
import { getApprovers, matchesApprover, signerIsApprovers } from "../approval/verify.js";
import type { GateEvaluationResult, GateRunnerOptions } from "./index";
import { GateOutcome } from "./gate-outcome.js";
import { checkChangeset, type ChangesetFile } from "./validation/changeset-checker.js";
import {
  isStrictVerifierPassing,
  runStrictVerifier,
  type StrictVerifierInput,
} from "./validation/strict-verifier-bridge.js";

/** A merge authorisation: the Authorised Approver and the commit that signals it. */
export interface MergeAuthorisation {
  /** The authorising identity */
  readonly approver: string;
  /** The signed commit that carries the authorisation */
  readonly signalCommit: string;
}

/** What the merge gate evaluates, as the caller read it from the repository. */
export interface MergeGateInputs {
  /**
   * The spec as strict verification reads it. Its risk class is the gate's.
   * Missing: approvals, tasks, strict verification and required gates are not checked.
   */
  readonly spec?: Omit<StrictVerifierInput, "riskClass">;
  /** Gate ids the Policy requires to pass before merge (checked against the spec's ledger) */
  readonly requiredGates?: readonly string[];
  /** Whether the Policy requires a changeset, and the changeset files the change adds */
  readonly changesets?: { readonly required: boolean; readonly files?: readonly ChangesetFile[] };
  /** Whether the Policy permits automated merge at this risk class (criterion 6.4) */
  readonly automatedMergePermitted?: boolean;
  /** The merge authorisation, when one was given (criterion 6.3) */
  readonly authorisation?: MergeAuthorisation | null;
}

const REVIEWED: readonly ArtifactKind[] = ["requirements", "design", "tasks"];

/**
 * Merge gate evaluation.
 */
export class MergeGate {
  constructor(
    private readonly options: GateRunnerOptions,
    private readonly inputs: MergeGateInputs = {},
  ) {}

  /**
   * Evaluate the merge gate.
   *
   * Requirements 6.1-6.4:
   * - Valid approvals for requirements, design, plan
   * - Each required task succeeded with evidence
   * - Strict Verifier PASS
   * - All required gates passing
   * - Policy-required changesets and documentation
   * - Merge authorisation by Authorised Approver, unless policy permits automated merge
   */
  evaluate(): GateEvaluationResult {
    const outcome = new GateOutcome(`.agents/specs/${this.options.spec_slug}/`);
    const spec = this.inputs.spec;

    if (!spec) {
      const reason = "the spec's artifacts, ledger, policy and git context were not supplied";
      outcome.skip("valid approvals (criterion 6.1)", reason);
      outcome.skip("required tasks succeeded (criterion 6.1)", reason);
      outcome.skip("strict verification (criterion 6.1)", reason);
      outcome.skip("required gates passing (criterion 6.1)", reason);
    } else {
      this.checkApprovals(spec, outcome);
      this.checkStrictVerification(spec, outcome);
      this.checkRequiredGates(spec, outcome);
    }

    // Changesets (criterion 6.1)
    if (!this.inputs.changesets) {
      outcome.skip(
        "changesets (criterion 6.1)",
        "whether the Policy requires a changeset was not supplied",
      );
    } else {
      outcome.record(
        "changesets (criterion 6.1)",
        "MERGE_GATE_CHANGESET_INVALID",
        checkChangeset(this.inputs.changesets.required, this.inputs.changesets.files),
      );
    }

    // Documentation (criterion 6.1)
    outcome.skip(
      "documentation check (criterion 6.1)",
      "the Policy-required documentation check is not implemented in this engine version",
    );

    this.checkMergeAuthorisation(spec?.gitCommits, outcome);

    return {
      gate_id: "merge-gate",
      status: outcome.status(),
      findings: outcome.findings,
      not_checked: outcome.notChecked,
      artifact_version: null,
      artifact_checksum: null,
    };
  }

  /** Each reviewed artifact holds its required valid approvals (criterion 6.1). */
  private checkApprovals(spec: Omit<StrictVerifierInput, "riskClass">, outcome: GateOutcome): void {
    const records = resolveApprovalSignals(
      approvalRecords(spec.ledger, spec.artifacts),
      spec.options?.approvalCommits,
    ).flatMap((resolved) => (resolved.problem === undefined ? [resolved.record] : []));
    const byKind = new Map(spec.artifacts.map((a) => [a.kind, a] as const));
    const evaluation = evaluateApprovals(
      records,
      spec.policy,
      this.options.risk_class,
      spec.gitCommits,
      new Map(spec.artifacts.map((a) => [a.kind, computeChecksum(a.body)] as const)),
    );

    for (const kind of REVIEWED) {
      const artifact = byKind.get(kind);
      if (!artifact) {
        outcome.finding(
          "MERGE_GATE_INVALID_APPROVAL",
          `${kind}.md is missing, so it has no valid approval`,
        );
        continue;
      }
      const required = evaluation.artifacts.get(kind)!;
      if (!required.met) {
        outcome.finding(
          "MERGE_GATE_INVALID_APPROVAL",
          required.required === 0
            ? `The policy names no required approvals for ${kind} at risk class ${this.options.risk_class}`
            : `${kind} has ${required.count} of ${required.required} required valid approvals`,
        );
      }
    }
  }

  /** Required tasks succeeded with evidence, and the Strict Verifier passes (criterion 6.1). */
  private checkStrictVerification(
    spec: Omit<StrictVerifierInput, "riskClass">,
    outcome: GateOutcome,
  ): void {
    const strict = runStrictVerifier({ ...spec, riskClass: this.options.risk_class });
    const unverified = strict.findings.filter((f) => f.includes(" TASK_NOT_VERIFIED: "));
    for (const finding of unverified) {
      outcome.finding("MERGE_GATE_TASK_NOT_SUCCEEDED", finding);
    }
    if (!isStrictVerifierPassing(strict)) {
      outcome.finding(
        "MERGE_GATE_STRICT_VERIFIER_FAIL",
        `Strict Verifier reported ${strict.status}: ${strict.findings.join("; ")}`,
      );
    }
  }

  /** Each Policy-required gate's latest recorded result is pass (criterion 6.1). */
  private checkRequiredGates(
    spec: Omit<StrictVerifierInput, "riskClass">,
    outcome: GateOutcome,
  ): void {
    const required = this.inputs.requiredGates;
    if (required === undefined) {
      outcome.skip(
        "required gates passing (criterion 6.1)",
        "the Policy's required gates were not supplied",
      );
      return;
    }
    const latest = new Map<string, unknown>();
    for (const entry of spec.ledger) {
      if (entry.kind !== "gate_result") continue;
      const recorded = entry as unknown as {
        gate_id?: unknown;
        gateName?: unknown;
        status?: unknown;
        result?: unknown;
      };
      const gate = typeof recorded.gate_id === "string" ? recorded.gate_id : recorded.gateName;
      if (typeof gate === "string") latest.set(gate, recorded.status ?? recorded.result);
    }
    for (const gate of required) {
      const status = latest.get(gate);
      if (status === undefined) {
        outcome.finding(
          "MERGE_GATE_REQUIRED_GATE_MISSING",
          `Required gate ${gate} has no recorded result`,
        );
      } else if (status !== "pass" && status !== "PASS") {
        outcome.finding(
          "MERGE_GATE_REQUIRED_GATE_FAILING",
          `Required gate ${gate}'s latest result is ${String(status)}`,
        );
      }
    }
  }

  /**
   * A merge authorisation by an Authorised Approver (criterion 6.3), unless the
   * Policy permits automated merge at this risk class (criterion 6.4). The
   * authorisation counts only when its signal commit is signed by one of the
   * approver's policy keys and was not made in an assistant session.
   */
  private checkMergeAuthorisation(
    gitCommits: ReadonlyMap<string, GitCommit> | undefined,
    outcome: GateOutcome,
  ): void {
    const check = "merge authorisation (criteria 6.3-6.4)";
    if (this.inputs.automatedMergePermitted === true) return;
    if (this.inputs.automatedMergePermitted === undefined) {
      outcome.skip(check, "whether the Policy permits automated merge was not supplied");
      return;
    }
    const authorisation = this.inputs.authorisation;
    if (authorisation === undefined) {
      outcome.skip(check, "the merge authorisation was not supplied");
      return;
    }
    if (authorisation === null) {
      outcome.finding(
        "MERGE_GATE_NO_AUTHORISATION",
        "No merge authorisation from an Authorised Approver",
      );
      return;
    }
    const policy = this.inputs.spec?.policy;
    if (!policy || !gitCommits) {
      outcome.skip(
        check,
        "the policy and signal commits needed to verify the authorisation were not supplied",
      );
      return;
    }
    const authorised = REVIEWED.some((kind) =>
      getApprovers(policy, this.options.risk_class, kind).some((listed) =>
        matchesApprover(authorisation.approver, listed),
      ),
    );
    const commit = gitCommits.get(authorisation.signalCommit);
    const problem = !authorised
      ? `${authorisation.approver} is not an Authorised Approver at risk class ${this.options.risk_class}`
      : !commit
        ? `merge authorisation commit ${authorisation.signalCommit.slice(0, 12)} not found`
        : commit.sessionMetadata?.isAssistant
          ? "merge authorisation came from an assistant session"
          : !commit.signer || !signerIsApprovers(policy, authorisation.approver, commit.signer)
            ? `merge authorisation commit is not signed by a key the policy lists for ${authorisation.approver}`
            : null;
    if (problem !== null) outcome.finding("MERGE_GATE_NO_AUTHORISATION", problem);
  }
}
