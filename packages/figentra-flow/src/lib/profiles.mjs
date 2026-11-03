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
export const KINDS = /** @type {ProfileKind[]} */ (["agents", "skills", "hooks"]);

/** The name of the profile a preset without `profiles`, or without `default`, falls back to. */
export const DEFAULT_PROFILE = "default";

/**
 * The profile `name` names in the preset, else the preset's `default`.
 * @param {Record<string, any> | undefined} presetYml the parsed `preset.yml`
 * @param {string} [name] the config's `profile`
 * @returns {Profile}
 * @throws {ConfigError} on an unknown name, or a profile whose agents, skills or hooks are not a list of names
 */
export function resolveProfile(presetYml, name) {
  const declared = presetYml?.profiles;
  const chosen = name ?? presetYml?.default ?? DEFAULT_PROFILE;
  if (declared === undefined || declared === null) {
    if (chosen === DEFAULT_PROFILE)
      return { name: chosen, agents: ["*"], skills: ["*"], hooks: ["*"] };
    throw new ConfigError(
      `profile "${chosen}" is unknown: the preset declares no profiles (only the implicit "${DEFAULT_PROFILE}")`,
    );
  }
  const names = typeof declared === "object" ? Object.keys(declared) : [];
  const entry = names.includes(chosen) ? declared[chosen] : undefined;
  if (typeof entry !== "object" || entry === null || Array.isArray(entry))
    throw new ConfigError(
      `profile "${chosen}" is unknown: the preset's profiles are ${names.join(", ") || "(none)"}`,
    );
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
