/**
 * Figentra Flow file contract:
 * Purpose: `figentra-flow team check [--tracker]` (AC-047, AC-049): validates the roster the configuration's `team`
 *   names and each role file beside it, printing one line per problem; `--tracker` also lists the roles' labels the
 *   tracker does not have. Exit 0 when the roster holds, 1 with problems, 2 when the configuration names no roster.
 * Boundary: read-only: a missing label is reported for the lead to create, never created.
 * Runtime: node
 * Governing contract: STA-1729 phase 7 (the agent-team plan stop of 2026-11-01).
 * Secrets: none here; the tracker adapter reads its own token.
 */
import { trackerFor } from "../adapters/tracker/index.mjs";
import { say } from "../lib/cli.mjs";
import { git } from "../lib/git.mjs";
import { CONFIG_FILE, NAME } from "../lib/product.mjs";
import { loadTeam } from "../lib/team.mjs";

/** `figentra-flow team check [--tracker]`. */
export async function run(/** @type {string[]} */ [mode, ...args]) {
  if (mode !== "check") {
    console.error(`usage: ${NAME} team check [--tracker]`);
    return 2;
  }
  const top = git(process.cwd(), ["rev-parse", "--show-toplevel"]);
  const root = top.ok ? top.out : process.cwd();
  const team = loadTeam(root);
  if (!team) {
    console.error(`${NAME} team: ${CONFIG_FILE} names no roster ("team")`);
    return 2;
  }
  const problems = [...team.problems];
  if (args.includes("--tracker")) {
    const { tracker, problem } = trackerFor(root);
    if (!tracker?.missingLabels)
      problems.push(`--tracker: ${problem ?? "the tracker cannot list labels"}`);
    else
      try {
        const labels = [...team.roles.values()].map((r) => r.label ?? `role:${r.id}`);
        for (const label of await tracker.missingLabels(labels))
          problems.push(`the tracker has no label \`${label}\` (the lead creates it)`);
      } catch (error) {
        problems.push(`--tracker: ${/** @type {Error} */ (error).message}`);
      }
  }
  for (const p of problems) console.error(`${NAME} team: ${p}`);
  say(
    problems.length ? "blocked" : "approved",
    `${NAME} team: ${team.roles.size} role(s)${problems.length ? `, ${problems.length} problem(s)` : ""}`,
  );
  return problems.length ? 1 : 0;
}
