/**
 * Figentra Flow file contract:
 * Purpose: hold `fflow ledger` to FR-21 and AC-42: what landed, released and shipped (a record's history entries that
 *   finished those stages, nothing else), since a day, by day and track (the track its sessions' titles name), read
 *   from the records only, with the history `updateRecord` dates; an unreadable record or a missing repository is
 *   listed as a problem and exits 1; a `--since` that is not a day that exists is a usage error.
 * Boundary: temporary repositories with a local bare origin; no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945.
 */
// @covers sta-1945:FR-21 sta-1945:AC-42 sta-1945:P-026
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { runCommandForTest } from "@stackra/console/testing";

import { ledger, refusal, render } from "../commands/ledger.mjs";
import { CONSOLE } from "../lib/console.mjs";
import { emptyRecord, updateRecord } from "../lib/record.mjs";
import { allRecords } from "../lib/records.mjs";
import { repo, sh } from "./__fixtures__/repo.mjs";

/**
 * A record of `key` with a session titled `name`, its PRs and its history.
 * @param {string} key
 * @param {string} name
 * @param {number[]} prs
 * @param {[import("../lib/stages.mjs").Stage, "active" | "waiting" | "done" | "failed", string][]} history
 */
const recordOf = (key, name, prs, history) => ({
  ...emptyRecord(key),
  prs,
  sessions: [{ name, kind: "claude-code", start: null }],
  history: history.map(([stage, state, at]) => ({ stage, state, at })),
});

test("ledger: what landed, released and shipped since a day, by day and track", () => {
  const records = [
    {
      repo: "/flow",
      key: "sta-1",
      from: "main",
      record: recordOf(
        "sta-1",
        "FLOW · the ledger (STA-1)",
        [74],
        [
          ["gate", "done", "2026-11-01T09:00:00.000Z"],
          ["land", "done", "2026-11-01T10:00:00.000Z"],
          ["release", "waiting", "2026-11-02T08:00:00.000Z"],
          ["release", "done", "2026-11-03T08:00:00.000Z"],
        ],
      ),
    },
    {
      repo: "/docs",
      key: "sta-2",
      from: "main",
      record: recordOf(
        "sta-2",
        "done · Docs · the site",
        [],
        [
          ["land", "done", "2026-11-03T07:00:00.000Z"],
          ["ship", "done", "2026-11-03T09:00:00.000Z"],
        ],
      ),
    },
    {
      repo: "/x",
      key: "sta-3",
      from: "main",
      record: recordOf("sta-3", "projects-2e", [9], [["land", "done", "2026-11-02T12:00:00.000Z"]]),
    },
  ];
  const all = ledger(records);
  assert.deepEqual(
    all.rows.map((r) => [r.day, r.track, r.what, r.key]),
    [
      ["2026-11-01", "FLOW", "landed", "sta-1"],
      ["2026-11-02", "(no track)", "landed", "sta-3"],
      ["2026-11-03", "DOCS", "landed", "sta-2"],
      ["2026-11-03", "DOCS", "shipped", "sta-2"],
      ["2026-11-03", "FLOW", "released", "sta-1"],
    ],
  );
  const since = ledger(records, "2026-11-03");
  assert.equal(
    render(since),
    [
      "2026-11-03",
      "  DOCS",
      "    landed STA-2 /docs",
      "    shipped STA-2 /docs",
      "  FLOW",
      "    released STA-1 (#74) /flow",
    ].join("\n"),
  );
  assert.equal(render(ledger(records, "2026-11-04")), "nothing landed, released or shipped");
});

test("ledger: read from the history `updateRecord` dates; a broken record is a problem", (t) => {
  const r = repo();
  t.after(r.dispose);
  updateRecord(r.root, "sta-4", (rec) => ({
    ...rec,
    sessions: [{ name: "FLOW · land it (STA-4)", kind: "claude-code", start: null }],
  }));
  updateRecord(r.root, "sta-4", (rec) => ({ ...rec, stage: "land", state: "waiting" }));
  const landed = updateRecord(r.root, "sta-4", (rec) => ({ ...rec, state: "done" }));
  sh(r.root, "add", "-A");
  sh(r.root, "commit", "-q", "-m", "landed");
  const day = landed.history?.at(-1)?.at.slice(0, 10);
  const list = ledger([
    ...allRecords([r.root]),
    { repo: "/r", key: "sta-5", from: "main", problem: "not valid JSON" },
  ]);
  assert.deepEqual(
    list.rows.map((row) => [row.day, row.track, row.what, row.key]),
    [[day, "FLOW", "landed", "sta-4"]],
  );
  assert.match(render(list), /\nproblem: \/r main: not valid JSON$/);
});

test("ledger: the command exits 1 on a broken record or a missing repository, and writes --json", async (t) => {
  const r = repo();
  t.after(r.dispose);
  mkdirSync(join(r.root, ".flow", "record"), { recursive: true });
  writeFileSync(join(r.root, ".flow", "record", "sta-6.json"), "{");
  const options = { cwd: r.root, columns: 400 };
  const text = await runCommandForTest(CONSOLE, ["ledger", "--repo", r.root], options);
  assert.equal(text.exitCode, 1, text.stdout + text.stderr);
  assert.match(text.stdout, /problem: .*sta-6\.json: not valid JSON/);
  const json = await runCommandForTest(CONSOLE, ["ledger", "--repo", r.root, "--json"], options);
  assert.equal(json.exitCode, 1, json.stdout + json.stderr);
  const doc = /** @type {{ data: { rows: unknown[], problems: { key: string }[] } }} */ (json.json);
  assert.deepEqual(doc.data.rows, []);
  assert.deepEqual(
    doc.data.problems.map((p) => p.key),
    ["sta-6"],
  );
  const missing = join(r.root, "missing");
  const gone = await runCommandForTest(CONSOLE, ["ledger", "--repo", missing], options);
  assert.equal(gone.exitCode, 1, gone.stdout + gone.stderr);
  assert.match(gone.stdout, /nothing landed, released or shipped\nproblem: .*missing: missing/);
});

test("ledger: --since takes a day that exists", async () => {
  assert.equal(refusal({}), undefined);
  assert.equal(refusal({ since: "2026-02-28" }), undefined);
  assert.match(refusal({ since: "yesterday" })?.message ?? "", /YYYY-MM-DD/);
  assert.ok(refusal({ since: "2026-02-30" }));
  assert.ok(refusal({ since: "" }));
  const refused = await runCommandForTest(CONSOLE, ["ledger", "--since", "yesterday"]);
  assert.equal(refused.exitCode, 2);
  assert.match(refused.stdout + refused.stderr, /--since takes a day/);
});
