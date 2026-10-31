/**
 * Figentra Flow file contract:
 * Purpose: a spec's and its tasks' roles against the repository's roster (AC-048, AC-053): `**Role**: <id>` and
 *   `**Owner stops**: <category, …> | none` in spec.md, `— role: <id>` on a task line. An unknown role or category, a
 *   feature- or big-tier spec past Clarified without `**Role**` or `**Owner stops**`, and an Impact that names money,
 *   security, legal, brand, pricing, secrets or public content while `**Owner stops**` says none are findings. A task
 *   with no role is listed for the lead, never given one.
 * Boundary: pure: text and a loaded roster in, problems out. Without a roster nothing here runs.
 * Runtime: node
 * Governing contract: STA-1729 phase 7 (the agent-team plan stop of 2026-11-01, decision A and the Impact addition).
 * Secrets: none.
 */
import { parseTasks, strip } from "./spec-parse.mjs";

/** @typedef {import("./team.mjs").Team} Team */

/** What an Impact answer names that only the owner approves (the leader's list of 2026-11-01). */
const OWNER_IMPACT =
  /\b(money|payments?|billing|security|legal|brand|pricing|secrets?|public content)\b/i;

/**
 * A spec header's value, or undefined.
 * @param {string} text
 * @param {string} name
 */
const header = (text, name) =>
  strip(text)
    .match(new RegExp(`^\\*\\*${name}\\*\\*:[ \\t]*(.*)$`, "m"))?.[1]
    ?.trim();

/** The spec's `**Role**`, or undefined. */
export const roleOf = (/** @type {string} */ text) => header(text, "Role") || undefined;

/**
 * The spec's `**Owner stops**` categories: [] for `none`, undefined when the line is absent.
 * @param {string} text
 * @returns {string[] | undefined}
 */
export function ownerStopsOf(text) {
  const value = header(text, "Owner stops");
  if (value === undefined) return undefined;
  if (/^none\b/i.test(value)) return [];
  return value
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * The Impact answers that name an owner-kept subject, as `Field: value`.
 * @param {string} text
 */
export function ownerImpact(text) {
  const impact = strip(text).match(/^## Impact\b[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m)?.[1] ?? "";
  return [...impact.matchAll(/^- \*\*([^*]+)\*\*:[ \t]*(.*)$/gm)]
    .filter(([, , value]) => !/^(none|n\/a|no)\b/i.test(value.trim()))
    .filter(([, field, value]) => OWNER_IMPACT.test(`${field} ${value}`))
    .map(([, field, value]) => `${field}: ${value.trim()}`);
}

/**
 * Role findings for one spec.
 * @param {string} text
 * @param {Team} team
 * @param {{ tiered: boolean, pastClarified: boolean }} stage
 */
export function checkSpecRoles(text, team, { tiered, pastClarified }) {
  /** @type {string[]} */
  const problems = [];
  const role = roleOf(text);
  if (role !== undefined && !team.roles.has(role))
    problems.push(`\`**Role**\` \`${role}\` is not a role of the roster`);
  else if (role === undefined && tiered && pastClarified)
    problems.push(
      "a feature or big spec past Clarified names its `**Role**` (the roster's role id)",
    );
  const stops = ownerStopsOf(text);
  const keeps = team.roster.owner?.keeps ?? [];
  if (stops === undefined) {
    if (tiered && pastClarified)
      problems.push(
        `a feature or big spec past Clarified names its \`**Owner stops**\` (${keeps.join(", ")}, or none)`,
      );
  } else {
    for (const s of stops)
      if (!keeps.includes(s))
        problems.push(
          `\`**Owner stops**\` names \`${s}\`, not a category the owner keeps (${keeps.join(", ")})`,
        );
    if (!stops.length)
      for (const answer of ownerImpact(text))
        problems.push(
          `\`**Owner stops**\` is none, but the Impact names an owner subject: "${answer}" (name the category, or answer the Impact none)`,
        );
  }
  return problems;
}

/**
 * Role findings for tasks.md, and the live tasks with no role (for the lead).
 * @param {string} tasksText
 * @param {Team} team
 */
export function checkTaskRoles(tasksText, team) {
  /** @type {string[]} */
  const problems = [];
  /** @type {string[]} */
  const unassigned = [];
  for (const t of parseTasks(tasksText).filter((x) => !x.struck)) {
    if (!t.role) unassigned.push(`tasks.md:${t.line}: ${t.id}`);
    else if (!team.roles.has(t.role))
      problems.push(`tasks.md:${t.line}: ${t.id} role \`${t.role}\` is not a role of the roster`);
  }
  return { problems, unassigned };
}
