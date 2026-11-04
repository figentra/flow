/**
 * Figentra Flow file contract:
 * Purpose: a spec's declared status, tier and approval stops (ADR 0502): `STATUSES`, `statusOf`, `statusLine`,
 *   `TIERS`, `tierOf`, `approvedAt` and `checkApproval`, moved unchanged out of `commands/gate.mjs` (which re-exports
 *   them) so `lib/land-rules.mjs` imports nothing from `commands/` (ADR 0523, L2 PR C); `approvalsAt` lists every
 *   approval of a stage, re-approvals included, for the record's content-bound approvals (STA-1945 A-3).
 * Boundary: pure functions over the spec's text; no file or network access.
 * Runtime: node
 * Governing contract: ADR 0502 (tiers and approval stops); ADR 0120; ADR 0523; STA-1945 (A-3, AC-34).
 * Secrets: none.
 */
import { strip } from "./spec-parse.mjs";

export const STATUSES = [
  "draft",
  "clarified",
  "planned",
  "tasked",
  "implementing",
  "done",
  "abandoned",
  "superseded",
];

/** True when `status` is `stage` or later. */
export const atLeast = (status, stage) => STATUSES.indexOf(status) >= STATUSES.indexOf(stage);

/** The declared `**Status**`, lower-cased ("" when absent). */
export const statusOf = (text) =>
  strip(text)
    .match(/^\*\*Status\*\*:\s*([A-Za-z]+)/m)?.[1]
    ?.toLowerCase() ?? "";

/** The spec's `**Status**:` line, trimmed ("" when absent). */
export const statusLine = (text) =>
  strip(text)
    .match(/^\*\*Status\*\*:.*$/m)?.[0]
    .trim() ?? "";

/** The spec tiers of ADR 0502, smallest first. */
export const TIERS = ["trivial", "small", "feature", "big"];

/**
 * The tier a spec declares in its `**Tier**:` header, or undefined (an older spec).
 * @param {string} text
 * @returns {string | undefined}
 */
export const tierOf = (text) => {
  const tier = strip(text)
    .match(/^\*\*Tier\*\*:\s*([A-Za-z]+)/m)?.[1]
    ?.toLowerCase();
  return tier !== undefined && TIERS.includes(tier) ? tier : undefined;
};

/**
 * Every approval of a spec at `stage`, in document order: "Approved by <who> <YYYY-MM-DD>" on the Status line while
 * the spec sits there, then on each Status history line that moved it there (a re-approval is a later line).
 * @param {string} text
 * @param {string} stage
 * @returns {{ who: string, date: string }[]}
 */
export function approvalsAt(text, stage) {
  const lines = statusOf(text) === stage ? [statusLine(text)] : [];
  const history =
    strip(text).match(/^## Status history\b[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m)?.[1] ?? "";
  lines.push(...history.split("\n").filter((l) => new RegExp(`→\\s*${stage}\\b`, "i").test(l)));
  return lines.flatMap((line) => {
    const found = line.match(/Approved by ([^\n]+?) (\d{4}-\d{2}-\d{2})\b/);
    return found ? [{ who: found[1] ?? "", date: found[2] ?? "" }] : [];
  });
}

/**
 * Who approved a spec at `stage` and when: the first of `approvalsAt`.
 * @param {string} text
 * @param {string} stage
 * @returns {{ who: string, date: string } | undefined}
 */
export function approvedAt(text, stage) {
  return approvalsAt(text, stage)[0];
}

/**
 * The approval stops of ADR 0502: feature before Tasked; big before Planned and before Tasked; both name the Approver.
 * @param {string} text
 * @param {string} [status] the status to check for (`plan` passes the one its step moves the spec to)
 * @returns {string[]}
 */
export function checkApproval(text, status = statusOf(text)) {
  const tier = tierOf(text);
  if (tier !== "feature" && tier !== "big") return [];
  if (status === "abandoned" || status === "superseded") return [];
  const problems = [];
  if (atLeast(status, "planned") && !/^\*\*Approver\*\*:\s*\S/m.test(strip(text)))
    problems.push(
      `a ${tier} spec names its \`**Approver**\` (the owner, or the leader for a technical-only stop; ADR 0502)`,
    );
  for (const stop of tier === "big" ? ["clarified", "planned"] : ["planned"]) {
    const next = stop === "clarified" ? "planned" : "tasked";
    if (atLeast(status, next) && approvedAt(text, stop) === undefined)
      problems.push(
        `status ${status} needs the ${stop[0].toUpperCase()}${stop.slice(1)} approval of a ${tier} spec: "Approved by <who> <YYYY-MM-DD>" on that stage (ADR 0502)`,
      );
  }
  return problems;
}
