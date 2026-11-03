/**
 * Figentra Flow file contract:
 * Purpose: scope drift (FR-30, AC-32): the files a PR changes that none of its spec's tasks names.
 * Boundary: pure; no file, git or network access.
 * Runtime: node
 * Governing contract: STA-1945 FR-30 (the fix for drift is an amendment that names the file).
 * Secrets: none.
 */

/** Files a PR may change without a task naming them: tests, changesets and lockfiles. */
// shortcut: any test file passes, not only one beside a named subject; tie it to its subject when a repository needs it.
const ALLOWED =
  /(?:^|\/)__tests__\/|\.(?:test|spec)\.[cm]?[jt]sx?$|^\.changeset\/[^/]+\.md$|(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|bun\.lockb?|Cargo\.lock|go\.sum|uv\.lock|poetry\.lock)$/;

/**
 * The changed files no live task names, by its exact path or a folder path ending in `/`.
 * @param {string[]} changed repository-relative paths
 * @param {{ paths: string[], struck?: boolean }[]} tasks `parseTasks` rows
 * @returns {string[]}
 */
export function scopeDrift(changed, tasks) {
  // shortcut: no globs or `{a,b}` in task paths; tasks name each file, as the tasks template asks.
  const named = tasks.filter((t) => !t.struck).flatMap((t) => t.paths);
  return changed.filter(
    (f) => !ALLOWED.test(f) && !named.some((p) => p === f || (p.endsWith("/") && f.startsWith(p))),
  );
}
