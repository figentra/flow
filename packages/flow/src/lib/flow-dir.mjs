/**
 * Figentra Flow file contract:
 * Purpose: the `.flow/` folder a repository owns (ADR 0510): its paths, the current-spec pointer that `gate dir`
 *   writes and every `spec` subcommand reads, the spec folders from the configuration (`specs.dir`, `specs.bugsDir`),
 *   the preset (bundled, an installed npm package or a folder of the repository, STA-2097), template resolution: the
 *   repository's `.flow/overrides/`, then its preset, then Flow's base templates; and the preset's surface files
 *   (`surfaces/`) read as YAML, and a preset folder's files as text (`presetTree`).
 * Boundary: reads the configuration and files; `writeCurrent` is the only write.
 * Runtime: node
 * Governing contract: ADR 0510; STA-1729; STA-2097.
 * Secrets: none.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { ConfigError, loadConfig } from "./config.mjs";
import { resolvePackagePreset } from "./preset-package.mjs";
import { VERSION } from "./product.mjs";
import { parseYaml, YamlError } from "./yaml.mjs";

/** The presets bundled with Flow. */
export const BUNDLED = ["neutral", "stackra"];

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
 * The preset folder `root` uses (`presetSource`).
 * @param {string} root
 * @throws {ConfigError} as `presetSource` does
 */
export function presetDir(root) {
  return presetSource(root).dir;
}

/**
 * The preset `root` uses: a bundled preset by name; else an installed npm package by name (its package.json
 * `flow.preset` folder, at the package's version, STA-2097); else the repository's own folder (`preset` as a path).
 * Bundled and path presets carry Flow's version.
 * @param {string} root
 * @returns {import("./preset-package.mjs").PresetSource}
 * @throws {ConfigError} when a package name is not installed, or its package names no preset folder inside it
 */
export function presetSource(root) {
  const preset = loadConfig(root).config.preset ?? "neutral";
  const bundled = join(FLOW_ASSETS, "presets", preset);
  if (existsSync(bundled)) return { name: preset, dir: bundled, version: VERSION };
  return (
    resolvePackagePreset(root, preset) ?? {
      name: preset,
      dir: resolve(root, preset),
      version: VERSION,
    }
  );
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

/**
 * A preset surface file (`surfaces/<name>`) read as YAML, or undefined when the preset has none; invalid YAML is a
 * `ConfigError` naming the file.
 * @param {string} dir the preset's folder
 * @param {string} name
 * @returns {any}
 */
export function surfaceYaml(dir, name) {
  const file = join(dir, "surfaces", name);
  if (!existsSync(file)) return undefined;
  try {
    return parseYaml(readFileSync(file, "utf8")) ?? {};
  } catch (error) {
    if (error instanceof YamlError) throw new ConfigError(`${file}: ${error.message}`);
    throw error;
  }
}

/**
 * Every file under `dir`, its `/`-separated path relative to `dir` and its text, sorted by path; none when `dir` is
 * missing.
 * @param {string} dir
 * @param {(path: string) => string} [from] the file a path's text is read from (its replacement's, FR-4)
 * @returns {[string, string][]}
 * @throws {ConfigError} on a file that is not UTF-8 text: rendered as text it would be corrupted, and the lock with it
 */
export function presetTree(dir, from = (path) => join(dir, path)) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((path) => statSync(join(dir, path)).isFile())
    .map((path) => path.split(sep).join("/"))
    .toSorted()
    .map((path) => {
      const file = from(path);
      const bytes = readFileSync(file);
      const text = bytes.toString("utf8");
      if (!Buffer.from(text, "utf8").equals(bytes))
        throw new ConfigError(`${file} is not UTF-8 text; a preset ships text files only`);
      return /** @type {[string, string]} */ ([path, text]);
    });
}
