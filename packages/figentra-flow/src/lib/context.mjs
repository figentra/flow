/**
 * Figentra Flow file contract:
 * Purpose: bounded, offline navigation of a checkout or the existing workspace registry for an agent's task.
 * Boundary: reads Git paths and package metadata; no setup, network, scripts, cache or document body loading.
 * Runtime: node
 * Secrets: none; metadata only, no environment files or remote URLs.
 */
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { ConfigError } from "./config.mjs";
import { git } from "./git.mjs";
import { readWorkspace } from "./workspace.mjs";

export const CONTEXT_LIMIT = 100;
const REPO_LIMIT = 25;

/** @typedef {{ repo?: string, all?: boolean, query?: string, path?: string, limit?: number }} ContextOptions */

/** A navigation category, not an assertion about a document's authority or delivery status. */
function kindOf(/** @type {string} */ path) {
  const name = basename(path);
  if (/^AGENTS(?:\.override)?\.md$/.test(name)) return "instructions";
  if (name === "SKILL.md") return "skill";
  if (name === "package.json") return "package";
  if (/^README\.(md|mdx)$/i.test(name)) return "overview";
  if (/^(stackra\.(config\.ts|manifest\.json)|pnpm-workspace\.yaml|flow\.config\.json)$/.test(name))
    return "manifest";
  if (path === ".flow/lock.json" || /(^|\/)(pnpm-lock\.yaml|package-lock\.json)$/.test(path))
    return "versions";
  if (/\.(md|mdx)$/.test(name) && /(^|\/)(docs|rules|reference|specs|agents)\//.test(path))
    return "guidance";
  return undefined;
}

/** Only regular files reached without symlinks, including at intermediate directory boundaries. */
function regular(/** @type {string} */ root, /** @type {string} */ path) {
  let at = root;
  try {
    for (const part of path.split("/")) {
      at = join(at, part);
      if (lstatSync(at).isSymbolicLink()) return false;
    }
    return lstatSync(at).isFile();
  } catch {
    return false;
  }
}

/**
 * One checkout's pointers. Git supplies tracked and non-ignored untracked paths; deleted files are omitted.
 * shortcut: package facts and path categories only; add language-specific manifests when a pilot needs them.
 * @param {string} directory
 * @param {ContextOptions} options
 */
export function repositoryContext(
  directory,
  { query = "", path = "", limit = 20, all = false } = {},
) {
  const top = git(directory, ["rev-parse", "--show-toplevel"]);
  if (!top.ok) return { path: directory, error: "missing or unreadable Git checkout" };
  const root = realpathSync(top.out);
  if (all && realpathSync(directory) !== root)
    return { path: directory, error: "registered path is not a repository root" };
  const target = resolve(root, path);
  const scoped = relative(root, target);
  if (isAbsolute(scoped) || scoped === ".." || scoped.startsWith(`..${sep}`))
    throw new ConfigError("context: path must stay inside the repository");
  const scope = scoped.split(sep).join("/");
  const listed = git(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]);
  const state = git(root, ["--no-optional-locks", "status", "--porcelain"]);
  if (!listed.ok || !state.ok) return { path: root, error: "cannot read Git paths or status" };
  const files = [...new Set(listed.out.split("\0").filter(Boolean))]
    .filter((file) => !/(^|\/)(node_modules|\.git|dist|build|coverage|\.vendor)\//.test(file))
    .filter((file) => kindOf(file) && regular(root, file))
    .sort();
  /** @type {string[]} */
  const problems = [];
  const entries = files
    .filter((file) => !scope || file === scope || file.startsWith(`${scope}/`))
    .map((file) => {
      const kind = kindOf(file);
      let name = "";
      let purpose = "";
      if (kind === "package") {
        try {
          if (lstatSync(join(root, file)).size > 256 * 1024) throw new Error("too large");
          const pkg = JSON.parse(readFileSync(join(root, file), "utf8"));
          if (!pkg || typeof pkg !== "object" || Array.isArray(pkg))
            throw new Error("not an object");
          name = typeof pkg?.name === "string" ? pkg.name.slice(0, 200) : "";
          purpose = typeof pkg?.description === "string" ? pkg.description.slice(0, 240) : "";
        } catch {
          problems.push(`${file}: unreadable, oversized or invalid package metadata`);
        }
      }
      return { path: file, kind, ...(name ? { name } : {}), ...(purpose ? { purpose } : {}) };
    });
  const matches = entries.filter((entry) =>
    `${entry.path} ${entry.name ?? ""} ${entry.purpose ?? ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  // Ancestor instructions are returned even when a query or result limit excludes them.
  const instructions = files.filter((file) => {
    if (kindOf(file) !== "instructions") return false;
    const parent = dirname(file);
    return parent === "." || scope === parent || scope.startsWith(`${parent}/`);
  });
  return {
    path: root,
    revision: git(root, ["rev-parse", "--verify", "HEAD"]).out || null,
    branch: git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]).out || null,
    dirty: state.out !== "",
    source: "working-tree Git paths and package.json metadata; no cache",
    instructions,
    entrypoints: files.filter((file) =>
      ["README.md", ".agents/README.md", ".agents/skills/README.md", ".flow/lock.json"].includes(
        file,
      ),
    ),
    matches: matches.slice(0, limit),
    total: matches.length,
    truncated: matches.length > limit,
    problems: problems.slice(0, limit),
    problemCount: problems.length,
  };
}

/**
 * Single-checkout by default; collection mode reads only registered paths, with missing checkouts surfaced.
 * @param {string} cwd
 * @param {ContextOptions} [options]
 */
export function discoverContext(
  cwd,
  { repo, all = false, query = "", path = "", limit = 20 } = {},
) {
  if (repo !== undefined && all) throw new ConfigError("context: use --repo or --all, not both");
  if (!Number.isInteger(limit) || limit < 1 || limit > CONTEXT_LIMIT)
    throw new ConfigError(`context: limit must be an integer from 1 to ${CONTEXT_LIMIT}`);
  for (const [key, value] of Object.entries({ query, path }))
    if (
      typeof value !== "string" ||
      value.length > 500 ||
      [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
    )
      throw new ConfigError(`context: ${key} must be a single line of at most 500 characters`);
  if (isAbsolute(path)) throw new ConfigError("context: path must be repository-relative");
  const repos = all ? readWorkspace() : [{ path: resolve(cwd, repo ?? "."), github: "" }];
  return {
    repositories: repos.slice(0, REPO_LIMIT).map((r) => ({
      ...repositoryContext(r.path, { query, path, limit, all }),
      ...(r.github ? { identity: r.github } : {}),
    })),
    totalRepositories: repos.length,
    truncated: repos.length > REPO_LIMIT,
    limitations: [
      "Navigation only: read applicable instructions and contracts before editing; parent instructions outside the checkout and client/global rules are not indexed.",
      "Paths and package descriptions do not prove ownership, consumers, decision status, test success or deployment. No private document bodies are loaded.",
      "Results omit ignored files, dependencies, build output and symlinks. Narrow by repo, path or query when truncated. Each repository has its own revision; dirty means HEAD alone does not describe its content.",
    ],
  };
}
