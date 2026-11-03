/**
 * Figentra Flow file contract:
 * Purpose: `fflow validate [--workspace <dir>]` (STA-1945 FR-1, AC-1): checks `flow.config.json` against its schema and
 *   names each field that breaks it, and a `profile` the preset lacks (FR-6); a repository without the file is a
 *   problem too. The overrides' schema and the mandatory policies join with STA-1945 PR 2.
 * Boundary: reads only; writes nothing.
 * Runtime: node
 * Governing contract: STA-1945 (FR-1, FR-6, P-001).
 * Secrets: none.
 */
import { loadConfig } from "../lib/config.mjs";
import { CONFIG_FILE, NAME } from "../lib/product.mjs";
import { profileProblem } from "../lib/render.mjs";
import { runIn } from "../lib/workspace-run.mjs";

/**
 * The config's problems and warnings.
 * @param {string} root
 * @returns {{ problems: string[], warnings: string[] }}
 */
export function validateRepo(root) {
  const { source, errors, warnings } = loadConfig(root);
  if (!source) return { problems: [`no ${CONFIG_FILE} (run \`${NAME} init\`)`], warnings };
  const unresolved = profileProblem(root);
  return { problems: unresolved ? [...errors, unresolved] : errors, warnings };
}

/**
 * One repository's `validate`.
 * @param {string} root
 * @param {string[]} _args
 * @param {import("../lib/workspace-run.mjs").Io} io
 */
export function report(root, _args, io) {
  const { problems, warnings } = validateRepo(root);
  for (const w of warnings) io.log(`${NAME} validate: warning: ${w}`);
  for (const p of problems) io.log(`${NAME} validate: ${p}`);
  if (!problems.length) io.log(`${NAME} validate: ${CONFIG_FILE} is valid`);
  return problems.length
    ? { code: 1, line: `${problems.length} problem(s): ${problems.join("; ")}` }
    : { code: 0, line: "valid" };
}

/** `fflow validate [--workspace <dir>]`. */
export const run = (/** @type {string[]} */ args = []) => runIn(args, report);
