/**
 * Figentra Flow file contract:
 * Purpose: whether a commit's required checks are green, counting only what their trusted source posted (STA-1856,
 *   the security review of 2026-11-01): a context the ruleset pins to an App (`integration_id`) counts only that App's
 *   check run; any other context counts only a check run or commit status from a login `trusted` names for it (for
 *   example `fflow/gate` from the gate App; a list names a renamed App's old and new logins, ADR 0523). A context
 *   pinned by neither is untrusted, so a spoofed status never makes a commit green. `land` and the approval check
 *   share it.
 * Boundary: pure: the ruleset's required contexts, the commit's statuses (newest first) and check runs in; states out.
 * Runtime: node
 * Governing contract: STA-1856 FR-2 and FR-4.
 * Secrets: none.
 */

/** Check run conclusions GitHub counts as passing a required check. */
const PASSING = ["success", "skipped", "neutral"];

/**
 * The required contexts of a `rules/branches/<base>` response.
 * @param {any[]} rules
 * @returns {{ context: string, integration_id?: number }[]}
 */
export const requiredContexts = (rules) =>
  rules
    .filter((r) => r?.type === "required_status_checks")
    .flatMap((r) => r.parameters?.required_status_checks ?? []);

/**
 * Each required context's state on one commit.
 * @param {{ required: { context: string, integration_id?: number }[], statuses: any[], checkRuns: any[],
 *           trusted?: Record<string, string | string[]> }} input
 * @returns {{ passed: string[], pending: string[], failed: string[], untrusted: string[], succeeded: number }}
 */
export function requiredCheckState({ required, statuses, checkRuns, trusted = {} }) {
  /** @type {{ passed: string[], pending: string[], failed: string[], untrusted: string[], succeeded: number }} */
  const out = { passed: [], pending: [], failed: [], untrusted: [], succeeded: 0 };
  for (const { context, integration_id: app } of required) {
    // An empty login trusts no one (a deleted poster has no login either).
    const logins = [trusted[context] ?? []].flat().filter(Boolean);
    if (app === undefined && !logins.length) {
      out.untrusted.push(`${context} is pinned to no App (set its integration_id in the ruleset)`);
      continue;
    }
    // The newest run from the trusted source; a re-run has a higher id.
    const run = checkRuns
      .filter(
        (r) =>
          r.name === context &&
          (app !== undefined ? r.app?.id === app : logins.includes(`${r.app?.slug}[bot]`)),
      )
      .toSorted((a, b) => b.id - a.id)[0];
    const status = statuses.find((s) => s.context === context);
    /** @type {string} */
    let state;
    if (run)
      state =
        run.status !== "completed"
          ? "pending"
          : PASSING.includes(run.conclusion)
            ? run.conclusion
            : "failure";
    else if (status && logins.includes(status.creator?.login ?? ""))
      state = status.state === "success" || status.state === "pending" ? status.state : "failure";
    else if (status) {
      out.untrusted.push(
        `${context} was posted by ${status.creator?.login ?? "nobody"}, not ${logins.join(" or ") || `App ${app}`}`,
      );
      continue;
    } else state = "pending";
    if (state === "pending") out.pending.push(context);
    else if (state === "failure") out.failed.push(context);
    else {
      out.passed.push(context);
      if (state === "success") out.succeeded++;
    }
  }
  return out;
}
