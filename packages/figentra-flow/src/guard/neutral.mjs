/**
 * Figentra Flow file contract:
 * Purpose: the `./guard/neutral` export (STA-2097): the neutral preset's guard rules, for a preset whose
 *   `guard/*.mjs` extends them (the stackra preset puts the neutral path rules after its own). Its own module, not
 *   part of `./guard`, because the neutral rules import `./guard` themselves.
 * Boundary: re-exports only; no state, no I/O.
 * Runtime: node
 * Governing contract: ADR 0510; STA-2097.
 * Secrets: none.
 */
export { BASH_RULES } from "../../assets/flow/presets/neutral/guard/bash-rules.mjs";
export { isSecretPath, PATH_RULES } from "../../assets/flow/presets/neutral/guard/path-rules.mjs";
