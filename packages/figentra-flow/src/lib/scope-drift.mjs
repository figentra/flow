/**
 * Figentra Flow file contract:
 * Purpose: scope drift (FR-30, AC-32): the files a PR changes that none of its spec's tasks names, and the files a
 *          task names that no folder tree of its design holds.
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

/**
 * The paths a folder tree block names (FR-27): one per line, joined to the folder lines it is indented beneath; the
 * `├──`, `│` and ASCII tree marks, and anything after the path (a "(new)" note), are not part of it. A folder line with
 * lines beneath it loses its trailing `/`: it holds only what it lists, and only a leaf folder holds everything under it.
 * @param {string[]} lines the block's lines
 * @returns {string[]}
 */
export function treePaths(lines) {
  /** @type {{ at: number, name: string, i: number }[]} */
  const stack = [];
  const paths = [];
  for (const line of lines) {
    const m = line.match(/^((?:[├└][─-]+|[|`+]-+|[\s│|])*)(\S+)/);
    if (!m || /^[.…]+$/.test(m[2])) continue;
    const at = m[1].length;
    while ((stack.at(-1)?.at ?? -1) >= at) stack.pop();
    const top = stack.at(-1);
    if (top) paths[top.i] = paths[top.i].replace(/\/$/, "");
    const parent = stack.map(({ name }) => (name.endsWith("/") ? name : `${name}/`)).join("");
    stack.push({ at, name: m[2], i: paths.length });
    paths.push(parent + m[2]);
  }
  return paths;
}

/** A tree entry as a pattern: `*`, `**` and `{a,b}` glob; an entry ending in `/` holds everything under it. */
const pattern = (/** @type {string} */ entry) => {
  const glob = entry
    .replaceAll(/[.+?^$()|[\]\\]/g, "\\$&")
    .replaceAll(/\{([^{}]*)\}/g, (_, alts) => `(?:${alts.split(",").join("|")})`)
    .replaceAll(/\*\*?/g, (s) => (s === "**" ? ".*" : "[^/]*"));
  return new RegExp(`^${glob}${entry.endsWith("/") ? "" : "$"}`);
};

/** A backticked name that is a repository path: no space, glob, placeholder or call, and a folder or an extension. */
// shortcut: a slash-separated name that is not a file (a check name such as `fflow/gate`) still counts, while a task glob
// (`src/**`), an extensionless root file (`Makefile`) and a task's `{a,b}` (matched literally) are not expanded; refine
// it here when a repository needs it.
const isPath = (/** @type {string} */ p) =>
  !/[\s*<>()|:]/.test(p) && !/^[/~@]/.test(p) && /\/|\.[A-Za-z]\w*$/.test(p);

/**
 * FR-30: the paths a live task names that no tree entry holds (tests, changesets and lockfiles aside), each once.
 * @param {{ paths: string[], struck?: boolean }[]} tasks `parseTasks` rows
 * @param {string[]} entries `treePaths` of the design's trees
 * @returns {string[]}
 */
export function outsideTrees(tasks, entries) {
  const held = entries.map((e) => ({ e, re: pattern(e) }));
  const named = new Set(tasks.filter((t) => !t.struck).flatMap((t) => t.paths));
  return [...named].filter(
    (p) =>
      isPath(p) &&
      !ALLOWED.test(p) &&
      !held.some(({ e, re }) => re.test(p) || (p.endsWith("/") && e.startsWith(p))),
  );
}
