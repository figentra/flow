/**
 * Figentra Flow file contract:
 * Purpose: `fflow ledger [--since <YYYY-MM-DD>] [--repo <path>] [--json]` (FR-21, AC-42, P-026): what landed, released
 *   and shipped across the workspace (or the repository named, or the current one), by day and track: each record's
 *   history entries that finished `land`, `release` or `ship` (on or after `--since`, a UTC day), under the track its
 *   sessions' titles name (ADR 0001). Exit 0, 1 when a record could not be read (listed as a problem), 2 usage.
 * Boundary: read-only; reads Flow's records only (`allRecords`), no network.
 * Runtime: node
 * Governing contract: STA-1945 (FR-21, AC-42, P-026).
 * Secrets: none.
 */
import { NAME } from "../lib/product.mjs";
import { allRecords } from "../lib/records.mjs";
import { trackOf } from "../lib/sessions.mjs";
import { reposFor } from "./status.mjs";

/** The stages the ledger lists, by what finishing them means. @type {Record<string, string>} */
const DONE = { land: "landed", release: "released", ship: "shipped" };

/**
 * The ledger's rows, ordered by day, track and key, and each record that could not be read.
 * @param {import("../lib/records.mjs").RepoRecord[]} records
 * @param {string} [since] the first day listed, `YYYY-MM-DD`
 */
export function ledger(records, since) {
  const rows = records
    .flatMap(({ repo, key, record }) => {
      if (!record) return [];
      const track =
        record.sessions
          .map((s) => trackOf(s.name))
          .filter(Boolean)
          .at(-1) ?? "(no track)";
      return (record.history ?? [])
        .filter(
          (h) => h.state === "done" && DONE[h.stage] && (!since || h.at.slice(0, 10) >= since),
        )
        .map((h) => ({
          day: h.at.slice(0, 10),
          track,
          what: DONE[h.stage],
          repo,
          key,
          prs: record.prs,
        }));
    })
    .sort((a, b) => `${a.day} ${a.track} ${a.key}`.localeCompare(`${b.day} ${b.track} ${b.key}`));
  return { rows, problems: records.filter((r) => r.problem) };
}

/**
 * The ledger as text: a day, its tracks, each track's rows.
 * @param {ReturnType<typeof ledger>} list
 */
export function render({ rows, problems }) {
  /** @type {string[]} */
  const out = rows.length ? [] : ["nothing landed, released or shipped"];
  let day = "";
  let track = "";
  for (const r of rows) {
    if (r.day !== day) {
      out.push((day = r.day));
      track = "";
    }
    if (r.track !== track) out.push(`  ${(track = r.track)}`);
    const prs = r.prs.length ? ` (#${r.prs.join(", #")})` : "";
    out.push(`    ${r.what} ${r.key.toUpperCase()}${prs} ${r.repo}`);
  }
  for (const p of problems) out.push(`problem: ${p.repo} ${p.from}: ${p.problem}`);
  return out.join("\n");
}

/** @param {string[]} args */
export function run(args = []) {
  const opt = (/** @type {string} */ name) =>
    args.includes(`--${name}`) ? (args[args.indexOf(`--${name}`) + 1] ?? "") : undefined;
  const since = opt("since");
  const repo = opt("repo");
  if (
    (since !== undefined &&
      !(/^\d{4}-\d{2}-\d{2}$/.test(since) && !Number.isNaN(Date.parse(since)))) ||
    repo === ""
  ) {
    console.error(`usage: ${NAME} ledger [--since <YYYY-MM-DD>] [--repo <path>] [--json]`);
    return 2;
  }
  const list = ledger(allRecords(reposFor(repo, process.cwd()).map((r) => r.path)), since);
  console.log(args.includes("--json") ? JSON.stringify(list, null, 2) : render(list));
  return list.problems.length ? 1 : 0;
}
