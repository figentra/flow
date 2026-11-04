/**
 * Figentra Flow file contract:
 * Purpose: `fflow mcp`, an MCP server over stdio (AC-033): JSON-RPC 2.0, one message per line, written by hand so
 *   the package keeps no dependency (the leader's plan stop of 2026-10-31, decision 2). It answers `initialize`,
 *   `ping`, `tools/list` and `tools/call` for exactly eight tools, each returning one text content item holding JSON:
 *   seven read tools (status, spec, trace, worktrees, metrics, and the questions ones of STA-2098 H4: a spec's open
 *   questions and a docs lookup) and one writer, `clarification_record`, which records one answer in the spec (the
 *   spec is the record). Without an answer in its arguments it asks the user through MCP elicitation
 *   (`elicitation/create`), and only when the client declared `elicitation` in `initialize`.
 * Boundary: only `clarification_record` writes, and only `<repo>/.agents/specs/<key>-<slug>/spec.md` by its real path
 *   (`lib/questions.mjs`); no tool merges, lands, starts or cleans, and a test holds the tool list and its read and
 *   write split. An unknown method, an unknown tool or bad arguments is a JSON-RPC error, and one bad request never
 *   stops the server. Notifications get no answer; a reply to the server's own request settles it.
 * Runtime: node
 * Governing contract: STA-1729 phase 4; STA-2098 (PLAN section 10, H4).
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
import {
  checkLine,
  docsLookup,
  MAX_MATCHES,
  openQuestions,
  QuestionError,
  specFile,
  writeAnswer,
} from "../lib/questions.mjs";
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

/** What a read tool and the one writer tell the client (MCP tool annotations). */
const READS = { readOnlyHint: true };
const RECORDS = { readOnlyHint: false, destructiveHint: false, idempotentHint: true };

/** The seven read tools and the one writer, `clarification_record`; nothing else is offered (AC-033, STA-2098). */
export const TOOLS = [
  {
    name: `${PREFIX}_status`,
    description:
      "What is in flight: each repository's specs, worktrees, open PRs with their gate and review, and sessions.",
    inputSchema: object({ repo: str, offline: { type: "boolean" } }),
    annotations: READS,
  },
  {
    name: `${PREFIX}_spec`,
    description: "One spec's status, tier, session, approvals and gate problems, by its issue key.",
    inputSchema: object({ repo: str, key: str }, ["repo", "key"]),
    annotations: READS,
  },
  {
    name: `${PREFIX}_trace`,
    description:
      "One spec's FR, AC and property to task to test matrix, with what is not covered yet.",
    inputSchema: object({ repo: str, key: str }, ["repo", "key"]),
    annotations: READS,
  },
  {
    name: `${PREFIX}_worktrees`,
    description:
      "Each repository's worktrees: branch, issue key, dirty, idle hours, ahead and behind.",
    inputSchema: object({ repo: str }),
    annotations: READS,
  },
  {
    name: `${PREFIX}_metrics`,
    description:
      "Delivery metrics for the PRs merged in the last `since` days (default 30), from GitHub and the specs.",
    inputSchema: object({ since: { type: "integer", minimum: 1 } }),
    annotations: READS,
  },
  {
    name: `${PREFIX}_questions_list`,
    description:
      "One spec's open questions, by its issue key: each [NEEDS CLARIFICATION: …] marker outside a comment, and " +
      "each question under ## Clarifications with no answer, with its line.",
    inputSchema: object({ repo: str, key: str }, ["repo", "key"]),
    annotations: READS,
  },
  {
    name: `${PREFIX}_docs_lookup`,
    description:
      "Searches the repository's specs (.agents/specs), docs/ and .flow/ text for a phrase, in any case: the " +
      `matching lines with their paths, at most \`limit\` (default 20, at most ${MAX_MATCHES}).`,
    inputSchema: object({ repo: str, query: str, limit: { type: "integer", minimum: 1 } }, [
      "repo",
      "query",
    ]),
    annotations: READS,
  },
  {
    name: `${PREFIX}_clarification_record`,
    description:
      "The only tool that writes: records one answer in a spec, by its issue key, as `- Q: <question> → A: " +
      "<answer>` under ## Clarifications → ### Session <today>, and replaces the [NEEDS CLARIFICATION] marker " +
      "whose text is `marker` (else the question) with the answer. Without `answer`, the user is asked in a form " +
      "when the client supports MCP elicitation.",
    inputSchema: object({ repo: str, key: str, question: str, answer: str, marker: str }, [
      "repo",
      "key",
      "question",
    ]),
    annotations: RECORDS,
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
 * What a tool call may use of its connection: whether the client declared `elicitation` in `initialize`, and how to
 * send the client a request and wait for its reply (`connection`).
 * @typedef {{ elicitation?: boolean, ask?: (method: string, params: unknown) => Promise<any> }} Session
 * @typedef {(args: any, session: Session) => unknown} Reader
 */

/**
 * A refusal of the arguments as given, before anything is read or asked: a JSON-RPC error.
 * @param {string | undefined} problem
 */
const refuse = (problem) => {
  if (problem) throw new RpcError(-32602, problem);
};

/**
 * The default readers behind the tools; tests replace them.
 * @param {{ today?: () => string }} [options] the session date a recorded answer goes under (tests fix it)
 * @returns {Record<string, Reader>}
 */
export function defaultReaders({ today = () => new Date().toISOString().slice(0, 10) } = {}) {
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
    questions_list: ({ repo, key }) => {
      const found = specFolder(repo, key);
      return { spec: `${SPECS_DIR}/${found.folder}/spec.md`, ...openQuestions(found.spec) };
    },
    docs_lookup: ({ repo, query, limit }) => {
      refuse(checkLine(query, "query", 200));
      return docsLookup(repo, query, { limit });
    },
    clarification_record: async ({ repo, key, question, answer, marker }, session) => {
      refuse(checkLine(question, "question"));
      if (question.includes("→ A:")) refuse("question must not hold an answer (→ A:)");
      if (marker !== undefined) refuse(checkLine(marker, "marker"));
      if (answer !== undefined) refuse(checkLine(answer, "answer"));
      const { folder } = specFolder(repo, key);
      // The path is checked before the user is asked anything.
      specFile(repo, folder);
      let given = answer;
      if (given === undefined) {
        if (!session.elicitation || !session.ask)
          refuse(
            "missing argument: answer (this client declared no elicitation to ask the user with)",
          );
        const reply = await /** @type {NonNullable<Session["ask"]>} */ (session.ask)(
          "elicitation/create",
          {
            message: question,
            requestedSchema: {
              type: "object",
              properties: { answer: { type: "string", title: "Answer", description: question } },
              required: ["answer"],
            },
          },
        );
        if (reply.error)
          throw new QuestionError(`the client could not ask: ${reply.error.message}`);
        // Declined or cancelled: nothing is recorded, and the question stays open.
        if (reply.result?.action !== "accept")
          return { recorded: false, action: reply.result?.action ?? "cancel" };
        given = reply.result.content?.answer;
      }
      return writeAnswer(repo, folder, { question, answer: given, date: today(), marker });
    },
  };
}

/**
 * A connection's session (`Session`): `initialize` sets `elicitation`; `ask` sends the client a request and waits for
 * its reply, which `reply` settles when the read loop hands it a message that answers one; `close` settles the rest.
 * @param {(message: unknown) => void} write
 */
export function connection(write) {
  /** @type {Map<string, (reply: any) => void>} */
  const waiting = new Map();
  let next = 0;
  return {
    elicitation: false,
    /** @type {(method: string, params: unknown) => Promise<any>} */
    ask: (method, params) =>
      new Promise((resolve) => {
        const id = `${PREFIX}-${(next += 1)}`;
        waiting.set(id, resolve);
        write({ jsonrpc: "2.0", id, method, params });
      }),
    /**
     * Whether `message` is a reply (a result or an error, no method): one to an `ask` request settles it, and any
     * other is dropped, since a reply is never answered.
     */
    reply: (/** @type {any} */ message) => {
      if (typeof message !== "object" || message === null || message.method !== undefined)
        return false;
      if (!("result" in message || "error" in message)) return false;
      waiting.get(message.id)?.(message);
      waiting.delete(message.id);
      return true;
    },
    close: () => {
      for (const settle of waiting.values())
        settle({ error: { code: -32000, message: "the client closed the connection" } });
      waiting.clear();
    },
  };
}

/**
 * The answer to one JSON-RPC message, or undefined for a notification.
 * @param {any} message
 * @param {Record<string, Reader>} readers
 * @param {Session} [session] what `initialize` declared, for the tools that ask the client (`connection`)
 */
export async function handle(message, readers = defaultReaders(), session = {}) {
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
        // MCP elicitation is used only when the client says it can show the form.
        session.elicitation = Boolean(message.params?.capabilities?.elicitation);
        result = {
          protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: NAME, version: VERSION },
          instructions:
            "Read-only views of the workspace's specs, worktrees, PRs, sessions and delivery metrics, a spec's " +
            "open questions and a docs lookup; one writer, clarification_record, records an answer in the spec.",
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
          result = {
            content: [{ type: "text", text: JSON.stringify(await read(args, session), null, 2) }],
          };
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

/** `fflow mcp`: serves stdin to stdout until stdin closes. */
export async function run() {
  const write = (/** @type {unknown} */ m) => process.stdout.write(`${JSON.stringify(m)}\n`);
  const session = connection(write);
  const readers = defaultReaders();
  /** @type {Set<Promise<void>>} */
  const running = new Set();
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
    if (session.reply(message)) continue;
    // Not awaited: a call waiting on the client (elicitation) must not hold back the reply it waits for.
    const call = handle(message, readers, session).then((answer) => {
      if (answer) write(answer);
    });
    running.add(call);
    void call.finally(() => running.delete(call));
  }
  session.close();
  await Promise.all(running);
  return 0;
}
