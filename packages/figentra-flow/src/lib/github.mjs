/**
 * Figentra Flow file contract:
 * Purpose: GitHub REST calls for the commands that act on pull requests (`fflow land`), through `gh` with the
 *   credentials the repository's configuration names (the credentials port: `env`, `gh-user` or `wrapper`).
 * Boundary: one `gh api` process per call; no retries. Never falls back to a personal `gh` login: with no credentials
 *   configured it refuses (AC-034, AC-036). Figentra Flow never reads, prints or passes a token: `gh` or the wrapper holds it.
 * Runtime: node
 * Governing contract: STA-1729 (AC-034; phase A, A1).
 * Secrets: none here; the token stays inside `gh` or the wrapper.
 */
import { spawnSync } from "node:child_process";

import { credentialsPort } from "../adapters/credentials.mjs";
import { ConfigError, loadConfig, need } from "./config.mjs";

/**
 * @typedef {{ ok: boolean, json: any, err: string, bytes?: Buffer }} ApiResult `bytes`: the body of a `raw` call
 * @typedef {(method: string, path: string, body?: unknown, options?: { raw?: boolean }) => ApiResult} Api
 * @typedef {(command: string, args: string[], options: { cwd: string, encoding: "utf8" | "buffer",
 *   input?: string }) => { status: number | null, stdout?: string | Buffer, stderr?: string | Buffer,
 *   error?: Error }} Spawn
 */

/** The JSON body in `gh api`'s output, skipping any lines a wrapper printed before it. */
export function bodyOf(/** @type {string} */ out) {
  const at = out.search(/^[[{]/m);
  if (at < 0) return undefined;
  try {
    return JSON.parse(out.slice(at));
  } catch {
    return undefined;
  }
}

/** Raised when the repository names no usable GitHub credentials (the configuration's error). */
export const CredentialsError = ConfigError;

/**
 * The command that runs `gh` with the repository's credentials (the `api` arguments follow it), or a refusal naming
 * the fix.
 * @param {string} root
 * @param {{ env?: Record<string, string | undefined>, warn?: (s: string) => void }} [options]
 * @returns {string[]}
 */
export function ghCommand(root, { env = process.env, warn = console.error } = {}) {
  const loaded = loadConfig(root);
  for (const w of loaded.warnings) warn(w);
  return credentialsPort(need(loaded, "credentials", "a GitHub call"), { root, env }).gh;
}

/**
 * The GitHub API for the repository at `root`, with the credentials it names.
 * @param {string} root
 * @param {{ spawn?: Spawn, env?: Record<string, string | undefined>, warn?: (s: string) => void }} [options]
 * @returns {Api}
 */
export function github(
  root,
  { spawn = /** @type {Spawn} */ (/** @type {unknown} */ (spawnSync)), env, warn } = {},
) {
  const [command, ...prefix] = ghCommand(root, { env, warn });
  // `raw` keeps the body as bytes (an artifact's zip), which a utf8 decode would corrupt.
  return (method, path, body, { raw = false } = {}) => {
    const args = [
      ...prefix,
      "api",
      "-X",
      method,
      path,
      "-H",
      "Accept: application/vnd.github+json",
      ...(body === undefined ? [] : ["--input", "-"]),
    ];
    const r = spawn(command, args, {
      cwd: root,
      encoding: raw ? "buffer" : "utf8",
      maxBuffer: 64 << 20, // an artifact's zip outgrows the 1 MiB default
      input: body === undefined ? undefined : JSON.stringify(body),
    });
    const err =
      String(r.stderr ?? "")
        .split("\n")
        .filter((l) => /^gh: |HTTP \d{3}/.test(l))
        .join(" ")
        .trim() ||
      (r.error?.message ?? "");
    if (raw)
      return { ok: r.status === 0, json: undefined, err, bytes: /** @type {Buffer} */ (r.stdout) };
    return { ok: r.status === 0, json: bodyOf(String(r.stdout ?? "")), err };
  };
}
