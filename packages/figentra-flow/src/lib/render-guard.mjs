/**
 * Figentra Flow file contract:
 * Purpose: `.agents/hooks/fflow-guard.mjs` (STA-1945 NFR-2 as amended by A-8, STA-2131): the guard as one
 *   self-contained file in the repository, so it runs on a checkout with no install. It carries the guard engine's
 *   modules and the preset's guard tables (the preset's `bash-rules.mjs`, `path-rules.mjs` and `hints.mjs`, each
 *   the neutral preset's when the preset has none, with every module they import) as source text, and serves them
 *   from memory through `node:module`'s `registerHooks`; it imports only `node:` modules. The Claude Code hooks
 *   (`render-settings.mjs`) and the OpenCode guard plugin run it. `sync` writes it and the lock records its digest,
 *   so `check` names a hand edit.
 * Boundary: reads the package's and the preset's modules; returns text, writes nothing (`sync` writes).
 * Runtime: node
 * Governing contract: STA-1945 (FR-5, FR-7, NFR-2, A-8); STA-2131.
 * Secrets: none.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { TABLE_FILES, tableFile } from "../guard/tables.mjs";
import { ConfigError } from "./config.mjs";
import { NAME, PACKAGE } from "./product.mjs";

/** The rendered file. */
export const GUARD_FILE = `.agents/hooks/${NAME}-guard.mjs`;

/** The package's folder. Nothing is read from it at load: the bundle carries this module too (`render.mjs`). */
const HOME = fileURLToPath(new URL("../../", import.meta.url));

/**
 * The package's own exports by bare specifier (`@figentra-oss/flow/guard`), as package-relative paths.
 * @param {string} manifest `package.json`'s text
 * @returns {Record<string, string>}
 */
const exportsOf = (manifest) =>
  Object.fromEntries(
    Object.entries(JSON.parse(manifest).exports)
      .filter(([, to]) => typeof to?.default === "string")
      .map(([at, to]) => [`${PACKAGE}${at.slice(1)}`, to.default.slice(2)]),
  );

/** A static or dynamic import's specifier; a match in a comment or a string only adds a file that exists. */
const SPECIFIER = /\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

/** The one line of `product.mjs` the bundle replaces: it reads `package.json`, which has no copy beside the bundle. */
const READS_MANIFEST =
  'JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"))';

/**
 * The bundle's runtime, written into it as source: serves `files` (path to text) as modules under the folder `base`
 * (a URL nothing is read from), `bare` (specifier to path) among them, then runs the engine for `event` on the tables
 * `guard` (table file to path) names. Self-contained: it may use only its arguments.
 * @param {Record<string, string>} files
 * @param {Record<string, string>} bare
 * @param {Record<string, string>} guard
 * @param {string} event
 * @param {typeof import("node:module").registerHooks} registerHooks
 * @param {string} base
 * @returns {Promise<number>}
 */
export async function boot(files, bare, guard, event, registerHooks, base) {
  const url = (/** @type {string} */ path) => new URL(path, base).href;
  const sources = new Map(Object.entries(files).map(([path, text]) => [url(path), text]));
  registerHooks({
    resolve(specifier, context, next) {
      const to = bare[specifier]
        ? url(bare[specifier])
        : /^(\.\.?\/|file:)/.test(specifier)
          ? new URL(specifier, context.parentURL).href
          : "";
      return sources.has(to) ? { url: to, shortCircuit: true } : next(specifier, context);
    },
    load(href, context, next) {
      const source = sources.get(href);
      return source === undefined
        ? next(href, context)
        : { format: "module", source, shortCircuit: true };
    },
  });
  const { main } = await import(url("src/guard/engine.mjs"));
  return main(event, async (/** @type {string} */ file) =>
    guard[file] ? import(url(guard[file])) : undefined,
  );
}

/**
 * The bundle's path for a module: package-relative for the package's own, `preset/…` for a preset's.
 * @param {string} file
 * @param {string} presetDir
 */
function pathOf(file, presetDir) {
  const own = relative(HOME, file);
  if (!own.startsWith("..")) return own.split(sep).join("/");
  const rel = relative(presetDir, file);
  if (rel.startsWith(".."))
    throw new ConfigError(`${file}: a preset's guard module imports from outside the preset`);
  return `preset/${rel.split(sep).join("/")}`;
}

/**
 * Adds `file` and every module it imports (relative or by the package's `exports`) to `files`.
 * @param {string} file
 * @param {{ presetDir: string, exports: Record<string, string>, files: Record<string, string> }} into
 */
function collect(file, into) {
  const path = pathOf(file, into.presetDir);
  if (path in into.files) return;
  const text = readFileSync(file, "utf8");
  into.files[path] = text;
  for (const [, specifier] of text.matchAll(SPECIFIER)) {
    const to = specifier.startsWith(".")
      ? resolve(dirname(file), specifier)
      : into.exports[specifier] && join(HOME, into.exports[specifier]);
    if (to && /\.m?js$/.test(to) && existsSync(to)) collect(to, into);
  }
}

/**
 * The bundle's text for the preset at `presetDir`.
 * @param {string} presetDir
 * @returns {string}
 */
export function guardBundle(presetDir) {
  const manifest = readFileSync(join(HOME, "package.json"), "utf8");
  const into = {
    presetDir,
    exports: exportsOf(manifest),
    files: /** @type {Record<string, string>} */ ({}),
  };
  const { files } = into;
  collect(join(HOME, "src/guard/engine.mjs"), into);
  /** @type {Record<string, string>} */
  const guard = {};
  for (const name of TABLE_FILES) {
    const file = tableFile(join(presetDir, "guard"), name);
    if (!file) continue;
    collect(file, into);
    guard[name] = pathOf(file, presetDir);
  }
  const product = files["src/lib/product.mjs"];
  if (!product?.includes(READS_MANIFEST))
    throw new Error("src/lib/product.mjs no longer reads package.json as the guard bundle expects");
  files["src/lib/product.mjs"] = product.replace(READS_MANIFEST, () => manifest.trim());
  const bare = Object.fromEntries(Object.entries(into.exports).filter(([, path]) => path in files));
  return `// The guard, self-contained (STA-1945 NFR-2, A-8): \`node ${GUARD_FILE} <event>\` runs with no install.
import { registerHooks } from "node:module";

process.exit(
  await (${boot})(
    ${JSON.stringify(files)},
    ${JSON.stringify(bare)},
    ${JSON.stringify(guard)},
    process.argv[2] ?? "",
    registerHooks,
    new URL("./${NAME}-guard/", import.meta.url).href,
  ),
);
`;
}

/**
 * The guard bundle, when the preset wires a guard (its `surfaces/settings.json` or `surfaces/opencode/`).
 * @param {import("./render.mjs").RenderContext} ctx
 * @returns {Map<string, string>}
 */
export function renderGuard(ctx) {
  const surfaces = join(ctx.presetDir, "surfaces");
  if (!existsSync(join(surfaces, "settings.json")) && !existsSync(join(surfaces, "opencode")))
    return new Map();
  return new Map([[GUARD_FILE, guardBundle(ctx.presetDir)]]);
}
