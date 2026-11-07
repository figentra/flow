/**
 * Figentra Flow file contract:
 * Purpose: `AGENTS.md` and `CLAUDE.md` (STA-1945 FR-7): the preset's shared blocks (`surfaces/agents-md/agents.md`,
 *   filled with `fill`, the README's Mustache subset) plus the repository's facts: its name, tagline, what it is and
 *   its architecture from `.flow/readme.yml`, the rendered preset's folder name, its spec folder and tracker from the
 *   configuration, and its own notes from the configuration's `agentsMd.facts` (one Markdown string); its
 *   `agentsMd.land` (STA-2131) replaces the landing line of "How work flows", so a repository whose owner lands
 *   differently is not contradicted. `CLAUDE.md` imports `AGENTS.md`, so both tools read one text. The rules are
 *   an index, one line per rule file (its path, description and when it applies), never their text, so the file
 *   stays a pointer index under 20 KB (the master plan's AGENTS.md budget).
 * Boundary: reads the preset's template, `.flow/readme.yml` and the repository's own rule files; returns text, writes
 *   nothing (`sync` writes).
 * Runtime: node
 * Governing contract: STA-1945 (FR-7, AC-7, P-010).
 * Secrets: none.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { ConfigError } from "./config.mjs";
import { SPECS_DEFAULT } from "./flow-dir.mjs";
import { CONFIG_FILE } from "./product.mjs";
import { fill, README_DATA } from "./readme.mjs";
import { parseYaml } from "./yaml.mjs";

/** The preset's template, under its folder. */
const TEMPLATE = "surfaces/agents-md/agents.md";

/**
 * One index line's facts: the rule file, what it says and when it applies.
 * @typedef {{ path: string, description: string, when?: string }} RuleLine
 */

/**
 * The index of `rules` (rendered rule files, path to text) and of the repository's own files beside them in `dir`,
 * by path; a file without front matter is indexed by its path alone.
 * @param {string} root
 * @param {string} dir the rules folder, `.agents/rules` or `.claude/rules`
 * @param {Map<string, string>} rules
 * @returns {RuleLine[]}
 */
export function ruleIndex(root, dir, rules) {
  const all = new Map(rules);
  const own = join(root, dir);
  if (existsSync(own))
    for (const file of readdirSync(own))
      if (file.endsWith(".md") && file !== "README.md" && !all.has(`${dir}/${file}`))
        all.set(`${dir}/${file}`, readFileSync(join(own, file), "utf8"));
  return [...all]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([path, text]) => {
      const front = /^---\n([\s\S]*?)\n---/.exec(text);
      /** @type {Record<string, any>} */
      const meta = front ? (parseYaml(front[1] ?? "") ?? {}) : {};
      const globs = Array.isArray(meta.applies_to) ? meta.applies_to.map(String) : [];
      const when =
        meta.always === true
          ? "always"
          : globs.length > 0
            ? `for ${globs.map((glob) => `\`${glob}\``).join(", ")}`
            : undefined;
      return {
        path,
        description: String(meta.description ?? meta.title ?? basename(path, ".md")),
        ...(when === undefined ? {} : { when }),
      };
    });
}

/**
 * `AGENTS.md` and `CLAUDE.md`, or nothing when the preset has no `surfaces/agents-md/agents.md`.
 * @param {import("./render.mjs").RenderContext} ctx
 * @returns {Map<string, string>}
 */
export function renderAgentsMd(ctx) {
  const template = join(ctx.presetDir, TEMPLATE);
  if (!existsSync(template)) return new Map();
  const readme = join(ctx.root, README_DATA);
  // renderReadme validates the data file; here it only lends its facts.
  /** @type {Record<string, any>} */
  const data = existsSync(readme) ? (parseYaml(readFileSync(readme, "utf8")) ?? {}) : {};
  const { config } = ctx;
  const facts = config.agentsMd?.facts;
  if (facts !== undefined && typeof facts !== "string")
    throw new ConfigError(`${CONFIG_FILE}: agentsMd.facts must be one Markdown string`);
  const land = config.agentsMd?.land;
  if (land !== undefined && typeof land !== "string")
    throw new ConfigError(`${CONFIG_FILE}: agentsMd.land must be one Markdown string`);
  const text = fill(readFileSync(template, "utf8"), {
    name: data.name ?? basename(ctx.root),
    tagline: data.tagline,
    what: data.what,
    architecture: data.architecture,
    preset: basename(ctx.presetDir),
    specs: config.specs?.dir ?? SPECS_DEFAULT,
    tracker: config.tracker,
    facts,
    land,
    rules: ctx.rules ?? [],
    anyRules: (ctx.rules ?? []).length > 0,
  });
  return new Map([
    ["AGENTS.md", `${text.replace(/\n{3,}/g, "\n\n").trim()}\n`],
    ["CLAUDE.md", "@AGENTS.md\n"],
  ]);
}
