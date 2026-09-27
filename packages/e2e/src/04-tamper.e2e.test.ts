/**
 * Scenario 4 — tampering is detected. A spec is taken through the whole
 * lifecycle once; each case works on its own copy of that repository.
 * Editing, deleting, truncating or reordering ledger entries fails verify and
 * check naming ledger integrity; editing an approved document's content
 * voids its approval (CHECKSUM_MISMATCH); formatting-only edits and a flipped
 * task marker do not.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifiedSpec } from "./support/lifecycle.js";
import type { TestRepo } from "./support/repo.js";
import { REQUIREMENTS, SLUG } from "./support/spec.js";

interface Report {
  status: number;
  json: { result: string; specs: Array<{ findings: Array<{ rule: string; message: string }> }> };
}

describe("scenario 4: tampering", () => {
  let base: TestRepo;
  const copies: TestRepo[] = [];
  beforeAll(() => {
    base = verifiedSpec();
  });
  afterAll(() => {
    for (const copy of copies) copy.dispose();
    base?.dispose();
  });

  function copy(): TestRepo {
    const repo = base.clone();
    copies.push(repo);
    return repo;
  }

  function verify(repo: TestRepo): Report {
    const result = repo.vellum(["verify", SLUG, "--strict", "--json"]);
    return { status: result.status, json: JSON.parse(result.stdout) as Report["json"] };
  }

  function rules(report: Report): string[] {
    return report.json.specs[0]!.findings.map((f) => f.rule);
  }

  /** verify and check both fail, naming LEDGER_INTEGRITY. */
  function expectIntegrityFailure(repo: TestRepo): void {
    const report = verify(repo);
    expect(report.status).toBe(1);
    expect(rules(report)).toContain("LEDGER_INTEGRITY");
    const check = repo.vellum(["check", SLUG, "--json"]);
    expect(check.status).toBe(1);
    const json = JSON.parse(check.stdout) as { summary: { ledgerFailures: number }; findings: Array<{ rule: string }> };
    expect(json.summary.ledgerFailures).toBe(1);
    expect(json.findings.map((f) => f.rule)).toContain("LEDGER_INTEGRITY");
  }

  function rewriteLedger(repo: TestRepo, edit: (lines: string[]) => string[]): void {
    repo.write(repo.ledgerPath, `${edit(repo.ledgerLines()).join("\n")}\n`);
  }

  it("starts from a spec that verifies and checks clean", () => {
    expect(verify(base).status).toBe(0);
    expect(base.vellum(["check", SLUG]).status).toBe(0);
    expect(base.ledgerLines().length).toBeGreaterThan(6);
  });

  it("an edited ledger entry fails integrity", () => {
    const repo = copy();
    // A passing Evidence Entry rewritten to a failure, as someone hiding a result might.
    const target = repo.ledgerLines().findIndex((line) => line.includes('"kind":"evidence"'));
    expect(target).toBeGreaterThan(0);
    rewriteLedger(repo, (lines) =>
      lines.map((line, i) => (i === target ? line.replace('"exit_status":0', '"exit_status":1') : line)),
    );
    expect(repo.ledgerLines()[target]).toContain('"exit_status":1');
    expectIntegrityFailure(repo);
  });

  it("a deleted middle entry fails integrity", () => {
    const repo = copy();
    rewriteLedger(repo, (lines) => lines.filter((_, i) => i !== 2));
    expectIntegrityFailure(repo);
  });

  it("a truncated tail fails integrity", () => {
    const repo = copy();
    rewriteLedger(repo, (lines) => lines.slice(0, -2));
    expectIntegrityFailure(repo);
  });

  it("reordered entries fail integrity", () => {
    const repo = copy();
    rewriteLedger(repo, (lines) => [lines[1]!, lines[0]!, ...lines.slice(2)]);
    expectIntegrityFailure(repo);
  });

  it("editing an approved document's content voids its approval (CHECKSUM_MISMATCH)", () => {
    const repo = copy();
    repo.rewriteBody("requirements", REQUIREMENTS.replace("exit with status 2", "exit with status 3"));
    repo.commitAll("docs: change a requirement after approval");
    // The frontmatter checksum is current, so this is not a lint problem; it is an approval problem.
    expect(repo.vellum(["lint", SLUG]).status).toBe(0);
    const report = verify(repo);
    expect(report.status).toBe(1);
    // Criterion 8.2: the finding names the artifact and both checksums.
    const approved = repo.ledger().find((e) => e.kind === "approval" && e.artifact === "requirements.md")!;
    const current = repo.frontmatter("requirements").checksum;
    expect(approved.artifact_checksum).not.toBe(current);
    expect(report.json.specs[0]!.findings.map((f) => `${f.rule}: ${f.message}`)).toEqual([
      `APPROVAL_INVALID: Approval invalid: CHECKSUM_MISMATCH — requirements.md was approved at ${String(approved.artifact_checksum)} and is now ${current}`,
      "APPROVAL_REQUIRED: requirements.md has 0 of the 1 valid approvals the policy requires",
    ]);
    const status = JSON.parse(repo.vellum(["status", SLUG, "--json"]).stdout).specs[0];
    expect(status.approvals.requirements).toEqual({ current: 0, required: 1, complete: false });
    expect(repo.vellum(["check", SLUG]).status).toBe(1);
  });

  it("formatting-only edits keep the approval: CRLF, table padding, trailing spaces", () => {
    const repo = copy();
    for (const kind of ["requirements", "design", "tasks"] as const) {
      const path = `${repo.specDir}/${kind}.md`;
      const [, frontmatter, body] = /^(---\n[\s\S]*?\n---\n)([\s\S]*)$/.exec(repo.read(path))!;
      const reformatted = body!
        .split("\n")
        .map((line) =>
          line.startsWith("|")
            ? line.replace(/\s*\|\s*/g, " |  ").trimEnd()
            : line === "" ? line : `${line}   `,
        )
        .join("\r\n");
      repo.write(path, `${frontmatter}${reformatted}`);
    }
    expect(repo.read(`${repo.specDir}/tasks.md`)).toContain("\r\n");
    expect(repo.read(`${repo.specDir}/requirements.md`)).toMatch(/ {3}\r\n/);
    repo.commitAll("style: reformat the spec");
    const report = verify(repo);
    expect(report.json.specs[0]!.findings).toEqual([]);
    expect(report.status).toBe(0);
  });

  it("flipping a task marker keeps the plan approval", () => {
    const repo = copy();
    const path = `${repo.specDir}/tasks.md`;
    // Task 1.3 is now required (V-06), so it's completed in the base spec
    // Change it back to in-progress - this should still keep the approval
    repo.write(path, repo.read(path).replace("- [x] 1.3 ", "- [-] 1.3 "));
    repo.commitAll("chore: restart task 1.3");
    expect(repo.marker("1.3")).toBe("-");
    const status = JSON.parse(repo.vellum(["status", SLUG, "--json"]).stdout).specs[0];
    expect(status.approvals.tasks).toEqual({ current: 1, required: 1, complete: true });
    expect(verify(repo).status).toBe(0);
  });
});
