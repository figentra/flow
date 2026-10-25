/**
 * Scenario 6 — the installed `vellum-mcp` over stdio against a repository
 * whose spec went through the whole lifecycle: the handshake, a tool list in
 * which every tool is read-only, tool results equal to the CLI's --json for
 * the same repository, refusal of a state-changing tool and of a path that
 * leaves the repository, and not one byte of the repository changed.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifiedSpec } from "./support/lifecycle.js";
import { call, mcpSession, toolPayload, type RpcResponse } from "./support/mcp.js";
import type { TestRepo } from "./support/repo.js";
import { SLUG } from "./support/spec.js";

describe("scenario 6: MCP over stdio from the installed tarball", () => {
  let repo: TestRepo;
  let before: string;
  let responses: Map<number, RpcResponse>;
  let stderr: string;
  let exitCode: number | null;

  const PARITY: ReadonlyArray<readonly [number, string, object, readonly string[]]> = [
    [10, "vellum_status", {}, ["status", "--json"]],
    [11, "vellum_status", { spec: SLUG }, ["status", SLUG, "--json"]],
    [12, "vellum_lint", {}, ["lint", "--json"]],
    [13, "vellum_lint", { type: "tasks" }, ["lint", "--type=tasks", "--json"]],
    [14, "vellum_verify", { spec: SLUG }, ["verify", SLUG, "--json"]],
    [15, "vellum_check", {}, ["check", "--json"]],
  ];

  beforeAll(async () => {
    repo = verifiedSpec();
    before = repo.fingerprint();
    ({ responses, stderr, exitCode } = await mcpSession(repo.repo, repo.env, [
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      ...PARITY.map(([id, name, args]) => call(id, name, args)),
      call(20, "vellum_approve", { spec: SLUG, artifact: "requirements" }),
      call(21, "vellum_task_complete", { spec: SLUG, task: "1.1" }),
      call(22, "vellum_get_artifact", { path: "../../etc/passwd" }),
      call(23, "vellum_get_artifact", { path: `${repo.specDir}/requirements.md` }),
      call(24, "vellum_trace", { spec: SLUG, limit: 3 }),
    ]));
  });
  afterAll(() => repo?.dispose());

  it("answers the handshake and exits cleanly when stdin closes", () => {
    expect(responses.get(0)?.result).toMatchObject({
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "vellum" },
    });
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
  });

  it("lists only read-only tools", () => {
    const tools = responses.get(1)?.result?.tools as Array<{ name: string; annotations: Record<string, boolean> }>;
    expect(tools.map((t) => t.name)).toEqual([
      "vellum_status",
      "vellum_lint",
      "vellum_verify",
      "vellum_check",
      "vellum_trace",
      "vellum_context",
      "vellum_get_artifact",
    ]);
    for (const tool of tools) {
      expect(tool.annotations, tool.name).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    }
  });

  it("returns what the CLI's --json returns for the same repository", () => {
    for (const [id, name, args, argv] of PARITY) {
      const fromMcp = toolPayload(responses.get(id));
      const fromCli = repo.vellum(argv);
      expect(fromMcp.isError, name).toBe(false);
      expect(fromCli.stdout, argv.join(" ")).not.toBe("");
      expect(fromMcp.value, `${name} ${JSON.stringify(args)}`).toEqual(JSON.parse(fromCli.stdout));
    }
    // The spec is done, and both surfaces say so.
    expect(toolPayload(responses.get(14)).value).toMatchObject({ result: "PASS" });
    expect(toolPayload(responses.get(15)).value).toMatchObject({ exitStatus: 0 });
  });

  it("refuses a state-changing tool by name", () => {
    for (const [id, name] of [[20, "vellum_approve"], [21, "vellum_task_complete"]] as const) {
      const { isError, value } = toolPayload(responses.get(id));
      expect(isError, name).toBe(true);
      expect((value as { message: string }).message).toContain(`${name} would change repository state`);
    }
  });

  it("refuses a path that leaves the repository, and reads one inside it", () => {
    const escape = toolPayload(responses.get(22));
    expect(escape.isError).toBe(true);
    expect(JSON.stringify(escape.value)).not.toContain("root:");
    const inside = toolPayload(responses.get(23));
    expect(inside.isError).toBe(false);
    expect(JSON.stringify(inside.value)).toContain("Requirements Document");
    const trace = toolPayload(responses.get(24)).value as { total: number; entries: unknown[] };
    expect(trace.entries).toHaveLength(3);
    expect(trace.total).toBe(repo.ledgerLines().length);
  });

  it("leaves every byte of the repository unchanged", () => {
    expect(repo.fingerprint()).toBe(before);
  });
});
