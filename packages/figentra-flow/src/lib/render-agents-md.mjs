/**
 * Figentra Flow file contract:
 * Purpose: `AGENTS.md` and `CLAUDE.md` (STA-1945 FR-7): the preset's shared blocks (`surfaces/agents-md/agents.md`,
 *   filled with `fill`, the README's Mustache subset) plus the repository's facts: its name, tagline, what it is and
 *   its architecture from `.flow/readme.yml`, its preset, spec folder and tracker from the configuration, and its own
 *   notes from the configuration's `agentsMd.facts`. `CLAUDE.md` imports `AGENTS.md`, so both tools read one text.
 * Boundary: reads the preset's template and `.flow/readme.yml`; returns text, writes nothing (`sync` writes).
 * Runtime: node
 * Governing contract: STA-1945 (FR-7, AC-7, P-010).
 * Secrets: none.
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { SPECS_DEFAULT } from "./flow-dir.mjs";
import { fill, README_DATA } from "./readme.mjs";
import { parseYaml } from "./yaml.mjs";

/** The preset's template, under its folder. */
const TEMPLATE = "surfaces/agents-md/agents.md";

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
  const text = fill(readFileSync(template, "utf8"), {
    name: data.name ?? basename(ctx.root),
    tagline: data.tagline,
    what: data.what,
    architecture: data.architecture,
    preset: config.preset ?? "neutral",
    specs: config.specs?.dir ?? SPECS_DEFAULT,
    tracker: config.tracker,
    facts: config.agentsMd?.facts,
  });
  return new Map([
    ["AGENTS.md", `${text.replace(/\n{3,}/g, "\n\n").trim()}\n`],
    ["CLAUDE.md", "@AGENTS.md\n"],
  ]);
}
