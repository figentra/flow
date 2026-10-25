/**
 * Read-only queries over a repository, shared by every surface (the CLI and
 * the MCP server) so that both return the same result for the same state.
 */

export {
  openRepository,
  notARepositoryMessage,
  selectSpecs,
  enginePolicy,
  gitContext,
  recordedState,
  isLegacy,
  relativeFinding,
  type Repository,
  type SpecSelection,
  type GitContext,
} from "./repository.js";
export { outcomeExitStatus, type Outcome, type QueryResult } from "./result.js";
export {
  queryStatus,
  statusDocument,
  statusExitStatus,
  type StatusEntry,
  type StatusQuery,
  type StatusReport,
} from "./status.js";
export {
  ARTIFACT_KINDS,
  isArtifactKind,
  queryLint,
  lintDocument,
  lintExitStatus,
  type LintExamined,
  type LintQuery,
} from "./lint.js";
export {
  queryVerify,
  verifyDocument,
  verifyExitStatus,
  NOTHING_TO_VERIFY,
  type SpecVerification,
  type VerifyQuery,
} from "./verify.js";
export {
  queryCheck,
  checkDocument,
  NOTHING_TO_CHECK,
  type CheckQuery,
  type UnreadableSpec,
} from "./check.js";
export {
  queryTrace,
  queryArtifact,
  queryContext,
  type TraceQuery,
  type ArtifactQuery,
  type ContextQuery,
} from "./read.js";
export { resolveRepoPath, type RepoPath } from "./paths.js";
