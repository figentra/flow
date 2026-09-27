/**
 * @vellum/protocol — The Vellum protocol contract
 *
 * This package defines the types and schemas for the Vellum specification lifecycle.
 * It is the single source of truth for all data structures used across Vellum.
 */

// ============================================================================
// Core Types
// ============================================================================

export * from "./types.js";

// ============================================================================
// Diagnostics
// ============================================================================

export * from "./diagnostics.js";

// ============================================================================
// Frontmatter
// ============================================================================

export {
  computeChecksum,
  parseFrontmatter,
  serializeFrontmatter,
  validateFrontmatterChecksum,
  createInitialFrontmatter,
  amendFrontmatter,
} from "./frontmatter.js";

export { canonicalArtifactBody, canonicalChecksumBody } from "./canonical-body.js";

// ============================================================================
// Markers and Grammar
// ============================================================================

export {
  MARKER_DISPLAY,
  MARKER_DESCRIPTIONS,
  parseMarker,
  formatMarker,
  parseTaskLine,
  serializeTaskLine,
  updateTaskMarker,
  isTaskLine,
  extractTaskIdentifiers,
} from "./markers.js";

// ============================================================================
// Ledger Types (re-export from ledger subfolder)
// ============================================================================

export type {
  LedgerEntry as LedgerEntryFull,
  LedgerEntryHeader as LedgerEntryHeaderFull,
  LedgerEntryKind as LedgerEntryKindFull,
  LedgerIntegrityFailure,
  LedgerHead,
  LedgerFork,
  LedgerMetadata,
  ApprovalPayload as ApprovalPayloadFull,
  RejectionPayload as RejectionPayloadFull,
  EvidencePayload as EvidencePayloadFull,
  TaskBindingEntryPayload,
  AdoptionEntryPayload,
  ApprovalSignal,
  DecisionPayload as DecisionPayloadFull,
  AmendmentPayload,
  GateResultPayload as GateResultPayloadFull,
  QualityFinding,
  CheckDefinition,
  CheckResult as CheckResultFull,
} from "./ledger/types.js";

export { createQualityFinding } from "./ledger/types.js";
export {
  LEDGER_SCHEMA_VERSION,
  validateLedgerEntry,
  type SchemaValidationFinding,
} from "./ledger/schema.js";
export { canonicalSerialize, computeLedgerEntryDigest, sha256Hex } from "./ledger/canonical-json.js";

// ============================================================================
// Version
// ============================================================================

export const VERSION = "0.0.0" as const;
