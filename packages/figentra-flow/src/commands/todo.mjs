/**
 * Figentra Flow file contract:
 * Purpose: `fflow todo [--repo <path>] [--json]` (FR-21, AC-20, P-026): everything waiting on the owner across the
 *   workspace (or the repository named, or the current one), each with the command or link that clears it: every
 *   open owner ask of each task's newest record (approvals, merges, releases, promotions, decisions, secrets to set).
 *   Exit 0, or 1 when a record could not be read (listed as a problem). The options are declared in
 *   src/lib/console.mjs; `handle` runs them.
 * Boundary: read-only; reads Flow's records only (`allRecords`), no network.
 * Runtime: node
 * Governing contract: STA-1945 (FR-21, AC-20, P-026).
 * Secrets: none.
 */
import { allRecords } from "../lib/records.mjs";
import { reposFor } from "./status.mjs";

/**
 * The owner's to-do: each record's open asks, and each record that could not be read.
 * @param {import("../lib/records.mjs").RepoRecord[]} records
 */
export function todo(records) {
  return {
    asks: records.flatMap((r) =>
      (r.record?.asks ?? []).map((a) => ({ repo: r.repo, key: r.key, from: r.from, ...a })),
    ),
    problems: records.filter((r) => r.problem),
  };
}

/**
 * The to-do as text.
 * @param {ReturnType<typeof todo>} list
 */
export function render({ asks, problems }) {
  const out = asks.length
    ? asks.map((a) => `${a.key.toUpperCase()} (${a.repo}): ${a.what}\n  ${a.command}`)
    : ["nothing waits on the owner"];
  for (const p of problems)
    out.push(`problem: ${[p.repo, p.from].filter(Boolean).join(" ")}: ${p.problem}`);
  return out.join("\n");
}

/**
 * `fflow todo`; `--json` writes the to-do as the console's data.
 * @param {import("../lib/console.mjs").Io} io
 * @param {{ repo?: string }} options
 * @returns {number}
 */
export function handle(io, { repo }) {
  const list = todo(allRecords(reposFor(repo, io.cwd).map((r) => r.path)));
  if (io.json) io.output.json(list);
  else io.output.line(render(list));
  return list.problems.length ? 1 : 0;
}
