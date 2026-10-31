/**
 * Figentra Flow file contract:
 * Purpose: the secrets port (AC-040): wraps a command so it runs with the secrets one scope needs, without the value
 *   ever passing through this process. `env`: the command unchanged (the caller's environment holds the values);
 *   `infisical`: `infisical run --silent [--domain=…] [--projectId=…] [--env=…] --path=<the scope's path> -- <command>`.
 *   On a box with no login and no `.infisical.yaml`, `auth: "universal-auth"` logs in from the box's own
 *   `INFISICAL_UNIVERSAL_AUTH_CLIENT_ID` and `INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET`, and `projectId`, `env` and
 *   `domain` name the project, environment and instance (without `domain`, the CLI's own `INFISICAL_API_URL`).
 * Boundary: builds command strings for a POSIX shell on the box; runs nothing; reads no value. The access token is a
 *   command substitution assigned to `INFISICAL_TOKEN` for the `infisical run` process alone (AC-044): never an
 *   argument (a process list shows those), never in this process, the command text or a log.
 *   `store` (the one-time hand-off of `app create`) arrives with A4.
 * Runtime: node
 * Governing contract: STA-1729 phase A (A1); Stackra ADR 0257 for our Infisical use.
 * Secrets: paths, ids and environment names only, never values.
 */
import { ConfigError } from "../lib/config.mjs";

/**
 * @typedef {{ wrap: (command: string, scope: string) => string }} Secrets
 */

/** A value safe to put in a shell word unquoted: a project id or an environment slug. */
const SAFE = /^[\w.-]+$/;

/**
 * The secrets the block names; `env` when the configuration sets none.
 * @param {any} block the configuration's `secrets`
 * @returns {Secrets}
 */
export function secretsPort(block) {
  if (block === undefined || block.kind === "env") return { wrap: (command) => command };
  if (block.kind === "infisical") {
    for (const key of ["projectId", "env"])
      if (block[key] !== undefined && !SAFE.test(block[key]))
        throw new ConfigError(`secrets "infisical": ${key} is not an id: ${block[key]}`);
    if (
      block.domain !== undefined &&
      !/^https:\/\/[\w.-]+(?::\d+)?(?:\/[\w./-]*)?$/.test(block.domain)
    )
      throw new ConfigError(`secrets "infisical": domain is not an https URL: ${block.domain}`);
    const domain = block.domain ? ` --domain=${block.domain}` : "";
    const login =
      block.auth === "universal-auth"
        ? `INFISICAL_TOKEN="$(infisical login --method=universal-auth --silent --plain${domain})" `
        : "";
    const project = block.projectId ? ` --projectId=${block.projectId}` : "";
    const env = block.env ? ` --env=${block.env}` : "";
    return {
      wrap(command, scope) {
        const path = block.paths?.[scope];
        if (!path) throw new ConfigError(`secrets "infisical": set paths.${scope}`);
        if (!/^\/[\w./-]*$/.test(path))
          throw new ConfigError(`secrets "infisical": paths.${scope} is not a path: ${path}`);
        return `${login}infisical run --silent${domain}${project}${env} --path=${path} -- ${command}`;
      },
    };
  }
  throw new ConfigError(`secrets: unknown kind ${block.kind}`);
}
