/**
 * Vellum file contract:
 * Purpose: GitHub REST calls for the commands that act on pull requests (`vellum land`), through `gh`, with the
 *   credentials the repository names: `"vellum": { "credentials": "wrapper:<script>" }` runs `pnpm <script> -- api …`
 *   (a script that runs `gh` with a bot's token, such as Figentra's `bot:gh`), and `"credentials": "gh-user"` runs the
 *   caller's own `gh` login, for a solo user who opts in.
 * Boundary: one `gh api` process per call; no retries. Never falls back to a personal `gh` login: with no credentials
 *   named, or a wrapper script the repository lacks, it refuses (AC-034). Vellum never reads, prints or passes a
 *   token: `gh` or the wrapper holds it.
 * Runtime: node
 * Governing contract: Stackra ADR 0503; STA-1729 (the leader's credentials rule of 2026-10-31; the adapter phase
 *   moves this setting into `vellum.config`).
 * Secrets: none here; the token stays inside `gh` or the wrapper's `infisical run`.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * @typedef {{ ok: boolean, json: any, err: string }} ApiResult
 * @typedef {(method: string, path: string, body?: unknown) => ApiResult} Api
 * @typedef {(command: string, args: string[], options: { cwd: string, encoding: "utf8", input?: string }) =>
 *   { status: number | null, stdout?: string, stderr?: string, error?: Error }} Spawn
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

/** Raised when the repository names no usable GitHub credentials. */
export class CredentialsError extends Error {}

/**
 * The command that runs `gh` with the repository's credentials (the `api` arguments follow it), or a refusal naming
 * the fix.
 * @param {string} root
 * @returns {string[]}
 */
export function ghCommand(root) {
  /** @type {any} */
  let pkg = {};
  try {
    pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  } catch {
    // no package.json: no credentials named
  }
  const credentials = pkg.vellum?.credentials;
  if (credentials === "gh-user") return ["gh"];
  const script =
    typeof credentials === "string" ? credentials.match(/^wrapper:(\S+)$/)?.[1] : undefined;
  if (script && pkg.scripts?.[script]) return ["pnpm", script, "--"];
  if (script)
    throw new CredentialsError(
      `the credentials wrapper \`${script}\` is not a script in ${join(root, "package.json")}`,
    );
  throw new CredentialsError(
    'no GitHub credentials named: set package.json "vellum": { "credentials": "wrapper:<script>" } (a script that runs gh with a bot\'s token, such as bot:gh), or "gh-user" to use your own gh login on purpose',
  );
}

/**
 * The GitHub API for the repository at `root`, with the credentials it names.
 * @param {string} root
 * @param {{ spawn?: Spawn }} [options]
 * @returns {Api}
 */
export function github(
  root,
  { spawn = /** @type {Spawn} */ (/** @type {unknown} */ (spawnSync)) } = {},
) {
  const [command, ...prefix] = ghCommand(root);
  return (method, path, body) => {
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
      encoding: "utf8",
      input: body === undefined ? undefined : JSON.stringify(body),
    });
    const err =
      (r.stderr ?? "")
        .split("\n")
        .filter((l) => /^gh: |HTTP \d{3}/.test(l))
        .join(" ")
        .trim() ||
      (r.error?.message ?? "");
    return { ok: r.status === 0, json: bodyOf(r.stdout ?? ""), err };
  };
}
