/**
 * Vellum file contract:
 * Purpose: the repository's configuration (AC-035, AC-036): `vellum.config.json` at the repository root, validated
 *   against `SCHEMA` (shipped as `schema/vellum.config.schema.json` for editors), with every unknown key or wrong type
 *   refused by its path. Each port reads its block; a port with no block refuses the commands that need it, naming the
 *   key (`need`). There are no defaults that name an organisation. For one minor version, the older `package.json`
 *   `"vellum"` keys (`credentials`, `gate`, `gateApp`) are read with a deprecation warning when no config file exists.
 * Boundary: reads two files; never writes; never runs code from the repository (the config is JSON, ADR decision 1 of
 *   the phase A plan stop).
 * Runtime: node
 * Governing contract: STA-1729 phase A (the leader's plan stop of 2026-10-31).
 * Secrets: none; the config names environment variables and secret paths, never values.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { CONFIG_FILE } from "./product.mjs";

const str = { type: "string", minLength: 1 };
const strs = { type: "array", items: str, minItems: 1 };
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

/** The configuration's JSON Schema (draft 2020-12), the single source of `schema/vellum.config.schema.json`. */
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
    tracker: port(
      {
        linear: { team: str, branchPrefix: str, token: strs },
        "github-issues": { branchPrefix: str },
        jira: { site: str, project: str, branchPrefix: str, token: strs },
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
        command: { run: strs },
      },
      { ssh: ["host"], command: ["run"] },
    ),
    secrets: port(
      { env: {}, infisical: { paths: { type: "object", additionalProperties: str } } },
      { infisical: ["paths"] },
    ),
    apps: {
      type: "object",
      additionalProperties: false,
      properties: {
        gate: {
          type: "object",
          additionalProperties: false,
          required: ["login"],
          properties: { slug: str, login: str },
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
    gate: { type: "object", additionalProperties: false, properties: { check: str } },
    clean: {
      type: "object",
      additionalProperties: false,
      properties: { keep: { type: "array", items: str } },
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
  if (schema.type) {
    const t = typeOf(value);
    if (!(t === schema.type || (schema.type === "number" && t === "integer")))
      return [`${at}: must be ${schema.type === "integer" ? "an" : "a"} ${schema.type}`];
  }
  if (typeof value === "string" && schema.minLength && value.length < schema.minLength)
    return [`${at}: must not be empty`];
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
 * @typedef {{ version?: number, preset?: string, tracker?: any, credentials?: any, runner?: any, secrets?: any,
 *             apps?: { gate?: { slug?: string, login: string }, review?: { slug: string }, owner?: string },
 *             gate?: { check?: string }, clean?: { keep?: string[] }, review?: { required?: string[] },
 *             artifacts?: { paths?: string[], maxBytes?: number } }} Config
 * @typedef {{ config: Config, source: string | undefined, warnings: string[], errors: string[] }} Loaded
 */

/** The older `package.json` `"vellum"` keys as configuration (deprecated; read for one minor version). */
function fromPackage(/** @type {any} */ legacy) {
  /** @type {Config} */
  const config = { version: 1 };
  const credentials = legacy.credentials;
  if (credentials === "gh-user") config.credentials = { kind: "gh-user" };
  const script =
    typeof credentials === "string" ? credentials.match(/^wrapper:(\S+)$/)?.[1] : undefined;
  if (script) config.credentials = { kind: "wrapper", gh: ["pnpm", script, "--"] };
  if (typeof legacy.gate === "string") config.gate = { check: legacy.gate };
  if (typeof legacy.gateApp === "string") config.apps = { gate: { login: legacy.gateApp } };
  return config;
}

/**
 * The repository's configuration.
 * @param {string} root
 * @returns {Loaded}
 */
export function loadConfig(root) {
  const file = join(root, CONFIG_FILE);
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
    return {
      config: parsed,
      source: file,
      warnings: [],
      errors: validate(SCHEMA, parsed).map((p) => `${CONFIG_FILE}: ${p}`),
    };
  }
  let legacy;
  try {
    legacy = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).vellum;
  } catch {
    legacy = undefined;
  }
  if (legacy && typeof legacy === "object")
    return {
      config: fromPackage(legacy),
      source: join(root, "package.json"),
      warnings: [
        `package.json "vellum" is deprecated: move it into ${CONFIG_FILE} (it is read until the next minor version)`,
      ],
      errors: [],
    };
  return { config: {}, source: undefined, warnings: [], errors: [] };
}

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
