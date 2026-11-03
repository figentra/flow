/**
 * Figentra Flow file contract:
 * Purpose: profiles (STA-1945 FR-6): a preset's `preset.yml` declares `profiles: { <name>: { agents, skills, hooks } }`
 *   and a `default`; a profile selects which agents, skills and hooks a repository gets, `"*"` selecting all. The
 *   config's `profile` names one, else the preset's `default` applies; a preset without `profiles` has one implicit
 *   `default` selecting all.
 * Boundary: pure: the parsed `preset.yml` in, a profile out; reads no file.
 * Runtime: node
 * Governing contract: STA-1945 (FR-6, AC-6, P-009).
 * Secrets: none.
 */
import { ConfigError } from "./config.mjs";

/** @typedef {"agents" | "skills" | "hooks"} ProfileKind */
/** @typedef {{ name: string, agents: string[], skills: string[], hooks: string[] }} Profile `["*"]` selects all */

/** What a profile selects. */
const KINDS = /** @type {ProfileKind[]} */ (["agents", "skills", "hooks"]);

/** The implicit profile of a preset without `profiles`. */
const IMPLICIT = "default";

/**
 * @param {unknown} v
 * @returns {v is Record<string, any>}
 */
const isMap = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The profile `name` names in the preset, else the preset's `default`.
 * @param {Record<string, any> | undefined} presetYml the parsed `preset.yml`
 * @param {string} [name] the config's `profile`
 * @returns {Profile}
 * @throws {ConfigError} on an unknown name, a preset with profiles but no `default` when no name is given, or a
 *   malformed `profiles`
 */
export function resolveProfile(presetYml, name) {
  const declared = presetYml?.profiles;
  if (declared === undefined || declared === null) {
    const chosen = name ?? IMPLICIT;
    if (chosen === IMPLICIT) return { name: chosen, agents: ["*"], skills: ["*"], hooks: ["*"] };
    throw new ConfigError(
      `profile "${chosen}" is unknown: the preset declares no profiles (only the implicit "${IMPLICIT}")`,
    );
  }
  if (!isMap(declared))
    throw new ConfigError(`the preset's profiles must be a map of names to profiles`);
  const names = Object.keys(declared).join(", ") || "(none)";
  const chosen = name ?? presetYml?.default;
  if (chosen === undefined || chosen === null)
    throw new ConfigError(
      `the preset declares profiles but no \`default\`: set \`profile\` in the config to one of ${names}`,
    );
  if (!Object.hasOwn(declared, chosen))
    throw new ConfigError(`profile "${chosen}" is unknown: the preset's profiles are ${names}`);
  const entry = declared[chosen];
  if (!isMap(entry))
    throw new ConfigError(`profile "${chosen}" must be a map of agents, skills and hooks`);
  /** @type {Profile} */
  const profile = { name: chosen, agents: [], skills: [], hooks: [] };
  for (const kind of KINDS) {
    const ids = entry[kind] ?? [];
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string"))
      throw new ConfigError(`profile "${chosen}": ${kind} must be a list of names`);
    profile[kind] = ids;
  }
  return profile;
}

/**
 * Whether `profile` selects the `kind` named `id`.
 * @param {Profile} profile
 * @param {ProfileKind} kind
 * @param {string} id
 */
export function selects(profile, kind, id) {
  return profile[kind].includes("*") || profile[kind].includes(id);
}
