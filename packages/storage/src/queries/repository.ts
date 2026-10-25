/**
 * Opening the repository and gathering, per spec, what the engine needs
 * from git. Reads only; every decision is the engine's. Shared by every
 * surface that queries a repository (the CLI and the MCP server), so that
 * both return the same result for the same repository state.
 */

import { relative } from "node:path";
import type {
  ApprovalPolicy,
  Finding,
  GitCommit,
  LifecycleState,
} from "@vellum/protocol";
import type { ApprovalCommitResolution } from "@vellum/engine";
import {
  findRepoRoot,
  listSpecs,
  loadApprovalPolicy,
  readCommits,
  resolveApprovalCommits,
  resolveSpec,
  verifiedHistory,
  type LoadedSpec,
  type PolicyLoad,
  type SpecRef,
} from "../workspace.js";

/** An open repository. */
export interface Repository {
  readonly root: string;
  readonly policy: PolicyLoad;
}

/**
 * Open the repository containing `cwd`; null when `cwd` is not inside a git
 * work tree. With `targetBranch`, the Approval Policy is the target branch's
 * (criterion 7.10).
 */
export async function openRepository(
  cwd: string,
  targetBranch?: string,
): Promise<Repository | null> {
  const root = findRepoRoot(cwd);
  if (root === null) return null;
  return { root, policy: await loadApprovalPolicy(root, targetBranch) };
}

/** The message every surface gives when there is no repository. */
export function notARepositoryMessage(cwd: string): string {
  return `${cwd} is not inside a git work tree`;
}

/** The specs a query runs on, or why a fragment selects none (criterion 6.4). */
export type SpecSelection =
  | { readonly kind: "specs"; readonly specs: SpecRef[] }
  | { readonly kind: "error"; readonly message: string };

/**
 * The spec `fragment` names, or every spec when it is undefined. A fragment
 * matching none or several specs is an error.
 */
export function selectSpecs(
  root: string,
  fragment: string | undefined,
): SpecSelection {
  if (fragment === undefined) return { kind: "specs", specs: listSpecs(root) };
  const match = resolveSpec(root, fragment);
  if (match.kind === "one") return { kind: "specs", specs: [match.spec] };
  if (match.kind === "none")
    return { kind: "error", message: `no spec matches '${fragment}'` };
  return {
    kind: "error",
    message: `'${fragment}' matches more than one spec: ${match.matches.map((m) => m.slug).join(", ")}`,
  };
}

/** The approval policy as the engine takes it (null when missing or invalid). */
export function enginePolicy(policy: PolicyLoad): ApprovalPolicy | null {
  return policy.kind === "loaded" ? policy.policy : null;
}

/** What the engine needs from git to verify a spec's approvals and evidence. */
export interface GitContext {
  readonly gitCommits: ReadonlyMap<string, GitCommit>;
  readonly approvalCommits: ReadonlyMap<number, ApprovalCommitResolution>;
  readonly verifiedHistory: ReadonlySet<string>;
}

/** Resolve approval adding commits, read them with verified signers, and HEAD's history. */
export function gitContext(
  root: string,
  spec: LoadedSpec,
  policy: ApprovalPolicy | null,
): GitContext {
  const approvalCommits = resolveApprovalCommits(root, spec);
  const shas = [...approvalCommits.values()].flatMap((r) =>
    "commit" in r ? [r.commit] : [],
  );
  return {
    gitCommits: readCommits(root, shas, policy),
    approvalCommits,
    verifiedHistory: verifiedHistory(root),
  };
}

/** The Recorded Lifecycle State: requirements.md's frontmatter state, else DRAFT. */
export function recordedState(spec: LoadedSpec): LifecycleState {
  return (
    spec.artifacts.find((a) => a.kind === "requirements")?.frontmatter.state ??
    "DRAFT"
  );
}

/** A spec with no Machine Folder and no parsed artifact: not under Vellum management. */
export function isLegacy(spec: LoadedSpec): boolean {
  return spec.machineEntries === null && spec.artifacts.length === 0;
}

/** Rewrite a finding's absolute path relative to the repository root. */
export function relativeFinding(root: string, finding: Finding): Finding {
  return finding.file.startsWith("/")
    ? { ...finding, file: relative(root, finding.file) }
    : finding;
}
