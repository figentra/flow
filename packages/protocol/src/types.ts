/**
 * @vellum/protocol — Core Domain Types
 *
 * This module defines the foundational types for the Vellum specification lifecycle.
 * All types are immutable (readonly) and follow the contract defined in design.md.
 */

import type { Branded } from "./branded.js";

// ============================================================================
// Branded Types for Domain Identifiers
// ============================================================================

/** A spec directory slug (e.g., "016-queue-capability") */
export type SpecSlug = Branded<string, "SpecSlug">;

/** A spec ID (e.g., "016") */
export type SpecId = Branded<string, "SpecId">;

/** A spec number (e.g., 16) */
export type SpecNumber = Branded<number, "SpecNumber">;

/** A checksum (SHA-256 hex string) */
export type Checksum = Branded<string, "Checksum">;

/** A Git commit SHA (40-hex-char string) */
export type CommitSha = Branded<string, "CommitSha">;

/** A task identifier (e.g., "1", "2.3") */
export type TaskId = Branded<string, "TaskId">;

/** A criterion identifier (e.g., "1.2") */
export type CriterionId = Branded<string, "CriterionId">;

/** A property identifier (e.g., "P1") */
export type PropertyId = Branded<string, "PropertyId">;

/** An artifact path (relative to spec directory) */
export type ArtifactPath = Branded<string, "ArtifactPath">;

/** A ledger entry sequence number */
export type EntrySeq = Branded<number, "EntrySeq">;

/** Entry ID (alias for compatibility) */
export type EntryId = EntrySeq;

/** Rule identifier */
export type RuleIdentifier = string;

// ============================================================================
// Spec Directory
// ============================================================================

/** A spec directory in `.agents/specs/<slug>/`. */
export interface SpecDirectory {
  /** Absolute path to spec directory */
  readonly path: string;
  /** Spec ID (e.g., "016") */
  readonly id: SpecId;
  /** Spec slug (e.g., "016-queue-capability") */
  readonly slug: SpecSlug;
  /** Spec number (e.g., 16) */
  readonly number: SpecNumber;
  /** Path to .sdlc machine folder */
  readonly machineFolder: string;
  /** Path to ledger.jsonl */
  readonly ledgerPath: string;
}

/** Spec metadata */
export interface SpecMetadata {
  /** Spec slug (e.g., "016-queue-capability") */
  readonly slug: SpecSlug;
  /** Spec ID (e.g., "016") */
  readonly specId: SpecId;
  /** Spec number (e.g., 16) */
  readonly specNumber: SpecNumber;
  /** Absolute path to spec directory */
  readonly path: string;
  /** Current lifecycle state */
  readonly state: LifecycleState;
}

// ============================================================================
// Artifact Types
// ============================================================================

/** One of the three protocol artifacts. */
export type ArtifactKind = "requirements" | "design" | "tasks";

/** One of the three artifact filenames. */
export type ArtifactFilename = "requirements.md" | "design.md" | "tasks.md";

/** An artifact file with parsed content. */
export interface Artifact {
  /** Artifact kind */
  readonly kind: ArtifactKind;
  /** Absolute path to artifact file */
  readonly path: string;
  /** Artifact body (excluding frontmatter) */
  readonly body: string;
  /** Parsed lifecycle frontmatter */
  readonly frontmatter: LifecycleFrontmatter;
}

// ============================================================================
// Lifecycle State
// ============================================================================

/** Lifecycle states from Table 5.A. */
export type LifecycleState =
  | "DRAFT"
  | "IN_REVIEW"
  | "REQUIREMENTS_APPROVED"
  | "DESIGN_IN_REVIEW"
  | "DESIGN_APPROVED"
  | "PLAN_IN_REVIEW"
  | "PLAN_APPROVED"
  | "IN_PROGRESS"
  | "VERIFICATION"
  | "VERIFIED"
  | "MERGED"
  | "RELEASED"
  | "DONE"
  | "BLOCKED"
  | "REJECTED"
  | "SUPERSEDED"
  | "ABANDONED"
  | "INVALID";

/** Terminal states cannot transition. */
export type TerminalState = "VERIFIED" | "REJECTED" | "SUPERSEDED" | "ABANDONED" | "INVALID";

/** Check if a state is terminal (no outgoing transitions). */
export function isTerminalState(state: LifecycleState): state is TerminalState {
  return (
    state === "VERIFIED" ||
    state === "REJECTED" ||
    state === "SUPERSEDED" ||
    state === "ABANDONED" ||
    state === "INVALID"
  );
}

/** Spec state stored in machine folder */
export interface SpecState {
  /** Effective state (may differ from recorded due to computed transitions) */
  readonly effectiveState: LifecycleState;
  /** State recorded in ledger */
  readonly recordedState: LifecycleState;
  /** Last transition metadata */
  readonly lastTransition?: {
    readonly from: LifecycleState;
    readonly to: LifecycleState;
    readonly timestamp: string;
    readonly commit: CommitSha;
  };
}

/** Lifecycle frontmatter at the top of each artifact. */
export interface LifecycleFrontmatter {
  /** Artifact version (incremented on body change) */
  readonly version: number;
  /** SHA-256 checksum of body (excluding frontmatter) */
  readonly checksum: Checksum;
  /** Recorded lifecycle state */
  readonly state: LifecycleState;
  /** ISO 8601 UTC timestamp when created */
  readonly createdAt: string;
  /** ISO 8601 UTC timestamp when last updated */
  readonly updatedAt: string;
}

// ============================================================================
// Task Types
// ============================================================================

/** Task marker characters */
export type TaskMarker = " " | "~" | "-" | "x";

/** A task line parsed from tasks.md */
export interface TaskLine {
  /** Line number in tasks.md (1-indexed) */
  readonly lineNumber: number;
  /** Task marker */
  readonly marker: TaskMarker;
  /** Task identifier (e.g., "1", "2.3") */
  readonly identifier: TaskId;
  /** Task text (after marker) */
  readonly text: string;
  /** Criterion refs from trailer (e.g., ["1.2", "3.4"]) */
  readonly requirementsTrailer?: readonly CriterionId[];
  /** Property refs from trailer (e.g., ["P1", "P2"]) */
  readonly propertiesTrailer?: readonly PropertyId[];
  /** Whether task is marked optional */
  readonly isOptional: boolean;
}

/** Task dependency graph */
export interface TaskGraph {
  /** All task identifiers */
  readonly nodes: readonly TaskId[];
  /** Edges: task ID -> set of dependency task IDs */
  readonly edges: ReadonlyMap<TaskId, readonly TaskId[]>;
}

// ============================================================================
// Ledger Types
// ============================================================================

/** Kinds of ledger entries */
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
  | "task_binding"
  | "block"
  | "unblock"
  | "adoption";

/** Ledger entry (unsigned, payload-only) */
export type LedgerPayload =
  | CreatedPayload
  | AmendedPayload
  | ApprovalPayload
  | RejectionPayload
  | EvidencePayload
  | DecisionPayload
  | ClaimPayload
  | FailurePayload
  | TaskBindingPayload
  | GateResultPayload
  | MergePayload
  | ReleasePayload
  | BlockPayload
  | UnblockPayload
  | AdoptionPayload;

/** Created payload (spec creation) */
export interface CreatedPayload {
  readonly type: "created";
  readonly spec: SpecSlug;
}

/** Amended payload */
export interface AmendedPayload {
  readonly type: "amended";
  readonly artifact: ArtifactKind;
  readonly fromVersion: number;
  readonly toVersion: number;
}

/** Approval payload */
export interface ApprovalPayload {
  readonly approver: string;
  readonly artifact: ArtifactKind;
  readonly artifactChecksum: Checksum;
  readonly signalCommit: CommitSha;
}

/** Rejection payload */
export interface RejectionPayload {
  readonly artifact: ArtifactKind;
  readonly rationale: string;
  readonly rejectedBy: string;
}

/** Evidence payload */
export interface EvidencePayload {
  readonly taskIdentifier: TaskId;
  readonly commandText: string;
  readonly exitStatus: number;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly headCommit: CommitSha;
  readonly affectedPaths: readonly string[];
  readonly environmentVersions: Record<string, string>;
}

/** Decision payload */
export interface DecisionPayload {
  readonly decision: string;
  readonly rationale: string;
  readonly blocking: boolean;
}

/** Claim payload */
export interface ClaimPayload {
  readonly claim: string;
  readonly provenance: "human" | "agent";
  readonly verified: boolean;
}

/** Failure payload */
export interface FailurePayload {
  readonly taskIdentifier: TaskId;
  readonly reason: string;
  readonly exitStatus: number;
}

/** Task binding payload (criterion 18.5) */
export interface TaskBindingPayload {
  readonly taskIdentifier: TaskId;
  readonly requirementsVersion: number;
  readonly requirementsChecksum: Checksum;
  readonly designVersion: number;
  readonly designChecksum: Checksum;
  readonly planVersion: number;
  readonly planChecksum: Checksum;
}

/** Gate result payload */
export interface GateResultPayload {
  readonly gateName: string;
  readonly result: CheckResult;
  readonly findings: readonly Finding[];
}

/** Merge payload */
export interface MergePayload {
  readonly mergeCommit: CommitSha;
  readonly platformRef: string;
}

/** Release payload */
export interface ReleasePayload {
  readonly releaseId: string;
  readonly platformRef: string;
}

/** Block payload */
export interface BlockPayload {
  readonly reason: string;
}

/** Unblock payload */
export interface UnblockPayload {
  readonly rationale: string;
}

/** Adoption payload */
export interface AdoptionPayload {
  readonly from: "legacy";
  readonly to: "managed";
}

/** Ledger entry header */
export interface LedgerEntryHeader {
  readonly kind: LedgerEntryKind;
  readonly id: number;
  readonly predecessor_digest: string | null;
  readonly timestamp: string;
  /** SHA-256 hash of entry (for integrity) */
  readonly hash?: Checksum;
}

/** Full ledger entry */
export type LedgerEntry = LedgerEntryHeader & LedgerPayload;

// ============================================================================
// Approval Types
// ============================================================================

/** Risk class for approval policy */
export type RiskClass = "low" | "standard" | "high" | "critical";

/** Approval policy structure */
export interface ApprovalPolicy {
  readonly approvers: ReadonlyMap<RiskClass, ReadonlyMap<ArtifactKind, readonly string[]>>;
  readonly requiredCount: ReadonlyMap<RiskClass, ReadonlyMap<ArtifactKind, number>>;
}

/** Git commit with metadata */
export interface GitCommit {
  readonly sha: CommitSha;
  readonly author: { readonly name: string; readonly email: string };
  readonly committer: { readonly name: string; readonly email: string };
  readonly message: string;
  readonly timestamp: string;
  readonly signature?: string;
  readonly sessionMetadata?: {
    readonly isAssistant: boolean;
    readonly assistantName?: string;
  };
}

// ============================================================================
// Validation Types
// ============================================================================

/** Check result */
export type CheckResult = "PASS" | "FAIL" | "INCONCLUSIVE";

/** A finding from a validator */
export interface Finding {
  readonly file: string;
  readonly line: number;
  readonly rule: RuleIdentifier;
  readonly message: string;
}

/** Examination summary for PASS results */
export interface ExaminationSummary {
  readonly kind: string;
  readonly count: number;
}

// ============================================================================
// Transition Types
// ============================================================================

/** Kinds of transition preconditions */
export type TransitionPreconditionKind =
  | "ARTIFACT_EXISTS"
  | "ARTIFACT_VALID"
  | "APPROVAL_COUNT_MET"
  | "NO_BLOCKING_DECISIONS"
  | "NO_OPEN_BLOCKING_QUESTIONS"
  | "PREVIOUS_APPROVALS_VALID"
  | "TASK_GRAPH_VALID"
  | "TASK_DISPATCHED"
  | "ALL_REQUIRED_TASKS_VERIFIED"
  | "STRICT_VERIFICATION_PASS"
  | "BLOCKING_REASON_RECORDED"
  | "UNBLOCKING_DECISION_RECORDED"
  | "RATIONALE_RECORDED"
  | "SUPERSEDING_SPEC_RECORDED"
  | "COVERAGE_COMPLETE"
  | "TRANSITION_INVALID";

/** A transition precondition check result */
export interface TransitionPrecondition {
  readonly kind: TransitionPreconditionKind;
  readonly met: boolean;
  readonly message?: string;
}

// ============================================================================
// Filesystem Interface
// ============================================================================

/**
 * Filesystem abstraction for storage operations.
 * Provides atomic operations to prevent corruption.
 */
export interface FileSystem {
  /** Read file contents as UTF-8 string */
  readFile(path: string): Promise<string>;
  /** Write file atomically (temp file + rename) */
  writeFile(path: string, content: string): Promise<void>;
  /** Check if file exists */
  exists(path: string): Promise<boolean>;
  /** List directory contents */
  readdir(path: string): Promise<readonly string[]>;
  /** Delete file */
  delete(path: string): Promise<void>;
  /** Get file stats */
  stat(path: string): Promise<{ mtime: Date; size: number; isDirectory: boolean }>;
  /** Create directory recursively */
  mkdirp(path: string): Promise<void>;
  /** Update a section between markers atomically */
  updateSection(
    path: string,
    options: {
      startMarker: string;
      endMarker: string;
      content: string;
    },
  ): Promise<void>;
}

// ============================================================================
// Git Types
// ============================================================================

/** Git repository status */
export interface GitStatus {
  readonly branch: string;
  readonly head: CommitSha;
  readonly modified: readonly string[];
  readonly staged: readonly string[];
  readonly untracked: readonly string[];
  readonly isClean: boolean;
}

/** Git reader interface */
export interface GitReader {
  getHead(): Promise<CommitSha>;
  getCommit(sha: CommitSha): Promise<GitCommit | null>;
  isAncestor(ancestor: CommitSha, descendant: CommitSha): Promise<boolean>;
  status(): Promise<GitStatus>;
  getCommitsUpTo(sha: CommitSha): Promise<readonly GitCommit[]>;
}

/** Git writer interface */
export interface GitWriter {
  add(files: readonly string[]): Promise<void>;
  commit(message: string, options?: { signoff?: boolean }): Promise<CommitSha>;
  tag(name: string, message: string): Promise<void>;
}

// ============================================================================
// Parsing and Formatting Functions
// ============================================================================

// Re-export from branded module
export {
  brand,
  unbrand,
  parseSpecId,
  formatSpecId,
  parseChecksum,
  formatChecksum,
  parseCommitSha,
  formatCommitSha,
  parseTaskId,
  formatTaskId,
  parseCriterionId,
  formatCriterionId,
  parsePropertyId,
  formatPropertyId,
  createEntryId,
  getEntryIdValue,
  parseRuleIdentifier,
  formatRuleIdentifier,
  isValidGitSha,
  isValidChecksum,
} from "./branded.js";
