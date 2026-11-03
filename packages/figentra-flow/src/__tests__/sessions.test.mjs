/**
 * Figentra Flow file contract:
 * Purpose: hold the live sessions to FR-20 and Flow ADR 0001: the three title forms pass and anything else is named
 *   (untitled, the wrong form, a track off the list, an active track not in capitals); a running agent in the
 *   repository or a worktree is shown by title, state, worktree (the deepest checkout) and stage, while other
 *   processes, spares and other folders are not; a title at odds with its record and an unreadable record are flagged;
 *   with no process listing the records' last sessions are shown with a note; the session files read are only
 *   `<pid>.json`.
 * Boundary: temporary repositories and folders; processes and session files injected.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945.
 */
// @covers sta-1945:FR-20 sta-1945:AC-19 sta-1945:P-025
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { updateRecord } from "../lib/record.mjs";
import { liveSessions, nameProblem, systemSessions, trackOf } from "../lib/sessions.mjs";
import { repo, sh } from "./__fixtures__/repo.mjs";

test("sessions: ADR 0001's three forms pass, and a title off them is named", () => {
  for (const name of [
    "FLOW · Flow to 100% and the console engine (STA-1966)",
    "LEADER · Stackra status and coordination",
    "hold · Runway · completion plan (finishing 6d)",
    "done · Docs · core docs to Fumadocs",
  ])
    assert.equal(nameProblem(name), undefined, name);
  assert.match(nameProblem("") ?? "", /^untitled/);
  assert.match(nameProblem("projects-2e") ?? "", /not `TRACK · job \(key\)`/);
  assert.match(nameProblem("FLOW - wrong separator") ?? "", /not `TRACK · job \(key\)`/);
  assert.match(nameProblem("hold · Runway") ?? "", /not `hold · Track · job`/);
  assert.match(nameProblem("PNPM · bump every repo") ?? "", /^PNPM is not a track/);
  assert.match(nameProblem("Flow · a lower-case track") ?? "", /in capitals: FLOW$/);
  assert.equal(trackOf("FLOW · x (STA-1)"), "FLOW");
  assert.equal(trackOf("hold · Runway · plan"), "RUNWAY");
  assert.equal(trackOf("projects-2e"), undefined);
});

/** A repository with a worktree for STA-5 whose record is at `build`. */
function world() {
  const r = repo();
  const path = join(r.root, ".claude", "worktrees", "sta-5-live");
  sh(r.root, "worktree", "add", "-q", "-b", "figentra/sta-5-live", path, "main");
  updateRecord(path, "sta-5", (rec) => ({ ...rec, stage: "build" }));
  return { r, path };
}

test("sessions: a running agent is shown by title, state, worktree and stage; other processes are not", (t) => {
  const { r, path } = world();
  t.after(r.dispose);
  const deps = {
    processes: () => [
      {
        pid: 11,
        cwd: join(path, "packages"),
        args: [
          "/Users/a/Library/Application",
          "Support/Claude/claude.app/Contents/MacOS/claude",
          "--verbose",
        ],
      },
      { pid: 12, cwd: path, args: ["zsh"] },
      { pid: 13, cwd: "/elsewhere", args: ["claude"] },
      { pid: 14, cwd: r.root, args: ["claude", "bg-spare", "--bg-spare", "/tmp/x.sock"] },
      { pid: 15, cwd: r.root, args: ["opencode"] },
    ],
    sessionFiles: () => [{ path: "/s/11.json", name: "FLOW · live sessions (STA-5)", pid: 11 }],
  };
  assert.deepEqual(liveSessions(r.root, deps), [
    {
      name: "FLOW · live sessions (STA-5)",
      state: "active",
      worktree: path,
      stage: "build",
      pid: 11,
      kind: "claude-code",
    },
    {
      name: "",
      state: "active",
      worktree: r.root,
      pid: 15,
      kind: "opencode",
      problem: "untitled: name it `TRACK · job (key)` (ADR 0001)",
    },
  ]);
});

test("sessions: a title at odds with the record, no process listing, and an unreadable record", (t) => {
  const { r, path } = world();
  t.after(r.dispose);
  /** @param {string} name */
  const one = (name) =>
    liveSessions(r.root, {
      processes: () => [{ pid: 21, cwd: path, args: ["claude"] }],
      sessionFiles: () => [{ path: "/s/21.json", name, pid: 21 }],
    })[0];
  assert.equal(
    one("done · Flow · live sessions").problem,
    "the title says done but the record is active at build",
  );
  updateRecord(path, "sta-5", (rec) => ({ ...rec, stage: "ship", state: "done" }));
  assert.match(one("FLOW · live sessions (STA-5)").problem ?? "", /the record is shipped/);
  assert.equal(one("done · Flow · live sessions").problem, undefined);

  updateRecord(path, "sta-5", (rec) => ({
    ...rec,
    stage: "build",
    state: "active",
    sessions: [{ name: "hold · Flow · paused", kind: "claude-code", start: null }],
  }));
  assert.deepEqual(liveSessions(r.root, { processes: () => undefined, sessionFiles: () => [] }), [
    {
      name: "hold · Flow · paused",
      state: "hold",
      worktree: path,
      stage: "build",
      kind: "claude-code",
      note: "no process listing: the record's last session",
    },
  ]);

  writeFileSync(join(path, ".flow", "record", "sta-5.json"), "{");
  assert.match(one("FLOW · live sessions (STA-5)").problem ?? "", /not valid JSON/);
  const [listed] = liveSessions(r.root, { processes: () => undefined, sessionFiles: () => [] });
  assert.match(listed.problem ?? "", /not valid JSON/);
});

test("sessions: the system's session files are `<pid>.json` titles only", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "flow-sessions-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(systemSessions(dir).sessionFiles(), []);
  mkdirSync(join(dir, "sessions"));
  writeFileSync(join(dir, "sessions", "11.json"), JSON.stringify({ pid: 11, name: " FLOW · x " }));
  writeFileSync(join(dir, "sessions", "11.abc.key"), "not read");
  writeFileSync(join(dir, "sessions", "12.json"), "{");
  writeFileSync(join(dir, "sessions", "13.json"), JSON.stringify({ pid: 13 }));
  assert.deepEqual(
    systemSessions(dir)
      .sessionFiles()
      .sort((a, b) => a.pid - b.pid),
    [
      { path: join(dir, "sessions", "11.json"), name: "FLOW · x", pid: 11 },
      { path: join(dir, "sessions", "13.json"), name: "", pid: 13 },
    ],
  );
});
