/**
 * Figentra Flow file contract:
 * Purpose: `fflow check [--workspace <dir>]`, the CI check (STA-1945 FR-1, AC-1): it fails, naming each cause, when an
 *   owned file differs from the lock (any byte, provenance header or not), the installed preset differs from the
 *   locked digest, the lock is unreadable or names another Flow version, the config is invalid, a spec-kit file is
 *   left, an override is invalid (what `validate` refuses, a mandatory policy off among it) or an override's review
 *   date has passed. It warns from 14 days before a review date (STA-1945 FR-4, FR-5, AC-4).
 * Boundary: reads only; writes nothing.
 * Runtime: node
 * Governing contract: STA-1945 (FR-1, FR-3, FR-4, FR-5, P-001, P-005, P-007).
 * Secrets: none.
 */
import { loadConfig } from "../lib/config.mjs";
import { LockError, readLock } from "../lib/lock.mjs";
import { REVIEW_NOTICE_DAYS, reviewState } from "../lib/overrides.mjs";
import { NAME } from "../lib/product.mjs";
import { installProblems, presetDrift } from "../lib/render.mjs";
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
  const problems = [...config.errors, ...overrides.problems, ...installProblems(root)];
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
