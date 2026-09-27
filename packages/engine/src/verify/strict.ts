/**
 * @vellum/engine — Strict Verifier
 *
 * Verifies all gates pass and coverage is complete.
 * Pure function - no I/O.
 *
 * @see design.md Criterion 12
 */

import type {
  Artifact,
  LedgerEntry,
  LedgerHead,
  ApprovalPolicy,
  Finding,
  CheckResult,
  GitCommit,
  RiskClass,
  TaskLine,
} from "@vellum/protocol";
import { canonicalArtifactBody, computeChecksum, parseTaskItems } from "@vellum/protocol";
import {
  approvalRecords,
  resolveApprovalSignals,
  type ApprovalCommitResolution,
} from "../approval/records.js";
import { computeCoverage } from "../coverage/validate.js";
import { checkLedgerIntegrity } from "../ledger/integrity.js";
import { evaluateApprovals } from "../approval/evaluate.js";
import { createFinding } from "../validate/finding.js";
import { requiredTasks as requiredTasksOf } from "../lifecycle/required-tasks.js";

/**
 * Strict verification result.
 */
export interface StrictVerificationResult {
  /** Overall result */
  readonly result: CheckResult;
  /** Criteria coverage */
  readonly criteria: { readonly satisfied: number; readonly total: number };
  /** Properties cited */
  readonly properties: { readonly satisfied: number; readonly total: number };
  /** Tasks verified */
  readonly tasks: { readonly satisfied: number; readonly total: number };
  /** Evidence entries */
  readonly evidence: { readonly satisfied: number; readonly total: number };
  /**
   * Approvals valid, of the approvals that count or are findings: an approval
   * superseded by a re-approval of the current text is not in `total`.
   */
  readonly approvals: { readonly satisfied: number; readonly total: number };
  /** Approvals bound to an older checksum whose artifact was approved again: history */
  readonly supersededApprovals: number;
  /** All findings */
  readonly findings: readonly Finding[];
}

/** What the storage layer read from git for strict verification. */
export interface StrictVerifyOptions {
  /**
   * The Ledger Head beside the ledger; null when its file is absent. When
   * given, the ledger's tail is checked against it (truncation, last-entry
   * edits). Omitted: the tail is not checked.
   */
  readonly ledgerHead?: LedgerHead | null;
  /**
   * The commit that added each approval entry (by entry id). When given, that
   * commit is the Approval Signal, and an approval whose adding commit is
   * unknown or unsuitable does not count (see resolveApprovalSignals).
   */
  readonly approvalCommits?: ReadonlyMap<number, ApprovalCommitResolution>;
  /**
   * The verified commit and its ancestors. When given, an Evidence Entry
   * counts only if its commit is one of them (criteria 12.4, 9.9).
   */
  readonly verifiedHistory?: ReadonlySet<string>;
}

/**
 * Run strict verification on a spec.
 * Pure function - all data passed in.
 *
 * @param artifacts - The spec's artifacts
 * @param ledger - The spec's ledger
 * @param policy - Approval policy
 * @param gitCommits - Git commits referenced in approvals
 * @param riskClass - The spec's risk class, which selects the policy's approvers
 * @param options - Ledger head, approval adding commits and verified history read from git
 * @returns Verification result
 */
export function strictVerify(
  artifacts: readonly Artifact[],
  ledger: readonly LedgerEntry[],
  policy: ApprovalPolicy | null,
  gitCommits: ReadonlyMap<string, GitCommit>,
  riskClass: RiskClass,
  options: StrictVerifyOptions = {},
): StrictVerificationResult {
  const findings: Finding[] = [];

  // Check ledger integrity (criterion 12.6)
  const ledgerResult = checkLedgerIntegrity(ledger, options.ledgerHead);
  if (!ledgerResult.valid) {
    for (const failure of ledgerResult.failures) {
      findings.push(
        createFinding(".sdlc/ledger.jsonl", failure.entry_id, "LEDGER_INTEGRITY", failure.message),
      );
    }
  }

  // Each artifact must be present to be verified at all
  const byKind = new Map(artifacts.map((artifact) => [artifact.kind, artifact] as const));
  for (const kind of ["requirements", "design", "tasks"] as const) {
    if (!byKind.has(kind)) {
      findings.push(createFinding(`${kind}.md`, 0, "ARTIFACT_MISSING", `${kind}.md is missing`));
    }
  }

  // Verify each approval against the current artifact checksums (criteria
  // 12.5, 8.2). An approval bound to an older checksum is history once the
  // current text is approved again; see approval/evaluate.
  const records = resolveApprovalSignals(approvalRecords(ledger), options.approvalCommits);
  let validApprovals = 0;
  let supersededApprovals = 0;
  for (const { record, problem } of records) {
    if (problem === undefined) continue;
    findings.push(
      createFinding(
        ".sdlc/ledger.jsonl",
        record.entryId,
        "APPROVAL_INVALID",
        `Approval invalid: ${problem}`,
      ),
    );
  }
  const signalled = records.flatMap((resolved) =>
    resolved.problem === undefined ? [resolved.record] : [],
  );
  const currentChecksums = new Map(
    [...byKind].map(([kind, current]) => [kind, computeChecksum(current.body)] as const),
  );
  const evaluation = evaluateApprovals(signalled, policy, riskClass, gitCommits, currentChecksums);
  for (const { record, standing } of evaluation.records) {
    switch (standing.kind) {
      case "valid":
        validApprovals++;
        break;
      case "superseded":
        supersededApprovals++;
        break;
      case "invalidated":
        findings.push(
          createFinding(
            ".sdlc/ledger.jsonl",
            record.entryId,
            "APPROVAL_INVALID",
            `Approval invalid: CHECKSUM_MISMATCH — ${record.artifact}.md was approved at ${standing.approvedChecksum} and is now ${standing.currentChecksum}`,
          ),
        );
        break;
      case "rejected":
        findings.push(
          createFinding(
            ".sdlc/ledger.jsonl",
            record.entryId,
            "APPROVAL_INVALID",
            `Approval invalid: ${standing.reason}`,
          ),
        );
        break;
      case "artifact-missing":
        findings.push(
          createFinding(
            ".sdlc/ledger.jsonl",
            record.entryId,
            "APPROVAL_INVALID",
            `Approval invalid: approved artifact ${record.artifact}.md is not present`,
          ),
        );
        break;
    }
  }

  // Each present artifact holds the approvals the policy requires (criterion
  // 12.5): checking only the approvals that were recorded would pass a spec
  // that recorded none.
  for (const [kind, required] of evaluation.artifacts) {
    if (!required.met) {
      findings.push(
        createFinding(
          `${kind}.md`,
          0,
          "APPROVAL_REQUIRED",
          policy === null
            ? `${kind}.md cannot hold a valid approval: the Approval Policy is missing`
            : required.required === 0
              ? `The Approval Policy names no required approvals for ${kind} at risk class ${riskClass}`
              : `${kind}.md has ${required.count} of the ${required.required} valid approvals the policy requires`,
        ),
      );
    }
  }

  // Evidence (criteria 12.4, 9.9): an entry counts when it exited 0 and,
  // when the verified history is known, was recorded at the verified commit
  // or an ancestor. A failed attempt is not itself a finding; a Required Task
  // with no counting entry is.
  const passedTasks = new Set<string>();
  let validEvidence = 0;
  let totalEvidence = 0;
  for (const entry of ledger) {
    if (entry.kind !== "evidence") continue;
    totalEvidence++;
    const evidence = entry as unknown as {
      readonly task_id?: unknown;
      readonly exit_status?: unknown;
      readonly commit?: unknown;
    };
    if (evidence.exit_status !== 0) continue;
    const commit = typeof evidence.commit === "string" ? evidence.commit : "";
    if (options.verifiedHistory !== undefined && !options.verifiedHistory.has(commit)) {
      findings.push(
        createFinding(
          ".sdlc/ledger.jsonl",
          entry.id,
          "EVIDENCE_COMMIT_UNKNOWN",
          `Evidence entry ${entry.id} records commit ${commit.slice(0, 12) || "(none)"}, which is not the verified commit or an ancestor of it`,
        ),
      );
      continue;
    }
    validEvidence++;
    if (typeof evidence.task_id === "string") passedTasks.add(evidence.task_id);
  }

  const tasksArtifactForEvidence = byKind.get("tasks");
  const requiredTasks = tasksArtifactForEvidence
    ? requiredTasksOf(taskLines(canonicalArtifactBody(tasksArtifactForEvidence.body)))
    : [];
  let verifiedTasks = 0;
  for (const task of requiredTasks) {
    if (passedTasks.has(task.identifier)) {
      verifiedTasks++;
    } else {
      findings.push(
        createFinding(
          "tasks.md",
          task.lineNumber,
          "TASK_NOT_VERIFIED",
          `Task ${task.identifier} has no Evidence Entry with exit status 0`,
        ),
      );
    }
  }

  // Criteria coverage and property citation (criteria 12.2, 12.3), computed
  // from the artifacts rather than assumed
  const requirements = byKind.get("requirements");
  const design = byKind.get("design");
  const tasksArtifact = byKind.get("tasks");
  let criteria = { satisfied: 0, total: 0 };
  let properties = { satisfied: 0, total: 0 };
  if (requirements && design && tasksArtifact) {
    // Parsed in canonical form, so CRLF or re-padded tables read as the
    // approved text does.
    const coverage = computeCoverage(
      canonicalArtifactBody(requirements.body),
      canonicalArtifactBody(design.body),
      taskLines(canonicalArtifactBody(tasksArtifact.body)),
    );
    criteria = {
      satisfied: coverage.examined.criteria - coverage.uncoveredCriteria.length,
      total: coverage.examined.criteria,
    };
    properties = {
      satisfied: coverage.examined.properties - coverage.uncitedProperties.length,
      total: coverage.examined.properties,
    };
    if (coverage.examined.criteria === 0) {
      findings.push(
        createFinding(
          "requirements.md",
          0,
          "CRITERIA_NOT_COVERED",
          "requirements.md defines no criteria",
        ),
      );
    }
    for (const id of coverage.uncoveredCriteria) {
      findings.push(
        createFinding(
          "tasks.md",
          0,
          "CRITERIA_NOT_COVERED",
          `Criterion ${id} is covered by no task`,
        ),
      );
    }
    for (const id of coverage.uncitedProperties) {
      findings.push(
        createFinding("tasks.md", 0, "PROPERTY_NOT_CITED", `Property ${id} is cited by no task`),
      );
    }
  }

  const tasks = { satisfied: verifiedTasks, total: requiredTasks.length };
  const evidence = { satisfied: validEvidence, total: totalEvidence };
  const approvals = { satisfied: validApprovals, total: records.length - supersededApprovals };

  // Overall PASS if all checks pass (criterion 12.1)
  const result: CheckResult = findings.length === 0 ? "PASS" : "FAIL";

  return {
    result,
    criteria,
    properties,
    tasks,
    evidence,
    approvals,
    supersededApprovals,
    findings: Object.freeze(findings),
  };
}

/** Parse the tasks of a tasks.md body, keeping their 1-based line numbers. */
function taskLines(body: string): TaskLine[] {
  return parseTaskItems(body);
}

/**
 * Compute exit status for strict verification.
 * Criterion 12.7: FAIL → exit status 1
 */
export function getVerificationExitStatus(result: StrictVerificationResult): number {
  return result.result === "PASS" ? 0 : 1;
}

/**
 * Format verification result as JSON.
 */
export function formatVerificationJson(result: StrictVerificationResult): string {
  return JSON.stringify(
    {
      result: result.result,
      criteria: result.criteria,
      properties: result.properties,
      tasks: result.tasks,
      evidence: result.evidence,
      approvals: result.approvals,
      supersededApprovals: result.supersededApprovals,
      findings: result.findings,
    },
    null,
    2,
  );
}

/**
 * Format verification result for CLI.
 */
export function formatVerificationHuman(result: StrictVerificationResult): string {
  const lines: string[] = [];

  lines.push(`Result: ${result.result}`);

  lines.push(``);
  lines.push(`Coverage:`);
  lines.push(`  Criteria: ${result.criteria.satisfied}/${result.criteria.total}`);
  lines.push(`  Properties: ${result.properties.satisfied}/${result.properties.total}`);
  lines.push(`  Tasks: ${result.tasks.satisfied}/${result.tasks.total}`);
  lines.push(`  Evidence: ${result.evidence.satisfied}/${result.evidence.total}`);
  lines.push(
    `  Approvals: ${result.approvals.satisfied}/${result.approvals.total}` +
      (result.supersededApprovals > 0
        ? ` (${result.supersededApprovals} superseded by re-approval, not counted)`
        : ""),
  );

  if (result.findings.length > 0) {
    lines.push(``);
    lines.push(`Findings:`);
    for (const finding of result.findings) {
      lines.push(`  ${finding.file}:${finding.line} ${finding.rule}: ${finding.message}`);
    }
  }

  return lines.join("\n");
}
