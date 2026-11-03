/**
 * Figentra Flow file contract:
 * Purpose: hold `fflow session stop` to its contract (FR-19, AC-18, P-019): on a task's branch the session's work and
 *   its end in the record are committed as `wip(<name>)` and pushed; a second stop updates the same session, whose
 *   start is unknown when it was first seen at a stop; untracked and secret-named files are listed, never committed;
 *   hooks that refuse the commit are reported as that, and git's own refusal as nothing committed, the staging undone;
 *   a broken record still lets the work be saved; the default branch is left alone; `--save-only` writes only the
 *   record; a push that fails is recorded as `pushed: false` and committed locally, kept by a stop that saves nothing
 *   and cleared only by a later stop whose push succeeds.
 * Boundary: temporary repositories with a local bare origin; no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945.
 */
// @covers sta-1945:FR-19 sta-1945:FR-20 sta-1945:FR-14 sta-1945:FR-18 sta-1945:AC-18 sta-1945:P-019
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { sessionName, sessionTitle, stopReport, stopSession } from "../commands/session.mjs";
import { ENV_PREFIX } from "../lib/product.mjs";
import { readRecord } from "../lib/record.mjs";
import { refuseCommits, repo, sh } from "./__fixtures__/repo.mjs";

const BRANCH = "figentra/sta-5-session";
const NAME = "FLOW · stop (STA-5)";

test("session stop: the work and the record are on the remote (AC-18)", (t) => {
  const r = repo({ "work.txt": "x\n" });
  t.after(r.dispose);
  sh(r.root, "switch", "-q", "-c", BRANCH);
  writeFileSync(join(r.root, "work.txt"), "unsaved\n");
  const first = stopSession({ cwd: r.root, name: NAME, now: "2026-11-03T10:00:00Z" });
  assert.ok("pushed" in first && first.pushed, JSON.stringify(first));
  assert.equal(sh(r.origin, "rev-parse", BRANCH), first.sha);
  assert.equal(sh(r.origin, "show", `${BRANCH}:work.txt`), "unsaved");
  assert.match(sh(r.root, "log", "-1", "--format=%s"), /^wip\(FLOW · stop \(STA-5\)\): /);
  assert.equal(sh(r.root, "status", "--porcelain"), "");
  assert.deepEqual(stopReport(NAME, first), [
    ["approved", `fflow session stop: ${NAME} saved and pushed (${first.sha.slice(0, 12)})`],
  ]);

  writeFileSync(join(r.root, "work.txt"), "more\n");
  stopSession({ cwd: r.root, name: NAME, now: "2026-11-03T11:00:00Z" });
  // First seen at its stop: its start is unknown, not the stop's time.
  assert.deepEqual(readRecord(r.root, "sta-5")?.sessions, [
    { name: NAME, kind: "claude-code", start: null, end: "2026-11-03T11:00:00Z" },
  ]);
  assert.equal(sh(r.origin, "show", `${BRANCH}:work.txt`), "more");
});

test("session stop: untracked files and files named like secrets stay out of the commit, listed", (t) => {
  const r = repo({ "work.txt": "x\n", "server.pem": "x\n" });
  t.after(r.dispose);
  sh(r.root, "switch", "-q", "-c", BRANCH);
  writeFileSync(join(r.root, "work.txt"), "unsaved\n");
  writeFileSync(join(r.root, "server.pem"), "changed\n");
  writeFileSync(join(r.root, ".env"), "x\n");
  writeFileSync(join(r.root, "cert.p12"), "x\n");
  writeFileSync(join(r.root, "draft.md"), "x\n");
  const result = stopSession({ cwd: r.root, name: NAME });
  assert.ok("pushed" in result && result.pushed, JSON.stringify(result));
  assert.deepEqual(sh(r.origin, "show", "--name-only", "--format=", BRANCH).split("\n").sort(), [
    ".flow/record/sta-5.json",
    "work.txt",
  ]);
  assert.equal(sh(r.origin, "show", `${BRANCH}:server.pem`), "x");
  const report = stopReport(NAME, result).map(([, line]) => line);
  assert.match(report[1], /look like secrets: server\.pem, \.env, cert\.p12$/);
  assert.match(report[2], /untracked, so not committed .*: draft\.md$/);
});

test("session stop: hooks that refuse the WIP commit are reported as that, never as committed (FR-18)", (t) => {
  const r = repo({ "work.txt": "x\n" });
  t.after(r.dispose);
  sh(r.root, "switch", "-q", "-c", BRANCH);
  refuseCommits(r.root, "lint: 2 problems");
  writeFileSync(join(r.root, "work.txt"), "unsaved\n");
  const result = stopSession({ cwd: r.root, name: NAME });
  assert.ok("pushed" in result && !result.pushed);
  assert.equal(sh(r.root, "rev-list", "--count", "HEAD"), "1", "nothing committed");
  assert.match(sh(r.root, "status", "--porcelain"), /work\.txt/);
  const [line, ...rest] = stopReport(NAME, result);
  assert.deepEqual(rest, []);
  assert.equal(line[0], "blocked");
  assert.equal(
    line[1],
    "fflow session stop: the hooks refused the WIP commit: lint: 2 problems; the work stays in the worktree, uncommitted",
  );
  assert.doesNotMatch(line[1], /committed \(|but not pushed/);
  assert.equal(sh(r.root, "diff", "--cached", "--name-only"), "", "the staging is undone");
});

test("session stop: a commit git refuses (not the hooks) reports nothing committed, never committed (FR-18)", (t) => {
  const r = repo({ "work.txt": "x\n" });
  t.after(r.dispose);
  sh(r.root, "switch", "-q", "-c", BRANCH);
  sh(r.root, "config", "commit.gpgsign", "true");
  sh(r.root, "config", "gpg.program", join(r.root, "..", "no-such-gpg"));
  writeFileSync(join(r.root, "work.txt"), "unsaved\n");
  const result = stopSession({ cwd: r.root, name: NAME });
  assert.ok("uncommitted" in result && result.uncommitted, JSON.stringify(result));
  assert.equal(sh(r.root, "rev-list", "--count", "HEAD"), "1", "nothing committed");
  assert.equal(readRecord(r.root, "sta-5")?.sessions[0].pushed, undefined, "no pushed-false entry");
  const [[state, line]] = stopReport(NAME, result);
  assert.equal(state, "blocked");
  assert.match(
    line,
    /^fflow session stop: nothing was committed: git commit failed: [\s\S]*uncommitted$/,
  );
  assert.doesNotMatch(line, /hooks refused|is committed/);
});

test("session stop --save-only (the Stop hook) writes the record and commits and pushes nothing", (t) => {
  const r = repo({ "work.txt": "x\n" });
  t.after(r.dispose);
  sh(r.root, "switch", "-q", "-c", BRANCH);
  writeFileSync(join(r.root, "work.txt"), "unsaved\n");
  const result = stopSession({
    cwd: r.root,
    name: NAME,
    now: "2026-11-03T10:00:00Z",
    saveOnly: true,
  });
  assert.deepEqual(result, { key: "sta-5", local: true });
  assert.deepEqual(stopReport(NAME, result), []);
  assert.equal(readRecord(r.root, "sta-5")?.sessions[0].end, "2026-11-03T10:00:00Z");
  assert.equal(sh(r.root, "rev-list", "--count", "HEAD"), "1", "nothing committed");
  assert.throws(() => sh(r.origin, "rev-parse", "--verify", BRANCH), "nothing pushed");
});

test("session stop: a record that fails its schema still saves the work, and names the field", (t) => {
  const r = repo({ "work.txt": "x\n" });
  t.after(r.dispose);
  sh(r.root, "switch", "-q", "-c", BRANCH);
  mkdirSync(join(r.root, ".flow", "record"), { recursive: true });
  writeFileSync(
    join(r.root, ".flow", "record", "sta-5.json"),
    JSON.stringify({ recordVersion: 1, key: "sta-5" }),
  );
  writeFileSync(join(r.root, "work.txt"), "unsaved\n");
  const result = stopSession({ cwd: r.root, name: NAME });
  assert.ok("pushed" in result && result.pushed, JSON.stringify(result));
  assert.match(result.problem ?? "", /stage: is required/);
  assert.equal(sh(r.origin, "show", `${BRANCH}:work.txt`), "unsaved");
  assert.equal(sh(r.root, "rev-list", "--count", "HEAD"), "2", "one commit, no pushed-false one");
});

test("session stop: the name is the transcript's last title, not the session's id (FR-20)", (t) => {
  const r = repo();
  t.after(r.dispose);
  const transcript = join(r.root, "..", "session.jsonl");
  writeFileSync(
    transcript,
    [
      JSON.stringify({ type: "user", sessionId: "abc", message: { content: "custom-title" } }),
      JSON.stringify({
        type: "custom-title",
        customTitle: "FLOW · old job (STA-5)",
        sessionId: "abc",
      }),
      JSON.stringify({ type: "custom-title", customTitle: ` ${NAME} `, sessionId: "abc" }),
      '{"type":"custom-title","customTi',
    ].join("\n"),
  );
  assert.equal(sessionTitle(transcript), NAME);
  // The hook's JSON carries both: the title wins over the id, and --session and the environment win over both.
  const event = { transcript_path: transcript, session_id: "abc" };
  assert.equal(sessionName(["stop"], {}, event), NAME);
  assert.equal(sessionName(["stop", "--session", "mine"], {}, event), "mine");
  assert.equal(sessionName(["stop"], { [`${ENV_PREFIX}SESSION`]: "env" }, event), "env");
  assert.equal(sessionName(["stop"], {}, { session_id: "abc" }), "abc");
  assert.equal(sessionName(["stop"], {}, {}), "session");
  writeFileSync(transcript, `${JSON.stringify({ type: "user", sessionId: "abc" })}\n`);
  assert.equal(sessionName(["stop"], {}, event), "abc");
  assert.equal(sessionTitle(transcript), undefined);
  assert.equal(sessionTitle(join(r.root, "..", "missing.jsonl")), undefined);
  assert.equal(sessionTitle(undefined), undefined);
});

test("session stop: a renamed session keeps one entry; another session with its name gets its own", (t) => {
  const r = repo();
  t.after(r.dispose);
  sh(r.root, "switch", "-q", "-c", BRANCH);
  const old = "FLOW · stop (STA-5)";
  const renamed = "hold · stop (STA-5)";
  stopSession({ cwd: r.root, name: old, id: "abc", now: "2026-11-03T10:00:00Z" });
  stopSession({ cwd: r.root, name: renamed, id: "abc", now: "2026-11-03T11:00:00Z" });
  stopSession({ cwd: r.root, name: renamed, id: "def", now: "2026-11-03T12:00:00Z" });
  assert.deepEqual(readRecord(r.root, "sta-5")?.sessions, [
    {
      name: renamed,
      id: "abc",
      kind: "claude-code",
      start: null,
      end: "2026-11-03T11:00:00Z",
    },
    {
      name: renamed,
      id: "def",
      kind: "claude-code",
      start: null,
      end: "2026-11-03T12:00:00Z",
    },
  ]);
});

test("session stop: the default branch and a branch with no key are left alone", (t) => {
  const r = repo();
  t.after(r.dispose);
  const skipped = () => {
    const result = stopSession({ cwd: r.root, name: NAME });
    return "skipped" in result ? result.skipped : "";
  };
  writeFileSync(join(r.root, "work.txt"), "x\n");
  assert.match(skipped(), /default branch/);
  sh(r.root, "switch", "-q", "-c", "scratch");
  assert.match(skipped(), /no issue key/);
  assert.equal(sh(r.root, "rev-list", "--count", "HEAD"), "1");
});

test("session stop: a failed push is recorded as pushed false and committed locally; a later push clears it", (t) => {
  const r = repo({ "work.txt": "x\n" });
  t.after(r.dispose);
  sh(r.root, "switch", "-q", "-c", BRANCH);
  sh(r.root, "remote", "set-url", "origin", join(r.root, "..", "gone.git"));
  writeFileSync(join(r.root, "work.txt"), "unsaved\n");
  const result = stopSession({ cwd: r.root, name: NAME, id: "abc" });
  assert.ok("pushed" in result);
  assert.equal(result.pushed, false);
  assert.ok(result.problem);
  assert.equal(readRecord(r.root, "sta-5")?.sessions[0].pushed, false);
  assert.equal(sh(r.root, "status", "--porcelain"), "");
  assert.match(stopReport(NAME, result)[0][1], /is committed \(\w+\) but not pushed: /);

  // A stop that saves nothing (the hooks refuse) keeps the earlier `pushed: false`.
  sh(r.root, "remote", "set-url", "origin", r.origin);
  refuseCommits(r.root, "lint: 1 problem");
  writeFileSync(join(r.root, "work.txt"), "again\n");
  const refused = stopSession({ cwd: r.root, name: NAME, id: "abc" });
  assert.ok("hooks" in refused && refused.hooks !== undefined, JSON.stringify(refused));
  assert.equal(readRecord(r.root, "sta-5")?.sessions[0].pushed, false);

  sh(r.root, "config", "--unset", "core.hooksPath");
  const later = stopSession({ cwd: r.root, name: NAME, id: "abc" });
  assert.ok("pushed" in later && later.pushed, JSON.stringify(later));
  const [session] = readRecord(r.root, "sta-5")?.sessions ?? [];
  assert.equal("pushed" in session, false);
  assert.equal(
    JSON.parse(sh(r.origin, "show", `${BRANCH}:.flow/record/sta-5.json`)).sessions[0].pushed,
    undefined,
  );
});
