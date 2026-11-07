/**
 * Figentra Flow file contract:
 * Purpose: what the plan gate asks of a spec (`checkSpec`, `specDir`, `RULES`, `presetId`, `presetOf`), moved
 *   unchanged out of `commands/gate.mjs` (which re-exports them) so `guard/plan-gate.mjs` and the guard bundle
 *   (`render-guard.mjs`) do not pull in the whole gate command (STA-2131).
 * Boundary: reads the configuration, the preset's `preset.yml`, the spec folders and git's top level; writes nothing.
 * Runtime: node
 * Governing contract: ADR 0120; ADR 0502; STA-2097; STA-2131.
 * Secrets: none.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { schemeFor } from "../adapters/tracker/index.mjs";
import { loadConfig } from "./config.mjs";
import { BUNDLED, specsDirs } from "./flow-dir.mjs";
import { isPackageName, packagePreset } from "./preset-package.mjs";
import { NAME } from "./product.mjs";

const readIf = (/** @type {string} */ p) => (existsSync(p) ? readFileSync(p, "utf8") : "");

/** The top of `dir`'s git checkout, else `dir` (a test or a script run below the root reads the root's config). */
function topLevel(/** @type {string} */ dir) {
  try {
    return (
      execFileSync("git", ["rev-parse", "--show-toplevel"], {
        cwd: dir,
        encoding: "utf8",
      }).trim() || dir
    );
  } catch {
    return dir;
  }
}

/** The repository the command runs in: the top of the working directory's git checkout, else the directory. */
export const ROOT = topLevel(process.cwd());
const IMPACT_FIELDS = [
  "Apps touched",
  "Services touched",
  "Packages touched",
  "Cross-service events",
  "Tenancy and data",
  "Secrets",
  "ADR needed",
  "New dependencies",
  "Deploy modes",
  "Licence tier",
  "Docs to update",
  "Lane",
  "Change risk",
];
/** @typedef {import("../adapters/tracker/index.mjs").KeyScheme} KeyScheme */
/** @type {KeyScheme | undefined} */
let scheme;
/**
 * The repository's issue-key scheme (its tracker's; the transitional STA one, unannounced, without a config file).
 * Keys are full and lower-cased: `sta-163`, `gh-7`.
 */
export const repoScheme = () => (scheme ??= schemeFor(ROOT));
/**
 * The preset a repository uses: its configuration's `preset`, else `neutral`.
 * @param {string} [root]
 */
export const presetOf = (root = ROOT) => loadConfig(root).config.preset ?? "neutral";

/**
 * The id a preset declares: a bundled one's name, or the `id:` in a preset folder's `preset.yml` (a repository's own
 * copy of `stackra`, or an installed preset package's folder, STA-2097, keeps Stackra's rules). Undefined when the
 * folder declares none.
 * @param {string} preset
 * @param {string} [root]
 */
export function presetId(preset, root = ROOT) {
  if (BUNDLED.includes(preset)) return preset;
  let dir = resolve(root, preset);
  try {
    if (isPackageName(preset)) dir = packagePreset(root, preset)?.dir ?? dir;
  } catch {
    // A package that names no preset folder declares no id; `doctor` names the problem.
  }
  const yml = readIf(join(dir, "preset.yml"));
  return yml.match(/^\s+id:\s*["']?([\w-]+)["']?\s*$/m)?.[1];
}

/**
 * The rules each preset's templates satisfy. `stackra` adds its Impact questionnaire, Constitution Check, deploy
 * modes, correctness properties, task routes and path floors to what every preset keeps (the issue key, the
 * clarifications marker, statuses, tiers, approvals, EARS criteria and the design sections). A repository's own
 * preset folder is held to the rules of the id it declares, else the neutral ones.
 * @typedef {{ impact: boolean, constitution: boolean, properties: boolean, routes: boolean, floors: boolean }} Rules
 * @type {Record<string, Rules>}
 */
export const RULES = {
  stackra: { impact: true, constitution: true, properties: true, routes: true, floors: true },
  neutral: { impact: false, constitution: false, properties: false, routes: false, floors: false },
};
/** @type {Rules | undefined} */
let rules;
export const repoRules = () =>
  (rules ??= RULES[presetId(presetOf()) ?? "neutral"] ?? RULES.neutral);

/** The `**Linear**:` (or `**Issue**:`) line's key, lower-cased. */
export const issueLine = (/** @type {string} */ body, /** @type {KeyScheme} */ keys) =>
  body
    .match(new RegExp(`^\\*\\*(?:Linear|Issue)\\*\\*:\\s*(${keys.pattern})(?![0-9])`, "mi"))?.[1]
    .toLowerCase();
/** Problems that stop a spec from being planned; empty means it may be. */
/**
 * @param {string} text
 * @param {KeyScheme} [keys]
 * @param {Rules} [rules]
 */
export function checkSpec(text, keys = repoScheme(), rules = repoRules()) {
  const body = text.replaceAll(/<!--[\s\S]*?-->/g, "");
  const problems = [];
  if (!/^\*\*Clarifications status\*\*:\s*complete\s*$/im.test(body))
    problems.push("`**Clarifications status**` is not `complete` (run /flow-clarify)");
  if (!issueLine(body, keys))
    problems.push(
      `\`**Linear**\` (or \`**Issue**\`) has no issue key (${NAME} linear issue, or the tracker)`,
    );
  if (/\[NEEDS CLARIFICATION/i.test(body)) problems.push("a `[NEEDS CLARIFICATION` marker remains");

  const impact = body.match(/^## Impact\b[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m)?.[1];
  if (!rules.impact) return problems;
  if (impact === undefined) {
    problems.push("the `## Impact` section is missing");
  } else {
    for (const field of IMPACT_FIELDS) {
      const value = impact.match(new RegExp(`^- \\*\\*${field}\\*\\*:[ \\t]*(.*)$`, "m"))?.[1];
      if (value === undefined) problems.push(`Impact: \`${field}\` is missing`);
      else if (value.trim() === "" || /^\[.*\]$/.test(value.trim()))
        problems.push(`Impact: \`${field}\` is unanswered`);
    }
  }
  return problems;
}

/**
 * The repo-relative spec folder for a key: its existing `<key>-*` folder, else one named from `slug`. A branch with no
 * key falls back to the one folder whose slug is exactly the branch's last segment, as `feature/cancel-order` →
 * `<key>-cancel-order` (FR-31). A refusal's `fix` is the flag that settles it (`--key` or `--slug`), so a caller
 * names it, never another command that sends back here.
 * @param {{ root?: string, branch?: string, key?: string, slug?: string, keys?: KeyScheme }} [options]
 */
export function specDir({ root = ROOT, branch = "", key, slug, keys = repoScheme() } = {}) {
  const k = key === undefined ? keys.keys(branch)[0] : keys.parse(key);
  const specs = specsDirs(root).dir;
  const base = join(root, specs);
  if (!k) {
    if (key !== undefined) return { error: `no issue key in --key ${key}`, fix: "--key <key>" };
    const tail = branch.split("/").pop() ?? "";
    const folderSlug = (/** @type {string} */ d) => {
      const own = keys.folderKey(d);
      return own === undefined ? undefined : d.slice(own.length + 1);
    };
    const named =
      tail && existsSync(base) ? readdirSync(base).filter((d) => folderSlug(d) === tail) : [];
    if (named.length === 1) return { dir: `${specs}/${named[0]}` };
    return {
      error: `no issue key in branch \`${branch}\` and ${named.length ? `several spec folders named for it: ${named.join(", ")}` : "no spec folder named for its slug"}`,
      fix: "--key <key>",
    };
  }
  const existing = existsSync(base) ? readdirSync(base).filter((d) => keys.folderKey(d) === k) : [];
  if (existing.length > 1)
    return { error: `several folders for ${keys.display(k)}: ${existing.join(", ")}` };
  if (existing.length) return { dir: `${specs}/${existing[0]}` };
  const name = keys.folder(k, slug ?? "");
  if (keys.folderKey(name) !== k)
    return {
      error: `no folder for ${keys.display(k)} yet`,
      fix: "--slug <kebab-case short name>",
    };
  return { dir: `${specs}/${name}` };
}
