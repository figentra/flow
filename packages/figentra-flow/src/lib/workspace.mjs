/**
 * Figentra Flow file contract:
 * Purpose: the workspace list, `~/.config/figentra-flow/workspace.yaml` (`FIGENTRA_FLOW_WORKSPACE` overrides the path): every
 *   repository Figentra Flow acts on with `--all`, each with its folder and GitHub slug; and finding the repositories under
 *   some folders to write it.
 * Boundary: reads and writes that one file; the YAML is the small fixed shape below, so no YAML library is needed.
 * Runtime: node
 * Governing contract: Stackra ADR 0503; STA-1729.
 * Secrets: none.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { git } from "./git.mjs";
import { DISPLAY_NAME, ENV_PREFIX, NAME, USER_DIR } from "./product.mjs";

/** The workspace file's path. */
export const workspaceFile = (
  /** @type {Record<string, string | undefined>} */ env = process.env,
) => env[`${ENV_PREFIX}WORKSPACE`] ?? join(homedir(), ...USER_DIR, "workspace.yaml");

/**
 * @typedef {{ path: string, github: string }} Repo
 */

/**
 * The repositories of the workspace list; none when the file is missing.
 * @param {string} [file]
 * @returns {Repo[]}
 */
export function readWorkspace(file = workspaceFile()) {
  if (!existsSync(file)) return [];
  /** @type {Repo[]} */
  const repos = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const path = line.match(/^\s*-\s*path:\s*(.+?)\s*$/)?.[1];
    if (path !== undefined) repos.push({ path: path.replace(/^"|"$/g, ""), github: "" });
    const github = line.match(/^\s+github:\s*(.+?)\s*$/)?.[1];
    if (github !== undefined && repos.length)
      repos[repos.length - 1].github = github.replace(/^"|"$/g, "");
  }
  return repos;
}

/**
 * Writes the workspace list.
 * @param {Repo[]} repos
 * @param {string} [file]
 */
export function writeWorkspace(repos, file = workspaceFile()) {
  mkdirSync(dirname(file), { recursive: true });
  const body = repos.map(
    (r) => `  - path: ${JSON.stringify(r.path)}\n    github: ${JSON.stringify(r.github)}`,
  );
  writeFileSync(
    file,
    `# ${DISPLAY_NAME} workspace: the repositories \`--all\` acts on (${NAME} init --workspace).\nrepos:\n${body.join("\n")}\n`,
  );
}

/**
 * The git repositories directly under each folder (and the folders themselves), with their GitHub slug. A linked
 * worktree (`.git` is a file) is not a repository.
 * @param {string[]} dirs
 * @returns {Repo[]}
 */
export function findRepos(dirs) {
  /** @type {Repo[]} */
  const repos = [];
  const add = (/** @type {string} */ path) => {
    if (!existsSync(join(path, ".git")) || !statSync(join(path, ".git")).isDirectory()) return;
    if (repos.some((r) => r.path === path)) return;
    const url = git(path, ["remote", "get-url", "origin"]).out;
    const github = url.match(/github\.com[:/]+(.+?)(?:\.git)?$/)?.[1] ?? "";
    repos.push({ path, github });
  };
  for (const dir of dirs) {
    add(dir);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true }))
      if (entry.isDirectory() && !entry.name.startsWith(".")) add(join(dir, entry.name));
  }
  return repos;
}
