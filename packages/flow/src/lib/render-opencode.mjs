/**
 * Figentra Flow file contract:
 * Purpose: the OpenCode projection (STA-1945 FR-7): the preset's `surfaces/opencode.jsonc` as `opencode.jsonc` and
 *   every file under its `surfaces/opencode/` as `.opencode/<path>`, the guard plugin
 *   (`.opencode/plugins/fflow-guard.mjs`, which asks the repository's guard bundle, as Claude Code's hook does)
 *   among them. Both carry the provenance header (`//`). Opt-in (`surfaces.opencode`): the config allows broadly and
 *   then denies, so unset it renders only where the lock already records `opencode.jsonc` (`takesSurface`).
 * Boundary: reads the preset's files; returns text, writes nothing (`sync` writes).
 * Runtime: node
 * Governing contract: STA-1945 (FR-5, FR-7, AC-7, P-010).
 * Secrets: none.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { presetTree } from "./flow-dir.mjs";
import { takesSurface } from "./lock.mjs";

/** The rendered configuration file. */
export const OPENCODE_FILE = "opencode.jsonc";

/**
 * `opencode.jsonc` and `.opencode/**`, or nothing when the preset has neither surface or the repository does not take
 * it (`surfaces.opencode`).
 * @param {import("./render.mjs").RenderContext} ctx
 * @returns {Map<string, string>}
 */
export function renderOpencode(ctx) {
  const surfaces = join(ctx.presetDir, "surfaces");
  /** @type {Map<string, string>} */
  const out = new Map();
  if (!takesSurface(ctx.root, ctx.config, "opencode", OPENCODE_FILE)) return out;
  const config = join(surfaces, OPENCODE_FILE);
  if (existsSync(config)) out.set(OPENCODE_FILE, readFileSync(config, "utf8"));
  for (const [path, text] of presetTree(join(surfaces, "opencode")))
    out.set(`.opencode/${path}`, text);
  return out;
}
