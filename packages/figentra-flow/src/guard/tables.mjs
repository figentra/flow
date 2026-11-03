/**
 * Figentra Flow file contract:
 * Purpose: the guard engine's tables: the repository's preset's `guard/` modules (`bash-rules.mjs` → `BASH_RULES`,
 *   `path-rules.mjs` → `PATH_RULES` and `PLAN_GATED`, the source paths of the plan gate, `hints.mjs` → `PROMPT`
 *   and `SESSION`), each falling back to the neutral preset's module when the preset has none.
 * Boundary: imports preset modules; throws when one fails to load or a rule table is not a list, so the engine
 *   denies (closed on the mandatory policies).
 * Runtime: node
 * Governing contract: STA-1945 (FR-5, FR-7, P-012).
 * Secrets: none.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { FLOW_ASSETS, presetDir } from "../lib/flow-dir.mjs";

/**
 * @typedef {{ bash: import("./bash.mjs").BashRule[], paths: import("./paths.mjs").PathRule[], planGated?: RegExp,
 *   prompt?: import("./prompt-hints.mjs").PromptTable, session?: import("./session-context.mjs").SessionTable }} GuardTables
 */

const NEUTRAL = join(FLOW_ASSETS, "presets", "neutral", "guard");

/**
 * One export of a preset's guard module, or of the neutral preset's when the preset has no such file.
 * @param {string} dir the preset's `guard/` folder
 * @param {string} file
 * @param {string} name
 */
async function table(dir, file, name) {
  const path = [join(dir, file), join(NEUTRAL, file)].find((p) => existsSync(p));
  return path ? (await import(pathToFileURL(path).href))[name] : undefined;
}

/**
 * A rule table that must be a list (missing is empty).
 * @param {unknown} value
 * @param {string} name
 * @returns {any[]}
 */
function list(value, name) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${name} is not a list`);
  return value;
}

/**
 * The guard tables of the repository at `root`.
 * shortcut: the profile's selection (T034) and `extend` overrides (PR 2) are not applied yet; they join here when
 *   those land on this branch's base.
 * @param {string} root
 * @returns {Promise<GuardTables>}
 */
export async function loadTables(root) {
  const dir = join(presetDir(root), "guard");
  return {
    bash: list(await table(dir, "bash-rules.mjs", "BASH_RULES"), "BASH_RULES"),
    paths: list(await table(dir, "path-rules.mjs", "PATH_RULES"), "PATH_RULES"),
    planGated: await table(dir, "path-rules.mjs", "PLAN_GATED"),
    prompt: await table(dir, "hints.mjs", "PROMPT"),
    session: await table(dir, "hints.mjs", "SESSION"),
  };
}
