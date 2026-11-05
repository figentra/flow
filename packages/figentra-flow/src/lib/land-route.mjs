#!/usr/bin/env node
/**
 * Figentra Flow file contract:
 * Purpose: the `route` job of main's approval workflow (the L2 design, PR D): whether any open PR asks for a land
 *   (`select`: labelled `LAND_LABEL`, no `HOLD_LABEL`, based on the default branch, head in this repository). It writes
 *   `any=true` or `any=false` to `GITHUB_OUTPUT`, and the keyed `approve` and `merge` jobs run only on `true`. The
 *   answer is the same for every event; it is only a hint, since those jobs read the state again.
 * Boundary: GitHub REST reads with the job's read-only token; holds no App token and no `id-token`, writes nothing to
 *   GitHub. Exits 1 only when GitHub cannot be read.
 * Runtime: node (GitHub Actions)
 * Governing contract: ADR 0523; the L2 design (route, PR D); STA-1945.
 * Secrets: `GITHUB_TOKEN` from the environment; never printed.
 */
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { rest, select } from "./approve-check.mjs";

/**
 * Finds the land requests and writes `any`.
 * @param {Record<string, string | undefined>} env
 * @param {{ read?: import("./approve-check.mjs").Rest, log?: (s: string) => void,
 *           output?: (line: string) => void }} [deps]
 * @returns {Promise<number>}
 */
export async function main(env, deps = {}) {
  const log = deps.log ?? console.log;
  const output =
    deps.output ??
    ((/** @type {string} */ line) => appendFileSync(String(env.GITHUB_OUTPUT), line));
  try {
    const prs = await select(
      deps.read ?? rest(String(env.GITHUB_TOKEN), env.GITHUB_API_URL),
      String(env.REPO),
      String(env.DEFAULT_BRANCH),
    );
    log(
      prs.length
        ? `land requests: ${prs.map((p) => `#${p.number}`).join(", ")}`
        : "no land request",
    );
    output(`any=${prs.length > 0}\n`);
    return 0;
  } catch (error) {
    log(`::error::${/** @type {Error} */ (error).message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = await main(process.env);
