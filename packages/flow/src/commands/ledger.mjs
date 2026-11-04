/**
 * Figentra Flow file contract:
 * Purpose: `fflow ledger [--since <YYYY-MM-DD>] [--repo <path>] [--json]` (FR-21, AC-42, P-026): what landed, released
 *   and shipped across the workspace (or the repository named, or the current one), by day and track: each record's
 *   history entries that finished `land`, `release` or `ship` (on or after `--since`, a UTC day), under the track its
 *   sessions' titles name (ADR 0001). Exit 0, 1 when a record could not be read (listed as a problem), 2 usage. The
 *   options are declared in src/lib/console.mjs; `refusal` names a `--since` that is not a day, and `handle` runs them.
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
  for (const p of problems)
    out.push(`problem: ${[p.repo, p.from].filter(Boolean).join(" ")}: ${p.problem}`);
  return out.join("\n");
}

/**
 * What is wrong with `fflow ledger`'s `--since`, as a usage error's message and hint, or undefined.
 * @param {{ since?: string }} options
 * @returns {{ message: string, hint: string } | undefined}
 */
export function refusal({ since }) {
  if (since === undefined) return undefined;
  // A day that exists: `Date.parse` rolls `2026-02-30` over to March, so it must read back the same.
  const day = Date.parse(since);
  const isDay =
    /^\d{4}-\d{2}-\d{2}$/.test(since) &&
    !Number.isNaN(day) &&
    new Date(day).toISOString().slice(0, 10) === since;
  return isDay
    ? undefined
    : { message: "--since takes a day, as YYYY-MM-DD", hint: `${NAME} ledger --since 2026-11-01` };
}

/**
 * `fflow ledger`, after `refusal` passed its options; `--json` writes the ledger as the console's data.
 * @param {import("../lib/console.mjs").Io} io
 * @param {{ since?: string, repo?: string }} options
 * @returns {number}
 */
export function handle(io, { since, repo }) {
  const list = ledger(allRecords(reposFor(repo, io.cwd).map((r) => r.path)), since);
  if (io.json) io.output.json(list);
  else io.output.line(render(list));
  return list.problems.length ? 1 : 0;
}
