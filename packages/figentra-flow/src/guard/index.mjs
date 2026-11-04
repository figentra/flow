/**
 * Figentra Flow file contract:
 * Purpose: the `./guard` export (STA-2097, PLAN section 9 P2): what a preset's `guard/*.mjs` may import from Flow,
 *   so a preset shipped as an npm package needs no path into Flow's source. The helpers the bundled presets use
 *   (`collectStrings`, the configuration file names) and the rule and table types.
 * Boundary: re-exports only; no state, no I/O.
 * Runtime: node
 * Governing contract: ADR 0510; STA-2097.
 * Secrets: none.
 */
export { CONFIG_FILE, LEGACY_CONFIG_FILE } from "../lib/product.mjs";
export { collectStrings } from "./io.mjs";

/** @typedef {import("./bash.mjs").BashRule} BashRule */
/** @typedef {import("./bash.mjs").Decision} Decision */
/** @typedef {import("./paths.mjs").PathRule} PathRule */
/** @typedef {import("./prompt-hints.mjs").PromptTable} PromptTable */
/** @typedef {import("./session-context.mjs").SessionTable} SessionTable */
