/**
 * @vellum/storage — I/O layer (file system, git, ledger)
 *
 * This package is the ONLY package with I/O. It reads and writes files,
 * git repository state, and the Ledger. Wraps the engine with side effects.
 *
 * ## Design Principles
 *
 * - All I/O is in this package
 * - Engine remains pure
 * - Atomic operations where possible
 * - Ledger modifications only through programmatic interface
 */

// ============================================================================
// Filesystem Operations
// ============================================================================

export {
  createFilesystem,
  parseFrontmatter,
  serializeFrontmatter,
  computeChecksum,
  stripFrontmatter,
} from "./fs.js";

// ============================================================================
// Git Operations
// ============================================================================

export { createGitOps } from "./git.js";

export {
  verifyCommitSigner,
  sshPublicKeyFingerprint,
  type CommitSignatureCheck,
} from "./signature.js";
export { signingKeyFingerprint } from "./signing-key.js";

// ============================================================================
// Ledger Operations
// ============================================================================

export {
  readLedger,
  getLastEntry,
  appendLedgerEntry,
  verifyLedgerIntegrity,
  readLedgerHead,
  parseLedgerHead,
  getLedgerHeadPath,
  LEDGER_HEAD_FILE,
  detectFork,
  parseLedger,
  LedgerError,
  nodeLedgerFileSystem,
  type NewLedgerEntry,
  type LedgerErrorCode,
  type LedgerFileSystem,
  type AppendLedgerEntryOptions,
} from "./ledger.js";

// ============================================================================
// Machine Folder Operations
// ============================================================================

export {
  MACHINE_FOLDER,
  STATE_FILE,
  LEDGER_FILE,
  getMachineFolder,
  getLedgerPath,
  getStatePath,
  initMachineFolder,
  readState,
  writeState,
  clearState,
  discoverMachineFolders,
  getCachePath,
  clearCache,
} from "./state.js";

// ============================================================================
// Policy Operations
// ============================================================================

export {
  loadPolicy,
  parsePolicy,
  toApprovalPolicy,
  riskClassForSpec,
  DEFAULT_POLICY_PATH,
  getApproverByEmail,
  isAuthorisedForRiskClass,
  getRequirementsForRiskClass,
} from "./policy.js";

// ============================================================================
// Spec Discovery
// ============================================================================

export {
  SPEC_DIR,
  ARTIFACT_FILES,
  discoverSpecs,
  readSpecMetadata,
  findSpec,
  isValidSpecDirectory,
} from "./discovery.js";

// ============================================================================
// Spec workspace (what commands hand the engine) and evidence runs
// ============================================================================

export {
  runGit,
  findRepoRoot,
  listSpecs,
  resolveSpec,
  loadSpec,
  loadApprovalPolicy,
  specRiskClass,
  resolveApprovalCommits,
  readCommits,
  headCommit,
  verifiedHistory,
  changedPaths,
  findTask,
  setTaskMarker,
  setTaskMarkers,
  writeFileAtomically,
  ensureMachineFolder,
  gitConfig,
  type SpecRef,
  type SpecMatch,
  type LoadedSpec,
  type ArtifactProblem,
  type PolicyLoad,
  type TaskLocation,
} from "./workspace.js";

export {
  runVerificationCommand,
  type VerificationRun,
  type RunVerificationOptions,
} from "./evidence.js";

export { parseSessionMetadata } from "./git.js";

// ============================================================================
// Read-only queries (shared by the CLI and the MCP server)
// ============================================================================

export * from "./queries/index.js";

// ============================================================================
// Artifact Cache
// ============================================================================

export { createCache } from "./cache.js";

// ============================================================================
// Version
// ============================================================================

export const VERSION = "0.0.0" as const;
