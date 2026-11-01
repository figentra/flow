/**
 * Figentra Flow file contract:
 * Purpose: the repository's `README.md`, rendered from its data file `.flow/readme.yml` through the preset's
 *   `readme-template` (STA-1879): one layout for every repository, the content its own. The badges, the licence (read
 *   from `LICENSE` unless the data names one) and the status colour are computed here so the template holds layout
 *   only; `fill` is the small Mustache subset the template uses (`{{name}}`, `{{#name}}…{{/name}}`, `{{^name}}…{{/name}}`).
 * Boundary: reads the data file, the template and `LICENSE`; never writes (`readme` and `sync` write).
 * Runtime: node
 * Governing contract: STA-1879.
 * Secrets: none.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ConfigError, loadConfig } from "./config.mjs";
import { FLOW_DIR, OVERRIDES, resolveTemplate } from "./flow-dir.mjs";
import { NAME } from "./product.mjs";
import { parseYaml } from "./yaml.mjs";

/** The repository's README data. */
export const README_DATA = `${FLOW_DIR}/readme.yml`;

/** The status values, as `products/README.md` defines them, with their badge colours. */
export const STATUSES = { Live: "brightgreen", "In progress": "orange", Planned: "lightgrey" };

const REQUIRED = ["name", "repo", "tagline", "status", "what", "quickstart", "architecture"];
const OPTIONAL = [
  "statusNote",
  "banner",
  "licence",
  "ci",
  "package",
  "docs",
  "playground",
  "site",
  "development",
  "release",
];

/** A shields.io static badge (`-` and `_` are doubled, as shields reads them as separators). */
const shield = (
  /** @type {string} */ label,
  /** @type {string} */ message,
  /** @type {string} */ color,
) =>
  `https://img.shields.io/badge/${[label, message]
    .map((s) => encodeURIComponent(s.replaceAll("-", "--").replaceAll("_", "__")))
    .join("-")}-${color}`;

/**
 * Fills `template` from `view`: `{{name}}` is the value (no escaping: the README is Markdown), `{{#name}}…{{/name}}`
 * renders once per array item, once with an object pushed on the lookup stack, or once when truthy, and
 * `{{^name}}…{{/name}}` renders when falsy or empty. A newline right after a section tag is dropped.
 * @param {string} template
 * @param {Record<string, unknown>} view
 */
export function fill(template, view) {
  /**
   * @param {unknown[]} stack
   * @param {string} name
   */
  const lookup = (stack, name) => {
    for (let i = stack.length - 1; i >= 0; i--) {
      const frame = /** @type {Record<string, unknown> | undefined} */ (stack[i]);
      if (frame && typeof frame === "object" && name in frame) return frame[name];
    }
    return undefined;
  };
  /**
   * @param {string} text
   * @param {unknown[]} stack
   * @returns {string}
   */
  const walk = (text, stack) =>
    text.replace(
      /\{\{([#^])(\w+)\}\}\n?([\s\S]*?)\{\{\/\2\}\}\n?|\{\{(\w+)\}\}/g,
      (_, kind, section, body, name) => {
        if (name) return String(lookup(stack, name) ?? "").replace(/\n+$/, "");
        const value = lookup(stack, section);
        const empty = !value || (Array.isArray(value) && value.length === 0);
        if (kind === "^") return empty ? walk(body, stack) : "";
        if (empty) return "";
        if (Array.isArray(value)) return value.map((item) => walk(body, [...stack, item])).join("");
        return walk(body, typeof value === "object" ? [...stack, value] : stack);
      },
    );
  return walk(template, [view]);
}

/**
 * The problems in a README data object: a missing or unknown key, or a status outside `STATUSES`.
 * @param {Record<string, unknown>} data
 * @returns {string[]}
 */
export function readmeProblems(data) {
  const problems = REQUIRED.filter((k) => typeof data[k] !== "string" || !data[k]).map(
    (k) => `${README_DATA}: "${k}" is required`,
  );
  for (const k of Object.keys(data))
    if (!REQUIRED.includes(k) && !OPTIONAL.includes(k))
      problems.push(`${README_DATA}: "${k}" is not a README field`);
  if (typeof data.status === "string" && !(data.status in STATUSES))
    problems.push(`${README_DATA}: "status" is one of ${Object.keys(STATUSES).join(", ")}`);
  const banner = /** @type {Record<string, unknown> | undefined} */ (data.banner);
  if (
    banner !== undefined &&
    (typeof banner?.light !== "string" || typeof banner?.dark !== "string")
  )
    problems.push(`${README_DATA}: "banner" has "light" and "dark" image paths`);
  return problems;
}

/**
 * The licence a repository carries: `MIT` when its `LICENSE` is the MIT text, else `Proprietary`.
 * @param {string} root
 */
export function detectLicence(root) {
  const file = join(root, "LICENSE");
  if (!existsSync(file)) return { licence: "Proprietary", file: false };
  return {
    licence: readFileSync(file, "utf8").startsWith("MIT License") ? "MIT" : "Proprietary",
    file: true,
  };
}

/**
 * The template's view: the data plus the badges, the licence and the links.
 * @param {string} root
 * @param {Record<string, any>} data
 */
export function readmeView(root, data) {
  const detected = detectLicence(root);
  const licence = data.licence ?? detected.licence;
  const github = `https://github.com/${data.repo}`;
  const ci = data.ci ?? "ci.yml";
  const badges = [
    {
      alt: "CI",
      href: `${github}/actions/workflows/${ci}`,
      src: `${github}/actions/workflows/${ci}/badge.svg?branch=main`,
    },
    {
      alt: "Release",
      href: `${github}/releases/latest`,
      src: shield("release", data.package ?? "latest", "blue"),
    },
    {
      alt: `Licence: ${licence}`,
      href: detected.file ? `${github}/blob/main/LICENSE` : github,
      src: shield("licence", licence, licence === "MIT" ? "green" : "555"),
    },
    {
      alt: `Status: ${data.status}`,
      href: `${github}#status`,
      src: shield(
        "status",
        data.status,
        STATUSES[/** @type {keyof typeof STATUSES} */ (data.status)],
      ),
    },
    ...(data.docs ? [{ alt: "Docs", href: data.docs, src: shield("docs", "read", "0a7bd6") }] : []),
    ...(data.playground
      ? [{ alt: "Playground", href: data.playground, src: shield("playground", "open", "8a3ffc") }]
      : []),
  ];
  const links = [
    ...(data.docs ? [{ label: "Docs", url: data.docs }] : []),
    ...(data.playground ? [{ label: "Playground", url: data.playground }] : []),
    ...(data.site ? [{ label: "Site", url: data.site }] : []),
  ];
  return {
    ...data,
    github,
    badges,
    links,
    licence,
    mit: licence === "MIT",
    licenceFile: detected.file,
  };
}

/**
 * The README rendered for `root`, or undefined when it has no `.flow/readme.yml`. An invalid data file, or a preset
 * without a `readme-template`, is a `ConfigError` naming the problem.
 * @param {string} root
 * @returns {string | undefined}
 */
export function renderReadme(root) {
  const file = join(root, README_DATA);
  if (!existsSync(file)) return undefined;
  const data = /** @type {Record<string, any>} */ (parseYaml(readFileSync(file, "utf8")) ?? {});
  const problems = readmeProblems(data);
  if (problems.length > 0) throw new ConfigError(problems.join("; "));
  const template = resolveTemplate(root, "readme-template");
  if (!template)
    throw new ConfigError(
      `the "${loadConfig(root).config.preset ?? "neutral"}" preset has no readme-template; set "preset": "stackra" or add ${OVERRIDES}/readme-template.md (${NAME} readme)`,
    );
  const text = fill(readFileSync(template, "utf8"), readmeView(root, data));
  return `${text.replace(/\n{3,}/g, "\n\n").trim()}\n`;
}
