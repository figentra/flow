/**
 * @vellum/engine — evaluateApprovals: an approval bound to an older checksum
 * is history once the current text is approved again, and a finding until it is.
 */

import { describe, expect, it } from "vitest";
import type { ApprovalPolicy, ArtifactKind, Checksum, GitCommit } from "@vellum/protocol";
import { brand } from "@vellum/protocol";
import { evaluateApprovals } from "../evaluate.js";

const OLD = brand<string, "Checksum">("0".repeat(64));
const NEW = brand<string, "Checksum">("1".repeat(64));

function policy(required: number): ApprovalPolicy {
  return {
    approvers: new Map([
      ["standard", new Map([["requirements", ["alice@example.com", "bob@example.com"]]])],
    ]),
    requiredCount: new Map([["standard", new Map([["requirements", required]])]]),
    identities: [
      {
        identity: "alice@example.com",
        keys: [{ type: "ssh", fingerprint: "SHA256:alice", publicKey: "k" }],
      },
      {
        identity: "bob@example.com",
        keys: [{ type: "ssh", fingerprint: "SHA256:bob", publicKey: "k" }],
      },
    ],
  };
}

function signal(sha: string, who: "alice" | "bob"): [string, GitCommit] {
  return [
    sha,
    {
      sha: brand<string, "CommitSha">(sha),
      author: { name: who, email: `${who}@example.com` },
      committer: { name: who, email: `${who}@example.com` },
      message: "approve:",
      timestamp: "2026-09-26T10:00:00Z",
      signature: "sig",
      signer: { type: "ssh", fingerprint: `SHA256:${who}` },
    },
  ];
}

const commits = new Map<string, GitCommit>([
  signal("a1", "alice"),
  signal("a2", "alice"),
  signal("b1", "bob"),
]);

function record(approver: string, checksum: Checksum, signalCommit: string) {
  return {
    approver,
    artifact: "requirements" as ArtifactKind,
    artifactChecksum: checksum,
    signalCommit,
  };
}

const current = new Map<ArtifactKind, Checksum>([["requirements", NEW]]);

describe("evaluateApprovals", () => {
  it("supersedes the old approval once the current text holds the required approvals", () => {
    const result = evaluateApprovals(
      [record("alice@example.com", OLD, "a1"), record("alice@example.com", NEW, "a2")],
      policy(1),
      "standard",
      commits,
      current,
    );
    expect(result.records.map((r) => r.standing.kind)).toEqual(["superseded", "valid"]);
    expect(result.artifacts.get("requirements")).toEqual({ met: true, count: 1, required: 1 });
  });

  it("reports an old approval as invalidated, with both checksums, while nothing replaces it", () => {
    const result = evaluateApprovals(
      [record("alice@example.com", OLD, "a1")],
      policy(1),
      "standard",
      commits,
      current,
    );
    expect(result.records[0]!.standing).toEqual({
      kind: "invalidated",
      approvedChecksum: OLD,
      currentChecksum: NEW,
    });
    expect(result.artifacts.get("requirements")).toEqual({ met: false, count: 0, required: 1 });
  });

  it("with two required: the approver who re-approved is history, the one who did not is a finding", () => {
    const result = evaluateApprovals(
      [
        record("alice@example.com", OLD, "a1"),
        record("bob@example.com", OLD, "b1"),
        record("Alice@Example.com", NEW, "a2"),
      ],
      policy(2),
      "standard",
      commits,
      current,
    );
    expect(result.records.map((r) => r.standing.kind)).toEqual([
      "superseded",
      "invalidated",
      "valid",
    ]);
    expect(result.artifacts.get("requirements")).toEqual({ met: false, count: 1, required: 2 });
  });

  it("never supersedes an approval rejected for anything but its checksum", () => {
    const result = evaluateApprovals(
      [record("alice@example.com", OLD, "missing"), record("alice@example.com", NEW, "a2")],
      policy(1),
      "standard",
      commits,
      current,
    );
    expect(result.records[0]!.standing).toEqual({ kind: "rejected", reason: "INVALID_SIGNAL" });
  });

  it("reports an approval of an artifact that is not present", () => {
    const result = evaluateApprovals(
      [record("alice@example.com", NEW, "a2")],
      policy(1),
      "standard",
      commits,
      new Map(),
    );
    expect(result.records[0]!.standing).toEqual({ kind: "artifact-missing" });
    expect(result.artifacts.size).toBe(0);
  });
});

describe("evaluateApprovals: an upstream amendment voids later approvals (criteria 8.6, 8.7)", () => {
  const R1 = brand<string, "Checksum">("a".repeat(64));
  const R2 = brand<string, "Checksum">("b".repeat(64));
  const D1 = brand<string, "Checksum">("c".repeat(64));
  const D2 = brand<string, "Checksum">("d".repeat(64));
  const T1 = brand<string, "Checksum">("e".repeat(64));

  const chainPolicy: ApprovalPolicy = {
    approvers: new Map([
      [
        "standard",
        new Map<ArtifactKind, string[]>([
          ["requirements", ["alice@example.com"]],
          ["design", ["alice@example.com"]],
          ["tasks", ["alice@example.com"]],
        ]),
      ],
    ]),
    requiredCount: new Map([
      [
        "standard",
        new Map<ArtifactKind, number>([
          ["requirements", 1],
          ["design", 1],
          ["tasks", 1],
        ]),
      ],
    ]),
    identities: policy(1).identities,
  };

  function approval(artifact: ArtifactKind, checksum: Checksum, signalCommit = "a1") {
    return { approver: "alice@example.com", artifact, artifactChecksum: checksum, signalCommit };
  }

  function evaluate(
    records: ReturnType<typeof approval>[],
    checksums: { requirements: Checksum; design: Checksum; tasks: Checksum },
  ) {
    return evaluateApprovals(
      records,
      chainPolicy,
      "standard",
      commits,
      new Map<ArtifactKind, Checksum>(Object.entries(checksums) as [ArtifactKind, Checksum][]),
    );
  }

  const approvedChain = [
    approval("requirements", R1),
    approval("design", D1),
    approval("tasks", T1),
  ];

  it("counts a design and plan approved after the requirements they were given against", () => {
    const result = evaluate(approvedChain, { requirements: R1, design: D1, tasks: T1 });
    expect(result.records.map((r) => r.standing.kind)).toEqual(["valid", "valid", "valid"]);
  });

  it("voids the design and plan approvals when requirements are amended, naming requirements", () => {
    const result = evaluate(approvedChain, { requirements: R2, design: D1, tasks: T1 });
    expect(result.records.map((r) => r.standing)).toEqual([
      { kind: "invalidated", approvedChecksum: R1, currentChecksum: R2 },
      {
        kind: "upstream-amended",
        reason: "SUPERSEDED_BY_UPSTREAM_AMENDMENT",
        upstream: "requirements",
        approvedChecksum: R1,
        currentChecksum: R2,
      },
      {
        kind: "upstream-amended",
        reason: "SUPERSEDED_BY_UPSTREAM_AMENDMENT",
        upstream: "requirements",
        approvedChecksum: R1,
        currentChecksum: R2,
      },
    ]);
    expect(result.artifacts.get("design")).toEqual({ met: false, count: 0, required: 1 });
    expect(result.artifacts.get("tasks")).toEqual({ met: false, count: 0, required: 1 });
  });

  it("keeps them void when only requirements are approved again", () => {
    const result = evaluate([...approvedChain, approval("requirements", R2, "a2")], {
      requirements: R2,
      design: D1,
      tasks: T1,
    });
    expect(result.artifacts.get("requirements")?.met).toBe(true);
    expect(result.artifacts.get("design")?.met).toBe(false);
    expect(result.artifacts.get("tasks")?.met).toBe(false);
    expect(result.records[1]!.standing).toMatchObject({
      kind: "upstream-amended",
      upstream: "requirements",
    });
  });

  it("restores the chain once requirements, design and plan are approved again in order", () => {
    const result = evaluate(
      [
        ...approvedChain,
        approval("requirements", R2, "a2"),
        approval("design", D1, "a2"),
        approval("tasks", T1, "a2"),
      ],
      { requirements: R2, design: D1, tasks: T1 },
    );
    expect(result.records.map((r) => r.standing.kind)).toEqual([
      "superseded",
      "superseded",
      "superseded",
      "valid",
      "valid",
      "valid",
    ]);
    expect(result.records[1]!.standing).toEqual({
      kind: "superseded",
      upstream: "requirements",
      approvedChecksum: R1,
      currentChecksum: R2,
    });
    for (const kind of ["requirements", "design", "tasks"] as const) {
      expect(result.artifacts.get(kind)).toEqual({ met: true, count: 1, required: 1 });
    }
  });

  it("voids the plan approval, and only it, when design is amended (criterion 8.7)", () => {
    const result = evaluate(approvedChain, { requirements: R1, design: D2, tasks: T1 });
    expect(result.records.map((r) => r.standing)).toEqual([
      { kind: "valid" },
      { kind: "invalidated", approvedChecksum: D1, currentChecksum: D2 },
      {
        kind: "upstream-amended",
        reason: "SUPERSEDED_BY_UPSTREAM_AMENDMENT",
        upstream: "design",
        approvedChecksum: D1,
        currentChecksum: D2,
      },
    ]);
  });

  it("does not let an approval that is not authentic void or restore anything", () => {
    // A forged approval of new requirements text neither voids the design
    // approval given after the authentic one, nor restores a later one.
    const forged = evaluate(
      [approval("requirements", R1), approval("requirements", R2, "missing"), approval("design", D1)],
      { requirements: R1, design: D1, tasks: T1 },
    );
    expect(forged.records[2]!.standing).toEqual({ kind: "valid" });
  });

  it("does not apply when no upstream approval precedes the approval", () => {
    const result = evaluate([approval("design", D1)], { requirements: R2, design: D1, tasks: T1 });
    expect(result.records[0]!.standing).toEqual({ kind: "valid" });
  });
});
