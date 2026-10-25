/**
 * The Vellum MCP tools. Every tool is read-only: each runs the same
 * @vellum/storage query the CLI runs, and returns the document the CLI's
 * `--json` output holds for equal inputs (criterion 003:14.8). Approval and
 * evidence recording are left to the CLI (criterion 003:14.10); a call to a
 * state-changing tool is refused and names the tool (criterion 003:14.9).
 */

import {
  ARTIFACT_KINDS,
  checkDocument,
  isArtifactKind,
  lintDocument,
  notARepositoryMessage,
  openRepository,
  queryArtifact,
  queryCheck,
  queryContext,
  queryLint,
  queryStatus,
  queryTrace,
  queryVerify,
  selectSpecs,
  statusDocument,
  verifyDocument,
  type Repository,
  type SpecRef,
} from "@vellum/storage";

/** A JSON Schema for a tool's arguments, as MCP's `tools/list` publishes it. */
export interface ToolInputSchema {
  readonly type: "object";
  readonly properties: Readonly<Record<string, object>>;
  readonly required?: readonly string[];
  readonly additionalProperties: false;
}

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ToolInputSchema;
  readonly annotations: {
    readonly readOnlyHint: true;
    readonly destructiveHint: false;
    readonly openWorldHint: false;
  };
}

/** The `tools/call` result MCP defines. */
export interface ToolResult {
  readonly content: ReadonlyArray<{
    readonly type: "text";
    readonly text: string;
  }>;
  readonly isError?: true;
}

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
} as const;

const SPEC = {
  type: "string",
  description: "Spec number, slug or slug fragment, as the CLI takes it",
} as const;

export const TOOLS: readonly ToolDefinition[] = [
  {
    name: "vellum_status",
    description:
      "What `vellum status --json` returns: per spec, the Recorded Lifecycle State, artifact versions and checksum currency, valid approvals against the Approval Policy, evidenced tasks and ledger integrity. Omit spec for every spec.",
    inputSchema: {
      type: "object",
      properties: { spec: SPEC },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "vellum_lint",
    description:
      "What `vellum lint --json` returns: Protocol Validator findings over spec artifacts, with what was examined. Omit spec for every spec; type limits it to one artifact kind.",
    inputSchema: {
      type: "object",
      properties: {
        spec: SPEC,
        type: {
          type: "string",
          enum: [...ARTIFACT_KINDS],
          description: "Validate only this artifact kind",
        },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "vellum_verify",
    description:
      "What `vellum verify --json` returns: the Strict Verifier's PASS/FAIL/INCONCLUSIVE per spec (ledger integrity, signed approvals, coverage, task evidence). Omit spec for every managed spec IN_PROGRESS or later.",
    inputSchema: {
      type: "object",
      properties: { spec: SPEC },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "vellum_check",
    description:
      "What `vellum check --json` returns: Check Mode, the CI status check — per spec, the Effective Lifecycle State against the recorded one, ledger integrity and forks, with findings and the exit status the CLI would give. Omit spec for every spec.",
    inputSchema: {
      type: "object",
      properties: { spec: SPEC },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "vellum_trace",
    description:
      "A spec's ledger: the most recent entries (transitions, approvals, task bindings, evidence), oldest first, and the total count.",
    inputSchema: {
      type: "object",
      properties: {
        spec: SPEC,
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 1000,
          default: 20,
          description: "Most recent entries to return",
        },
      },
      required: ["spec"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "vellum_context",
    description:
      "What `vellum context <spec> <task> --json` returns: one task's briefing — the task, the full text of every criterion and Property it cites, the design sections and glossary terms it uses, its parent, sub-tasks and wave, and a missing list naming anything cited that was not found. Read it before the full documents.",
    inputSchema: {
      type: "object",
      properties: {
        spec: SPEC,
        task: { type: "string", description: "Task identifier, e.g. 2.3" },
      },
      required: ["spec", "task"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "vellum_get_artifact",
    description:
      "One spec artifact's text and Lifecycle Frontmatter, by its path relative to the repository root (.agents/specs/<spec>/requirements.md, design.md or tasks.md). Paths outside the repository root are refused.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path relative to the repository root",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
];

/**
 * Operations that change repository state. They are not tools; a call to
 * one is refused with the way to do it instead.
 */
const STATE_CHANGING: Readonly<Record<string, string>> = {
  vellum_approve:
    "A human records an approval with `vellum approve` in a terminal and commits it signed.",
  vellum_reject: "A human records a rejection through the CLI in a terminal.",
  vellum_task_start: "Run `vellum task start <spec> <task>` with the CLI.",
  vellum_task_complete:
    "Run `vellum task complete <spec> <task> --command <cmd>` with the CLI.",
  vellum_record_evidence:
    "Evidence is recorded by `vellum task complete --command <cmd>` with the CLI.",
  vellum_adopt: "Adoption writes files; run it with the CLI.",
  vellum_sync: "Sync writes files; run it with the CLI.",
};

function text(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function error(message: string): ToolResult {
  return {
    content: [
      { type: "text", text: JSON.stringify({ error: true, message }, null, 2) },
    ],
    isError: true,
  };
}

type Args = Readonly<Record<string, unknown>>;

/** Validate `args` against the tool's schema; the message when it does not conform. */
function checkArgs(tool: ToolDefinition, args: Args): string | null {
  const { properties, required = [] } = tool.inputSchema;
  for (const key of Object.keys(args)) {
    if (!(key in properties)) return `${tool.name} has no argument '${key}'`;
  }
  for (const key of required) {
    if (args[key] === undefined)
      return `${tool.name} requires argument '${key}'`;
  }
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined) continue;
    const schema = properties[key] as {
      type: string;
      enum?: readonly string[];
      minimum?: number;
      maximum?: number;
    };
    if (schema.type === "string" && typeof value !== "string")
      return `${tool.name}: '${key}' must be a string`;
    if (schema.type === "integer" && !Number.isInteger(value))
      return `${tool.name}: '${key}' must be an integer`;
    if (schema.enum && !schema.enum.includes(value as string)) {
      return `${tool.name}: '${key}' must be one of ${schema.enum.join(", ")}`;
    }
    if (typeof value === "number") {
      if (schema.minimum !== undefined && value < schema.minimum)
        return `${tool.name}: '${key}' must be >= ${schema.minimum}`;
      if (schema.maximum !== undefined && value > schema.maximum)
        return `${tool.name}: '${key}' must be <= ${schema.maximum}`;
    }
  }
  return null;
}

function select(repo: Repository, spec: unknown): SpecRef[] | ToolResult {
  const selection = selectSpecs(repo.root, spec as string | undefined);
  return selection.kind === "specs"
    ? selection.specs
    : error(selection.message);
}

async function run(
  name: string,
  args: Args,
  repo: Repository,
): Promise<ToolResult> {
  switch (name) {
    case "vellum_status": {
      const specs = select(repo, args.spec);
      if (!Array.isArray(specs)) return specs;
      const query = queryStatus(repo, specs);
      return query.kind === "ok"
        ? text(statusDocument(query.value))
        : error(query.message);
    }
    case "vellum_lint": {
      const specs = select(repo, args.spec);
      if (!Array.isArray(specs)) return specs;
      const type = args.type as string | undefined;
      return text(
        lintDocument(
          queryLint(
            repo,
            specs,
            type !== undefined && isArtifactKind(type) ? type : undefined,
          ),
        ),
      );
    }
    case "vellum_verify": {
      const specs = select(repo, args.spec);
      if (!Array.isArray(specs)) return specs;
      const query = queryVerify(repo, specs, args.spec !== undefined);
      if (query.kind === "inconclusive")
        return error(`INCONCLUSIVE — ${query.message}`);
      return text(verifyDocument(query.value));
    }
    case "vellum_check": {
      const specs = select(repo, args.spec);
      if (!Array.isArray(specs)) return specs;
      const query = queryCheck(repo, specs);
      if (query.kind === "inconclusive")
        return error(`INCONCLUSIVE — ${query.message}`);
      return text(checkDocument(query.value));
    }
    case "vellum_trace": {
      const specs = select(repo, args.spec);
      if (!Array.isArray(specs)) return specs;
      const query = queryTrace(
        specs[0]!,
        (args.limit as number | undefined) ?? 20,
      );
      return query.kind === "ok" ? text(query.value) : error(query.message);
    }
    case "vellum_context": {
      const specs = select(repo, args.spec);
      if (!Array.isArray(specs)) return specs;
      const query = queryContext(specs[0]!, args.task as string);
      if (query.kind === "inconclusive") return error(query.message);
      return query.value === null
        ? error(`${specs[0]!.slug}/tasks.md defines no task ${args.task as string}`)
        : text(query.value);
    }
    case "vellum_get_artifact": {
      const query = queryArtifact(repo, args.path as string);
      return query.kind === "ok" ? text(query.value) : error(query.message);
    }
    default:
      return error(`Unknown tool: ${name}`);
  }
}

/**
 * Call tool `name` with `args` against the repository containing `cwd`.
 * Never writes: a state-changing operation is refused and names itself.
 */
export async function callTool(
  cwd: string,
  name: string,
  args: unknown = {},
): Promise<ToolResult> {
  const refusal = STATE_CHANGING[name];
  if (refusal !== undefined) {
    return error(
      `${name} would change repository state and the Vellum MCP server is read-only. ${refusal}`,
    );
  }
  const tool = TOOLS.find((t) => t.name === name);
  if (tool === undefined) return error(`Unknown tool: ${name}`);
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return error(`${name}: arguments must be an object`);
  }
  const problem = checkArgs(tool, args as Args);
  if (problem !== null) return error(problem);

  const repo = await openRepository(cwd);
  if (repo === null) return error(notARepositoryMessage(cwd));
  return run(name, args as Args, repo);
}
