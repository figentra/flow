/**
 * Scenario 14 — a project approved and part-way through implementation under
 * Vellum 0.1.2 upgrades to this build. Its approvals and its open Task
 * Binding were recorded in checksum form 1 (no `checksum_form` field), and its
 * requirements.md and tasks.md carry wrapped prose and blank-line runs, so
 * their form-1 and form-2 checksums differ. The approvals must keep counting:
 * verify, status and lint accept the spec, the task 0.1.2 started completes,
 * the next one starts with a form-2 binding, and `vellum stamp` moves the
 * frontmatter to the current form without a new version. A content edit
 * still voids the approval.
 *
 * The spec files in fixtures/v0.1.2 were written by 0.1.2's own canonical-body
 * source (release commit 690c8a5), frontmatter checksums included; the ledger
 * lines below are shaped exactly as 0.1.2's adopt, approve and task start
 * wrote them — including the signing key's file path as `identity_key`, which
 * this version still reads. Nothing here computes a checksum.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HUMAN, KINDS, TestRepo, type Kind } from "./support/repo.js";
import { PASSING_COMMAND, SLUG } from "./support/spec.js";

const FIXTURE: Readonly<Record<Kind, string>> = Object.fromEntries(
  KINDS.map((kind) => [
    kind,
    readFileSync(new URL(`./fixtures/v0.1.2/${kind}.md`, import.meta.url), "utf8"),
  ]),
) as Record<Kind, string>;

/** The form-1 checksum 0.1.2 stamped into each fixture's frontmatter. */
const FORM_1: Readonly<Record<Kind, string>> = Object.fromEntries(
  KINDS.map((kind) => [kind, /^checksum: ([0-9a-f]{64})$/m.exec(FIXTURE[kind])![1]!]),
) as Record<Kind, string>;

/** The ledger's canonical JSON (keys sorted at every level) and its SHA-256. */
function digest(entry: unknown): string {
  const canonical = JSON.stringify(entry, (_key, value: unknown) =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, (value as Record<string, unknown>)[k]]),
        )
      : value,
  );
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** Append one entry as 0.1.2 did: the next id, the chain link, and the head. */
function append(repo: TestRepo, entry: Record<string, unknown>): void {
  const ledger = repo.ledger();
  const previous = ledger.at(-1);
  const full = {
    ...entry,
    id: ledger.length + 1,
    predecessor_digest: previous === undefined ? null : digest(previous),
  };
  repo.write(repo.ledgerPath, `${[...repo.ledgerLines(), JSON.stringify(full)].join("\n")}\n`);
  repo.write(
    `${repo.specDir}/.sdlc/ledger.head.json`,
    `${JSON.stringify({ last_id: full.id, last_digest: digest(full) })}\n`,
  );
}

interface StatusJson {
  specs: Array<{
    approvals: Record<Kind, { current: number; required: number; complete: boolean }>;
    artifacts: Record<
      Kind,
      { version: number; checksum: string; checksumCurrent: boolean; checksumEarlierForm: boolean }
    >;
  }>;
}

describe("scenario 14: upgrading a project approved and started under Vellum 0.1.2", () => {
  let repo: TestRepo;
  const status = () => JSON.parse(repo.vellum(["status", SLUG, "--json"]).stdout) as StatusJson;

  beforeAll(() => {
    repo = TestRepo.create();
    for (const kind of KINDS) repo.write(`${repo.specDir}/${kind}.md`, FIXTURE[kind]);
    append(repo, {
      kind: "adoption",
      timestamp: "2026-09-27T11:51:24.397Z",
      from: "legacy",
      to: "managed",
    });
    repo.commitAll(`docs: spec ${SLUG}`);
    for (const kind of KINDS) {
      append(repo, {
        timestamp: "2026-09-27T11:52:29.397Z",
        artifact: `${kind}.md`,
        artifact_version: 1,
        identity: HUMAN.email,
        kind: "approval",
        artifact_checksum: FORM_1[kind],
        identity_key: repo.key(HUMAN.key),
        session_type: "human",
        approval_signal: { commit: null, message_prefix: "approve:" },
      });
      repo.commitLedger(`approve: ${SLUG} ${kind}`, HUMAN.key);
    }
    // 0.1.2's `task start 1.1`: a form-1 Task Binding and the marker set to [-].
    append(repo, {
      kind: "task_binding",
      timestamp: "2026-09-27T12:10:03.228Z",
      task_id: "1.1",
      requirements_version: 1,
      requirements_checksum: FORM_1.requirements,
      design_version: 1,
      design_checksum: FORM_1.design,
      plan_version: 1,
      plan_checksum: FORM_1.tasks,
    });
    const tasks = `${repo.specDir}/tasks.md`;
    repo.write(tasks, repo.read(tasks).replace("- [ ] 1.1 ", "- [-] 1.1 "));
    repo.commitAll(`chore: ${SLUG} task 1.1 started`);
  });
  afterAll(() => repo?.dispose());

  it("the fixture's requirements.md and tasks.md checksums differ between the two forms", () => {
    const { artifacts } = status().specs[0]!;
    for (const kind of ["requirements", "tasks"] as const) {
      expect(artifacts[kind].checksum).not.toBe(FORM_1[kind]);
      expect(artifacts[kind]).toMatchObject({ checksumCurrent: false, checksumEarlierForm: true });
    }
    expect(repo.ledger().filter((e) => "checksum_form" in e)).toEqual([]);
  });

  it("verify counts all three approvals and reports none invalid", () => {
    const result = repo.vellum(["verify", SLUG, "--strict", "--json"]);
    const spec = (
      JSON.parse(result.stdout) as {
        specs: Array<{ approvals: unknown; findings: Array<{ rule: string; message: string }> }>;
      }
    ).specs[0]!;
    expect(spec.approvals).toEqual({ satisfied: 3, total: 3 });
    expect(spec.findings.filter((f) => f.rule.startsWith("APPROVAL"))).toEqual([]);
  });

  it("status counts them, and lint accepts the frontmatter 0.1.2 stamped", () => {
    for (const kind of KINDS) {
      expect(status().specs[0]!.approvals[kind]).toEqual({
        current: 1,
        required: 1,
        complete: true,
      });
    }
    const lint = repo.vellum(["lint", SLUG]);
    expect(lint.stdout + lint.stderr).not.toContain("CHECKSUM_MISMATCH");
    expect(lint.status).toBe(0);
  });

  it("the task 0.1.2 started completes, and the next starts with a form-2 binding", () => {
    const complete = repo.vellum(["task", "complete", SLUG, "1.1", "--command", PASSING_COMMAND]);
    expect(complete.stdout).toContain("Task 1.1 verified: exit status 0");
    expect(complete.status).toBe(0);

    const start = repo.vellum(["task", "start", SLUG, "1.2"]);
    expect(start.stderr).toBe("");
    expect(start.status).toBe(0);
    expect(repo.ledger().at(-1)).toMatchObject({
      kind: "task_binding",
      task_id: "1.2",
      requirements_checksum: status().specs[0]!.artifacts.requirements.checksum,
      checksum_form: 2,
    });
    repo.commitAll(`chore: ${SLUG} task 1.1 evidence, task 1.2 started`);
  });

  it("stamp moves the frontmatter to the current form without a new version; approvals still count", () => {
    const stamped = repo.vellum(["stamp", SLUG]);
    expect(stamped.status).toBe(0);
    const { artifacts, approvals } = status().specs[0]!;
    for (const kind of KINDS) {
      expect(repo.frontmatter(kind).version).toBe("1");
      expect(repo.frontmatter(kind).checksum).toBe(artifacts[kind].checksum);
      expect(artifacts[kind]).toMatchObject({ version: 1, checksumCurrent: true });
      expect(approvals[kind]).toEqual({ current: 1, required: 1, complete: true });
    }
    repo.commitAll(`docs: ${SLUG} frontmatter in the current checksum form`);
  });

  it("a content edit still voids the 0.1.2 approval", () => {
    const edited = repo.clone();
    try {
      const path = `${edited.specDir}/requirements.md`;
      edited.write(path, edited.read(path).replace("refuses an empty one", "refuses a blank one"));
      const start = edited.vellum(["task", "start", SLUG, "3.1"]);
      expect(start.status).toBe(1);
      expect(start.stderr).toContain(`approved checksum ${FORM_1.requirements}`);
    } finally {
      edited.dispose();
    }
  });
});
