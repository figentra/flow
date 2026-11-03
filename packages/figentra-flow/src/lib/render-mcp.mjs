/**
 * Figentra Flow file contract:
 * Purpose: `.mcp.yaml` (STA-1945 FR-7): the preset's MCP servers (`surfaces/mcp.yaml`) plus the configuration's `mcp`
 *   servers, by name; a configured server replaces the preset's of the same name. Secrets are named, never written:
 *   every `env` value must be a `$NAME` reference, which the repository's MCP launcher expands, and anything else is
 *   refused before it reaches a committed file. `args` and `headers` are written as given, unchecked: a token
 *   belongs in `env`, never there.
 * Boundary: reads the preset's file; returns text, writes nothing (`sync` writes).
 * Runtime: node
 * Governing contract: STA-1945 (FR-7, AC-7, P-010).
 * Secrets: none; the rendered file names environment variables, never values.
 */
import { ConfigError } from "./config.mjs";
import { surfaceYaml } from "./flow-dir.mjs";
import { CONFIG_FILE } from "./product.mjs";
import { stringifyYaml } from "./yaml.mjs";

/** The rendered file. */
export const MCP_FILE = ".mcp.yaml";

/** A secret named, not written: `$NAME` or `${NAME}`. */
const SECRET_REF = /^\$(?:[A-Z_][A-Z0-9_]*|\{[A-Z_][A-Z0-9_]*\})$/;

/**
 * `.mcp.yaml`, or nothing when the preset has no `surfaces/mcp.yaml`.
 * @param {import("./render.mjs").RenderContext} ctx
 * @returns {Map<string, string>}
 */
export function renderMcp(ctx) {
  const preset = surfaceYaml(ctx.presetDir, "mcp.yaml");
  if (preset === undefined) return new Map();
  /** @type {Record<string, Record<string, any>>} */
  const servers = { ...preset.mcpServers, ...ctx.config.mcp };
  for (const [name, server] of Object.entries(servers))
    for (const [key, value] of Object.entries(server?.env ?? {}))
      if (typeof value !== "string" || !SECRET_REF.test(value))
        throw new ConfigError(
          `${name in (ctx.config.mcp ?? {}) ? CONFIG_FILE : "the preset's surfaces/mcp.yaml"}: mcp server "${name}" sets env ${key} to a value; name the secret instead ("$${key}")`,
        );
  return new Map([[MCP_FILE, stringifyYaml({ mcpServers: servers })]]);
}
