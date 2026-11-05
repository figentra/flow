/**
 * Figentra Flow file contract:
 * Purpose: `lefthook.yml` and the `mise.toml` tool pins (STA-1945 FR-7, AC-8). The preset's `surfaces/lefthook.yml`
 *   holds the hook jobs as core proved them (STA-1865, os#112), under the hook rule of STA-2039: oxfmt and oxlint run
 *   the mise-pinned binary, named in `mise exec`, and the stackra preset skips them with a note where mise is missing
 *   (no `pnpm exec` fallback: pnpm 12's exec installs); oxfmt's `--no-error-on-unmatched-pattern` passes an
 *   all-ignored staged set and its exit 2 (a file it cannot parse) fails, commitlint skips without
 *   `node_modules/.bin/commitlint`, and oxlint skips when its config extends `@stackra/oxlint-config` and no workspace
 *   install has it. The configuration's `lefthook` adds its own jobs per hook after the preset's. Every
 *   pre-push job, the preset's and the configuration's, skips only on the registry's 401 (pnpm's metadata fetch or its
 *   lockfile supply-chain check on a machine with no read token, STA-1936), the 401 on the error's own line; any
 *   other failure still blocks the push. A configured pre-push job must have a `run`, which is what gets wrapped.
 *   `pinTools` sets the `npm:oxfmt` and `npm:oxlint` pins of `mise.toml` to the catalog's versions and touches no
 *   other line.
 * Boundary: reads the preset's file; returns text, writes nothing (`sync` writes).
 * Runtime: node
 * Governing contract: STA-1945 (FR-7, AC-8, P-011); Stackra STA-1865; STA-2039; os#112.
 * Secrets: none.
 */
import { ConfigError } from "./config.mjs";
import { surfaceYaml } from "./flow-dir.mjs";
import { CONFIG_FILE } from "./product.mjs";
import { stringifyYaml } from "./yaml.mjs";

/** The rendered file. */
export const LEFTHOOK_FILE = "lefthook.yml";

/** The two tools the hooks run through mise, by their `mise.toml` key. */
const TOOLS = /** @type {const} */ (["oxfmt", "oxlint"]);

/**
 * One line of pnpm's output that reports the registry's 401: its 401 code, or its metadata fetch or lockfile
 * supply-chain check failing with status 401 on that same line (a 500 with `401` in a URL does not match).
 */
const NO_REGISTRY =
  "ERR_PNPM_FETCH_401|(ERR_PNPM_META_FETCH_FAIL|Lockfile failed supply-chain policy check).*[^0-9]401([^0-9]|$)";

/**
 * A pre-push command that passes only when it failed on the registry's 401, saying so; its output is kept.
 * @param {string} run
 */
export function skipOnRegistry401(run) {
  return [
    `out="$( {`,
    run.replace(/\n$/, ""),
    `} 2>&1 )"; s=$?`,
    `printf '%s\\n' "$out"`,
    `if [ $s -ne 0 ] && printf '%s' "$out" | grep -qE '${NO_REGISTRY}'; then`,
    `  echo "pre-push skipped: pnpm cannot read the registry on this machine (401); the PR must cite a box run for this commit"`,
    `  exit 0`,
    `fi`,
    `exit $s`,
    ``,
  ].join("\n");
}

/**
 * `lefthook.yml`, or nothing when the preset has no `surfaces/lefthook.yml`.
 * @param {import("./render.mjs").RenderContext} ctx
 * @returns {Map<string, string>}
 */
export function renderLefthook(ctx) {
  const preset = surfaceYaml(ctx.presetDir, LEFTHOOK_FILE);
  if (preset === undefined) return new Map();
  /** @type {Record<string, any>} */
  const hooks = { ...preset };
  for (const [hook, jobs] of Object.entries(ctx.config.lefthook ?? {})) {
    if (!Array.isArray(jobs))
      throw new ConfigError(`${CONFIG_FILE}: lefthook.${hook} must be a list of jobs`);
    // Only a `run` can be wrapped in the 401 skip; a `script` or `group` job would block on it.
    if (hook === "pre-push")
      for (const job of jobs)
        if (typeof job?.run !== "string")
          throw new ConfigError(
            `${CONFIG_FILE}: lefthook.pre-push job "${job?.name ?? "?"}" needs a \`run\` command`,
          );
    hooks[hook] = { ...hooks[hook], jobs: [...(hooks[hook]?.jobs ?? []), ...jobs] };
  }
  if (hooks["pre-push"]?.jobs)
    hooks["pre-push"] = {
      ...hooks["pre-push"],
      jobs: hooks["pre-push"].jobs.map((/** @type {Record<string, any>} */ job) =>
        typeof job.run === "string" ? { ...job, run: skipOnRegistry401(job.run) } : job,
      ),
    };
  return new Map([[LEFTHOOK_FILE, stringifyYaml(hooks)]]);
}

/**
 * The catalog's oxfmt and oxlint versions from `pnpm-workspace.yaml`'s `catalog:` or `catalogs:`, or undefined
 * when it lacks either.
 * @param {string} workspaceYaml
 * @returns {{ oxfmt: string, oxlint: string } | undefined}
 */
export function catalogPins(workspaceYaml) {
  /** @type {Record<string, string>} */
  const pins = {};
  let inCatalog = false;
  for (const line of workspaceYaml.split(/\r?\n/)) {
    if (/^[^\s#]/.test(line)) inCatalog = /^catalogs?:/.test(line);
    const m = inCatalog ? line.match(/^\s+["']?(oxfmt|oxlint)["']?:\s*["']?([^\s"'#]+)/) : null;
    if (m) pins[m[1]] ??= m[2];
  }
  return pins.oxfmt && pins.oxlint ? { oxfmt: pins.oxfmt, oxlint: pins.oxlint } : undefined;
}

/**
 * `miseToml` with `"npm:oxfmt"` and `"npm:oxlint"` at the catalog's versions: a pin that differs is rewritten in
 * place (its comment kept), a missing one is added under `[tools]`, and no other line changes.
 * @param {string} miseToml
 * @param {{ oxfmt: string, oxlint: string }} catalog
 * @returns {string}
 */
export function pinTools(miseToml, catalog) {
  let text = miseToml;
  /** @type {string[]} */
  const missing = [];
  for (const tool of TOOLS) {
    const pin = new RegExp(`^([ \\t]*["']npm:${tool}["'][ \\t]*=[ \\t]*)["'][^"']*["']`, "m");
    if (pin.test(text)) text = text.replace(pin, `$1"${catalog[tool]}"`);
    else missing.push(`"npm:${tool}" = "${catalog[tool]}"`);
  }
  if (!missing.length) return text;
  const tools = text.match(/^\[tools\][^\n]*(?:\n|$)/m);
  if (!tools) {
    const gap = !text ? "" : text.endsWith("\n") ? "\n" : "\n\n";
    return `${text}${gap}[tools]\n${missing.join("\n")}\n`;
  }
  const at = /** @type {number} */ (tools.index) + tools[0].length;
  const head = tools[0].endsWith("\n") ? "" : "\n";
  return `${text.slice(0, at)}${head}${missing.join("\n")}\n${text.slice(at)}`;
}
