/**
 * Figentra Flow file contract:
 * Purpose: a repository's overrides (STA-1945 FR-4): `.flow/overrides/<surface>/<id>.yml`, each one of four kinds,
 *   checked against `OVERRIDE_SCHEMA` (shipped as `schema/override.schema.json` for editors):
 *   - `extend` appends `items` (as list lines) or `text` to the end of a rendered output, or of its Markdown `section`;
 *     on a mandatory policy's id it adds `items` to the policy's rule list (`policies.mjs`);
 *   - `configure` sets `values` in a parameter block the preset declares (`parameters:` in `preset.yml`); no bundled
 *     preset declares one yet, so `validate` refuses every `configure` until one does and its reader applies it;
 *   - `replace` swaps a whole rendered output, or a preset source (`commands/`, `agents/`, `rules/` or `templates/`
 *     `<name>.md`, a file of `skills/<name>/` or `reference/`, `routing.yaml` or `models.yaml`) before it is
 *     rendered, for the text of `file` (relative to `.flow/overrides/`);
 *   - `disable` drops a rendered output.
 *   `replace` and `disable` need `reason`, `owner` and `review` (a date); `reviewState` is `due` from 14 days before
 *   the review date and `expired` after it. Today's whole-file overrides (`.flow/overrides/{commands,agents,rules}/
 *   <name>.md`, and a template as `.flow/overrides/<name>.md`) that no `.yml` names as its `file` are read as `replace`
 *   overrides of that preset source, marked `legacy`. Each kind changes only its target. A replacement that links
 *   outside `.flow/overrides/` is refused, so no file from elsewhere reaches a committed output.
 * Boundary: `loadOverrides` reads `.flow/overrides/`; the rest is pure, except that `applyOverrides` reads a
 *   replacement's file. Nothing here writes.
 * Runtime: node
 * Governing contract: STA-1945 (FR-4, AC-4, P-007).
 * Secrets: none.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

import { validate } from "./config.mjs";
import { inOverrides, OVERRIDES } from "./flow-dir.mjs";
import { policyOf, RULE_LISTS } from "./policies.mjs";
import { NAME } from "./product.mjs";
import { parseYaml, YamlError } from "./yaml.mjs";

/**
 * @typedef {{ id: string, surface: string, path: string, kind: "extend" | "configure" | "replace" | "disable",
 *   target: string, reason?: string, owner?: string, review?: string, items?: string[], section?: string,
 *   text?: string, values?: Record<string, unknown>, file?: string, legacy?: boolean }} Override `path` is the
 *   override's file, relative to the repository
 */

/** How many days before its review date an override is due. */
export const REVIEW_NOTICE_DAYS = 14;

const str = { type: "string", minLength: 1 };
const review = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
/** One kind's variant: `reason`, `owner` and `review` are allowed on every kind and required on some. */
const kind = (
  /** @type {string} */ name,
  /** @type {Record<string, unknown>} */ properties,
  /** @type {string[]} */ required = [],
) => ({
  type: "object",
  additionalProperties: false,
  required: ["kind", "target", ...required],
  properties: {
    kind: { const: name },
    target: str,
    ...properties,
    reason: str,
    owner: str,
    review,
  },
});
const governed = ["reason", "owner", "review"];

/** The override file's JSON Schema (draft 2020-12), the single source of `schema/override.schema.json`. */
export const OVERRIDE_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "override.schema.json",
  title: ".flow/overrides/<surface>/<id>.yml",
  oneOf: [
    kind("extend", { items: { type: "array", items: str, minItems: 1 }, section: str, text: str }),
    kind("configure", { values: { type: "object" } }, ["values"]),
    kind("replace", { file: str }, ["file", ...governed]),
    kind("disable", {}, governed),
  ],
};

/** The preset sources a whole-file override replaces, by their folder under `.flow/overrides/`. */
const LEGACY_FOLDERS = ["commands", "agents", "rules"];
/** A preset source `replace` may target. */
const SOURCE =
  /^(?:(?:commands|agents|rules|templates)\/[^/]+\.md|(?:skills\/[^/]+|reference)\/.+|routing\.yaml|models\.yaml)$/;

/**
 * Whether `s` is a real calendar date `YYYY-MM-DD`.
 * @param {string} s
 */
function isDate(s) {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * The repository's overrides, sorted by path, and a problem for each file that is not a valid override (never a
 * throw). An invalid override is left out.
 * @param {string} root
 * @returns {{ overrides: Override[], problems: string[] }}
 */
export function loadOverrides(root) {
  const dir = join(root, OVERRIDES);
  /** @type {Override[]} */
  const overrides = [];
  /** @type {string[]} */
  const problems = [];
  if (!existsSync(dir)) return { overrides, problems };
  const files = readdirSync(dir, { recursive: true, encoding: "utf8" }).toSorted();
  for (const rel of files.filter((f) => /\.ya?ml$/.test(f))) {
    const path = `${OVERRIDES}/${rel}`;
    const parts = rel.split("/");
    if (parts.length !== 2) {
      problems.push(`${path}: an override lives at ${OVERRIDES}/<surface>/<id>.yml`);
      continue;
    }
    let data;
    try {
      data = parseYaml(readFileSync(join(dir, rel), "utf8"));
    } catch (error) {
      if (!(error instanceof YamlError)) throw error;
      problems.push(`${path}: ${error.message}`);
      continue;
    }
    const errors = validate(OVERRIDE_SCHEMA, data);
    if (data?.review && !errors.length && !isDate(data.review))
      errors.push(`review: ${data.review} is not a date`);
    if (data?.kind === "extend" && !data.items && !data.text)
      errors.push("extend: needs `items`, or `text` (with an optional `section`)");
    if (data?.kind === "extend" && data.items && data.text)
      errors.push("extend: takes `items` or `text`, not both");
    if (data?.kind === "replace" && typeof data.file === "string") {
      const at = relative(dir, resolve(dir, data.file));
      const template = String(data.target ?? "").match(/^templates\/(.+)$/)?.[1];
      if (at.startsWith("..") || isAbsolute(at))
        errors.push(`file: ${data.file} is outside ${OVERRIDES}/`);
      else if (!existsSync(join(dir, at))) errors.push(`file: ${OVERRIDES}/${at} does not exist`);
      else if (!inOverrides(root, at))
        errors.push(`file: ${OVERRIDES}/${at} links outside ${OVERRIDES}/`);
      // shortcut: templates resolve from `.flow/overrides/<name>.md` only (`resolveTemplate`); a template replacement
      // elsewhere would be silently ignored, so it is refused until templates read the overrides.
      else if (template && at !== template)
        errors.push(`file: a template's replacement must be ${OVERRIDES}/${template}`);
    }
    if (errors.length) {
      problems.push(...errors.map((e) => `${path}: ${e}`));
      continue;
    }
    overrides.push({ id: parts[1].replace(/\.ya?ml$/, ""), surface: parts[0], path, ...data });
  }
  // Only a valid `.yml` claims its file; an invalid one leaves a whole-file override as it was.
  const named = new Set(
    overrides.filter((o) => o.kind === "replace").map((o) => relative(dir, resolve(dir, o.file))),
  );
  for (const rel of files.filter((f) => f.endsWith(".md") && !named.has(f))) {
    const parts = rel.split("/");
    const folder = parts.length === 1 ? "templates" : parts[0];
    if (parts.length > 2 || (parts.length === 2 && !LEGACY_FOLDERS.includes(folder))) continue;
    if (!inOverrides(root, rel)) {
      problems.push(`${OVERRIDES}/${rel}: links outside ${OVERRIDES}/`);
      continue;
    }
    overrides.push({
      id: parts.at(-1).slice(0, -3),
      surface: folder,
      path: `${OVERRIDES}/${rel}`,
      kind: "replace",
      target: `${folder}/${parts.at(-1)}`,
      file: rel,
      legacy: true,
    });
  }
  return { overrides, problems };
}

/**
 * Today's whole-file overrides that still lack their `.yml` (FR-4 migration).
 * @param {Override[]} overrides
 */
export function legacyWarnings(overrides) {
  return overrides
    .filter((o) => o.legacy)
    .map(
      (o) =>
        `${o.path} is a whole-file override read as \`replace\` of ${o.target}: give it a .yml in ${OVERRIDES}/${o.surface}/ (kind: replace, target: ${o.target}, file: ${o.file}, reason, owner, review)`,
    );
}

/**
 * Where `section` (a Markdown heading's text) ends in `lines`: the line after its last non-blank line, before the
 * next heading of the same or a higher level. Front matter and fenced code are not headings. -1 without it.
 * @param {string[]} lines
 * @param {string} section
 */
function sectionEnd(lines, section) {
  let fenced = false;
  let level = 0;
  let start = -1;
  let stop = lines.length;
  for (let i = lines[0] === "---" ? lines.indexOf("---", 1) + 1 : 0; i < lines.length; i++) {
    if (/^(```|~~~)/.test(lines[i])) fenced = !fenced;
    const h = fenced ? null : lines[i].match(/^(#{1,6})\s+(.*?)\s*$/);
    if (!h) continue;
    if (level && h[1].length <= level) {
      stop = i;
      break;
    }
    if (!level && h[2] === section) {
      level = h[1].length;
      start = i;
    }
  }
  if (start < 0) return -1;
  while (stop > start + 1 && !lines[stop - 1].trim()) stop--;
  return stop;
}

/**
 * Whether `text` has the Markdown section `section`.
 * @param {string} text
 * @param {string} section
 */
export function hasSection(text, section) {
  return sectionEnd(text.split("\n"), section) >= 0;
}

/**
 * `text` with an `extend` override's `items` (as `- item` lines) or `text` at the end of its section, or of the file.
 * @param {string} text
 * @param {Override} o
 */
function extendText(text, o) {
  const add = o.text?.replace(/\n$/, "") ?? (o.items ?? []).map((i) => `- ${i}`).join("\n");
  const lines = text.split("\n");
  if (o.section) {
    const end = sectionEnd(lines, o.section);
    if (end < 0) return text;
    return [...lines.slice(0, end), add, ...lines.slice(end)].join("\n");
  }
  return `${text.replace(/\n*$/, "\n")}${add}\n`;
}

/**
 * `files` (rendered output path to text) with each override that targets a rendered output applied, in order. An
 * override on a preset source, a parameter or a policy is applied where those are read, and one on an unknown target
 * changes nothing (`targetProblems` names it).
 * @param {Map<string, string>} files
 * @param {Override[]} overrides
 * @param {string} root
 * @returns {Map<string, string>}
 */
export function applyOverrides(files, overrides, root) {
  const out = new Map(files);
  for (const o of overrides) {
    if (!out.has(o.target)) continue;
    if (o.kind === "disable") out.delete(o.target);
    else if (o.kind === "replace")
      out.set(o.target, readFileSync(join(root, OVERRIDES, o.file), "utf8"));
    else if (o.kind === "extend") out.set(o.target, extendText(out.get(o.target), o));
  }
  return out;
}

/**
 * Each override whose target the repository does not have: a rendered output for every kind, a preset source for
 * `replace`, a policy's rule list for `extend`, a declared parameter for `configure`; and an `extend` section the
 * output lacks.
 * @param {Override[]} overrides
 * @param {Map<string, string>} outputs what `sync` renders before the overrides
 * @param {{ params?: Record<string, any>, sources?: Set<string> }} [known] the preset's parameter blocks and sources
 * @returns {string[]}
 */
export function targetProblems(overrides, outputs, { params = {}, sources = new Set() } = {}) {
  /** @type {string[]} */
  const problems = [];
  for (const o of overrides) {
    if (o.legacy) continue;
    if (o.kind === "configure") {
      const block = params[o.target];
      if (!block || typeof block !== "object")
        problems.push(
          `${o.path}: configure ${o.target}: the preset declares no such parameter block`,
        );
      else
        for (const key of Object.keys(o.values ?? {}))
          if (!(key in block))
            problems.push(
              `${o.path}: configure ${o.target}: the preset declares no parameter ${key}`,
            );
    } else if (outputs.has(o.target)) {
      if (o.kind === "extend" && o.section && !hasSection(outputs.get(o.target), o.section))
        problems.push(`${o.path}: extend ${o.target}: it has no section "${o.section}"`);
    } else if (o.kind === "replace" && SOURCE.test(o.target)) {
      if (!sources.has(o.target))
        problems.push(`${o.path}: replace ${o.target}: the preset has no such source`);
    } else if (!(o.kind === "extend" && RULE_LISTS.includes(o.target)))
      problems.push(
        `${o.path}: ${o.kind} ${o.target}: ${NAME} renders no such output (\`${NAME} diff\` lists them)`,
      );
  }
  return problems;
}

/**
 * The preset source a rendered output comes from (`commands/`, `agents/` or `rules/` `<name>.md`, a preset skill's
 * or reference file, `routing.yaml`, `models.yaml`, or the README's template), or undefined.
 * @param {string} path
 */
function sourceOf(path) {
  if (path === "README.md") return "templates/readme-template.md";
  const command =
    path.match(/^\.(?:claude|agents)\/skills\/(flow-[^/]+)\/SKILL\.md$/) ??
    path.match(/^\.opencode\/commands\/([^/]+)\.md$/);
  if (command) return `commands/${command[1]}.md`;
  return (
    path.match(/^\.(?:claude|agents)\/((?:agents|rules)\/[^/]+\.md)$/)?.[1] ??
    path.match(/^\.(?:claude|agents)\/(skills\/.+)$/)?.[1] ??
    path.match(/^\.agents\/(reference\/.+|routing\.yaml|models\.yaml)$/)?.[1]
  );
}

/**
 * The paths of the overrides that shape the rendered output `path`: one on the output, on its preset source, or an
 * `extend` of the policy it holds (FR-3: its header names them).
 * @param {Override[]} overrides
 * @param {string} path
 * @returns {string[]}
 */
export function shapedBy(overrides, path) {
  const source = sourceOf(path);
  const policy = policyOf(path);
  return overrides
    .filter(
      (o) =>
        o.target === path ||
        (source && o.kind === "replace" && o.target === source) ||
        (policy && o.kind === "extend" && o.target === policy),
    )
    .map((o) => o.path);
}

/**
 * Where `override` stands against its review date on `now`'s UTC day: `due` from 14 days before it, `expired` after
 * it, `ok` otherwise and without one.
 * @param {Override} override
 * @param {Date} now
 * @returns {"ok" | "due" | "expired"}
 */
export function reviewState(override, now) {
  if (!override.review) return "ok";
  const today = now.toISOString().slice(0, 10);
  if (override.review < today) return "expired";
  const notice = new Date(now.getTime() + REVIEW_NOTICE_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return override.review <= notice ? "due" : "ok";
}
