/**
 * Figentra Flow file contract:
 * Purpose: the artifact guard (AC-043): the files a branch adds or changes against the default branch that are build
 *   or tool output (a path under `.cache/`, `node_modules/`, `dist/`, `.turbo/` or `coverage/` by default) or larger
 *   than the size limit (5 MB by default). `fflow gate run` and `fflow land` refuse while there is any. Both lists
 *   are the configuration's `artifacts` (`paths`, `maxBytes`).
 * Boundary: reads git only (`git diff`, `git cat-file -s`); changes nothing.
 * Runtime: node
 * Governing contract: STA-1729 phase A (the leader's rule of 2026-10-31, after a pnpm store was committed in #5).
 * Secrets: none.
 */
import { git } from "./git.mjs";

/** Folders whose files are never committed (a trailing `/` matches the folder at any depth). */
export const DEFAULT_PATHS = [".cache/", "node_modules/", "dist/", ".turbo/", "coverage/"];

/** The largest file a change may add (5 MB). */
export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Whether `file` matches `pattern`: `name/` is that folder at any depth; otherwise a glob (`*` within a segment) on the
 * file's name, or on its whole path when the pattern has a `/`.
 * @param {string} file
 * @param {string} pattern
 */
export function matches(file, pattern) {
  if (pattern.endsWith("/")) return `/${file}`.includes(`/${pattern}`);
  const glob = new RegExp(
    `^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", "[^/]*")}$`,
  );
  return glob.test(pattern.includes("/") ? file : (file.split("/").pop() ?? file));
}

/**
 * Every artifact `head` adds or changes against `base`, one line each.
 * @param {string} root
 * @param {string} base a ref or sha (the default branch)
 * @param {string} head
 * @param {{ paths?: string[], maxBytes?: number }} [rules] the configuration's `artifacts`
 * @returns {string[]}
 */
export function artifactProblems(
  root,
  base,
  head,
  { paths = DEFAULT_PATHS, maxBytes = DEFAULT_MAX_BYTES } = {},
) {
  const diff = git(root, [
    "diff",
    "--name-only",
    "--no-renames",
    "--diff-filter=AM",
    "-z",
    `${base}...${head}`,
  ]);
  if (!diff.ok) return [`cannot diff ${head.slice(0, 12)} against ${base}: ${diff.err}`];
  /** @type {string[]} */
  const problems = [];
  for (const file of diff.out.split("\0").filter(Boolean)) {
    const pattern = paths.find((p) => matches(file, p));
    if (pattern) {
      problems.push(`${file}: build or tool output (${pattern}) must not be committed`);
      continue;
    }
    const size = Number.parseInt(git(root, ["cat-file", "-s", `${head}:${file}`]).out, 10);
    if (size > maxBytes)
      problems.push(
        `${file}: ${(size / 1024 / 1024).toFixed(1)} MB is over the ${(maxBytes / 1024 / 1024).toFixed(1)} MB limit`,
      );
  }
  return problems;
}
