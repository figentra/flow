/**
 * Figentra Flow file contract:
 * Purpose: hold `fflow mcp` to AC-033 and the MCP shapes of `initialize`, `tools/list` and `tools/call`: the
 *   tool list is exactly the eight read tools and the one writer, `clarification_record` (STA-2098 H4; the
 *   question tools themselves are `questions.test.mjs`'s), each call returns one text item holding the reader's JSON, a reader's
 *   own failure is `isError`, and an unknown method, an unknown tool, bad arguments or a malformed request is a JSON-RPC
 *   error; notifications get no answer.
 * Boundary: the handler driven by request objects with stub readers; no process, no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1729 phase 4; STA-2098 (H4).
 */
// @covers sta-1729:FR-7 sta-1729:AC-033
import { test } from "node:test";
import assert from "node:assert/strict";

import { handle, PROTOCOLS, TOOLS } from "../commands/mcp.mjs";

/** @type {Record<string, (args: any) => unknown>} */
const readers = {
  status: (args) => ({ tool: "status", args }),
  spec: (args) => ({ tool: "spec", args }),
  trace: (args) => ({ tool: "trace", args }),
  worktrees: (args) => ({ tool: "worktrees", args }),
  metrics: () => {
    throw new Error("GitHub is unreachable");
  },
};
/**
 * The shapes these tests read from a reply; `handle` itself types `result` as unknown.
 * @typedef {{ protocolVersion: string, capabilities: object, serverInfo: { name: string, version: string },
 *   tools: typeof TOOLS, content: { type: string, text: string }[], isError?: boolean }} Result
 * @typedef {{ jsonrpc: string, id?: number, result?: Result, error?: { code: number, message: string } }} Reply
 */
const call = async (
  /** @type {number} */ id,
  /** @type {string} */ method,
  /** @type {any} */ params,
) =>
  /** @type {Reply | undefined} */ (await handle({ jsonrpc: "2.0", id, method, params }, readers));

test("mcp: initialize negotiates the protocol and announces only tools; notifications get no answer", async () => {
  const init = await call(1, "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "t", version: "1" },
  });
  assert.equal(init?.result.protocolVersion, "2025-03-26");
  assert.deepEqual(init?.result.capabilities, { tools: { listChanged: false } });
  assert.equal(init?.result.serverInfo.name, "fflow");
  assert.equal(
    (await call(2, "initialize", { protocolVersion: "1999-01-01" }))?.result.protocolVersion,
    PROTOCOLS[0],
  );
  assert.equal(
    await handle({ jsonrpc: "2.0", method: "notifications/initialized" }, readers),
    undefined,
  );
  assert.deepEqual((await call(3, "ping"))?.result, {});
});

test("mcp: the tool list is exactly eight read tools and one writer, clarification_record (AC-033, STA-2098)", async () => {
  const listed = (await call(1, "tools/list"))?.result.tools;
  const reads = [
    "fflow_status",
    "fflow_spec",
    "fflow_trace",
    "fflow_worktrees",
    "fflow_metrics",
    "fflow_questions_list",
    "fflow_docs_lookup",
    "fflow_context",
  ];
  const writes = ["fflow_clarification_record"];
  assert.deepEqual(
    listed.map((/** @type {any} */ t) => t.name),
    [...reads, ...writes],
  );
  for (const tool of listed) {
    assert.equal(typeof tool.description, "string");
    assert.equal(tool.inputSchema.type, "object");
    assert.doesNotMatch(tool.name, /land|merge|start|clean|write|create|delete|push|set/);
    // The read and write split, as the client sees it (MCP tool annotations).
    assert.equal(tool.annotations.readOnlyHint, reads.includes(tool.name), tool.name);
  }
  const writer = /** @type {any} */ (listed.find((/** @type {any} */ t) => t.name === writes[0]));
  assert.equal(writer.annotations.destructiveHint, false);
  assert.match(writer.description, /^The only tool that writes/);
  assert.equal(listed, TOOLS);
});

test("mcp: tools/call returns the reader's JSON as one text item; a reader's failure is isError", async () => {
  const answer = await call(1, "tools/call", {
    name: "fflow_spec",
    arguments: { repo: "/r", key: "STA-1" },
  });
  assert.equal(answer?.result.content.length, 1);
  assert.equal(answer?.result.content[0].type, "text");
  assert.deepEqual(JSON.parse(answer?.result.content[0].text), {
    tool: "spec",
    args: { repo: "/r", key: "STA-1" },
  });
  assert.deepEqual(
    JSON.parse((await call(2, "tools/call", { name: "fflow_status" }))?.result.content[0].text),
    {
      tool: "status",
      args: {},
    },
  );
  const failed = await call(3, "tools/call", {
    name: "fflow_metrics",
    arguments: { since: 7 },
  });
  assert.equal(failed?.result.isError, true);
  assert.match(failed?.result.content[0].text, /unreachable/);
});

test("mcp: unknown method, unknown tool, bad arguments and a malformed request are JSON-RPC errors", async () => {
  assert.equal((await call(1, "resources/list"))?.error.code, -32601);
  assert.equal((await call(2, "tools/call", { name: "fflow_land" }))?.error.code, -32602);
  for (const args of [
    { repo: "/r" },
    { repo: "/r", key: 3 },
    { repo: "/r", key: "x", force: true },
  ])
    assert.equal(
      (await call(3, "tools/call", { name: "fflow_trace", arguments: args }))?.error.code,
      -32602,
    );
  assert.equal(
    (await call(4, "tools/call", { name: "fflow_metrics", arguments: { since: 0 } }))?.error.code,
    -32602,
  );
  assert.equal((await handle({ id: 5, method: "ping" }, readers))?.error.code, -32600);
  assert.equal(
    await handle({ jsonrpc: "2.0", method: "ping" }, readers),
    undefined,
    "a notification is never answered",
  );
});
