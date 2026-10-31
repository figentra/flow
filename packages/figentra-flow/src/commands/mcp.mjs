/**
 * Figentra Flow file contract:
 * Purpose: `figentra-flow mcp`, a read-only MCP server over stdio (AC-033): JSON-RPC 2.0, one message per line,
 *   written by hand so the package keeps no dependency (the leader's plan stop of 2026-10-31, decision 2). It answers
 *   `initialize`, `ping`, `tools/list` and `tools/call` for exactly five read tools: status, spec, trace, worktrees and
 *   metrics, each returning one text content item holding JSON.
 * Boundary: no tool writes, merges, lands, starts or cleans; a test holds the tool list to these five. An unknown
 *   method, an unknown tool or bad arguments is a JSON-RPC error, and one bad request never stops the server.
 *   Notifications get no answer.
 * Runtime: node
 * Governing contract: STA-1729 phase 4.
 * Secrets: none; GitHub reads go through each repository's credentials.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { schemeFor } from "../adapters/tracker/index.mjs";
import { approvedAt, SPECS_DIR, STAGES, testsText } from "./gate.mjs";
import { reposFor } from "./status.mjs";
import { trace, traceProblems } from "./trace.mjs";
import { github } from "../lib/github.mjs";
import { metrics } from "../lib/metrics.mjs";
import { NAME, VERSION } from "../lib/product.mjs";
import { snapshot } from "../lib/snapshot.mjs";
import { readSessionCap } from "../lib/workspace.mjs";

/** The MCP protocol revisions this server speaks, newest first. */
export const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const PREFIX = NAME.replaceAll("-", "_");
const str = { type: "string" };
const object = (
  /** @type {Record<string, unknown>} */ properties,
  /** @type {string[]} */ required = [],
) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

/** The five read tools; nothing else is offered (AC-033). */
export const TOOLS = [
  {
    name: `${PREFIX}_status`,
    description:
      "What is in flight: each repository's specs, worktrees, open PRs with their gate and review, and sessions.",
    inputSchema: object({ repo: str, offline: { type: "boolean" } }),
  },
  {
    name: `${PREFIX}_spec`,
    description: "One spec's status, tier, session, approvals and gate problems, by its issue key.",
    inputSchema: object({ repo: str, key: str }, ["repo", "key"]),
  },
  {
    name: `${PREFIX}_trace`,
    description:
      "One spec's FR, AC and property to task to test matrix, with what is not covered yet.",
    inputSchema: object({ repo: str, key: str }, ["repo", "key"]),
  },
  {
    name: `${PREFIX}_worktrees`,
    description:
      "Each repository's worktrees: branch, issue key, dirty, idle hours, ahead and behind.",
    inputSchema: object({ repo: str }),
  },
  {
    name: `${PREFIX}_metrics`,
    description:
      "Delivery metrics for the PRs merged in the last `since` days (default 30), from GitHub and the specs.",
    inputSchema: object({ since: { type: "integer", minimum: 1 } }),
  },
];

/** A JSON-RPC error. */
class RpcError extends Error {
  constructor(/** @type {number} */ code, /** @type {string} */ message) {
    super(message);
    this.code = code;
  }
}

/**
 * Checks `args` against a tool's flat schema: known keys, required keys and their types.
 * @param {any} schema
 * @param {any} args
 */
function checkArgs(schema, args) {
  if (args === null || typeof args !== "object" || Array.isArray(args))
    throw new RpcError(-32602, "arguments must be an object");
  for (const key of Object.keys(args))
    if (!(key in schema.properties)) throw new RpcError(-32602, `unknown argument: ${key}`);
  for (const key of schema.required)
    if (args[key] === undefined) throw new RpcError(-32602, `missing argument: ${key}`);
  for (const [key, value] of Object.entries(args)) {
    const type = schema.properties[key].type;
    const ok = type === "integer" ? Number.isInteger(value) && value >= 1 : typeof value === type;
    if (!ok)
      throw new RpcError(
        -32602,
        `${key} must be ${type === "integer" ? "a positive integer" : `a ${type}`}`,
      );
  }
}

/**
 * One spec folder of `repo` by its key, with its texts.
 * @param {string} repo
 * @param {string} key
 */
function specFolder(repo, key) {
  const keys = schemeFor(repo);
  const wanted = keys.parse(key);
  const base = join(repo, SPECS_DIR);
  const folder = (existsSync(base) ? readdirSync(base) : []).find(
    (f) => wanted && keys.folderKey(f) === wanted,
  );
  if (!folder) throw new RpcError(-32602, `no spec for ${key} in ${repo}`);
  const read = (/** @type {string} */ name) => {
    const file = join(base, folder, name);
    return existsSync(file) ? readFileSync(file, "utf8") : "";
  };
  return { keys, folder, spec: read("spec.md"), plan: read("plan.md"), tasks: read("tasks.md") };
}

/**
 * The default readers behind the tools; tests replace them.
 * @returns {Record<string, (args: any) => unknown>}
 */
export function defaultReaders() {
  const repos = (/** @type {string | undefined} */ repo) => reposFor(repo, process.cwd());
  return {
    status: ({ repo, offline = false }) =>
      snapshot({
        repos: repos(repo),
        cap: readSessionCap(),
        offline,
        api: offline ? undefined : (root) => github(root),
      }),
    spec: ({ repo, key }) => {
      const s = snapshot({ repos: repos(repo), offline: true }).repos[0];
      const found = specFolder(s.path ?? repo, key);
      const row = (s.specs ?? []).find((/** @type {any} */ x) => x.folder === found.folder);
      const approvals = Object.fromEntries(
        STAGES.map((stage) => [stage, approvedAt(found.spec, stage) ?? null]).filter(([, a]) => a),
      );
      return { ...row, approvals };
    },
    trace: ({ repo, key }) => {
      const found = specFolder(repo, key);
      const t = trace({ ...found, tests: testsText(repo), keys: found.keys });
      return { ...t, problems: traceProblems(t) };
    },
    worktrees: ({ repo }) =>
      snapshot({ repos: repos(repo), offline: true }).repos.map((r) => ({
        path: r.path,
        worktrees: r.worktrees ?? [],
        error: r.error,
      })),
    metrics: ({ since = 30 }) =>
      metrics({
        repos: repos(undefined),
        api: (root) => github(root),
        since: Date.now() - since * 86_400_000,
      }),
  };
}

/**
 * The answer to one JSON-RPC message, or undefined for a notification.
 * @param {any} message
 * @param {Record<string, (args: any) => unknown>} readers
 */
export async function handle(message, readers = defaultReaders()) {
  const id = message?.id;
  const notification = id === undefined || id === null;
  try {
    if (message?.jsonrpc !== "2.0" || typeof message.method !== "string")
      throw new RpcError(-32600, "not a JSON-RPC 2.0 request");
    /** @type {unknown} */
    let result;
    switch (message.method) {
      case "initialize": {
        const asked = message.params?.protocolVersion;
        result = {
          protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: NAME, version: VERSION },
          instructions:
            "Read-only views of the workspace's specs, worktrees, PRs, sessions and delivery metrics.",
        };
        break;
      }
      case "ping":
        result = {};
        break;
      case "tools/list":
        result = { tools: TOOLS };
        break;
      case "tools/call": {
        const tool = TOOLS.find((t) => t.name === message.params?.name);
        if (!tool) throw new RpcError(-32602, `unknown tool: ${message.params?.name}`);
        const args = message.params?.arguments ?? {};
        checkArgs(tool.inputSchema, args);
        const read = readers[tool.name.slice(PREFIX.length + 1)];
        try {
          result = { content: [{ type: "text", text: JSON.stringify(await read(args), null, 2) }] };
        } catch (error) {
          if (error instanceof RpcError) throw error;
          // A failure inside the tool is the tool's result, so the agent sees it (MCP's isError).
          result = {
            content: [{ type: "text", text: /** @type {Error} */ (error).message }],
            isError: true,
          };
        }
        break;
      }
      default:
        if (message.method.startsWith("notifications/")) return undefined;
        throw new RpcError(-32601, `unknown method: ${message.method}`);
    }
    return notification ? undefined : { jsonrpc: "2.0", id, result };
  } catch (error) {
    if (notification) return undefined;
    const code = error instanceof RpcError ? error.code : -32603;
    return { jsonrpc: "2.0", id, error: { code, message: /** @type {Error} */ (error).message } };
  }
}

/** `figentra-flow mcp`: serves stdin to stdout until stdin closes. */
export async function run() {
  const readers = defaultReaders();
  const lines = createInterface({ input: process.stdin });
  for await (const line of lines) {
    if (!line.trim()) continue;
    /** @type {any} */
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } })}\n`,
      );
      continue;
    }
    const answer = await handle(message, readers);
    if (answer) process.stdout.write(`${JSON.stringify(answer)}\n`);
  }
  return 0;
}
