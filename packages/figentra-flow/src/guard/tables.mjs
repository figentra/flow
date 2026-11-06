/**
 * Figentra Flow file contract:
 * Purpose: the guard engine's tables: the repository's preset's `guard/` modules (`bash-rules.mjs` → `BASH_RULES`,
 *   `path-rules.mjs` → `PATH_RULES` and `PLAN_GATED`, the source paths of the plan gate, `hints.mjs` → `PROMPT`
 *   and `SESSION`), each falling back to the neutral preset's module when the preset has none, read from disk or, in
 *   the guard bundle (`render-guard.mjs`), from the modules it carries. The engine's own rules (the side doors, the
 *   neutral path rules) are not table data: `decideBash` and `decidePaths` add them to any table.
 * Boundary: reads the configuration and imports preset modules; throws when the configuration did not load, when a
 *   module fails to load or when a rule table is not a list, so the engine denies (closed on the mandatory policies).
 * Runtime: node
 * Governing contract: STA-1945 (FR-5, FR-7, P-012).
 * Secrets: none.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { loadConfig } from "../lib/config.mjs";
import { FLOW_ASSETS, presetDir } from "../lib/flow-dir.mjs";

/**
 * @typedef {{ bash: import("./bash.mjs").BashRule[], paths: import("./paths.mjs").PathRule[], planGated?: RegExp,
 *   prompt?: import("./prompt-hints.mjs").PromptTable, session?: import("./session-context.mjs").SessionTable }} GuardTables
 */

const NEUTRAL = join(FLOW_ASSETS, "presets", "neutral", "guard");

/** The preset's `guard/` modules the tables come from. */
export const TABLE_FILES = ["bash-rules.mjs", "path-rules.mjs", "hints.mjs"];

/**
 * The file a preset's guard module loads from: the preset's, else the neutral preset's; undefined when neither has it.
 * @param {string} dir the preset's `guard/` folder
 * @param {string} file one of `TABLE_FILES`
 */
export const tableFile = (dir, file) =>
  [join(dir, file), join(NEUTRAL, file)].find((p) => existsSync(p));

/**
 * A guard module of the preset by its file name (one of `TABLE_FILES`), or undefined when it has none.
 * @typedef {(file: string) => Promise<Record<string, any> | undefined>} GuardModules
 */

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
 * The guard tables of the repository at `root`, from `modules` or else the preset's folder.
 * shortcut: the profile's selection (T034, landed) is ignored on purpose, so every rule applies (closed), and
 *   `extend` overrides (PR 2) are not applied; both join here with T037/PR 2.
 * @param {string} root
 * @param {GuardModules} [modules]
 * @returns {Promise<GuardTables>}
 */
export async function loadTables(root, modules) {
  const { config, errors } = loadConfig(root);
  // A configuration that did not load (both names, bad JSON) must not fall back to the neutral tables.
  if (errors.length && config.preset === undefined) throw new Error(errors.join("; "));
  const load =
    modules ??
    (async (/** @type {string} */ file) => {
      const path = tableFile(join(presetDir(root), "guard"), file);
      return path ? import(pathToFileURL(path).href) : undefined;
    });
  const table = async (/** @type {string} */ file, /** @type {string} */ name) =>
    (await load(file))?.[name];
  return {
    bash: list(await table("bash-rules.mjs", "BASH_RULES"), "BASH_RULES"),
    paths: list(await table("path-rules.mjs", "PATH_RULES"), "PATH_RULES"),
    planGated: await table("path-rules.mjs", "PLAN_GATED"),
    prompt: await table("hints.mjs", "PROMPT"),
    session: await table("hints.mjs", "SESSION"),
  };
}
