/**
 * Figentra Flow file contract:
 * Purpose: `fflow check [--workspace <dir>]`, the CI check (STA-1945 FR-1, AC-1): it fails, naming each cause, when an
 *   owned file differs from the lock (any byte, provenance header or not), the installed preset differs from the
 *   locked digest, the lock is unreadable or names another Flow version, the config is invalid or names a profile
 *   the preset lacks, the profile differs from the lock's (FR-6), or a spec-kit file is left. Override and
 *   mandatory-policy causes join with STA-1945 PR 2.
 * Boundary: reads only; writes nothing.
 * Runtime: node
 * Governing contract: STA-1945 (FR-1, FR-3, FR-6, P-001, P-005).
 * Secrets: none.
 */
import { loadConfig } from "../lib/config.mjs";
import { LockError, readLock } from "../lib/lock.mjs";
import { NAME } from "../lib/product.mjs";
import { installProblems, presetDrift, profileProblem } from "../lib/render.mjs";
import { runIn } from "../lib/workspace-run.mjs";

/**
 * What `check` finds in `root`.
 * @param {string} root
 * @returns {{ problems: string[], warnings: string[] }}
 */
export function check(root) {
  const { errors, warnings } = loadConfig(root);
  const problems = [...errors, ...installProblems(root)];
  const unresolved = profileProblem(root);
  if (unresolved) problems.push(unresolved);
  try {
    const drift = presetDrift(root, readLock(root));
    if (drift) problems.push(drift);
  } catch (error) {
    // installProblems already names an unreadable lock.
    if (!(error instanceof LockError)) throw error;
  }
  return { problems, warnings };
}

/**
 * One repository's `check`.
 * @param {string} root
 * @param {string[]} _args
 * @param {import("../lib/workspace-run.mjs").Io} io
 */
export function report(root, _args, io) {
  const { problems, warnings } = check(root);
  for (const w of warnings) io.log(`${NAME} check: warning: ${w}`);
  for (const p of problems) io.log(`${NAME} check: ${p}`);
  if (!problems.length) io.log(`${NAME} check: ok`);
  return problems.length
    ? { code: 1, line: `${problems.length} problem(s): ${problems.join("; ")}` }
    : { code: 0, line: warnings.length ? `ok, ${warnings.length} warning(s)` : "ok" };
}

/** `fflow check [--workspace <dir>]`. */
export const run = (/** @type {string[]} */ args = []) => runIn(args, report);
