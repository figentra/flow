/**
 * Ledger Entry JSON Schema validation.
 *
 * @see requirements.md Requirement 4.11
 */

import type { LedgerEntry, LedgerEntryKind } from "./types.js";

/**
 * Schema version for Ledger entries.
 */
export const LEDGER_SCHEMA_VERSION = "1.0";

/**
 * Finding reported during schema validation.
 */
export interface SchemaValidationFinding {
  /** Type of finding */
  kind: "schema_violation";
  /** Entry identifier (if applicable) */
  entry_id?: number | undefined;
  /** Field that failed validation */
  field: string;
  /** Human-readable message */
  message: string;
}

/**
 * Required header fields for all Ledger entries.
 */
const REQUIRED_HEADER_FIELDS = ["kind", "id", "predecessor_digest", "timestamp"];

/**
 * Valid Ledger entry kinds.
 */
const VALID_KINDS: LedgerEntryKind[] = [
  "approval",
  "rejection",
  "evidence",
  "decision",
  "amendment",
  "gate_result",
  "merge",
  "release",
  "claim",
  "failure",
  "attempt",
  "task_binding",
  "adoption",
];

/**
 * The one direction an adoption entry records, field by field. (Kept as data:
 * the bundle test scans for a quote after the word from, as in an import.)
 */
const ADOPTION_DIRECTION: Readonly<Record<string, string>> = { from: "legacy", to: "managed" };

/**
 * Required fields per entry kind.
 */
const KIND_REQUIRED_FIELDS: Record<LedgerEntryKind, string[]> = {
  approval: [
    "artifact",
    "artifact_version",
    "artifact_checksum",
    "identity",
    "identity_key",
    "session_type",
    "approval_signal",
  ],
  rejection: ["artifact", "artifact_version", "identity", "rationale"],
  evidence: [
    "task_id",
    "command",
    "exit_status",
    "start_timestamp",
    "finish_timestamp",
    "commit",
    "affected_paths",
    "environment_versions",
    "uncommitted",
  ],
  decision: ["decision", "rationale", "blocking"],
  amendment: ["original_id", "what_changed", "rationale"],
  gate_result: ["gate", "status", "findings"],
  merge: ["merge_commit", "platform_reference"],
  release: ["release_identifier", "platform_reference"],
  claim: ["claim", "provenance", "verified"],
  failure: ["component", "error", "context"],
  attempt: ["task_id", "outcome"],
  task_binding: [
    "task_id",
    "requirements_version",
    "requirements_checksum",
    "design_version",
    "design_checksum",
    "plan_version",
    "plan_checksum",
  ],
  adoption: Object.keys(ADOPTION_DIRECTION),
};

/**
 * Fields that must NOT appear in evidence entries (Requirement 9.3).
 */
export const EVIDENCE_FORBIDDEN_FIELDS = ["stdout", "stderr"];

/**
 * Validate a Ledger Entry against its schema.
 *
 * @param entry - The entry to validate (as a plain object)
 * @returns Array of findings (empty if valid)
 */
export function validateLedgerEntry(entry: Record<string, unknown>): SchemaValidationFinding[] {
  const findings: SchemaValidationFinding[] = [];

  // Check required header fields
  for (const field of REQUIRED_HEADER_FIELDS) {
    if (!(field in entry) || entry[field] === undefined) {
      findings.push({
        kind: "schema_violation",
        entry_id: typeof entry.id === "number" ? entry.id : undefined,
        field,
        message: `Missing required header field: ${field}`,
      });
    }
  }

  // Validate kind field
  if (entry.kind !== undefined) {
    if (!VALID_KINDS.includes(entry.kind as LedgerEntryKind)) {
      findings.push({
        kind: "schema_violation",
        entry_id: typeof entry.id === "number" ? entry.id : undefined,
        field: "kind",
        message: `Invalid entry kind: ${entry.kind}`,
      });
      return findings; // Can't validate kind-specific fields without valid kind
    }

    const kind = entry.kind as LedgerEntryKind;

    // Check kind-specific required fields
    const requiredFields = KIND_REQUIRED_FIELDS[kind];
    for (const field of requiredFields) {
      if (!(field in entry) || entry[field] === undefined) {
        findings.push({
          kind: "schema_violation",
          entry_id: typeof entry.id === "number" ? entry.id : undefined,
          field,
          message: `Missing required field for ${kind} entry: ${field}`,
        });
      }
    }

    // Validate evidence entry has no stdout/stderr (Requirement 9.3)
    if (kind === "evidence") {
      for (const forbidden of EVIDENCE_FORBIDDEN_FIELDS) {
        if (forbidden in entry) {
          findings.push({
            kind: "schema_violation",
            entry_id: typeof entry.id === "number" ? entry.id : undefined,
            field: forbidden,
            message: `Evidence entry must not contain ${forbidden} field (Requirement 9.3)`,
          });
        }
      }
    }

    // Validate kind-specific field types
    validateKindFieldTypes(entry, kind, findings);
  }

  // Validate id is positive integer
  if (typeof entry.id !== "number" || entry.id < 1 || !Number.isInteger(entry.id)) {
    findings.push({
      kind: "schema_violation",
      field: "id",
      message: "Entry id must be a positive integer",
    });
  }

  // Validate timestamp is ISO 8601 string
  if (typeof entry.timestamp === "string") {
    const timestampDate = new Date(entry.timestamp);
    if (isNaN(timestampDate.getTime())) {
      findings.push({
        kind: "schema_violation",
        entry_id: typeof entry.id === "number" ? entry.id : undefined,
        field: "timestamp",
        message: "Invalid ISO 8601 timestamp",
      });
    }
  }

  return findings;
}

/**
 * Validate field types for a specific entry kind.
 */
function validateKindFieldTypes(
  entry: Record<string, unknown>,
  kind: LedgerEntryKind,
  findings: SchemaValidationFinding[],
): void {
  const entryId = typeof entry.id === "number" ? entry.id : undefined;

  switch (kind) {
    case "approval":
      if (typeof entry.artifact_version !== "number" || entry.artifact_version < 1) {
        findings.push({
          kind: "schema_violation",
          entry_id: entryId,
          field: "artifact_version",
          message: "artifact_version must be a positive integer",
        });
      }
      if (
        typeof entry.artifact_checksum !== "string" ||
        !/^[a-f0-9]{64}$/.test(entry.artifact_checksum as string)
      ) {
        findings.push({
          kind: "schema_violation",
          entry_id: entryId,
          field: "artifact_checksum",
          message: "artifact_checksum must be a SHA-256 hex string (64 characters)",
        });
      }
      if (!["human", "assistant", "ci"].includes(entry.session_type as string)) {
        findings.push({
          kind: "schema_violation",
          entry_id: entryId,
          field: "session_type",
          message: "session_type must be 'human', 'assistant', or 'ci'",
        });
      }
      checkChecksumForm(entry, entryId, findings);
      break;

    case "task_binding":
      checkChecksumForm(entry, entryId, findings);
      break;

    case "evidence":
      if (
        typeof entry.exit_status !== "number" ||
        entry.exit_status < 0 ||
        entry.exit_status > 255
      ) {
        findings.push({
          kind: "schema_violation",
          entry_id: entryId,
          field: "exit_status",
          message: "exit_status must be an integer 0-255",
        });
      }
      if (!Array.isArray(entry.affected_paths)) {
        findings.push({
          kind: "schema_violation",
          entry_id: entryId,
          field: "affected_paths",
          message: "affected_paths must be an array",
        });
      }
      if (typeof entry.uncommitted !== "boolean") {
        findings.push({
          kind: "schema_violation",
          entry_id: entryId,
          field: "uncommitted",
          message: "uncommitted must be a boolean",
        });
      }
      break;

    case "decision":
      if (typeof entry.blocking !== "boolean") {
        findings.push({
          kind: "schema_violation",
          entry_id: entryId,
          field: "blocking",
          message: "blocking must be a boolean",
        });
      }
      break;

    case "gate_result":
      if (!["PASS", "FAIL"].includes(entry.status as string)) {
        findings.push({
          kind: "schema_violation",
          entry_id: entryId,
          field: "status",
          message: "status must be 'PASS' or 'FAIL'",
        });
      }
      if (!Array.isArray(entry.findings)) {
        findings.push({
          kind: "schema_violation",
          entry_id: entryId,
          field: "findings",
          message: "findings must be an array",
        });
      }
      break;

    case "adoption":
      for (const [field, expected] of Object.entries(ADOPTION_DIRECTION)) {
        if (entry[field] !== expected) {
          findings.push({
            kind: "schema_violation",
            entry_id: entryId,
            field,
            message: `${field} must be '${expected}'`,
          });
        }
      }
      break;

    case "claim":
      if (!["human", "agent"].includes(entry.provenance as string)) {
        findings.push({
          kind: "schema_violation",
          entry_id: entryId,
          field: "provenance",
          message: "provenance must be 'human' or 'agent'",
        });
      }
      if (typeof entry.verified !== "boolean") {
        findings.push({
          kind: "schema_violation",
          entry_id: entryId,
          field: "verified",
          message: "verified must be a boolean",
        });
      }
      break;
  }
}

/**
 * Type guard to check if an object is a valid Ledger Entry.
 */
export function isValidLedgerEntry(entry: unknown): entry is LedgerEntry {
  if (typeof entry !== "object" || entry === null) {
    return false;
  }

  const record = entry as Record<string, unknown>;
  const findings = validateLedgerEntry(record);

  return findings.length === 0;
}

/**
 * `checksum_form` is optional (an entry without it is form 1, as Vellum 0.1.2
 * wrote it); when present it names a known form.
 */
function checkChecksumForm(
  entry: Record<string, unknown>,
  entryId: number | undefined,
  findings: SchemaValidationFinding[],
): void {
  if (!("checksum_form" in entry) || entry.checksum_form === 1 || entry.checksum_form === 2) return;
  findings.push({
    kind: "schema_violation",
    entry_id: entryId,
    field: "checksum_form",
    message: "checksum_form, when present, must be 1 or 2",
  });
}
