/**
 * Figentra Flow file contract:
 * Purpose: `figentra-flow team check` (AC-047): validates the roster the configuration's `team` names and each role
 *   file beside it, printing one line per problem. Exit 0 when the roster holds, 1 with problems, 2 when the
 *   configuration names no roster.
 * Boundary: read-only.
 * Runtime: node
 * Governing contract: STA-1729 phase 7 (the agent-team plan stop of 2026-11-01).
 * Secrets: none.
 */
import { say } from "../lib/cli.mjs";
import { git } from "../lib/git.mjs";
import { CONFIG_FILE, NAME } from "../lib/product.mjs";
import { loadTeam } from "../lib/team.mjs";

/** `figentra-flow team check`. */
export function run(/** @type {string[]} */ [mode]) {
  if (mode !== "check") {
    console.error(`usage: ${NAME} team check`);
    return 2;
  }
  const top = git(process.cwd(), ["rev-parse", "--show-toplevel"]);
  const team = loadTeam(top.ok ? top.out : process.cwd());
  if (!team) {
    console.error(`${NAME} team: ${CONFIG_FILE} names no roster ("team")`);
    return 2;
  }
  for (const p of team.problems) console.error(`${NAME} team: ${p}`);
  say(
    team.problems.length ? "blocked" : "approved",
    `${NAME} team: ${team.roles.size} role(s)${team.problems.length ? `, ${team.problems.length} problem(s)` : ""}`,
  );
  return team.problems.length ? 1 : 0;
}
