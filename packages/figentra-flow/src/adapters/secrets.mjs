/**
 * Figentra Flow file contract:
 * Purpose: the secrets port (AC-040): wraps a command so it runs with the secrets one scope needs, without the value
 *   ever passing through this process. `env`: the command unchanged (the caller's environment holds the values);
 *   `infisical`: `infisical run --silent [--domain=…] [--projectId=…] [--env=…] --path=<the scope's path> -- <command>`.
 *   On a box with no login and no `.infisical.yaml`, `auth: "universal-auth"` logs in from the box's own
 *   `INFISICAL_UNIVERSAL_AUTH_CLIENT_ID` and `INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET`, and `projectId`, `env` and
 *   `domain` name the project, environment and instance (without `domain`, the CLI's own `INFISICAL_API_URL`).
 *   A box whose ssh shell has neither the CLI on PATH nor that identity in its environment names them: `bin` (the
 *   CLI's path) and `envFile` (a file of `INFISICAL_UNIVERSAL_AUTH_CLIENT_ID=` and `_SECRET=` lines, read in a
 *   subshell for this one command; only those two lines are taken, and only the login sees them).
 * Boundary: builds command strings for a POSIX shell on the box; runs nothing; reads no value. The access token is a
 *   command substitution assigned to `INFISICAL_TOKEN` for the `infisical run` process alone (AC-044): never an
 *   argument (a process list shows those), never in this process, the command text or a log.
 *   `store` is `app create`'s one hand-off of a new App's key, on the human's machine: `env` writes a new 0600 file
 *   at the path the human names; `infisical` writes the value to a 0600 file in a private temporary folder and runs
 *   `infisical secrets set <NAME>=@<file>` with the human's own login (the CLI reads the file, so the value is on no
 *   command line), discards the CLI's output (its table can echo values) and removes the folder.
 * Runtime: node
 * Governing contract: STA-1729 phase A (A1); Stackra ADR 0257 for our Infisical use.
 * Secrets: paths, ids and environment names only, never values.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ConfigError } from "../lib/config.mjs";

/**
 * @typedef {{ ok: boolean, problem?: string, where?: string }} Stored
 * @typedef {{ wrap: (command: string, scope: string) => string,
 *             store: (name: string, value: string, options?: { scope?: string, file?: string, spawn?: any }) => Stored }} Secrets
 */

/** A value safe to put in a shell word unquoted: a project id or an environment slug. */
const SAFE = /^[\w.-]+$/;

/** A file on the box: absolute, or under `~` or `$HOME`. */
const BOX_PATH = /^(?:~|\$HOME)?\/[\w./-]+$/;

/** The identity lines `envFile` may contribute, with any `export ` dropped so they stay unexported. */
const IDENTITY = "s/^(export[[:space:]]+)?(INFISICAL_UNIVERSAL_AUTH_CLIENT_(ID|SECRET)=)/\\2/p";

/**
 * The secrets the block names; `env` when the configuration sets none.
 * @param {any} block the configuration's `secrets`
 * @returns {Secrets}
 */
export function secretsPort(block) {
  if (block === undefined || block.kind === "env")
    return {
      wrap: (command) => command,
      store(name, value, { file } = {}) {
        if (!file)
          return {
            ok: false,
            problem: `the env secrets port stores ${name} in a file: pass --key-file <path>`,
          };
        try {
          // `wx`: never over an existing file; 0600: only its owner reads it.
          writeFileSync(file, value, { mode: 0o600, flag: "wx" });
        } catch (error) {
          return { ok: false, problem: `${file}: ${/** @type {Error} */ (error).message}` };
        }
        return { ok: true, where: file };
      },
    };
  if (block.kind === "infisical") {
    for (const key of ["projectId", "env"])
      if (block[key] !== undefined && !SAFE.test(block[key]))
        throw new ConfigError(`secrets "infisical": ${key} is not an id: ${block[key]}`);
    if (
      block.domain !== undefined &&
      !/^https:\/\/[\w.-]+(?::\d+)?(?:\/[\w./-]*)?$/.test(block.domain)
    )
      throw new ConfigError(`secrets "infisical": domain is not an https URL: ${block.domain}`);
    for (const key of ["bin", "envFile"])
      if (block[key] !== undefined && !BOX_PATH.test(block[key]))
        throw new ConfigError(`secrets "infisical": ${key} is not a box path: ${block[key]}`);
    if (block.envFile !== undefined && block.auth !== "universal-auth")
      throw new ConfigError(`secrets "infisical": envFile needs "auth": "universal-auth"`);
    const quoted = (/** @type {string} */ p) => `"${p.replace(/^~(?=\/)/, "$HOME")}"`;
    const cli = block.bin ? quoted(block.bin) : "infisical";
    // The identity reaches the login's substitution subshell alone, never the run or the wrapped command.
    const identity = block.envFile
      ? "export INFISICAL_UNIVERSAL_AUTH_CLIENT_ID INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET; "
      : "";
    const load = block.envFile ? `eval "$(sed -nE '${IDENTITY}' ${quoted(block.envFile)})"; ` : "";
    const domain = block.domain ? ` --domain=${block.domain}` : "";
    const login =
      block.auth === "universal-auth"
        ? `INFISICAL_TOKEN="$(${identity}${cli} login --method=universal-auth --silent --plain${domain})" `
        : "";
    const project = block.projectId ? ` --projectId=${block.projectId}` : "";
    const env = block.env ? ` --env=${block.env}` : "";
    const pathOf = (/** @type {string} */ scope) => {
      const path = block.paths?.[scope];
      if (!path) throw new ConfigError(`secrets "infisical": set paths.${scope}`);
      if (!/^\/[\w./-]*$/.test(path))
        throw new ConfigError(`secrets "infisical": paths.${scope} is not a path: ${path}`);
      return path;
    };
    return {
      store(name, value, { scope = "gate", spawn = spawnSync } = {}) {
        if (!/^[A-Z][A-Z0-9_]*$/.test(name))
          return { ok: false, problem: `${name} is not a secret name` };
        const path = pathOf(scope);
        const dir = mkdtempSync(join(tmpdir(), "flow-store-"));
        try {
          const file = join(dir, "value");
          writeFileSync(file, value, { mode: 0o600 });
          const args = [
            "secrets",
            "set",
            ...[domain, project, env].filter(Boolean).map((a) => a.trim()),
          ];
          const r = spawn("infisical", [...args, `--path=${path}`, `${name}=@${file}`], {
            stdio: ["ignore", "pipe", "pipe"],
            encoding: "utf8",
          });
          if (r.status === 0) return { ok: true, where: `Infisical ${path}/${name}` };
          const why = r.error ? r.error.message : `infisical exited ${r.status}`;
          return {
            ok: false,
            problem: `storing ${name} at ${path} failed (${why}); is \`infisical login\` done?`,
          };
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      },
      wrap(command, scope) {
        const path = pathOf(scope);
        const run = `${login}${cli} run --silent${domain}${project}${env} --path=${path} -- ${command}`;
        return load ? `( ${load}${run} )` : run;
      },
    };
  }
  throw new ConfigError(`secrets: unknown kind ${block.kind}`);
}
