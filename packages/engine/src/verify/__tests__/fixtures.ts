/**
 * Shared fixtures for the strict-verification and pre-execution tests: a
 * complete spec whose three artifacts are approved by one signed human signal
 * per artifact.
 */

import type {
  ApprovalPolicy,
  Artifact,
  ArtifactKind,
  GitCommit,
  LedgerEntry,
  RiskClass,
} from "@vellum/protocol";
import {
  CHECKSUM_FORM,
  brand,
  computeChecksum,
  computeChecksumInForm,
  computeLedgerEntryDigest,
} from "@vellum/protocol";

export const REQUIREMENTS = `# Requirements

### Requirement 1: One

#### Acceptance Criteria

1.1 WHEN a thing happens, THE System SHALL do one thing.
1.2 WHEN another thing happens, THE System SHALL do another thing.

| Term | Meaning |
| --- | --- |
| Spec | A folder |
`;

export const DESIGN = `# Design

**Property 1: First**
**Validates: Requirements 1.1**

**Property 2: Second**
**Validates: Requirements 1.2**
`;

export const TASKS = `# Tasks

- [ ] 1 Build the first thing <!-- criteria: 1.1 --> <!-- properties: P1 -->
- [ ] 2 Build the second thing <!-- criteria: 1.2 --> <!-- properties: P2 -->
`;

export const BODIES: Record<ArtifactKind, string> = {
  requirements: REQUIREMENTS,
  design: DESIGN,
  tasks: TASKS,
};

export const SIGNAL = "a".repeat(40);

export function policyFor(riskClass: RiskClass): ApprovalPolicy {
  const perArtifact = new Map<ArtifactKind, readonly string[]>([
    ["requirements", ["alice@example.com"]],
    ["design", ["alice@example.com"]],
    ["tasks", ["alice@example.com"]],
  ]);
  const counts = new Map<ArtifactKind, number>([
    ["requirements", 1],
    ["design", 1],
    ["tasks", 1],
  ]);
  return {
    approvers: new Map([[riskClass, perArtifact]]),
    requiredCount: new Map([[riskClass, counts]]),
    identities: [
      {
        identity: "alice@example.com",
        keys: [{ type: "ssh", fingerprint: "SHA256:alice", publicKey: "ssh-ed25519 AAAA" }],
      },
    ],
  };
}

export const commits = new Map<string, GitCommit>([
  [
    SIGNAL,
    {
      sha: brand<string, "CommitSha">(SIGNAL),
      author: { name: "Alice", email: "alice@example.com" },
      committer: { name: "Alice", email: "alice@example.com" },
      message: "approve: spec",
      timestamp: "2026-09-26T10:00:00Z",
      signature: "-----BEGIN SSH SIGNATURE-----",
      signer: { type: "ssh", fingerprint: "SHA256:alice" },
    },
  ],
]);

/** An on-disk (ledger/types) approval entry for `kind`, bound to `body`. */
export function approvalEntry(
  id: number,
  kind: ArtifactKind,
  body: string,
  identity = "alice@example.com",
): LedgerEntry {
  return {
    kind: "approval",
    id,
    predecessor_digest: null,
    timestamp: "2026-09-26T10:00:00Z",
    artifact: `${kind}.md`,
    artifact_version: 1,
    artifact_checksum: computeChecksum(body),
    checksum_form: CHECKSUM_FORM,
    identity,
    identity_key: "SHA256:alice",
    session_type: "human",
    approval_signal: { commit: SIGNAL, message_prefix: "approve:" },
  } as unknown as LedgerEntry;
}

/**
 * An approval entry for `kind` exactly as Vellum 0.1.2 wrote one: no
 * `checksum_form`, and the checksum of `body` in form 1.
 */
export function approvalEntryV012(id: number, kind: ArtifactKind, body: string): LedgerEntry {
  const { checksum_form: _form, ...entry } = approvalEntry(id, kind, body) as unknown as Record<
    string,
    unknown
  >;
  return { ...entry, artifact_checksum: computeChecksumInForm(body, 1) } as unknown as LedgerEntry;
}

/**
 * Re-link entries into a chain the engine's integrity check accepts: ids from
 * 1, a null predecessor first, then each predecessor the previous entry's digest.
 */
export function chain(entries: readonly LedgerEntry[]): LedgerEntry[] {
  const linked: LedgerEntry[] = [];
  entries.forEach((entry, index) => {
    const previous = linked[index - 1];
    const predecessor_digest =
      previous === undefined ? null : computeLedgerEntryDigest(previous);
    linked.push({ ...entry, id: index + 1, predecessor_digest } as LedgerEntry);
  });
  return linked;
}

/** Approvals of all three artifacts as given in BODIES, chained. */
export function approvals(): LedgerEntry[] {
  return chain(
    (["requirements", "design", "tasks"] as const).map((kind, i) =>
      approvalEntry(i + 1, kind, BODIES[kind]),
    ),
  );
}

/** An on-disk (ledger/types) evidence entry for `taskId`. */
export function evidenceEntry(taskId: string, exitStatus = 0, commit = "c".repeat(40)): LedgerEntry {
  return {
    kind: "evidence",
    id: 0,
    predecessor_digest: null,
    timestamp: "2026-09-26T11:00:00Z",
    task_id: taskId,
    command: "pnpm test",
    exit_status: exitStatus,
    start_timestamp: "2026-09-26T11:00:00Z",
    finish_timestamp: "2026-09-26T11:00:05Z",
    commit,
    affected_paths: [],
    environment_versions: { platform: "0.0.0", schema: "1.0", node: "22.0.0" },
    uncommitted: false,
  } as unknown as LedgerEntry;
}

/**
 * The approvals of all three artifacts, then passing evidence for both
 * required tasks in TASKS (criterion 12.4), chained.
 */
export function verifiedLedger(): LedgerEntry[] {
  return chain([...approvals(), evidenceEntry("1"), evidenceEntry("2")]);
}

/** An artifact whose frontmatter claims `claimed` as its checksum, whatever its body. */
export function artifact(kind: ArtifactKind, body: string, claimed?: string): Artifact {
  return {
    kind,
    path: `/repo/.agents/specs/001-x/${kind}.md`,
    body,
    frontmatter: {
      version: 1,
      checksum: brand<string, "Checksum">(claimed ?? computeChecksum(body)),
      state: "IN_REVIEW",
      createdAt: "2026-09-26T09:00:00Z",
      updatedAt: "2026-09-26T09:00:00Z",
    },
  };
}

export function allArtifacts(overrides: Partial<Record<ArtifactKind, string>> = {}): Artifact[] {
  return (["requirements", "design", "tasks"] as const).map((kind) =>
    artifact(kind, overrides[kind] ?? BODIES[kind]),
  );
}
