/**
 * Scenario 13 — a Markdown formatter runs over an approved spec. A human
 * approves all three documents and commits each approval signed; then
 * prettier (this repository's own, the workspace root's devDependency) runs
 * over the spec folder with `--prose-wrap always` at a narrow width, so every
 * long task line wraps onto hanging-indented continuation lines and the
 * `_Requirements:_` / `_Properties:_` trailers move off the task's first line
 * (one even splits across two), and it inserts a blank line after each
 * frontmatter block (prettier's default). The width is one at which prettier
 * leaves the fenced Task Dependency Graph JSON as written: fenced code is kept
 * exactly, so reformatting that JSON would be a change the checksum sees.
 * The reformat changes no word (decision 13 in 002's design):
 * lint, status and verify still count every approval and the plan's coverage
 * stays complete, and `task start` / `task complete` still work on the
 * wrapped tasks, rewriting only the marker on each task's first line.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveAll, draftSpec } from "./support/lifecycle.js";
import { KINDS, type TestRepo } from "./support/repo.js";
import { PASSING_COMMAND, REQUIRED_TASKS, SLUG } from "./support/spec.js";

const PRETTIER = createRequire(import.meta.url).resolve("prettier/bin/prettier.cjs");

interface VerifyJson {
  result: string;
  specs: Array<{
    approvals: { satisfied: number; total: number };
    findings: Array<{ rule: string; message: string }>;
  }>;
}

describe("scenario 13: prettier --prose-wrap always over an approved spec", () => {
  let repo: TestRepo;
  let checksums: Record<string, string>;
  let formattedTasks: string;
  beforeAll(() => {
    repo = draftSpec();
    approveAll(repo);
    checksums = Object.fromEntries(KINDS.map((kind) => [kind, repo.frontmatter(kind).checksum!]));
  });
  afterAll(() => repo?.dispose());

  const verify = () => {
    const result = repo.vellum(["verify", SLUG, "--strict", "--json"]);
    return { status: result.status, json: JSON.parse(result.stdout) as VerifyJson };
  };

  it("prettier rewraps the spec: task lines and their trailers now span several lines", () => {
    const before = repo.read(`${repo.specDir}/tasks.md`);
    execFileSync(
      process.execPath,
      [
        PRETTIER,
        "--no-config",
        "--no-editorconfig",
        "--prose-wrap",
        "always",
        "--print-width",
        "50",
        "--write",
        join(repo.specDir, "*.md"),
      ],
      { cwd: repo.repo, env: repo.env, stdio: "pipe" },
    );
    formattedTasks = repo.read(`${repo.specDir}/tasks.md`);
    expect(formattedTasks).not.toBe(before);
    // Prettier's default blank line after the frontmatter block.
    expect(formattedTasks).toMatch(/^---\n[\s\S]*?\n---\n\n#/);
    // Task 1.1's trailer is no longer on the task's first line.
    expect(formattedTasks).toMatch(/- \[ \] 1\.1 [^\n]*\n\s+[^\n]*_Requirements:/);
    expect(
      formattedTasks.split("\n").some((l) => /^\s+1\.\d_/.test(l) || /^\s+_Requirements:/.test(l)),
    ).toBe(true);
    repo.commitAll(`style: format ${SLUG} with prettier`);
  });

  it("lint still reads every task and every trailer", () => {
    const lint = repo.vellum(["lint", SLUG, "--json"]);
    expect(lint.stderr).toBe("");
    expect(JSON.parse(lint.stdout)).toMatchObject({
      status: "PASS",
      findings: [],
      examined: { specs: 1, artifacts: 3, taskLines: 8 },
    });
    expect(lint.status).toBe(0);
  });

  it("every approval still counts: the checksums are unchanged", () => {
    const spec = JSON.parse(repo.vellum(["status", SLUG, "--json"]).stdout).specs[0];
    for (const kind of KINDS) {
      expect(spec.approvals[kind]).toEqual({ current: 1, required: 1, complete: true });
    }
    const { json } = verify();
    expect(json.specs[0]!.approvals).toEqual({ satisfied: 3, total: 3 });
    // Nothing is wrong but the evidence no task has yet.
    expect(json.specs[0]!.findings.map((f) => f.rule)).not.toContain("APPROVAL_INVALID");
    expect(json.specs[0]!.findings.map((f) => f.rule)).not.toContain("CRITERION_NOT_REFERENCED");
    expect(json.specs[0]!.findings.map((f) => f.rule)).not.toContain("PROPERTY_NOT_CITED");
    // The frontmatter checksum stamped before the reformat is still current.
    for (const kind of KINDS) expect(repo.frontmatter(kind).checksum).toBe(checksums[kind]);
  });

  it("task start and complete work on the wrapped tasks, flipping only the first line's marker", () => {
    for (const id of REQUIRED_TASKS) {
      const start = repo.vellum(["task", "start", SLUG, id]);
      expect(start.stderr).toBe("");
      expect(start.status).toBe(0);
      expect(repo.marker(id)).toBe("-");
      const complete = repo.vellum(["task", "complete", SLUG, id, "--command", PASSING_COMMAND]);
      expect(complete.stdout).toContain(`Task ${id} verified: exit status 0`);
      expect(complete.status).toBe(0);
      expect(repo.marker(id)).toBe("x");
    }
    // Only marker characters changed: the plan reads as it did, markers aside.
    const unmark = (text: string) => text.replace(/^(\s*- \[)[ x~-]\]/gm, "$1 ]");
    expect(unmark(repo.read(`${repo.specDir}/tasks.md`))).toBe(unmark(formattedTasks));
    repo.commitAll(`chore: record ${SLUG} task evidence`);
  });

  it("verify --strict passes on the formatted spec", () => {
    const { status, json } = verify();
    expect(json.specs[0]!.findings).toEqual([]);
    expect(json.specs[0]!.approvals).toEqual({ satisfied: 3, total: 3 });
    expect(json.result).toBe("PASS");
    expect(status).toBe(0);
  });
});
