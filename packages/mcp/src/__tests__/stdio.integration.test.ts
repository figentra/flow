/**
 * The built `vellum-mcp` bin over stdio: spawn dist/server.js in a temp
 * repository, then initialize -> tools/list -> tools/call, reading real
 * results. Needs `build` first (this package's turbo `test` depends on it).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Fixture, SLUG } from "./fixture.js";

const SERVER = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "dist",
  "server.js",
);

/** Send `messages` one per line, close stdin, and return every response line parsed. */
function converse(
  cwd: string,
  env: NodeJS.ProcessEnv,
  messages: readonly (object | string)[],
): Promise<{
  responses: Array<Record<string, any>>;
  code: number | null;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on(
      "data",
      (chunk: Buffer) => (stdout += chunk.toString("utf8")),
    );
    child.stderr.on(
      "data",
      (chunk: Buffer) => (stderr += chunk.toString("utf8")),
    );
    child.on("error", reject);
    child.on("close", (code) => {
      const responses = stdout
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line) as Record<string, any>);
      resolve({ responses, code, stderr });
    });
    for (const message of messages) {
      child.stdin.write(
        `${typeof message === "string" ? message : JSON.stringify(message)}\n`,
      );
    }
    child.stdin.end();
  });
}

describe("vellum-mcp over stdio", () => {
  let fx: Fixture;

  beforeEach(() => {
    fx = new Fixture();
  });

  afterEach(() => {
    fx.dispose();
  });

  it("is built", () => {
    expect(existsSync(SERVER), `${SERVER} — run the build first`).toBe(true);
  });

  it("answers initialize, tools/list and tools/call with real results, in order", async () => {
    const { responses, code, stderr } = await converse(fx.repo, fx.env, [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "0" },
        },
      },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "vellum_status", arguments: { spec: SLUG } },
      },
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "vellum_lint", arguments: {} },
      },
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "vellum_approve", arguments: { spec: SLUG } },
      },
      "{ not json",
    ]);

    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(responses.map((r) => r.id)).toEqual([1, 2, 3, 4, 5, null]);

    expect(responses[0]!.result).toMatchObject({
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "vellum" },
    });
    expect(
      responses[1]!.result.tools.map((t: { name: string }) => t.name),
    ).toEqual([
      "vellum_status",
      "vellum_lint",
      "vellum_verify",
      "vellum_check",
      "vellum_trace",
      "vellum_context",
      "vellum_get_artifact",
    ]);

    const status = JSON.parse(responses[2]!.result.content[0].text);
    expect(status.command).toBe("status");
    expect(status.specs[0].specId).toBe(SLUG);
    expect(status.specs[0].recordedState).toBe("IN_PROGRESS");

    const lint = JSON.parse(responses[3]!.result.content[0].text);
    expect(lint).toMatchObject({
      command: "lint",
      status: "PASS",
      examined: { specs: 1, artifacts: 3 },
    });

    expect(responses[4]!.result.isError).toBe(true);
    expect(responses[4]!.result.content[0].text).toContain(
      "vellum_approve would change repository state",
    );

    expect(responses[5]!.error.code).toBe(-32700);
    expect(fx.git(["status", "--porcelain"])).toBe("");
  });
});
