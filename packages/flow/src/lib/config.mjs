/**
 * Figentra Flow file contract:
 * Purpose: the repository's configuration (AC-035, AC-036): `flow.config.json` at the repository root, validated
 *   against `SCHEMA` (shipped as `schema/flow.config.schema.json` for editors), with every unknown key or wrong type
 *   refused by its path. Each port reads its block; a port with no block refuses the commands that need it, naming the
 *   key (`need`). There are no defaults that name an organisation, and no other file is read in its place.
 * Boundary: reads two files; never writes; never runs code from the repository (the config is JSON, ADR decision 1 of
 *   the phase A plan stop).
 * Runtime: node
 * Governing contract: STA-1729 phase A (the leader's plan stop of 2026-10-31); STA-2098 (`harnesses`); STA-1945
 *   (FR-7: `mcp`, `lefthook`, `agentsMd`); STA-2131 (`session`).
 * Secrets: none; the config names environment variables and secret paths, never values.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { HARNESS_IDS } from "../adapters/harness/index.mjs";
import { CONFIG_FILE, LEGACY_CONFIG_FILE, NAME, NEVER_TOLERATED } from "./product.mjs";

const str = { type: "string", minLength: 1 };
const strs = { type: "array", items: str, minItems: 1 };
/** The marketplace sources `claudeCode.extraKnownMarketplaces` may name: remote ones only (STA-2131). */
export const MARKETPLACE_SOURCES = ["github", "git", "url"];
/** A port block chosen by `kind`: one variant per adapter. */
const port = (
  /** @type {Record<string, Record<string, unknown>>} */ variants,
  /** @type {Record<string, string[]>} */ required = {},
) => ({
  oneOf: Object.entries(variants).map(([kind, properties]) => ({
    type: "object",
    additionalProperties: false,
    required: ["kind", ...(required[kind] ?? [])],
    properties: { kind: { const: kind }, ...properties },
  })),
});

/** The configuration's JSON Schema (draft 2020-12), the single source of `schema/flow.config.schema.json`. */
export const SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: CONFIG_FILE.replace(".json", ".schema.json"),
  title: CONFIG_FILE,
  type: "object",
  additionalProperties: false,
  required: ["version"],
  properties: {
    $schema: str,
    version: { const: 1 },
    preset: str,
    // STA-1945 FR-6: the preset's profile; without it, the preset's default.
    profile: str,
    // STA-2098: the tools `sync --direct` renders the `flow-*` commands for; without it, Claude Code and OpenCode.
    harnesses: { type: "array", items: { enum: [...HARNESS_IDS] }, minItems: 1 },
    team: str,
    specs: {
      type: "object",
      additionalProperties: false,
      properties: { dir: str, bugsDir: str },
    },
    tracker: port(
      {
        linear: { team: str, branchPrefix: str, otherBranchPrefixes: strs, token: strs },
        "github-issues": { branchPrefix: str, otherBranchPrefixes: strs },
        jira: {
          site: str,
          project: str,
          branchPrefix: str,
          otherBranchPrefixes: strs,
          token: strs,
        },
      },
      {
        linear: ["team", "branchPrefix"],
        "github-issues": ["branchPrefix"],
        jira: ["site", "project", "branchPrefix"],
      },
    ),
    credentials: port(
      { env: {}, "gh-user": {}, wrapper: { gh: strs, git: strs } },
      { wrapper: ["gh"] },
    ),
    runner: port(
      {
        "github-actions": { workflow: str },
        ssh: { host: str },
        local: {},
        command: { run: strs, secrets: { type: "boolean" } },
      },
      { ssh: ["host"], command: ["run"] },
    ),
    secrets: port({
      env: {},
      sops: {
        // The L2 design: main's approval jobs run `decrypt` (an action pinned to a commit, given `scope` and `names`),
        // which signs in with the job's OIDC token and puts the gate App's id and key in the job's environment.
        oidc: {
          type: "object",
          additionalProperties: false,
          required: ["decrypt", "scope"],
          properties: {
            decrypt: {
              type: "string",
              pattern: "^(?!.*\\.\\.)[\\w-]+/[\\w.-]+(?:/[\\w.-]+)*@[0-9a-f]{40}$",
            },
            scope: { type: "string", pattern: "^[\\w-]+(?:/[\\w-]+)*$" },
          },
        },
      },
      // Retired (Stackra ADR 0525): still read so existing files load, as `env`, with a warning.
      infisical: {
        paths: { type: "object", additionalProperties: str },
        projectId: str,
        env: str,
        domain: str,
        auth: { enum: ["universal-auth"] },
        bin: str,
        envFile: str,
      },
    }),
    apps: {
      type: "object",
      additionalProperties: false,
      properties: {
        gate: {
          type: "object",
          additionalProperties: false,
          required: ["login"],
          // `aliases`: the App's other logins, for a rename (ADR 0523): its status counts from any of them.
          properties: { slug: str, login: str, aliases: strs },
        },
        review: {
          type: "object",
          additionalProperties: false,
          required: ["slug"],
          properties: { slug: str },
        },
        owner: str,
      },
    },
    // `shard`: the check for `gate run --shards`, with `{filters}` for a shard's packages (FR-15)
    gate: { type: "object", additionalProperties: false, properties: { check: str, shard: str } },
    approve: {
      type: "object",
      additionalProperties: false,
      properties: {
        ownerOnly: { type: "array", items: str },
        checks: { type: "object", additionalProperties: str },
        // The L2 design: the workflows whose success wakes main's land lane, and the App slugs that may ask for a land.
        workflows: { type: "array", items: { type: "string", pattern: "^[\\w .()-]+$" } },
        requesters: { type: "array", items: { type: "string", pattern: "^[\\w-]+$" } },
        // The required checks a red main may excuse against its baseline (STA-1945 FR-22); none by default.
        tolerate: { type: "array", items: { ...str, not: { enum: NEVER_TOLERATED } } },
      },
    },
    // Opt-in surfaces (each unset: only where the lock already records the file).
    surfaces: {
      type: "object",
      additionalProperties: false,
      properties: { settings: { type: "boolean" }, lefthook: { type: "boolean" } },
    },
    clean: {
      type: "object",
      additionalProperties: false,
      properties: {
        keep: { type: "array", items: str },
        budget: { type: "integer", minimum: 1 },
        // Remove merged worktrees in the background at each session's start (`fflow clean --merged`).
        whenMerged: { type: "boolean" },
      },
    },
    baseline: {
      type: "object",
      additionalProperties: false,
      properties: {
        tasks: { type: "array", items: str, minItems: 1 },
        mustPass: { type: "array", items: str },
        install: str,
        setup: { type: "array", items: { type: "object" } },
        branch: str,
      },
    },
    review: {
      type: "object",
      additionalProperties: false,
      properties: {
        required: { type: "array", items: { enum: ["trivial", "small", "feature", "big"] } },
      },
    },
    artifacts: {
      type: "object",
      additionalProperties: false,
      properties: {
        paths: { type: "array", items: str },
        maxBytes: { type: "integer", minimum: 1 },
      },
    },
    train: {
      type: "object",
      additionalProperties: false,
      properties: {
        cutoff: { type: "integer", minimum: 1 },
        eject: { enum: ["bisect", "manual"] },
        after: { type: "array", items: str },
        label: str,
      },
    },
    // STA-1945 FR-7: the repository's additions to the preset's surfaces: its MCP servers by name (`.mcp.yaml`), its
    // lefthook jobs by hook (`lefthook.yml`) and its own notes for AGENTS.md (`facts`, one Markdown string).
    mcp: { type: "object", additionalProperties: { type: "object" } },
    lefthook: {
      type: "object",
      additionalProperties: { type: "array", items: { type: "object" } },
    },
    // STA-2131: `land` replaces the landing line of AGENTS.md's "How work flows".
    agentsMd: {
      type: "object",
      additionalProperties: false,
      properties: { facts: str, land: str },
    },
    // STA-2131: `pushAtEnd` renders the SessionEnd hook that commits the session's work as WIP and pushes it; off
    // unless a repository opts in. `contextCommands` are the repository's own commands (argv, no shell) whose
    // output the SessionStart context appends.
    // Project `.agents/` into each assistant's folders after every sync, not only `--direct` (STA-2098 H6).
    projection: { type: "boolean" },
    session: {
      type: "object",
      additionalProperties: false,
      properties: {
        pushAtEnd: { type: "boolean" },
        contextCommands: { type: "array", items: strs },
      },
    },
    // STA-2131: the Claude Code plugins and marketplaces `.claude/settings.json` carries; only these two keys, so
    // nothing here reaches its hooks, permissions or environment.
    claudeCode: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabledPlugins: { type: "object", additionalProperties: { type: "boolean" } },
        extraKnownMarketplaces: {
          type: "object",
          additionalProperties: {
            type: "object",
            required: ["source"],
            // A remote source only: a local `directory` or `file` marketplace could hand the session a plugin whose
            // hooks run beside the guard's, from files any branch can change.
            properties: {
              source: {
                type: "object",
                required: ["source"],
                properties: { source: { enum: MARKETPLACE_SOURCES } },
              },
            },
          },
        },
      },
    },
  },
};

const typeOf = (/** @type {unknown} */ v) =>
  Array.isArray(v) ? "array" : v === null ? "null" : Number.isInteger(v) ? "integer" : typeof v;

/**
 * The problems of `value` against the subset of JSON Schema `SCHEMA` uses, each with its path.
 * @param {any} schema
 * @param {any} value
 * @param {string} [path]
 * @returns {string[]}
 */
export function validate(schema, value, path = "") {
  const at = path || "(root)";
  if (schema.oneOf) {
    // A port block: pick the variant its `kind` names, so the errors are that adapter's.
    const kinds = schema.oneOf.map((/** @type {any} */ v) => v.properties.kind.const);
    const variant = schema.oneOf.find(
      (/** @type {any} */ v) => v.properties.kind.const === value?.kind,
    );
    if (typeOf(value) !== "object") return [`${at}: must be an object with a kind`];
    if (!variant) return [`${at}.kind: must be one of ${kinds.join(", ")}`];
    return validate(variant, value, path);
  }
  if ("const" in schema && value !== schema.const)
    return [`${at}: must be ${JSON.stringify(schema.const)}`];
  if (schema.enum && !schema.enum.includes(value))
    return [`${at}: must be one of ${schema.enum.join(", ")}`];
  if (schema.not?.enum?.includes(value))
    return [`${at}: must not be one of ${schema.not.enum.join(", ")}`];
  if (schema.type) {
    const t = typeOf(value);
    /** @type {string[]} */
    const types = [schema.type].flat();
    if (!(types.includes(t) || (types.includes("number") && t === "integer")))
      return [`${at}: must be ${types[0] === "integer" ? "an" : "a"} ${types.join(" or ")}`];
  }
  if (typeof value === "string" && schema.minLength && value.length < schema.minLength)
    return [`${at}: must not be empty`];
  if (typeof value === "string" && schema.pattern && !new RegExp(schema.pattern).test(value))
    return [`${at}: must match ${schema.pattern}`];
  if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum)
    return [`${at}: must be at least ${schema.minimum}`];
  /** @type {string[]} */
  const problems = [];
  if (Array.isArray(value)) {
    if (schema.minItems && value.length < schema.minItems)
      problems.push(`${at}: must have at least ${schema.minItems} item(s)`);
    if (schema.items)
      value.forEach((v, i) => problems.push(...validate(schema.items, v, `${path}[${i}]`)));
  }
  if (typeOf(value) === "object") {
    for (const key of schema.required ?? [])
      if (!(key in value)) problems.push(`${path ? `${path}.` : ""}${key}: is required`);
    for (const [key, v] of Object.entries(value)) {
      const child =
        schema.properties?.[key] ??
        (typeof schema.additionalProperties === "object" ? schema.additionalProperties : undefined);
      if (child) problems.push(...validate(child, v, path ? `${path}.${key}` : key));
      else if (schema.additionalProperties === false)
        problems.push(`${path ? `${path}.` : ""}${key}: is not a known key`);
    }
  }
  return problems;
}

/**
 * @typedef {{ version?: number, preset?: string, profile?: string, harnesses?: string[], team?: string, specs?: { dir?: string, bugsDir?: string }, tracker?: any, credentials?: any, runner?: any, secrets?: any,
 *             apps?: { gate?: { slug?: string, login: string, aliases?: string[] }, review?: { slug: string },
 *                      owner?: string },
 *             gate?: { check?: string, shard?: string }, approve?: { ownerOnly?: string[], checks?: Record<string, string>,
 *                      workflows?: string[], requesters?: string[], tolerate?: string[] },
 *             surfaces?: { settings?: boolean, lefthook?: boolean },
 *             projection?: boolean,
 *             clean?: { keep?: string[], budget?: number, whenMerged?: boolean }, review?: { required?: string[] },
 *             baseline?: { tasks?: string[], mustPass?: string[], install?: string, setup?: Record<string, unknown>[], branch?: string },
 *             artifacts?: { paths?: string[], maxBytes?: number },
 *             train?: { cutoff?: number, eject?: "bisect" | "manual", after?: string[], label?: string },
 *             mcp?: Record<string, Record<string, any>>, lefthook?: Record<string, Record<string, any>[]>,
 *             agentsMd?: { facts?: string, land?: string },
 *             session?: { pushAtEnd?: boolean, contextCommands?: string[][] },
 *             claudeCode?: { enabledPlugins?: Record<string, boolean>,
 *                            extraKnownMarketplaces?: Record<string, { source: Record<string, unknown> }> } }} Config
 * @typedef {{ config: Config, source: string | undefined, warnings: string[], errors: string[] }} Loaded
 */

/**
 * The repository's configuration.
 * @param {string} root
 * @returns {Loaded}
 */
export function loadConfig(root) {
  const current = join(root, CONFIG_FILE);
  const legacy = join(root, LEGACY_CONFIG_FILE);
  // Before 0.2.2 the file was LEGACY_CONFIG_FILE; it is read until `sync` renames it, and both at once is an error.
  if (existsSync(current) && existsSync(legacy))
    return {
      config: {},
      source: current,
      warnings: [],
      errors: [
        `${CONFIG_FILE} and ${LEGACY_CONFIG_FILE} both exist: keep ${CONFIG_FILE} and delete the other`,
      ],
    };
  const file = existsSync(current) ? current : legacy;
  const warnings =
    file === legacy
      ? [`${LEGACY_CONFIG_FILE} is the old name: \`${NAME} sync\` renames it to ${CONFIG_FILE}`]
      : [];
  if (existsSync(file)) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      return {
        config: {},
        source: file,
        warnings: [],
        errors: [`${CONFIG_FILE}: not valid JSON (${/** @type {Error} */ (error).message})`],
      };
    }
    if (parsed?.secrets?.kind === "infisical")
      warnings.push(
        `${CONFIG_FILE}: secrets.kind "infisical" is retired and read as "env" (the caller's environment holds the values); set "env", or "sops" with secrets.oidc for the approval workflow`,
      );
    return {
      config: parsed,
      source: file,
      warnings,
      errors: validate(SCHEMA, parsed).map((p) => `${CONFIG_FILE}: ${p}`),
    };
  }
  return { config: {}, source: undefined, warnings: [], errors: [] };
}

/**
 * Who may post the gate status: `apps.gate.login`, or with its `aliases` the list of logins (a renamed App, ADR 0523).
 * @param {Config["apps"]} apps
 * @returns {string | string[] | undefined}
 */
export const gateLogins = (apps) =>
  // Only a list counts: a bare string spread here would trust each of its characters.
  Array.isArray(apps?.gate?.aliases) && apps.gate.aliases.length
    ? [apps.gate.login, ...apps.gate.aliases].filter((x) => typeof x === "string" && x !== "")
    : apps?.gate?.login;

/** Raised when a command needs a setting the configuration does not hold, or the configuration is invalid. */
export class ConfigError extends Error {}

/**
 * The block `key` of a valid configuration, or a refusal naming the key to set (AC-036).
 * @param {Loaded} loaded
 * @param {"tracker" | "credentials" | "runner" | "secrets" | "apps"} key
 * @param {string} why what needs it, for the message
 */
export function need(loaded, key, why) {
  if (loaded.errors.length) throw new ConfigError(loaded.errors.join("\n"));
  const block = loaded.config[key];
  if (block === undefined)
    throw new ConfigError(
      `${why} needs "${key}" in ${CONFIG_FILE} (see the schema: schema/${CONFIG_FILE.replace(".json", ".schema.json")})`,
    );
  return block;
}
