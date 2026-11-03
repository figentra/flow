/**
 * Figentra Flow file contract:
 * Purpose: hold `fflow todo` to FR-21 and AC-20: every open owner ask of the records, each with its command or link,
 *   read from the records only (here a task branch's); an unreadable record or a missing repository is listed as a
 *   problem and exits 1, through the console as through `todo`; nothing waiting says so.
 * Boundary: temporary repositories with a local bare origin; no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945.
 */
// @covers sta-1945:FR-21 sta-1945:AC-20 sta-1945:P-026
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { runCommandForTest } from "@stackra/console/testing";

import { render, todo } from "../commands/todo.mjs";
import { CONSOLE } from "../lib/console.mjs";
import { commitRecord, updateRecord } from "../lib/record.mjs";
import { allRecords } from "../lib/records.mjs";
import { repo, sh } from "./__fixtures__/repo.mjs";

test("todo: every open owner ask of the records, with its command", (t) => {
  const r = repo();
  t.after(r.dispose);
  assert.equal(render(todo(allRecords([r.root]))), "nothing waits on the owner");
  sh(r.root, "switch", "-q", "-c", "figentra/sta-7-release");
  updateRecord(r.root, "sta-7", (rec) => ({
    ...rec,
    stage: "release",
    state: "waiting",
    asks: [
      { what: "approve the release Environment", command: "https://example.test/approve" },
      { what: "set the NPM_TOKEN secret", command: "fflow doctor" },
    ],
  }));
  commitRecord(r.root, "sta-7", { message: "chore(flow): ask", push: false });
  sh(r.root, "switch", "-q", "main");
  const list = todo(allRecords([r.root]));
  assert.deepEqual(
    list.asks.map((a) => [a.key, a.from, a.what, a.command]),
    [
      [
        "sta-7",
        "figentra/sta-7-release",
        "approve the release Environment",
        "https://example.test/approve",
      ],
      ["sta-7", "figentra/sta-7-release", "set the NPM_TOKEN secret", "fflow doctor"],
    ],
  );
  assert.equal(
    render(list),
    [
      `STA-7 (${r.root}): approve the release Environment`,
      "  https://example.test/approve",
      `STA-7 (${r.root}): set the NPM_TOKEN secret`,
      "  fflow doctor",
    ].join("\n"),
  );
});

test("todo: an unreadable record is a problem", () => {
  const text = render(
    todo([{ repo: "/r", key: "sta-8", from: "main", problem: "not valid JSON" }]),
  );
  assert.equal(text, "nothing waits on the owner\nproblem: /r main: not valid JSON");
});

test("todo: the command exits 1 on a broken record or a missing repository, and writes --json", async (t) => {
  const r = repo();
  t.after(r.dispose);
  mkdirSync(join(r.root, ".flow", "record"), { recursive: true });
  writeFileSync(join(r.root, ".flow", "record", "sta-6.json"), "{");
  const options = { cwd: r.root, columns: 400 };
  const text = await runCommandForTest(CONSOLE, ["todo", "--repo", r.root], options);
  assert.equal(text.exitCode, 1, text.stdout + text.stderr);
  assert.match(text.stdout, /nothing waits on the owner\nproblem: .*sta-6\.json: not valid JSON/);
  const json = await runCommandForTest(CONSOLE, ["todo", "--repo", r.root, "--json"], options);
  assert.equal(json.exitCode, 1, json.stdout + json.stderr);
  assert.match(json.stdout, /"sta-6"/);
  const missing = join(r.root, "missing");
  const gone = await runCommandForTest(CONSOLE, ["todo", "--repo", missing], options);
  assert.equal(gone.exitCode, 1, gone.stdout + gone.stderr);
  assert.match(gone.stdout, /nothing waits on the owner\nproblem: .*missing: missing/);
});
