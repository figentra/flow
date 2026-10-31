/**
 * Vellum file contract:
 * Purpose: GitHub REST calls for the commands that act on pull requests (`vellum land`), through the `gh` CLI, and
 *   through the repository's own `bot:gh` wrapper when it has one (Figentra repositories give `gh` its token there).
 * Boundary: one `gh api` process per call; no retries. Vellum never reads, prints or passes a GitHub token: `gh` holds
 *   it.
 * Runtime: node
 * Governing contract: Stackra ADR 0503; STA-1729 phase 3.
 * Secrets: none here; the token stays inside `gh` (or the `bot:gh` wrapper's `infisical run`).
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * @typedef {{ ok: boolean, json: any, err: string }} ApiResult
 * @typedef {(method: string, path: string, body?: unknown) => ApiResult} Api
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

/**
 * The GitHub API for the repository at `root`.
 * @param {string} root
 * @returns {Api}
 */
export function github(root) {
  let wrapped = false;
  try {
    wrapped = Boolean(
      JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts?.["bot:gh"],
    );
  } catch {
    wrapped = false;
  }
  return (method, path, body) => {
    const args = [
      "api",
      "-X",
      method,
      path,
      "-H",
      "Accept: application/vnd.github+json",
      ...(body === undefined ? [] : ["--input", "-"]),
    ];
    const r = wrapped
      ? spawnSync("pnpm", ["bot:gh", "--", ...args], {
          cwd: root,
          encoding: "utf8",
          input: body === undefined ? undefined : JSON.stringify(body),
        })
      : spawnSync("gh", args, {
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
