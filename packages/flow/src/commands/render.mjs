/**
 * Figentra Flow file contract:
 * Purpose: `fflow render [--dir d] [--out o]`: the render proof of a built site (`lib/render-site.mjs`). Every page
 *   at each width in Chromium, failing on a console error, a page error, a failed request, a 4xx/5xx or a missing
 *   basic, plus the configured requests; screenshots under `out`. The `ci.render` job sets its options as JSON in
 *   `FFLOW_RENDER` (the config's entry), so no config value reaches a `run:` line; `--dir` and `--out` win.
 * Boundary: reads the built folder, writes the screenshots. Needs Playwright resolvable (`NODE_PATH`), which the job
 *   installs; exits 2 with the reason when it is not.
 * Runtime: node
 * Governing contract: the owner's "live means rendered" rule; SITE's figentra.com render job (figentra#66).
 * Secrets: none.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { ConfigError } from "../lib/config.mjs";
import { NAME, RENDER_ENV } from "../lib/product.mjs";
import { renderSite } from "../lib/render-site.mjs";

/**
 * The options: `FFLOW_RENDER`'s JSON, then the flags.
 * @param {{ dir?: string, out?: string }} flags
 * @param {Record<string, string | undefined>} env
 * @param {string} cwd
 * @returns {import("../lib/render-site.mjs").RenderOptions}
 */
export function renderOptions(flags, env, cwd) {
  /** @type {Record<string, any>} */
  let fromEnv = {};
  if (env[RENDER_ENV]) {
    try {
      fromEnv = JSON.parse(env[RENDER_ENV]);
    } catch {
      throw new ConfigError(`${RENDER_ENV} is not JSON`);
    }
  }
  const dir = flags.dir || fromEnv.dir;
  if (!dir) throw new ConfigError("no site to render: pass --dir <built folder>");
  const out = flags.out || fromEnv.out || `.${NAME}/render`;
  return {
    dir: resolve(cwd, dir),
    out: resolve(cwd, out),
    locales: fromEnv.locales,
    rtl: fromEnv.rtl,
    widths: fromEnv.widths,
    heights: fromEnv.heights,
    requests: fromEnv.requests,
  };
}

/**
 * `fflow render`.
 * @param {{ cwd: string, env: Record<string, string | undefined>, say: (line: string) => void,
 *   complain: (line: string) => void, playwright?: any }} io
 * @param {{ dir?: string, out?: string }} flags
 * @returns {Promise<number>}
 */
export async function run(io, flags) {
  const options = renderOptions(flags, io.env, io.cwd);
  if (!existsSync(options.dir)) {
    io.complain(`${NAME} render: ${options.dir} does not exist; build the site first`);
    return 2;
  }
  let result;
  try {
    result = await renderSite(options, { root: io.cwd, say: io.say, playwright: io.playwright });
  } catch (error) {
    const code = /** @type {{ code?: string }} */ (error).code;
    if (code === "MODULE_NOT_FOUND" || code === "ERR_MODULE_NOT_FOUND") {
      io.complain(
        `${NAME} render: Playwright is not installed; install it outside the workspace and put it on NODE_PATH, as the ci.render job does`,
      );
      return 2;
    }
    throw error;
  }
  if (result.pages === 0) {
    io.complain(`${NAME} render: no page (a folder with an index.html) under ${options.dir}`);
    return 1;
  }
  if (result.failures.length) {
    io.complain(`\n${result.failures.length} render(s) failed:`);
    for (const f of result.failures) {
      io.complain(`- ${f.route} (${f.at})`);
      for (const p of f.problems) io.complain(`    ${p}`);
    }
    return 1;
  }
  io.say(`\nAll ${result.renders} renders passed. Screenshots in ${options.out}`);
  return 0;
}
