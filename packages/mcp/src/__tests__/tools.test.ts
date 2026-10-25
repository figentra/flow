/**
 * Each MCP tool against a real temp git repository: it returns what the
 * shared @vellum/storage query returns — the document the CLI's --json
 * output holds — and never changes the repository.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkDocument,
  lintDocument,
  openRepository,
  queryCheck,
  queryContext,
  queryLint,
  queryStatus,
  queryVerify,
  selectSpecs,
  statusDocument,
  verifyDocument,
  type Repository,
  type SpecRef,
} from "@vellum/storage";
import { TOOLS, callTool, type ToolResult } from "../tools.js";
import { Fixture, SLUG } from "./fixture.js";

/** The JSON payload of a tool result. */
function payload(result: ToolResult): Record<string, unknown> {
  expect(result.content).toHaveLength(1);
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

function errorMessage(result: ToolResult): string {
  expect(result.isError).toBe(true);
  return String(payload(result).message);
}

describe("MCP tools against a temp repository", () => {
  let fx: Fixture;
  let repo: Repository;
  let specs: SpecRef[];

  beforeEach(async () => {
    fx = new Fixture();
    repo = (await openRepository(fx.repo))!;
    const selection = selectSpecs(repo.root, undefined);
    if (selection.kind !== "specs") throw new Error(selection.message);
    specs = selection.specs;
  });

  afterEach(() => {
    fx.dispose();
  });

  it("lists exactly the read-only tools, each annotated read-only", () => {
    expect(TOOLS.map((t) => t.name)).toEqual([
      "vellum_status",
      "vellum_lint",
      "vellum_verify",
      "vellum_check",
      "vellum_trace",
      "vellum_context",
      "vellum_get_artifact",
    ]);
    for (const tool of TOOLS) {
      expect(tool.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      });
    }
  });

  describe("vellum_status", () => {
    it("returns the status document the CLI writes, for every spec and for one", async () => {
      const all = await callTool(fx.repo, "vellum_status", {});
      expect(all.isError).toBeUndefined();
      const query = queryStatus(repo, specs);
      if (query.kind !== "ok") throw new Error(query.message);
      expect(payload(all)).toEqual(
        JSON.parse(JSON.stringify(statusDocument(query.value))),
      );

      const one = payload(
        await callTool(fx.repo, "vellum_status", { spec: "1" }),
      );
      expect(one.command).toBe("status");
      expect(one.policy).toBe("missing");
      const [report] = one.specs as Array<Record<string, unknown>>;
      expect(report!.specId).toBe(SLUG);
      expect(report!.recordedState).toBe("IN_PROGRESS");
    });

    it("is an error naming the fragment when no spec matches", async () => {
      expect(
        errorMessage(await callTool(fx.repo, "vellum_status", { spec: "999" })),
      ).toBe("no spec matches '999'");
    });

    it("is an error when the Approval Policy is invalid", async () => {
      fx.write(".sdlc/policy.json", "{ not json");
      expect(
        errorMessage(await callTool(fx.repo, "vellum_status", {})),
      ).toContain("is invalid");
    });
  });

  describe("vellum_lint", () => {
    it("passes a well-formed spec and says what it examined, equal to the shared query", async () => {
      const result = payload(await callTool(fx.repo, "vellum_lint", {}));
      expect(result.status).toBe("PASS");
      expect(result.examined).toMatchObject({
        specs: 1,
        artifacts: 3,
        taskLines: 1,
      });
      expect(result).toEqual(
        JSON.parse(
          JSON.stringify(lintDocument(queryLint(repo, specs, undefined))),
        ),
      );
    });

    it("fails an artifact edited without its checksum", async () => {
      fx.write(
        `.agents/specs/${SLUG}/design.md`,
        `${fx.read(`.agents/specs/${SLUG}/design.md`)}\nedited\n`,
      );
      const result = payload(
        await callTool(fx.repo, "vellum_lint", { spec: SLUG }),
      );
      expect(result.status).toBe("FAIL");
      expect(
        (result.findings as Array<{ file: string }>).map((f) => f.file),
      ).toContain(`.agents/specs/${SLUG}/design.md`);
    });

    it("with type validates only that artifact, and refuses a type that is not a kind", async () => {
      const result = payload(
        await callTool(fx.repo, "vellum_lint", { type: "design" }),
      );
      expect(result.type).toBe("design");
      expect(result.examined).toMatchObject({ artifacts: 1 });
      expect(
        errorMessage(
          await callTool(fx.repo, "vellum_lint", { type: "readme" }),
        ),
      ).toContain("requirements, design, tasks");
    });
  });

  describe("vellum_verify", () => {
    it("fails a spec with no valid approval, equal to the shared query", async () => {
      const result = payload(await callTool(fx.repo, "vellum_verify", {}));
      expect(result.result).toBe("FAIL");
      expect(
        (result.specs as Array<{ spec: string }>).map((s) => s.spec),
      ).toEqual([SLUG]);
      const query = queryVerify(repo, specs, false);
      if (query.kind !== "ok") throw new Error(query.message);
      expect(result).toEqual(
        JSON.parse(JSON.stringify(verifyDocument(query.value))),
      );
    });

    it("is INCONCLUSIVE with no specs when nothing is IN_PROGRESS or later", async () => {
      for (const kind of ["requirements", "design", "tasks"] as const) {
        fx.write(
          `.agents/specs/${SLUG}/${kind}.md`,
          fx
            .read(`.agents/specs/${SLUG}/${kind}.md`)
            .replace("state: IN_PROGRESS", "state: DRAFT"),
        );
      }
      expect(payload(await callTool(fx.repo, "vellum_verify", {}))).toEqual({
        command: "verify",
        result: "INCONCLUSIVE",
        specs: [],
      });
    });
  });

  describe("vellum_check", () => {
    it("returns Check Mode's document, equal to the shared query, for every spec and for one", async () => {
      const all = payload(await callTool(fx.repo, "vellum_check", {}));
      expect(all.command).toBe("check");
      // The fixture records IN_PROGRESS with no approval: a state mismatch.
      expect(all.exitStatus).toBe(1);
      const query = queryCheck(repo, specs);
      if (query.kind !== "ok") throw new Error(query.message);
      expect(all).toEqual(JSON.parse(JSON.stringify(checkDocument(query.value))));
      const one = payload(await callTool(fx.repo, "vellum_check", { spec: SLUG }));
      expect(one).toEqual(all);
    });

    it("is an error naming the fragment when no spec matches, and INCONCLUSIVE on an invalid policy", async () => {
      expect(errorMessage(await callTool(fx.repo, "vellum_check", { spec: "999" }))).toContain(
        "no spec matches '999'",
      );
      fx.write(".sdlc/policy.json", "{ not json");
      expect(errorMessage(await callTool(fx.repo, "vellum_check", {}))).toMatch(/^INCONCLUSIVE — Approval Policy .* is invalid/);
    });
  });

  describe("vellum_trace", () => {
    it("returns the most recent ledger entries, oldest first, and the total", async () => {
      await fx.appendApproval("requirements");
      await fx.appendApproval("design");
      await fx.appendApproval("tasks");
      const all = payload(
        await callTool(fx.repo, "vellum_trace", { spec: SLUG }),
      );
      expect(all.total).toBe(3);
      expect((all.entries as Array<{ id: number }>).map((e) => e.id)).toEqual([
        1, 2, 3,
      ]);
      const last = payload(
        await callTool(fx.repo, "vellum_trace", { spec: "demo", limit: 2 }),
      );
      expect(last.spec).toBe(SLUG);
      expect(
        (last.entries as Array<{ id: number; artifact: string }>).map((e) => [
          e.id,
          e.artifact,
        ]),
      ).toEqual([
        [2, "design.md"],
        [3, "tasks.md"],
      ]);
    });

    it("requires spec and refuses a limit that is not a positive integer", async () => {
      expect(
        errorMessage(await callTool(fx.repo, "vellum_trace", {})),
      ).toContain("requires argument 'spec'");
      expect(
        errorMessage(
          await callTool(fx.repo, "vellum_trace", { spec: SLUG, limit: 0 }),
        ),
      ).toContain(">= 1");
      expect(
        errorMessage(
          await callTool(fx.repo, "vellum_trace", { spec: SLUG, limit: 1.5 }),
        ),
      ).toContain("integer");
    });

    it("is an error when the ledger cannot be read", async () => {
      writeFileSync(fx.ledgerPath, "{ broken\n");
      expect(
        (await callTool(fx.repo, "vellum_trace", { spec: SLUG })).isError,
      ).toBe(true);
    });
  });

  describe("vellum_context", () => {
    it("returns the briefing the context query computes, and writes nothing", async () => {
      const before = fx.git(["status", "--porcelain", "--untracked-files=all"]);
      const query = queryContext(specs[0]!, "1");
      if (query.kind !== "ok" || query.value === null) throw new Error("expected a briefing");
      const result = payload(await callTool(fx.repo, "vellum_context", { spec: SLUG, task: "1" }));
      expect(result).toEqual(JSON.parse(JSON.stringify(query.value)));
      expect(result.spec).toBe(SLUG);
      expect((result.task as { id: string }).id).toBe("1");
      expect(fx.git(["status", "--porcelain", "--untracked-files=all"])).toBe(before);
    });

    it("is an error for a task tasks.md does not define, or without a task", async () => {
      expect(errorMessage(await callTool(fx.repo, "vellum_context", { spec: SLUG, task: "9" }))).toContain(
        "defines no task 9",
      );
      expect(errorMessage(await callTool(fx.repo, "vellum_context", { spec: SLUG }))).toContain(
        "requires argument 'task'",
      );
    });
  });

  describe("vellum_get_artifact", () => {
    it("returns an artifact's text and frontmatter by its repository-relative path", async () => {
      const path = `.agents/specs/${SLUG}/requirements.md`;
      const result = payload(
        await callTool(fx.repo, "vellum_get_artifact", { path }),
      );
      expect(result).toMatchObject({
        path,
        spec: SLUG,
        kind: "requirements",
        text: fx.read(path),
      });
      expect(result.frontmatter).toMatchObject({
        version: 1,
        state: "IN_PROGRESS",
      });
    });

    it("refuses paths that leave the repository root", async () => {
      const outside = join(fx.base, "secret.md");
      writeFileSync(outside, "outside the repository");
      symlinkSync(outside, join(fx.specDir, "design-link.md"));
      symlinkSync(fx.base, join(fx.repo, ".agents", "specs", "escape"));
      writeFileSync(join(fx.base, "requirements.md"), "outside");

      const cases: Array<[string, string]> = [
        ["../secret.md", ".."],
        [`.agents/specs/${SLUG}/../../../../secret.md`, ".."],
        [outside, "absolute"],
        [join(fx.repo, `.agents/specs/${SLUG}/requirements.md`), "absolute"],
        [`.agents/specs/${SLUG}/design-link.md`, "outside the repository root"],
        [".agents/specs/escape/requirements.md", "outside the repository root"],
      ];
      for (const [path, reason] of cases) {
        const result = await callTool(fx.repo, "vellum_get_artifact", { path });
        expect(errorMessage(result), path).toContain(reason);
        expect(payload(result)).not.toHaveProperty("text");
      }
    });

    it("refuses a path inside the root that is not a spec artifact", async () => {
      fx.write("notes.md", "not an artifact");
      for (const path of [
        "notes.md",
        `.agents/specs/${SLUG}/.sdlc/ledger.jsonl`,
        `.agents/specs/${SLUG}`,
      ]) {
        expect(
          errorMessage(
            await callTool(fx.repo, "vellum_get_artifact", { path }),
          ),
          path,
        ).toContain("not a spec artifact");
      }
    });
  });

  describe("read-only surface", () => {
    it("refuses every state-changing operation by name and writes nothing", async () => {
      const before = {
        status: fx.git(["status", "--porcelain"]),
        ledger: fx.read(`.agents/specs/${SLUG}/.sdlc/ledger.jsonl`),
      };
      for (const name of [
        "vellum_approve",
        "vellum_task_start",
        "vellum_task_complete",
        "vellum_record_evidence",
      ]) {
        const message = errorMessage(
          await callTool(fx.repo, name, { spec: SLUG, task: "1" }),
        );
        expect(message).toContain(name);
        expect(message).toContain("read-only");
      }
      for (const tool of TOOLS) {
        const args =
          tool.name === "vellum_get_artifact"
            ? { path: `.agents/specs/${SLUG}/tasks.md` }
            : tool.name === "vellum_trace"
              ? { spec: SLUG }
              : {};
        await callTool(fx.repo, tool.name, args);
      }
      expect(fx.git(["status", "--porcelain"])).toBe(before.status);
      expect(fx.read(`.agents/specs/${SLUG}/.sdlc/ledger.jsonl`)).toBe(
        before.ledger,
      );
    });

    it("names an unknown tool, and refuses an argument the tool does not declare", async () => {
      expect(errorMessage(await callTool(fx.repo, "vellum_nope", {}))).toBe(
        "Unknown tool: vellum_nope",
      );
      expect(
        errorMessage(await callTool(fx.repo, "vellum_status", { cwd: "/" })),
      ).toContain("no argument 'cwd'");
      expect(
        errorMessage(await callTool(fx.repo, "vellum_status", [])),
      ).toContain("must be an object");
    });

    it("is an error outside a git work tree", async () => {
      const dir = mkdtempSync(join(tmpdir(), "vellum-mcp-nogit-"));
      try {
        expect(
          errorMessage(await callTool(dir, "vellum_status", {})),
        ).toContain("is not inside a git work tree");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
