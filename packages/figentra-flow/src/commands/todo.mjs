/**
 * Figentra Flow file contract:
 * Purpose: `fflow todo [--repo <path>] [--json]` (FR-21, AC-20, P-026): everything waiting on the owner across the
 *   workspace (or the repository named, or the current one), each with the command or link that clears it: every
 *   open owner ask of each task's newest record (approvals, merges, releases, promotions, decisions, secrets to set).
 *   Exit 0, or 1 when a record could not be read (listed as a problem).
 * Boundary: read-only; reads Flow's records only (`allRecords`), no network.
 * Runtime: node
 * Governing contract: STA-1945 (FR-21, AC-20, P-026).
 * Secrets: none.
 */
import { NAME } from "../lib/product.mjs";
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

/** @param {string[]} args */
export function run(args = []) {
  const at = args.indexOf("--repo");
  if (at >= 0 && !args[at + 1]) {
    console.error(`usage: ${NAME} todo [--repo <path>] [--json]`);
    return 2;
  }
  const repos = reposFor(at < 0 ? undefined : args[at + 1], process.cwd());
  const list = todo(allRecords(repos.map((r) => r.path)));
  console.log(args.includes("--json") ? JSON.stringify(list, null, 2) : render(list));
  return list.problems.length ? 1 : 0;
}
