/**
 * @stellum/engine — Pure logic implementation (no I/O)
 *
 * This package contains the stateless engine functions that compute
 * lifecycle state, approvals, evidence, and verification.
 *
 * ## Design Principles
 *
 * - No filesystem access
 * - No git operations
 * - No network calls
 * - No clock dependency
 * - Pure functions only
 * - Deterministic output
 *
 * All decisions are computed from repository content and the pinned version alone.
 */

// ============================================================================
// Lifecycle
// ============================================================================

export {
  isTerminalState,
  isValidTransition,
  getValidNextStates,
  getTransitionPreconditions,
  checkPreconditions,
  InvalidTransitionError,
} from "./lifecycle/state-machine.js";

export { requiredTasks, parentTaskIds, parentsCompletedBy } from "./lifecycle/required-tasks.js";

export {
  computeEffectiveLifecycleState,
  isLifecycleState,
  type EffectiveState,
  type EffectiveStateInput,
} from "./lifecycle/effective-state.js";

export {
  planAdoption,
  planStamp,
  IN_REVIEW_STATE,
  type AdoptionPlan,
  type StampPlan,
  type FrontmatterPlan,
  type FrontmatterRefusal,
  type FrontmatterPlanInput,
  type ArtifactRewrite,
} from "./lifecycle/stamp.js";

// ============================================================================
// Validation
// ============================================================================

export { validateProtocol, validateRequiredArtifacts } from "./validate/protocol-validator.js";

export { validateTaskGraph, buildTaskGraph, validateWaveOrdering } from "./validate/task-graph.js";

export { validateWaveGraph } from "./validate/wave-graph.js";

export { findClarificationMarkers, NEEDS_CLARIFICATION } from "./validate/clarification.js";

export {
  validateSpecFolder,
  validateMachineFolder,
  isLegacySpec,
  detectLegacyStage,
} from "./validate/spec-folder.js";

// ============================================================================
// Approval
// ============================================================================

export {
  verifyApproval,
  countValidApprovals,
  getRequiredApprovalCount,
  hasRequiredApprovals,
  matchesApprover,
  approverKeys,
  signerIsApprovers,
  getApprovers,
  isApprovalInvalidated,
  diagnoseInvalidApproval,
} from "./approval/verify.js";

export {
  evaluateApprovals,
  type ApprovalStanding,
  type ApprovalEvaluation,
  type EvaluatedApproval,
  type EvaluatedApprovalInput,
} from "./approval/evaluate.js";

export {
  cascadeInvalidation,
  wouldCascadeToDesign,
  wouldCascadeToPlan,
  countInvalidatedApprovals,
} from "./approval/cascade.js";

// ============================================================================
// Ledger
// ============================================================================

export {
  checkLedgerIntegrity,
  detectForks,
  checkMissingEntries,
  verifyLedgerChain,
} from "./ledger/integrity.js";

// ============================================================================
// Status
// ============================================================================

export { computeStatusReport, formatStatusJson, formatStatusHuman } from "./status/reporter.js";

// ============================================================================
// Verification
// ============================================================================

export {
  approvalRecords,
  resolveApprovalSignals,
  type ApprovalRecordView,
  type ApprovedArtifactBody,
  type ApprovalCommitResolution,
  type ResolvedApproval,
} from "./approval/records.js";

export {
  strictVerify,
  type StrictVerifyOptions,
  type StrictVerificationResult,
  getVerificationExitStatus,
  formatVerificationJson,
  formatVerificationHuman,
} from "./verify/strict.js";

export {
  preExecutionCheck,
  checkTaskBinding,
  validateTaskBinding,
  type PreCheckResult,
  type TaskBinding,
  type PreCheckApprovalContext,
} from "./verify/precheck.js";

export {
  verifyDeterminism,
  sortFindings,
  verifyFindingsSorted,
  computeOutputHash,
} from "./verify/determinism.js";

// ============================================================================
// Evidence
// ============================================================================

export {
  validateEvidence,
  containsSecretPattern,
  hasVerifiedEvidence,
  findUnverifiedTasks,
  countEvidence,
  checkEvidenceCompleteness,
} from "./evidence/validate.js";

// ============================================================================
// Coverage
// ============================================================================

export {
  computeCoverage,
  hasCompleteCoverage,
  getCoveragePercentage,
  extractCriteria,
  extractProperties,
  validateCriteriaCoverage,
  validatePropertiesCitation,
} from "./coverage/validate.js";

export { decidePlanApproval, type PlanApprovalDecision } from "./coverage/plan-approval.js";

// ============================================================================
// Task Context (the per-task briefing)
// ============================================================================

export {
  buildTaskContext,
  type TaskContext,
  type TaskContextArtifact,
  type ContextCriterion,
  type ContextProperty,
  type ContextDesignSection,
  type ContextGlossaryEntry,
  type ContextMissing,
} from "./context/task-context.js";
export { formatTaskContextMarkdown } from "./context/format.js";

// ============================================================================
// Check Mode
// ============================================================================

export {
  runCheckMode,
  checkSingleSpec,
  formatCheckResult,
  type CheckModeSpec,
  type CheckModeResult,
  type CheckModeSpecResult,
  type CheckSummary,
} from "./mode/check.js";

