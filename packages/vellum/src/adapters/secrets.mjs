/**
 * Vellum file contract:
 * Purpose: the secrets port (AC-040): wraps a command so it runs with the secrets one scope needs, without the value
 *   ever passing through this process. `env`: the command unchanged (the caller's environment holds the values);
 *   `infisical`: `infisical run --silent --path=<the scope's path> -- <command>`.
 * Boundary: builds command strings for a POSIX shell on the box; runs nothing; reads no value. `store` (the one-time
 *   hand-off of `app create`) arrives with A4.
 * Runtime: node
 * Governing contract: STA-1729 phase A (A1); Stackra ADR 0257 for our Infisical use.
 * Secrets: paths only, never values.
 */
import { ConfigError } from "../lib/config.mjs";

/**
 * @typedef {{ wrap: (command: string, scope: string) => string }} Secrets
 */

/**
 * The secrets the block names; `env` when the configuration sets none.
 * @param {any} block the configuration's `secrets`
 * @returns {Secrets}
 */
export function secretsPort(block) {
  if (block === undefined || block.kind === "env") return { wrap: (command) => command };
  if (block.kind === "infisical")
    return {
      wrap(command, scope) {
        const path = block.paths?.[scope];
        if (!path) throw new ConfigError(`secrets "infisical": set paths.${scope}`);
        if (!/^\/[\w./-]*$/.test(path))
          throw new ConfigError(`secrets "infisical": paths.${scope} is not a path: ${path}`);
        return `infisical run --silent --path=${path} -- ${command}`;
      },
    };
  throw new ConfigError(`secrets: unknown kind ${block.kind}`);
}
