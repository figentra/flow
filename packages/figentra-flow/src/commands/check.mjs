/**
 * Figentra Flow file contract:
 * Purpose: `fflow check [--workspace <dir>]`, the CI check (STA-1945 FR-1, AC-1): it fails, naming each cause, when an
 *   owned file differs from the lock (any byte, provenance header or not), the installed preset differs from the
 *   locked digest, the lock is unreadable or names another Flow version, the config is invalid or names a profile
 *   the preset lacks, the profile differs from the lock's (FR-6), a spec-kit file is left, an override is invalid
 *   (what `validate` refuses, a mandatory policy off among it), the overrides differ from the lock's digest (changed
 *   without a `sync`), an override's review date has passed, or a machine-only skill is committed (FR-8, D1). It
 *   warns from 14 days before a review date (STA-1945 FR-4, FR-5, AC-4).
 * Boundary: reads only (`git ls-files` among it); writes nothing.
 * Runtime: node
 * Governing contract: STA-1945 (FR-1, FR-3, FR-4, FR-5, FR-6, FR-8, P-001, P-005, P-007, P-013).
 * Secrets: none.
 */
import { ConfigError, loadConfig } from "../lib/config.mjs";
import { presetDir } from "../lib/flow-dir.mjs";
import { LockError, readLock } from "../lib/lock.mjs";
import { REVIEW_NOTICE_DAYS, reviewState } from "../lib/overrides.mjs";
import { NAME } from "../lib/product.mjs";
import { installProblems, presetDrift, profileProblem } from "../lib/render.mjs";
import { loadThirdParty, machineOnlyProblems } from "../lib/skills.mjs";
import { runIn } from "../lib/workspace-run.mjs";
import { overridesReport } from "./validate.mjs";

/**
 * What `check` finds in `root`.
 * @param {string} root
 * @param {Date} [now] the day review dates are measured from
 * @returns {{ problems: string[], warnings: string[] }}
 */
export function check(root, now = new Date()) {
  const config = loadConfig(root);
  const overrides = overridesReport(root);
  const unresolved = profileProblem(root);
  const problems = [
    ...config.errors,
    ...(unresolved ? [unresolved] : []),
    ...overrides.problems,
    ...installProblems(root),
  ];
  const warnings = [...config.warnings, ...overrides.warnings];
  for (const o of overrides.overrides) {
    const state = reviewState(o, now);
    if (state === "expired")
      problems.push(
        `${o.path}: its review date ${o.review} has passed (review it, then move \`review\` on or remove the override)`,
      );
    else if (state === "due")
      warnings.push(`${o.path}: its review date ${o.review} is within ${REVIEW_NOTICE_DAYS} days`);
  }
  try {
    const drift = presetDrift(root, readLock(root));
    if (drift) problems.push(drift);
  } catch (error) {
    // installProblems already names an unreadable lock.
    if (!(error instanceof LockError)) throw error;
  }
  if (!config.errors.length) problems.push(...machineOnlyCommitted(root));
  return { problems, warnings };
}

/**
 * The machine-only skills committed to `root` (STA-1945 FR-8, D1), each with its source, whatever the profile (a
 * licence rule, not a selection); a `third-party.yml` that is not valid, or a git that cannot list the tracked files,
 * is its own problem.
 * @param {string} root
 * @returns {string[]}
 */
function machineOnlyCommitted(root) {
  let skills, found;
  try {
    skills = loadThirdParty(presetDir(root));
    found = machineOnlyProblems(root, skills);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    return [error.message];
  }
  const sources = new Map(skills.map((s) => [s.id, s.source]));
  return found.map(
    ({ dir, id }) =>
      `${dir} is the machine-only skill ${id}, which no repository carries (remove it from git; install it on the machine from ${sources.get(id)}, as \`${NAME} doctor\` lists)`,
  );
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
