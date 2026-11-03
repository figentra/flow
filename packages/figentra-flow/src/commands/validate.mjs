/**
 * Figentra Flow file contract:
 * Purpose: `fflow validate [--workspace <dir>]` (STA-1945 FR-1, FR-4, FR-5, FR-6, AC-1, AC-4, AC-5): checks
 *   `flow.config.json` against its schema and names each field that breaks it, a `profile` the preset lacks (FR-6),
 *   and each agent or skill that profile names but the preset does not carry (C6); a repository without the file is
 *   a problem too. It checks each override in `.flow/overrides/` against the override schema (a `replace` or
 *   `disable` without `reason`, `owner` and `review` is refused), against what `sync` renders for the profile (an
 *   unknown target is refused), and against the mandatory policies (one that disables, replaces or loosens one is
 *   refused, naming it); a whole-file override without its `.yml` is a warning.
 * Boundary: reads only; writes nothing.
 * Runtime: node
 * Governing contract: STA-1945 (FR-1, FR-4, FR-5, FR-6, P-001, P-007, P-008).
 * Secrets: none.
 */
import { loadConfig } from "../lib/config.mjs";
import { LockError, readLock } from "../lib/lock.mjs";
import { legacyWarnings, loadOverrides, targetProblems } from "../lib/overrides.mjs";
import { policyProblems } from "../lib/policies.mjs";
import { CONFIG_FILE, NAME } from "../lib/product.mjs";
import {
  presetTargets,
  profileGaps,
  profileProblem,
  render,
  syncedDirect,
} from "../lib/render.mjs";
import { runIn } from "../lib/workspace-run.mjs";

/**
 * The lock of `root`, or undefined when it has none or it is unreadable (`check` names that).
 * @param {string} root
 */
function readableLock(root) {
  try {
    return readLock(root);
  } catch (error) {
    if (error instanceof LockError) return undefined;
    throw error;
  }
}

/**
 * The overrides of `root` with their problems (schema, target, mandatory policy) and warnings (whole-file overrides
 * without their `.yml`). Targets are checked against what `sync` renders for the profile without overrides, as the
 * last sync did.
 * @param {string} root
 * @returns {{ overrides: import("../lib/overrides.mjs").Override[], problems: string[], warnings: string[] }}
 */
export function overridesReport(root) {
  const { overrides, problems } = loadOverrides(root);
  if (!overrides.length) return { overrides, problems, warnings: [] };
  // What `sync` renders is unknown while the profile is unresolved; `validate` and `check` name that problem.
  const targets = profileProblem(root)
    ? []
    : targetProblems(
        overrides,
        render(root, { direct: syncedDirect(readableLock(root)), overrides: [] }),
        presetTargets(root),
      );
  return {
    overrides,
    problems: [...problems, ...targets, ...policyProblems(overrides)],
    warnings: legacyWarnings(overrides),
  };
}

/**
 * The config's and the overrides' problems and warnings.
 * @param {string} root
 * @returns {{ problems: string[], warnings: string[] }}
 */
export function validateRepo(root) {
  const { source, errors, warnings } = loadConfig(root);
  if (!source) return { problems: [`no ${CONFIG_FILE} (run \`${NAME} init\`)`], warnings };
  const unresolved = profileProblem(root);
  const o = overridesReport(root);
  return {
    problems: [...errors, ...(unresolved ? [unresolved] : profileGaps(root)), ...o.problems],
    warnings: [...warnings, ...o.warnings],
  };
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
