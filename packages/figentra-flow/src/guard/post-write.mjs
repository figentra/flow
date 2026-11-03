/**
 * Figentra Flow file contract:
 * Purpose: the guard engine's post-write check, ported from core's `post-write-checks.mjs`: a file the agent wrote
 *   inside the repository that the repository's oxfmt would reformat is reported, never fixed and never blocked.
 * Boundary: runs `node_modules/.bin/oxfmt --check <file>` in the repository, never writes; a missing binary, a
 *   missing file or a spawn failure reports nothing (the write already happened).
 * Runtime: node
 * Governing contract: STA-1945 (FR-7, P-012).
 * Secrets: none.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";

/** The files oxfmt checks. */
const CHECKED = /\.(ts|tsx|js|mjs|cjs|json|jsonc|md|mdx|yaml|yml|css)$/;

/**
 * The report for a written file, or undefined when there is nothing to say.
 * @param {string} root the repository
 * @param {string} file the written file
 * @returns {string | undefined}
 */
export function postWrite(root, file) {
  const oxfmt = join(root, "node_modules", ".bin", "oxfmt");
  // A file outside the repository (the scratchpad, another checkout) is not this repository's to format.
  if (!file || !resolve(root, file).startsWith(resolve(root) + sep)) return undefined;
  if (
    !existsSync(file) ||
    !existsSync(oxfmt) ||
    !CHECKED.test(file) ||
    /(^|\/)(node_modules|dist)\//.test(file)
  )
    return undefined;
  const r = spawnSync(oxfmt, ["--check", file], { cwd: root, stdio: "ignore" });
  // A non-zero exit means "needs formatting"; a spawn failure has no status and stays silent.
  if (typeof r.status === "number" && r.status !== 0)
    return `[CHECKS] ${file} is not oxfmt-formatted. Run \`pnpm exec oxfmt ${file}\`.`;
  return undefined;
}
