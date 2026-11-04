/**
 * Figentra Flow file contract:
 * Purpose: a preset shipped as an npm package (STA-2097, PLAN section 9 P1): whether a configured `preset` is shaped
 *   like a package name, the package's preset folder (its package.json `flow.preset`, kept inside the package), the
 *   Flow range it declares (`peerDependencies` on Flow and `preset.yml` `requires.flow`), a small semver range check,
 *   and why the installed Flow is outside either range.
 * Boundary: reads the repository's installed packages and the preset's `preset.yml`; writes nothing, runs nothing.
 *   Flow loads code only from the preset the config names: nothing here installs or patches.
 * Runtime: node
 * Governing contract: ADR 0510; STA-2097.
 * Secrets: none.
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { ConfigError } from "./config.mjs";
import { NAME, PACKAGE, VERSION } from "./product.mjs";
import { parseYaml, YamlError } from "./yaml.mjs";

/** An npm package name, `name` or `@scope/name`: lower case, no path segment, never `.` or `..`. */
export const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

/**
 * Whether `value` is shaped like an npm package name (npm's limit is 214 characters).
 * @param {string} value
 */
export const isPackageName = (value) => value.length <= 214 && PACKAGE_NAME.test(value);

/**
 * @typedef {{ name: string, dir: string, version: string, flowRange?: string }} PresetSource the preset's configured
 *   name, its folder, its version (a package's own, else Flow's) and the Flow range a package declares
 */

/**
 * The preset folder of the package `name` installed for the repository at `root`, or undefined when it is not
 * installed.
 * @param {string} root
 * @param {string} name a package name (`isPackageName`)
 * @returns {PresetSource | undefined}
 * @throws {ConfigError} when its package.json names no `flow.preset` folder, or one outside the package or missing
 */
export function packagePreset(root, name) {
  let manifest;
  try {
    manifest = createRequire(join(root, "package.json")).resolve(`${name}/package.json`);
  } catch (error) {
    if (/** @type {any} */ (error)?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED")
      throw new ConfigError(
        `the preset package ${name} does not export ./package.json (add it to its "exports")`,
      );
    return undefined;
  }
  const pkg = JSON.parse(readFileSync(manifest, "utf8"));
  const folder = pkg.flow?.preset;
  if (typeof folder !== "string" || !folder)
    throw new ConfigError(
      `${name} is not a ${NAME} preset: its package.json has no "flow": { "preset": "./preset" }`,
    );
  const base = realpathSync(dirname(manifest));
  let dir;
  try {
    dir = realpathSync(resolve(base, folder));
  } catch {
    throw new ConfigError(
      `${name}'s preset folder ${folder} (its package.json flow.preset) is missing`,
    );
  }
  // A link or `..` out of the package would load another folder's guard code.
  const at = relative(base, dir);
  if (/^\.\.(\/|\\|$)/.test(at) || isAbsolute(at))
    throw new ConfigError(`${name}'s preset folder ${folder} is outside the package`);
  const range = pkg.peerDependencies?.[PACKAGE];
  return {
    name,
    dir,
    version: String(pkg.version ?? ""),
    ...(typeof range === "string" ? { flowRange: range } : {}),
  };
}

/**
 * The preset `preset` names for `root` when it is a package: installed, or a ConfigError naming `fflow preset add`.
 * Undefined when `preset` is not shaped like a package name, or names a folder of the repository that exists (a
 * bare folder name such as `ours` keeps working).
 * @param {string} root
 * @param {string} preset
 * @returns {PresetSource | undefined}
 */
export function resolvePackagePreset(root, preset) {
  if (!isPackageName(preset)) return undefined;
  const found = packagePreset(root, preset);
  if (found || existsSync(resolve(root, preset))) return found;
  throw new ConfigError(
    `the preset package ${preset} is not installed in ${root} (run \`${NAME} preset add ${preset}\`)`,
  );
}

/**
 * A version as its three numbers (an `x` or `*` part, or a missing one, counts as 0), how many were given, and its
 * prerelease.
 * @param {string} text
 */
function parseVersion(text) {
  const m =
    /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
      text,
    );
  if (!m) return undefined;
  const parts = [m[1], m[2], m[3]];
  const wild = parts.findIndex((p) => p === undefined || /^[xX*]$/.test(p));
  const given = wild === -1 ? 3 : wild;
  return { v: [0, 1, 2].map((i) => (i < given ? Number(parts[i]) : 0)), given, pre: m[4] };
}

/**
 * The order of two versions; a prerelease is below its release.
 * @param {{ v: number[], pre?: string }} a
 * @param {{ v: number[], pre?: string }} b
 */
function compare(a, b) {
  for (let i = 0; i < 3; i++) if (a.v[i] !== b.v[i]) return a.v[i] - b.v[i];
  if (a.pre === b.pre) return 0;
  if (!a.pre) return 1;
  if (!b.pre) return -1;
  return a.pre.localeCompare(b.pre, "en", { numeric: true });
}

/**
 * `v` with part `i` one higher and the parts after it 0.
 * @param {number[]} v
 * @param {number} i
 */
const bump = (v, i) => ({ v: v.map((n, j) => (j < i ? n : j === i ? n + 1 : 0)) });

/**
 * Whether `version` meets one comparator, as `^1.2`, `~1.2.3`, `>=1`, `<2.0.0`, `1.2.x` or `*`.
 * @param {ReturnType<typeof parseVersion> & {}} version
 * @param {string} comparator
 */
function meetsOne(version, comparator) {
  const m = /^(<=|>=|<|>|=|\^|~)?(.+)$/.exec(comparator);
  const want = m && parseVersion(m[2]);
  if (!m || !want) return false;
  const { v, given } = want;
  const at = compare(version, want);
  /** The first version past the given parts: 1.2 → 1.3.0. */
  const past = () => compare(version, bump(v, given - 1));
  switch (m[1] ?? "=") {
    case "=":
      return given === 0 || (given === 3 ? at === 0 : at >= 0 && past() < 0);
    case ">=":
      return at >= 0;
    case ">":
      return given === 3 ? at > 0 : given > 0 && past() >= 0;
    case "<":
      return given > 0 && at < 0;
    case "<=":
      return given === 3 ? at <= 0 : given === 0 || past() < 0;
    case "^": {
      if (given === 0) return true;
      // The first non-zero given part (or the last given one) may not change.
      const fixed = v[0] > 0 || given === 1 ? 0 : v[1] > 0 || given === 2 ? 1 : 2;
      return at >= 0 && compare(version, bump(v, fixed)) < 0;
    }
    default: // "~"
      if (given === 0) return true;
      return at >= 0 && compare(version, bump(v, given === 1 ? 0 : 1)) < 0;
  }
}

/**
 * Whether `version` is in `range`: comparators (`*`, an exact or partial version, `^`, `~`, `>=`, `>`, `<=`, `<`)
 * joined by spaces, and sets of them joined by `||`. A range or version outside that form is never met.
 * shortcut: a prerelease is compared by its numbers only (npm admits it only against a comparator on the same
 *   x.y.z), and hyphen ranges (`1 - 2`) are not read; upgrade to the `semver` package if a preset needs either.
 * @param {string} version
 * @param {string} range
 */
export function satisfies(version, range) {
  const have = parseVersion(version.trim());
  if (!have) return false;
  return range.split("||").some((set) => {
    const comparators = set
      .trim()
      .replace(/(<=|>=|<|>|=|\^|~)\s+/g, "$1")
      .split(/\s+/)
      .filter(Boolean);
    return comparators.every((c) => meetsOne(have, c));
  });
}

/**
 * The Flow range the preset's `preset.yml` declares (`requires.flow`), or undefined.
 * @param {string} dir the preset's folder
 * @throws {ConfigError} when `preset.yml` is outside the YAML subset
 */
function requiredFlow(dir) {
  const file = join(dir, "preset.yml");
  if (!existsSync(file)) return undefined;
  try {
    const flow = parseYaml(readFileSync(file, "utf8"))?.requires?.flow;
    return flow === undefined ? undefined : String(flow);
  } catch (error) {
    if (error instanceof YamlError) throw new ConfigError(`${file}: ${error.message}`);
    throw error;
  }
}

/**
 * Why the installed Flow cannot run `source`: a Flow range the package or its `preset.yml` declares that `version`
 * is outside, with the fix; undefined when both are met or absent.
 * @param {PresetSource} source
 * @param {string} [version] the installed Flow version
 * @returns {{ detail: string, fix: string } | undefined}
 */
export function incompatibility(source, version = VERSION) {
  for (const [range, where] of [
    [source.flowRange, `its peerDependencies["${PACKAGE}"]`],
    [requiredFlow(source.dir), "its preset.yml requires.flow"],
  ])
    if (range !== undefined && !satisfies(version, range))
      return {
        detail: `the ${source.name} preset needs ${PACKAGE} ${range} (${where}); ${version} is installed`,
        fix: `install a ${source.name} that supports ${version}, or the ${PACKAGE} it needs`,
      };
  return undefined;
}
