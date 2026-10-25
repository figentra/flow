/**
 * Scenario 11 — an approved document is amended and approved again. Here
 * spec-clarify's edit: a criterion reworded in place and a dated
 * `## Clarifications` session appended to an approved, verified
 * requirements.md. The old approval then binds a checksum the document no
 * longer has: verify fails naming both checksums (criterion 8.2), and the
 * design and plan approvals given before the amendment stop counting too
 * (criterion 8.6), reported as SUPERSEDED_BY_UPSTREAM_AMENDMENT naming
 * requirements.md. Re-approving requirements alone does not restore them: the
 * design and plan were approved against other requirements. Once the human
 * approves requirements, design and plan again, in order, each committed
 * signed, the old approvals are history — not findings, not counted — and
 * verify, status and check agree the spec is approved.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approve, verifiedSpec } from "./support/lifecycle.js";
import type { TestRepo } from "./support/repo.js";
import { REQUIREMENTS, SLUG } from "./support/spec.js";

const CLARIFIED = `${REQUIREMENTS.replace(
  "exit with status 2 and print nothing to stdout.",
  "exit with status 2, print nothing to stdout and print a usage line to stderr.",
)}
## Clarifications

### Session 2026-09-27

- Q: Where does the refusal of an empty name explain itself? → A: One usage line on stderr (criterion 1.2).
`;

interface VerifyJson {
  result: string;
  specs: Array<{
    approvals: { satisfied: number; total: number };
    supersededApprovals: number;
    findings: Array<{ rule: string; message: string }>;
  }>;
}

describe("scenario 11: requirements amended by clarify, then approved again", () => {
  let repo: TestRepo;
  beforeAll(() => {
    expect(CLARIFIED).not.toContain("print nothing to stdout.\n");
    repo = verifiedSpec();
  });
  afterAll(() => repo?.dispose());

  const verify = () => {
    const result = repo.vellum(["verify", SLUG, "--strict", "--json"]);
    return { status: result.status, json: JSON.parse(result.stdout) as VerifyJson };
  };
  const statusApprovals = () =>
    (
      JSON.parse(repo.vellum(["status", SLUG, "--json"]).stdout) as {
        specs: Array<{ approvals: Record<"requirements" | "design" | "tasks", unknown> }>;
      }
    ).specs[0]!.approvals;
  const requirementsApprovals = () => statusApprovals().requirements;
  const upstream = (kind: string, was: string, now: string) =>
    `APPROVAL_INVALID: Approval invalid: SUPERSEDED_BY_UPSTREAM_AMENDMENT — ${kind}.md was approved while requirements.md was at ${was}; requirements.md has since been amended to ${now}`;
  let approvedAt = "";
  let amendedTo = "";

  it("the verified spec passes before the amendment", () => {
    expect(verify().status).toBe(0);
  });

  it("the clarified requirements void the approval, and the design and plan approvals given before it", () => {
    const before = repo
      .ledger()
      .find((e) => e.kind === "approval" && e.artifact === "requirements.md")!;
    repo.rewriteBody("requirements", CLARIFIED);
    repo.commitAll(`docs: clarify ${SLUG} requirements`);
    approvedAt = String(before.artifact_checksum);
    amendedTo = String(repo.frontmatter("requirements").checksum);

    const { status, json } = verify();
    expect(status).toBe(1);
    expect(json.result).toBe("FAIL");
    expect(json.specs[0]!.approvals).toEqual({ satisfied: 0, total: 3 });
    expect(json.specs[0]!.findings.map((f) => `${f.rule}: ${f.message}`)).toEqual([
      `APPROVAL_INVALID: Approval invalid: CHECKSUM_MISMATCH — requirements.md was approved at ${approvedAt} and is now ${amendedTo}`,
      upstream("design", approvedAt, amendedTo),
      upstream("tasks", approvedAt, amendedTo),
      "APPROVAL_REQUIRED: requirements.md has 0 of the 1 valid approvals the policy requires",
      "APPROVAL_REQUIRED: design.md has 0 of the 1 valid approvals the policy requires",
      "APPROVAL_REQUIRED: tasks.md has 0 of the 1 valid approvals the policy requires",
    ]);
    expect(statusApprovals()).toEqual({
      requirements: { current: 0, required: 1, complete: false },
      design: { current: 0, required: 1, complete: false },
      tasks: { current: 0, required: 1, complete: false },
    });
    expect(repo.vellum(["check", SLUG]).status).toBe(1);
  });

  it("re-approving only the requirements leaves the design and plan approvals void", () => {
    approve(repo, "requirements");

    const { status, json } = verify();
    expect(status).toBe(1);
    expect(json.specs[0]!.findings.map((f) => `${f.rule}: ${f.message}`)).toEqual([
      upstream("design", approvedAt, amendedTo),
      upstream("tasks", approvedAt, amendedTo),
      "APPROVAL_REQUIRED: design.md has 0 of the 1 valid approvals the policy requires",
      "APPROVAL_REQUIRED: tasks.md has 0 of the 1 valid approvals the policy requires",
    ]);
    expect(requirementsApprovals()).toEqual({ current: 1, required: 1, complete: true });

    const status2 = JSON.parse(repo.vellum(["status", SLUG, "--json"]).stdout) as {
      specs: Array<{ effectiveState: string; effective: { failedPrecondition: string } }>;
    };
    expect(status2.specs[0]!.effectiveState).toBe("DESIGN_IN_REVIEW");
    expect(status2.specs[0]!.effective.failedPrecondition).toContain(
      "SUPERSEDED_BY_UPSTREAM_AMENDMENT — design.md was approved while requirements.md was at",
    );
    const check = repo.vellum(["check", SLUG]);
    expect(check.status).toBe(1);
  });

  it("re-approving design and plan after the requirements makes verify, status and check pass", () => {
    approve(repo, "design");
    approve(repo, "tasks");

    const { status, json } = verify();
    expect(json.specs[0]!.findings).toEqual([]);
    expect(json.specs[0]!.approvals).toEqual({ satisfied: 3, total: 3 });
    expect(json.specs[0]!.supersededApprovals).toBe(3);
    expect(json.result).toBe("PASS");
    expect(status).toBe(0);

    expect(statusApprovals()).toEqual({
      requirements: { current: 1, required: 1, complete: true },
      design: { current: 1, required: 1, complete: true },
      tasks: { current: 1, required: 1, complete: true },
    });
    const check = repo.vellum(["check", SLUG]);
    expect(check.stderr).toBe("");
    expect(check.status).toBe(0);
  });

  it("the human output says the old approval was superseded", () => {
    const human = repo.vellum(["verify", SLUG, "--strict"]);
    expect(human.status).toBe(0);
    expect(human.stdout).toContain("Approvals: 3/3 (3 superseded by re-approval, not counted)");
  });
});
