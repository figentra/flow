/**
 * Vellum file contract:
 * Purpose: the credentials port (AC-034, AC-036): the command prefixes that run `gh` (GitHub API calls) and network
 *   `git` with the credentials the configuration names. `env`: `gh` and `git` with `GH_TOKEN` or `GITHUB_TOKEN` set
 *   by the caller; `gh-user`: the caller's own `gh` login and git credentials, chosen on purpose; `wrapper`: the
 *   repository's own commands that supply a bot's credentials (Figentra's `pnpm bot:gh --` and `pnpm bot:git --`).
 * Boundary: builds argument lists; runs nothing. Never falls back to a personal login: a missing block, an unset
 *   token for `env`, or a `pnpm <script>` wrapper the repository lacks is refused, naming the fix.
 * Runtime: node
 * Governing contract: STA-1729 phase A (A1).
 * Secrets: names environment variables only; never reads a token's value beyond checking that it is set.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ConfigError } from "../lib/config.mjs";
import { CONFIG_FILE } from "../lib/product.mjs";

/**
 * @typedef {{ gh: string[], git: string[] | undefined }} Credentials
 */

/** Refuses a `pnpm <script> …` wrapper whose script the repository does not have. */
function checkScript(/** @type {string[] | undefined} */ prefix, /** @type {string} */ root) {
  if (prefix?.[0] !== "pnpm" || prefix[1] === undefined) return;
  let scripts = {};
  try {
    scripts = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts ?? {};
  } catch {
    // no package.json: no scripts
  }
  if (!(prefix[1] in scripts))
    throw new ConfigError(
      `credentials: the wrapper \`${prefix[1]}\` is not a script in ${join(root, "package.json")}`,
    );
}

/**
 * The credentials the block names.
 * @param {any} block the configuration's `credentials`
 * @param {{ root: string, env?: Record<string, string | undefined> }} context
 * @returns {Credentials}
 */
export function credentialsPort(block, { root, env = process.env }) {
  switch (block?.kind) {
    case "env":
      if (!env.GH_TOKEN && !env.GITHUB_TOKEN)
        throw new ConfigError(
          'credentials "env": set GH_TOKEN (or GITHUB_TOKEN) in the environment that runs the command',
        );
      return { gh: ["gh"], git: ["git"] };
    case "gh-user":
      return { gh: ["gh"], git: ["git"] };
    case "wrapper":
      checkScript(block.gh, root);
      checkScript(block.git, root);
      return { gh: block.gh, git: block.git };
    default:
      throw new ConfigError(
        `credentials: set "credentials" in ${CONFIG_FILE} (env, gh-user or wrapper)`,
      );
  }
}
