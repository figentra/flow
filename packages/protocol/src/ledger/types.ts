/**
 * Ledger Entry domain types for the Vellum Platform.
 *
 * Each Ledger Entry is a JSON Line in .sdlc/ledger.jsonl with a hash-chained structure.
 *
 * @see requirements.md Requirements 4.1, 4.5
 */

// ============================================================================
// Ledger Entry Header
// ============================================================================

/**
 * Supported Ledger Entry kinds.
 */
export type LedgerEntryKind =
  | "approval"
  | "rejection"
  | "evidence"
  | "decision"
  | "amendment"
  | "gate_result"
  | "merge"
  | "release"
  | "claim"
  | "failure"
  | "attempt"
  | "task_binding"
  | "adoption";

/**
 * Header fields present in every Ledger Entry.
 */
export interface LedgerEntryHeader {
  /** The kind of entry (discriminant) */
  kind: LedgerEntryKind;
  /** Monotonically increasing identifier, starting at 1 */
  id: number;
  /** SHA-256 hex string of preceding entry's canonical JSON, null for first entry */
  predecessor_digest: string | null;
  /** UTC ISO 8601 timestamp when entry was appended */
  timestamp: string;
}

// ============================================================================
// Approval Entry
// ============================================================================

/**
 * Approval Signal commit reference.
 */
export interface ApprovalSignal {
  /**
   * Git commit SHA of the Approval Signal, or null when the signal is the
   * commit that adds this entry to the ledger. `vellum approve` writes null:
   * the approver's own signed commit of the ledger line is the signal, and
   * verification resolves it from git history.
   */
  commit: string | null;
  /** Commit message prefix */
  message_prefix: string;
}

/**
 * Approval Record - records a human's approval of an artifact version.
 */
export interface ApprovalPayload {
  /** The artifact that was approved */
  artifact: "requirements.md" | "design.md" | "tasks.md";
  /** The artifact version at approval time */
  artifact_version: number;
  /** SHA-256 of artifact body at approval time, in the form `checksum_form` names */
  artifact_checksum: string;
  /**
   * The canonical form `artifact_checksum` hashes (checksum-form.ts). Absent
   * on entries written by Vellum 0.1.2 and earlier, which are form 1.
   */
  checksum_form?: 1 | 2;
  /** Email of the Authorised Approver */
  identity: string;
  /** GPG or SSH key fingerprint used to sign the Approval Signal */
  identity_key: string;
  /** Session type - "human" required, "assistant" rejected */
  session_type: "human" | "assistant" | "ci";
  /** Reference to the Approval Signal commit */
  approval_signal: ApprovalSignal;
}

// ============================================================================
// Rejection Entry
// ============================================================================

/**
 * Rejection Record - records an Authorised Approver's refusal.
 */
export interface RejectionPayload {
  /** The artifact that was rejected */
  artifact: "requirements.md" | "design.md" | "tasks.md";
  /** The artifact version at rejection time */
  artifact_version: number;
  /** Email of the rejecting Approver */
  identity: string;
  /** Rationale for rejection */
  rationale: string;
}

// ============================================================================
// Evidence Entry
// ============================================================================

/**
 * Environment versions recorded in Evidence Entry.
 */
export interface EnvironmentVersions {
  /** Vellum Platform version */
  platform: string;
  /** Schema version */
  schema: string;
  /** Node.js version */
  node: string;
}

/**
 * Evidence Entry - records a Verification Command run.
 * Holds NO stdout/stderr content (Requirement 9.3).
 */
export interface EvidencePayload {
  /** Task identifier in "N.N" format */
  task_id: string;
  /** The Verification Command text */
  command: string;
  /** Exit status (0-255) */
  exit_status: number;
  /** UTC timestamp when command started */
  start_timestamp: string;
  /** UTC timestamp when command finished */
  finish_timestamp: string;
  /** HEAD commit at command start */
  commit: string;
  /** Paths the task declared */
  affected_paths: string[];
  /** Platform runtime versions */
  environment_versions: EnvironmentVersions;
  /** Whether working tree differed from HEAD in an affected path */
  uncommitted: boolean;
  /**
   * SHA-256 of the command's combined standard output and standard error.
   * Proves which output the run produced without storing it (criterion 9.3).
   */
  output_sha256?: string;
  /** Wall-clock duration of the run in milliseconds */
  duration_ms?: number;
  /** True when the Evidence Recorder stopped the command at its timeout */
  timed_out?: boolean;
}

// ============================================================================
// Task Binding Entry
// ============================================================================

/**
 * Task Binding - the artifact versions and checksums a task attempt started
 * against (criterion 18.5), which its completion is checked against
 * (criterion 18.10).
 */
export interface TaskBindingEntryPayload {
  /** Task identifier */
  task_id: string;
  requirements_version: number;
  requirements_checksum: string;
  design_version: number;
  design_checksum: string;
  plan_version: number;
  plan_checksum: string;
  /**
   * The canonical form the three checksums hash (checksum-form.ts). Absent on
   * entries written by Vellum 0.1.2 and earlier, which are form 1.
   */
  checksum_form?: 1 | 2;
}

// ============================================================================
// Decision Entry
// ============================================================================

/**
 * Decision Record - records a documented decision.
 */
export interface DecisionPayload {
  /** The decision text */
  decision: string;
  /** Rationale for the decision */
  rationale: string;
  /** Whether this decision blocks transitions */
  blocking: boolean;
}

// ============================================================================
// Amendment Entry
// ============================================================================

// ============================================================================
// Quality Finding Types (Slice 3)
// ============================================================================

/**
 * Quality Finding severity levels.
 */
export type FindingSeverity = "error" | "warn" | "info";

/**
 * Base Finding type for all finding categories.
 */
export interface Finding {
  /** Finding code/identifier */
  code: string;
  /** Finding level/severity */
  level: FindingSeverity;
  /** Human-readable message */
  message: string;
  /** Related spec ID if applicable */
  specId?: string;
}

/**
 * Quality Finding - one reported violation from the Quality Checker.
 */
export interface QualityFinding extends Finding {
  /** File path where the violation was found */
  file_path: string;
  /** Line number (1-based) where the violation was found */
  line_number: number;
  /** Stable Rule Identifier (e.g., EARS_PATTERN_INVALID) */
  rule_id: string;
  /** The severity of this finding */
  severity: FindingSeverity;
  /** Criterion reference (e.g., "1.2") if applicable */
  criterion_reference?: string | undefined;
  /** Violating text excerpt if applicable */
  violating_text?: string | undefined;
}

/**
 * Helper to create a QualityFinding with both code/level and rule_id/severity.
 * Both code and rule_id are set to the same value to maintain consistency.
 */
export function createQualityFinding(
  rule_id: string,
  message: string,
  file_path: string,
  line_number: number,
  severity: FindingSeverity = "error",
  criterion_reference?: string,
  violating_text?: string,
): QualityFinding {
  return {
    code: rule_id,
    level: severity,
    rule_id,
    message,
    file_path,
    line_number,
    severity,
    criterion_reference,
    violating_text,
  };
}

/**
 * Check Definition - the specification of one mechanical quality rule.
 */
export interface CheckDefinition {
  /** Stable identifier matching a Quality Checker rule (e.g., EARS_PATTERN_INVALID) */
  code: string;
  /** Which Artifact kinds this rule applies to */
  artifact_kind: "requirements" | "design" | "plan" | "all";
  /** Human-readable explanation shown in diagnostics */
  description: string;
  /** The severity a Check Result inherits */
  severity: FindingSeverity;
  /** The sections of the artifact this rule reads */
  applicable_sections: string[];
}

/**
 * Check Result - one evaluation of one Check Definition against one Artifact Version.
 */
export interface CheckResult {
  /** Unique identifier for this result */
  id: string;
  /** Foreign Key to CheckDefinition.code */
  check_code: string;
  /** Path to the artifact file */
  artifact_path: string;
  /** The Artifact Version this result evaluates */
  artifact_version: number;
  /** The outcome: pass, fail, warn, skip */
  status: "pass" | "fail" | "warn" | "skip";
  /** Zero or more findings */
  findings: QualityFinding[];
  /** UTC timestamp when the check ran */
  evaluated_at: string;
}

/**
 * Gate Result Record - records the outcome of a gate evaluation.
 */
export interface GateResultPayload {
  /** Gate identifier (e.g., "requirements-review", "merge-gate") */
  gate_id: string;
  /** Gate status */
  status: "pass" | "fail" | "warn";
  /** Findings from the gate evaluation */
  findings: QualityFinding[];
  /** Evidence references */
  evidence_references: string[];
  /** The artifact version this gate result is bound to */
  artifact_version: number;
  /** SHA-256 checksum of the artifact at evaluation time */
  artifact_checksum: string;
}

/**
 * Cross-Family Review Record - records findings from a different model family reviewer.
 */
export interface CrossFamilyReviewPayload {
  /** The artifact that was reviewed */
  artifact_path: string;
  /** The artifact version at review time */
  artifact_version: number;
  /** SHA-256 checksum of the artifact at review time */
  artifact_checksum: string;
  /** The Agent Role that ran the review */
  reviewer_agent_role: string;
  /** The model identifier */
  model: string;
  /** The Model Family of the reviewer */
  model_family: string;
  /** Advisory findings from the review */
  findings: QualityFinding[];
}

/**
 * Amendment Payload - records a change to an approved artifact with impact analysis.
 */
export interface AmendmentPayload {
  /** Which artifact was amended */
  artifact_path: string;
  /** Version before the amendment */
  from_version: number;
  /** Version after the amendment */
  to_version: number;
  /** Criteria affected by the amendment */
  affected_criteria: string[];
  /** Properties affected by the amendment */
  affected_properties: string[];
  /** Tasks affected by the amendment */
  affected_tasks: string[];
  /** Tests affected by the amendment */
  affected_tests: string[];
  /** Approvals invalidated by the amendment */
  invalidated_approvals: string[];
}

// ============================================================================
// Future Entry Kinds (Slice 3)
// ============================================================================

/**
 * Merge Record - Slice 3 placeholder.
 */
export interface MergePayload {
  merge_commit: string;
  platform_reference: string;
}

/**
 * Release Record - Slice 3 placeholder.
 */
export interface ReleasePayload {
  release_identifier: string;
  platform_reference: string;
}

/**
 * Claim Record - records a claim with provenance.
 */
export interface ClaimPayload {
  /** The claim text */
  claim: string;
  /** Where the claim originated */
  provenance: "human" | "agent";
  /** Whether the claim has been verified */
  verified: boolean;
}

/**
 * Failure Record - records a failure incident.
 */
export interface FailurePayload {
  /** What failed */
  component: string;
  /** Error message */
  error: string;
  /** Stack trace or additional context */
  context: string;
}

/**
 * Attempt Record - records a model or task attempt (spec 037).
 * Used for retry counts metric (spec 039 Assumption 1).
 */
export interface AttemptPayload {
  /** Task identifier */
  task_id: string;
  /** Role tier */
  role_tier?: string;
  /** Model identifier */
  model?: string;
  /** Findings from the attempt */
  findings?: string[];
  /** Outcome: success, failure, retry, escalated */
  outcome: "success" | "failure" | "retry" | "escalated";
}

/**
 * Adoption Record - records that a Legacy Spec was brought under Vellum
 * management (criterion 14). `vellum adopt` appends it as the spec's first
 * entry, after writing the Lifecycle Frontmatter; its presence is what makes
 * a second adopt a no-op. It records no approval (criterion 14.3).
 */
export interface AdoptionEntryPayload {
  /** Always "legacy": what the spec was before */
  from: "legacy";
  /** Always "managed": what the spec is after */
  to: "managed";
}

// ============================================================================
// Ledger Entry (Discriminated Union)
// ============================================================================

/**
 * Ledger Entry - discriminated union of all entry kinds.
 * Each entry has a header (common fields) and a payload (kind-specific fields).
 */
export type LedgerEntry =
  | (LedgerEntryHeader & ApprovalPayload)
  | (LedgerEntryHeader & RejectionPayload)
  | (LedgerEntryHeader & EvidencePayload)
  | (LedgerEntryHeader & DecisionPayload)
  | (LedgerEntryHeader & AmendmentPayload)
  | (LedgerEntryHeader & GateResultPayload)
  | (LedgerEntryHeader & MergePayload)
  | (LedgerEntryHeader & ReleasePayload)
  | (LedgerEntryHeader & ClaimPayload)
  | (LedgerEntryHeader & FailurePayload)
  | (LedgerEntryHeader & AttemptPayload)
  | (LedgerEntryHeader & TaskBindingEntryPayload)
  | (LedgerEntryHeader & AdoptionEntryPayload);

// ============================================================================
// Ledger Integrity Types
// ============================================================================

/**
 * Ledger Integrity Failure - a break in the hash chain.
 */
export interface LedgerIntegrityFailure {
  /** Entry identifier where the failure was detected */
  entry_id: number;
  /** Type of integrity failure */
  kind:
    | "predecessor_digest_mismatch"
    | "missing_entry"
    | "ordering_violation"
    | "fork"
    | "head_mismatch";
  /** Human-readable description */
  message: string;
  /** Additional entry identifier (for fork detection) */
  other_entry_id?: number;
}

/**
 * Ledger Head - the last entry the ledger writer appended, recorded beside the
 * ledger (`.sdlc/ledger.head.json`) and rewritten on every append.
 *
 * The hash chain proves each entry's predecessors, but nothing inside the
 * ledger proves that entries were not removed from its end, or that its last
 * entry was not edited. The head closes both gaps: verification compares the
 * ledger's last entry id and digest with the head. A ledger with entries and
 * no head fails verification. An attacker who truncates the ledger and
 * rewrites the head in the same change is not detectable from the working
 * tree alone; the git history of both files (and the signed commits that
 * added approvals) is what records that.
 */
export interface LedgerHead {
  /** Identifier of the last entry in the ledger */
  last_id: number;
  /** computeLedgerEntryDigest of the last entry */
  last_digest: string;
}

/**
 * Ledger Fork - two entries with the same predecessor digest.
 */
export interface LedgerFork {
  /** First entry identifier */
  entry_id_1: number;
  /** Second entry identifier */
  entry_id_2: number;
  /** Shared predecessor digest */
  predecessor_digest: string;
}

// ============================================================================
// Ledger Metadata
// ============================================================================

/**
 * Ledger Metadata - summary of ledger state.
 */
export interface LedgerMetadata {
  /** Total number of entries */
  entry_count: number;
  /** First entry ID (should be 1) */
  first_entry_id: number;
  /** Last entry ID */
  last_entry_id: number;
  /** Whether the chain integrity has been verified */
  integrity_verified: boolean;
  /** Timestamp of last verification */
  last_verified?: string;
}

// ============================================================================
// Convenience Type Aliases
// ============================================================================

/**
 * Approval Record - a ledger entry of kind "approval".
 * Convenience type for working with approval entries.
 */
export type ApprovalRecord = LedgerEntryHeader & ApprovalPayload;

/**
 * Rejection Record - a ledger entry of kind "rejection".
 * Convenience type for working with rejection entries.
 */
export type RejectionRecord = LedgerEntryHeader & RejectionPayload;

/**
 * Evidence Record - a ledger entry of kind "evidence".
 * Convenience type for working with evidence entries.
 */
export type EvidenceRecord = LedgerEntryHeader & EvidencePayload;

/**
 * Decision Record - a ledger entry of kind "decision".
 * Convenience type for working with decision entries.
 */
export type DecisionRecord = LedgerEntryHeader & DecisionPayload;

/**
 * Amendment Record - a ledger entry of kind "amendment".
 * Convenience type for working with amendment entries.
 */
export type AmendmentRecord = LedgerEntryHeader & AmendmentPayload;

/**
 * Gate Result Record - a ledger entry of kind "gate_result".
 * Convenience type for working with gate result entries.
 */
export type GateResultRecord = LedgerEntryHeader & GateResultPayload;

/**
 * Merge Record - a ledger entry of kind "merge".
 * Convenience type for working with merge entries.
 */
export type MergeRecord = LedgerEntryHeader & MergePayload;

/**
 * Release Record - a ledger entry of kind "release".
 * Convenience type for working with release entries.
 */
export type ReleaseRecord = LedgerEntryHeader & ReleasePayload;

/**
 * Claim Record - a ledger entry of kind "claim".
 * Convenience type for working with claim entries.
 */
export type ClaimRecord = LedgerEntryHeader & ClaimPayload;

/**
 * Failure Record - a ledger entry of kind "failure".
 * Convenience type for working with failure entries.
 */
export type FailureRecord = LedgerEntryHeader & FailurePayload;
