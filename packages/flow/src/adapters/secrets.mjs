/**
 * Figentra Flow file contract:
 * Purpose: the secrets port (AC-040): a command that needs a secret reads it from its own process environment, which
 *   the caller fills; Flow fetches no value. `wrap` leaves a command unchanged for every kind. Who fills the
 *   environment: in CI, a decrypt step before Flow runs (`sops`: the `secrets.oidc.decrypt` action the approval
 *   workflow renders, Stackra ADR 0525); on a workstation or a box, the caller's runner (for Stackra, core's
 *   `node tools/scripts/secrets-exec.mjs --names A,B -- <command>`). `infisical` is retired: it is still read, as
 *   `env`, and `loadConfig` warns.
 * Boundary: builds no secret lookup; runs nothing but git; reads no value. `store` is `app create`'s one hand-off of
 *   a new App's key, on the human's machine: it writes a new 0600 file at the path the human names, refusing one
 *   inside a git work tree that git does not ignore (so the key cannot be committed by accident); the human then puts
 *   it in the secret store (for Stackra, `pnpm secrets:put` in core) and deletes the file.
 * Runtime: node
 * Governing contract: STA-1729 phase A (A1); Stackra ADR 0525 (sops replaces Infisical).
 * Secrets: names and file paths only, never values.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

import { ConfigError } from "../lib/config.mjs";

/**
 * @typedef {{ ok: boolean, problem?: string, where?: string }} Stored
 * @typedef {{ wrap: (command: string, scope: string) => string,
 *             store: (name: string, value: string, options?: { scope?: string, file?: string }) => Stored }} Secrets
 */

/** The kinds the port reads; each takes its values from the environment. */
const KINDS = ["env", "sops", "infisical"];

/**
 * Why a key file may not be written at `file`: it lies inside a git work tree and git does not ignore it.
 * @param {string} file
 * @returns {string | undefined}
 */
export function trackable(file) {
  const dir = dirname(resolve(file));
  const inside = spawnSync("git", ["-C", dir, "rev-parse", "--is-inside-work-tree"], {
    encoding: "utf8",
  });
  if (inside.status !== 0 || inside.stdout.trim() !== "true") return undefined;
  // Relative to its own folder, so a symlinked temp path (/var vs /private/var) cannot confuse git.
  const ignored = spawnSync("git", ["-C", dir, "check-ignore", "-q", "--", basename(file)]);
  return ignored.status === 0
    ? undefined
    : `${file} is inside a git work tree and not ignored; write the key outside the repository`;
}

/**
 * The secrets the block names; `env` when the configuration sets none.
 * @param {any} block the configuration's `secrets`
 * @returns {Secrets}
 */
export function secretsPort(block) {
  if (block !== undefined && !KINDS.includes(block.kind))
    throw new ConfigError(`secrets: unknown kind ${block.kind}`);
  return {
    wrap: (command) => command,
    store(name, value, { file } = {}) {
      if (!file)
        return {
          ok: false,
          problem: `the secrets port stores ${name} in a file: pass --key-file <path>`,
        };
      const tracked = trackable(file);
      if (tracked) return { ok: false, problem: tracked };
      try {
        // `wx`: never over an existing file; 0600: only its owner reads it.
        writeFileSync(file, value, { mode: 0o600, flag: "wx" });
      } catch (error) {
        return { ok: false, problem: `${file}: ${/** @type {Error} */ (error).message}` };
      }
      return { ok: true, where: file };
    },
  };
}
