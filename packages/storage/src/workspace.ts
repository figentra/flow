/**
 * @vellum/storage — Reading a spec and its git context for the engine
 *
 * Everything a command needs to hand the pure engine: the spec's artifacts,
 * ledger and Ledger Head, the Approval Policy, the commit that added each
 * approval entry, those commits with their verified signers, and the
 * verified history. Also the two writes a command makes besides the ledger:
 * a task's marker, and nothing else.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, relative } from "node:path";
import type {
  ApprovalPolicy,
  Artifact,
  ArtifactKind,
  GitCommit,
  LedgerEntry,
  LedgerHead,
  RiskClass,
  TaskMarker,
} from "@vellum/protocol";
import { brand, parseFrontmatter, parseTaskItems } from "@vellum/protocol";
import type { ApprovalCommitResolution } from "@vellum/engine";
import { LedgerError, getLedgerHeadPath, parseLedger, parseLedgerHead } from "./ledger.js";
import { LEDGER_FILE, MACHINE_FOLDER } from "./state.js";
import { SPEC_DIR } from "./discovery.js";
import { parseSessionMetadata } from "./git.js";
import { verifyCommitSigner } from "./signature.js";
import { DEFAULT_POLICY_PATH, loadPolicy, riskClassForSpec, toApprovalPolicy } from "./policy.js";
import type { ConsumerConfiguration, PolicyError } from "./domain/policy/types.js";

const KINDS: readonly ArtifactKind[] = ["requirements", "design", "tasks"];

/** Run git in `cwd`; returns stdout. Throws with git's stderr on failure. */
export function runGit(cwd: string, args: readonly string[]): string {
  return execFileSync("git", [...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** The repository root containing `cwd`, or null when `cwd` is not in a git work tree. */
export function findRepoRoot(cwd: string): string | null {
  try {
    return runGit(cwd, ["rev-parse", "--show-toplevel"]).trim();
  } catch {
    return null;
  }
}

/** One spec directory under `.agents/specs/`. */
export interface SpecRef {
  /** Directory name, e.g. `016-queue-capability` */
  readonly slug: string;
  /** Absolute path */
  readonly path: string;
}

/** The spec directories of a repository, sorted by name. */
export function listSpecs(repoRoot: string): SpecRef[] {
  const root = join(repoRoot, SPEC_DIR);
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => !name.startsWith(".") && statSync(join(root, name)).isDirectory())
    .sort()
    .map((slug) => ({ slug, path: join(root, slug) }));
}

/** What a spec fragment resolved to (criterion 6.3, 6.4). */
export type SpecMatch =
  | { readonly kind: "one"; readonly spec: SpecRef }
  | { readonly kind: "none"; readonly fragment: string }
  | { readonly kind: "ambiguous"; readonly fragment: string; readonly matches: readonly SpecRef[] };

/**
 * Resolve a spec number or slug fragment: an exact directory name first,
 * then a numeric prefix (`16` and `016` match `016-…`), then a substring.
 */
export function resolveSpec(repoRoot: string, fragment: string): SpecMatch {
  const specs = listSpecs(repoRoot);
  const exact = specs.find((s) => s.slug === fragment);
  if (exact) return { kind: "one", spec: exact };

  let matches: SpecRef[];
  if (/^\d+$/.test(fragment)) {
    const wanted = Number.parseInt(fragment, 10);
    matches = specs.filter((s) => {
      const number = /^(\d+)/.exec(s.slug)?.[1];
      return number !== undefined && Number.parseInt(number, 10) === wanted;
    });
  } else {
    const lower = fragment.toLowerCase();
    matches = specs.filter((s) => s.slug.toLowerCase().includes(lower));
  }
  if (matches.length === 1) return { kind: "one", spec: matches[0]! };
  if (matches.length === 0) return { kind: "none", fragment };
  return { kind: "ambiguous", fragment, matches };
}

/** An artifact file that exists but could not be read as an Artifact. */
export interface ArtifactProblem {
  readonly kind: ArtifactKind;
  readonly file: string;
  readonly message: string;
}

/** A spec as read from disk. */
export interface LoadedSpec {
  readonly ref: SpecRef;
  /** Entries of the spec directory */
  readonly entries: readonly string[];
  /** Entries of the Machine Folder; null when it does not exist */
  readonly machineEntries: readonly string[] | null;
  /** Artifacts that exist and parse (frontmatter included) */
  readonly artifacts: readonly Artifact[];
  /** Artifact files that exist but do not parse */
  readonly artifactProblems: readonly ArtifactProblem[];
  /** Raw text of each artifact file that exists */
  readonly texts: ReadonlyMap<ArtifactKind, string>;
  readonly ledgerPath: string;
  /** Ledger entries; empty when the ledger does not exist */
  readonly ledger: readonly LedgerEntry[];
  /** Ledger Head; null when its file does not exist */
  readonly ledgerHead: LedgerHead | null;
  /** Why the ledger or its head could not be read, if so */
  readonly ledgerProblem: string | null;
}

/** Read a spec's artifacts, ledger and Ledger Head. Never writes. */
export function loadSpec(ref: SpecRef): LoadedSpec {
  const entries = readdirSync(ref.path).sort();
  const machine = join(ref.path, MACHINE_FOLDER);
  const machineEntries = existsSync(machine) ? readdirSync(machine).sort() : null;

  const artifacts: Artifact[] = [];
  const artifactProblems: ArtifactProblem[] = [];
  const texts = new Map<ArtifactKind, string>();
  for (const kind of KINDS) {
    const file = join(ref.path, `${kind}.md`);
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    texts.set(kind, text);
    const parsed = parseFrontmatter(text.replace(/\r\n?/g, "\n"));
    if (parsed === null) {
      artifactProblems.push({
        kind,
        file,
        message: `${kind}.md has no valid Lifecycle Frontmatter (version, checksum, state, createdAt, updatedAt)`,
      });
      continue;
    }
    artifacts.push({ kind, path: file, body: parsed.body, frontmatter: parsed.frontmatter });
  }

  const ledgerPath = join(machine, LEDGER_FILE);
  let ledger: readonly LedgerEntry[] = [];
  let ledgerHead: LedgerHead | null = null;
  let ledgerProblem: string | null = null;
  try {
    if (existsSync(ledgerPath)) ledger = parseLedger(readFileSync(ledgerPath, "utf8"));
    const headPath = getLedgerHeadPath(ledgerPath);
    if (existsSync(headPath))
      ledgerHead = parseLedgerHead(readFileSync(headPath, "utf8"), headPath);
  } catch (error) {
    if (!(error instanceof LedgerError)) throw error;
    ledgerProblem = error.message;
  }

  return {
    ref,
    entries,
    machineEntries,
    artifacts,
    artifactProblems,
    texts,
    ledgerPath,
    ledger,
    ledgerHead,
    ledgerProblem,
  };
}

/** The Approval Policy, or why there is none. */
export type PolicyLoad =
  | {
      readonly kind: "loaded";
      readonly config: ConsumerConfiguration;
      readonly policy: ApprovalPolicy;
      readonly path: string;
    }
  | { readonly kind: "missing"; readonly path: string }
  | { readonly kind: "invalid"; readonly path: string; readonly message: string };

/** Load the repository's Approval Policy (`.sdlc/policy.json` at the root). */
export async function loadApprovalPolicy(repoRoot: string): Promise<PolicyLoad> {
  try {
    const config = await loadPolicy(repoRoot);
    return {
      kind: "loaded",
      config,
      policy: toApprovalPolicy(config, DEFAULT_POLICY_PATH),
      path: DEFAULT_POLICY_PATH,
    };
  } catch (error) {
    const policyError = error as PolicyError;
    if (policyError?.code === "POLICY_MISSING")
      return { kind: "missing", path: DEFAULT_POLICY_PATH };
    return {
      kind: "invalid",
      path: DEFAULT_POLICY_PATH,
      message: policyError?.message ?? String(error),
    };
  }
}

/** The risk class of a spec under a loaded policy (`standard` otherwise). */
export function specRiskClass(policy: PolicyLoad, slug: string): RiskClass {
  return policy.kind === "loaded" ? riskClassForSpec(policy.config, slug) : "standard";
}

const NOT_COMMITTED = /^0{40}$/;

/**
 * The commit that added each approval entry to the ledger, from `git blame`
 * of the ledger file as it is in the working tree. An entry whose line is
 * not committed has no resolution. A commit that changed anything besides
 * this spec's ledger and Ledger Head is refused as an Approval Signal: an
 * approver's signature on a large commit must not sweep in an approval line
 * someone else staged.
 */
export function resolveApprovalCommits(
  repoRoot: string,
  spec: LoadedSpec,
): Map<number, ApprovalCommitResolution> {
  const resolved = new Map<number, ApprovalCommitResolution>();
  const approvals = spec.ledger.filter((entry) => entry.kind === "approval");
  if (approvals.length === 0 || !existsSync(spec.ledgerPath)) return resolved;

  // The file line of each entry id (blank lines do not hold entries).
  const lineOf = new Map<number, number>();
  readFileSync(spec.ledgerPath, "utf8")
    .split("\n")
    .forEach((text, index) => {
      if (text.trim() === "") return;
      const id = (JSON.parse(text) as { id?: unknown }).id;
      if (typeof id === "number" && !lineOf.has(id)) lineOf.set(id, index + 1);
    });

  const ledgerRel = relative(repoRoot, spec.ledgerPath);
  const headRel = relative(repoRoot, getLedgerHeadPath(spec.ledgerPath));
  let blame: string;
  try {
    blame = runGit(repoRoot, ["blame", "--porcelain", "--", ledgerRel]);
  } catch {
    return resolved; // Never committed: no approval has a signal.
  }

  // Porcelain: each line group starts "<sha> <orig> <final> [<count>]".
  const shaByLine = new Map<number, string>();
  for (const line of blame.split("\n")) {
    const match = /^([0-9a-f]{40}) \d+ (\d+)/.exec(line);
    if (match) shaByLine.set(Number(match[2]), match[1]!);
  }

  const changedFiles = new Map<string, readonly string[]>();
  for (const entry of approvals) {
    const line = lineOf.get(entry.id);
    const sha = line === undefined ? undefined : shaByLine.get(line);
    if (sha === undefined || NOT_COMMITTED.test(sha)) continue;
    let files = changedFiles.get(sha);
    if (files === undefined) {
      files = runGit(repoRoot, ["diff-tree", "--no-commit-id", "--name-only", "-r", "--root", sha])
        .split("\n")
        .filter((f) => f !== "");
      changedFiles.set(sha, files);
    }
    const extra = files.filter((f) => f !== ledgerRel && f !== headRel);
    resolved.set(
      entry.id,
      extra.length === 0
        ? { commit: sha }
        : {
            problem: `approval entry ${entry.id} was added by commit ${sha.slice(0, 12)}, which also changes ${extra.join(", ")}; an Approval Signal commit may change only the spec's ledger`,
          },
    );
  }
  return resolved;
}

/**
 * Read commits with their signature checked against the policy's keys: a
 * commit's `signer` is set only when its signature verified against one.
 */
export function readCommits(
  repoRoot: string,
  shas: Iterable<string>,
  policy: ApprovalPolicy | null,
): Map<string, GitCommit> {
  const commits = new Map<string, GitCommit>();
  for (const sha of new Set(shas)) {
    let raw: string;
    try {
      raw = runGit(repoRoot, [
        "show",
        "-s",
        "--no-show-signature",
        "--format=%H%x00%an%x00%ae%x00%cn%x00%ce%x00%aI%x00%B",
        sha,
      ]);
    } catch {
      continue; // Not an object here: the engine reports the signal as missing.
    }
    const [full = sha, an = "", ae = "", cn = "", ce = "", timestamp = "", ...body] =
      raw.split("\0");
    const message = body.join("\0").replace(/\n+$/, "");
    const check = policy ? verifyCommitSigner(repoRoot, full, policy) : null;
    const sessionMetadata = parseSessionMetadata(message);
    commits.set(sha, {
      sha: brand<string, "CommitSha">(full),
      author: { name: an, email: ae },
      committer: { name: cn, email: ce },
      message,
      timestamp,
      ...(check && check.kind !== "unsigned"
        ? { signature: check.kind === "verified" ? check.signer.type : check.reason }
        : {}),
      ...(check?.kind === "verified" ? { signer: check.signer } : {}),
      ...(sessionMetadata ? { sessionMetadata } : {}),
    });
  }
  return commits;
}

/** HEAD's commit id, or null in a repository with no commit. */
export function headCommit(repoRoot: string): string | null {
  try {
    return runGit(repoRoot, ["rev-parse", "--verify", "HEAD"]).trim();
  } catch {
    return null;
  }
}

/** HEAD and every ancestor of it. */
export function verifiedHistory(repoRoot: string): Set<string> {
  if (headCommit(repoRoot) === null) return new Set();
  return new Set(
    runGit(repoRoot, ["rev-list", "HEAD"])
      .split("\n")
      .filter((l) => l !== ""),
  );
}

/**
 * Paths where the working tree differs from HEAD (untracked files included),
 * ignoring everything under `exclude` (a directory relative to the root).
 */
export function changedPaths(repoRoot: string, exclude: string): string[] {
  const prefix = exclude.endsWith("/") ? exclude : `${exclude}/`;
  return runGit(repoRoot, ["status", "--porcelain", "--untracked-files=all"])
    .split("\n")
    .filter((l) => l.length > 3)
    .map((l) => l.slice(3).replace(/^"|"$/g, ""))
    .map((p) => (p.includes(" -> ") ? p.split(" -> ")[1]! : p))
    .filter((p) => !p.startsWith(prefix));
}

/** Where a task's line is in tasks.md. */
export interface TaskLocation {
  readonly lineNumber: number;
  readonly marker: TaskMarker;
  readonly isOptional: boolean;
}

/**
 * Find task `taskId` in tasks.md text; null when absent, an error when listed
 * twice. A task a formatter wrapped over several lines is found at its first
 * line, the one that carries the marker.
 */
export function findTask(tasksText: string, taskId: string): TaskLocation | null {
  const found: TaskLocation[] = parseTaskItems(tasksText)
    .filter((item) => item.identifier === taskId)
    .map((item) => ({
      lineNumber: item.lineNumber,
      marker: item.marker,
      isOptional: item.isOptional,
    }));
  if (found.length > 1) {
    throw new Error(`Task ${taskId} appears ${found.length} times in tasks.md`);
  }
  return found[0] ?? null;
}

/**
 * Set task `taskId`'s marker in `tasksPath`, changing only the marker
 * character of that one line (criterion 10.2), atomically (temp file +
 * rename). Returns the previous marker.
 */
export function setTaskMarker(tasksPath: string, taskId: string, marker: TaskMarker): TaskMarker {
  return setTaskMarkers(tasksPath, new Map([[taskId, marker]])).get(taskId)!;
}

/**
 * Set several tasks' markers in `tasksPath` in one atomic write (temp file +
 * rename), changing only the marker character of each task's line
 * (criterion 10.2). Returns each task's previous marker. Throws, writing
 * nothing, when a task is not found.
 */
export function setTaskMarkers(
  tasksPath: string,
  markers: ReadonlyMap<string, TaskMarker>,
): Map<string, TaskMarker> {
  const text = readFileSync(tasksPath, "utf8");
  const lines = text.split("\n");
  const previous = new Map<string, TaskMarker>();
  for (const [taskId, marker] of markers) {
    const location = findTask(text, taskId);
    if (location === null) throw new Error(`Task ${taskId} not found in ${tasksPath}`);
    const index = location.lineNumber - 1;
    lines[index] = lines[index]!.replace(/^(\s*-\s*\[)[ x~-](\])/, `$1${marker}$2`);
    previous.set(taskId, location.marker);
  }

  const temp = join(dirname(tasksPath), `.${basename(tasksPath)}.${randomUUID()}.tmp`);
  writeFileSync(temp, lines.join("\n"));
  renameSync(temp, tasksPath);
  return previous;
}

/**
 * Replace a spec file's content atomically (temp file in the same directory,
 * then rename), so a reader never sees half an artifact.
 */
export function writeFileAtomically(path: string, text: string): void {
  const temp = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  writeFileSync(temp, text);
  renameSync(temp, path);
}

/** Create the Machine Folder that holds `ledgerPath`, if it does not exist. */
export function ensureMachineFolder(ledgerPath: string): void {
  mkdirSync(dirname(ledgerPath), { recursive: true });
}

/** The value of `git config <key>` in the repository, or null when unset. */
export function gitConfig(repoRoot: string, key: string): string | null {
  try {
    const value = runGit(repoRoot, ["config", "--get", key]).trim();
    return value === "" ? null : value;
  } catch {
    return null;
  }
}
