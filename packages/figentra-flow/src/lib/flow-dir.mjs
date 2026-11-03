/**
 * Figentra Flow file contract:
 * Purpose: the `.flow/` folder a repository owns (ADR 0510): its paths, the current-spec pointer that `gate dir`
 *   writes and every `spec` subcommand reads, the spec folders from the configuration (`specs.dir`, `specs.bugsDir`),
 *   and template resolution: the repository's `.flow/overrides/`, then its preset, then Flow's base templates.
 * Boundary: reads the configuration and files; `writeCurrent` is the only write.
 * Runtime: node
 * Governing contract: ADR 0510; STA-1729.
 * Secrets: none.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "./config.mjs";

/** The folder a repository owns. */
export const FLOW_DIR = ".flow";
/** The current-spec pointer (git-ignored). */
export const CURRENT = `${FLOW_DIR}/current.json`;
/** A repository's own template overrides. */
export const OVERRIDES = `${FLOW_DIR}/overrides`;
/** The repository's constitution. */
export const CONSTITUTION = `${FLOW_DIR}/constitution.md`;
/** What `sync` rendered, with the Flow version and the preset. */
export const LOCK = `${FLOW_DIR}/lock.json`;

/** Flow's own assets: the presets and the base templates. */
export const FLOW_ASSETS = fileURLToPath(new URL("../../assets/flow", import.meta.url));

/** Where specs live unless `specs.dir` says otherwise. */
export const SPECS_DEFAULT = ".agents/specs";

/**
 * The spec folders of `root`: `specs.dir` and `specs.bugsDir` from the configuration.
 * @param {string} root
 */
export function specsDirs(root) {
  const specs = loadConfig(root).config.specs ?? {};
  const dir = specs.dir ?? SPECS_DEFAULT;
  return { dir, bugsDir: specs.bugsDir ?? `${dir}/bugs` };
}

/**
 * The spec folder `.flow/current.json` points at, relative to `root`, or undefined.
 * @param {string} root
 * @returns {string | undefined}
 */
export function readCurrent(root) {
  const file = join(root, CURRENT);
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf8")).feature_directory || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Points `.flow/current.json` at `dir` (relative to `root`).
 * @param {string} root
 * @param {string} dir
 */
export function writeCurrent(root, dir) {
  mkdirSync(join(root, FLOW_DIR), { recursive: true });
  writeFileSync(join(root, CURRENT), `${JSON.stringify({ feature_directory: dir }, null, 2)}\n`);
}

/**
 * The preset folder `root` uses: a bundled preset by name, or the repository's own folder (`preset` as a path).
 * @param {string} root
 */
export function presetDir(root) {
  const preset = loadConfig(root).config.preset ?? "neutral";
  const bundled = join(FLOW_ASSETS, "presets", preset);
  return existsSync(bundled) ? bundled : resolve(root, preset);
}

/**
 * Whether `rel` (relative to `.flow/overrides/`) is a file inside that folder once its links are followed: a link out
 * of it (say to `~/.npmrc`) would put that file's text into a committed output.
 * @param {string} root
 * @param {string} rel
 */
export function inOverrides(root, rel) {
  const dir = join(root, OVERRIDES);
  try {
    const at = relative(realpathSync(dir), realpathSync(join(dir, rel)));
    return !/^\.\.(\/|$)/.test(at) && !isAbsolute(at);
  } catch {
    // Missing, a dangling or looping link, or unreadable: never read as an override.
    return false;
  }
}

/**
 * The file a template name resolves to: `.flow/overrides/<name>.md` (when it is inside that folder), then the
 * preset's `templates/<name>.md`, then Flow's base `templates/<name>.md`; undefined when none has it.
 * @param {string} root
 * @param {string} name e.g. `plan-template`
 */
export function resolveTemplate(root, name) {
  const file = `${name}.md`;
  return [
    ...(inOverrides(root, file) ? [join(root, OVERRIDES, file)] : []),
    join(presetDir(root), "templates", file),
    join(FLOW_ASSETS, "templates", file),
  ].find((p) => existsSync(p));
}
