/**
 * Figentra Flow file contract:
 * Purpose: hold `fflow status` and its snapshot to FR-7, AC-012, AC-024 and AC-026: specs by status (a
 *   worktree's copy wins for its own key), worktrees (dirty, idle, no key), open PRs with the head's gate, the counted
 *   review and stacking, sessions with their spec, worktree and gate, the cap's warning naming the excess, a missing
 *   repository reported and skipped, `--offline` making no GitHub call, and the live agent sessions by title, state,
 *   worktree and stage with a warning for a title off ADR 0001's pattern (STA-1945 FR-20).
 * Boundary: temporary repositories with a local bare origin; GitHub injected; no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1729 phase 4.
 */
// @covers sta-1729:FR-7 sta-1729:AC-012 sta-1729:AC-024 sta-1729:AC-026
// @covers sta-1729:FR-10 sta-1729:AC-023 sta-1729:P-007 sta-1729:P-010
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { render } from "../commands/status.mjs";
import { CONFIG_FILE, STATUS_CONTEXT } from "../lib/product.mjs";
import { updateRecord } from "../lib/record.mjs";
import { snapshot } from "../lib/snapshot.mjs";
import { CONFIG, repo, sh } from "./__fixtures__/repo.mjs";

const spec = (/** @type {string} */ status, /** @type {string} */ session) =>
  `# Spec\n\n**Status**: ${status}\n\n**Tier**: small\n\n**Session**: ${session}\n`;

/** A repository with three building specs, a worktree for each of two, and an idle keyless worktree. */
function world() {
  const config = {
    ...CONFIG,
    apps: { gate: { login: "gate-app[bot]" }, review: { slug: "reviewer" } },
  };
  const r = repo({ [CONFIG_FILE]: JSON.stringify(config) });
  for (const [folder, status, session] of [
    ["sta-1-alpha", "Tasked", "s1"],
    ["sta-2-beta", "Implementing", "s2"],
    ["sta-3-gamma", "Tasked", "s3"],
  ]) {
    mkdirSync(join(r.root, ".agents/specs", folder), { recursive: true });
    writeFileSync(join(r.root, ".agents/specs", folder, "spec.md"), spec(status, session));
  }
  sh(r.root, "add", "-A");
  sh(r.root, "commit", "-q", "-m", "specs");
  sh(r.root, "push", "-q", "origin", "main");
  const tree = (/** @type {string} */ name, /** @type {string} */ branch) => {
    const path = join(r.root, ".claude/worktrees", name);
    sh(r.root, "worktree", "add", "-q", "-b", branch, path, "main");
    return path;
  };
  const alpha = tree("sta-1-alpha", "figentra/sta-1-alpha");
  // The worktree's copy of its own spec names the session that builds it.
  writeFileSync(join(alpha, ".agents/specs/sta-1-alpha/spec.md"), spec("Tasked", "os-services-b"));
  sh(alpha, "commit", "-qam", "session");
  sh(alpha, "push", "-q", "origin", "HEAD");
  const beta = tree("sta-2-beta", "figentra/sta-2-beta");
  writeFileSync(join(beta, "wip.txt"), "wip\n");
  const scratch = tree("scratch", "scratch");
  return { r, alpha, beta, scratch, head: sh(alpha, "rev-parse", "HEAD") };
}

/** A GitHub with PR #7 on alpha's head (green gate, review PASS) and #8 stacked on it. */
function github(/** @type {string} */ head) {
  /** @type {string[]} */
  const calls = [];
  /** @type {import("../lib/github.mjs").Api} */
  const api = (method, path) => {
    calls.push(`${method} ${path}`);
    if (path.startsWith("/repos/acme/app/pulls?state=open"))
      return {
        ok: true,
        err: "",
        json: [
          {
            number: 7,
            title: "alpha",
            head: { sha: head, ref: "figentra/sta-1-alpha" },
            base: { ref: "main" },
            user: { login: "dev" },
          },
          {
            number: 8,
            title: "on top",
            head: { sha: "b".repeat(40), ref: "figentra/sta-4-top" },
            base: { ref: "figentra/sta-1-alpha" },
            user: { login: "dev" },
          },
        ],
      };
    if (path === `/repos/acme/app/commits/${head}/statuses?per_page=100`)
      return {
        ok: true,
        err: "",
        json: [{ context: STATUS_CONTEXT, state: "success", creator: { login: "gate-app[bot]" } }],
      };
    if (path === "/repos/acme/app/issues/7/comments?per_page=100")
      return {
        ok: true,
        err: "",
        json: [
          {
            body: `AI-REVIEW: PASS ${head} base=main`,
            user: { login: "reviewer[bot]", type: "Bot" },
            performed_via_github_app: { slug: "reviewer" },
            created_at: "2026-11-01T10:00:00Z",
            updated_at: "2026-11-01T10:00:00Z",
          },
        ],
      };
    return { ok: true, err: "", json: [] };
  };
  return { api, calls };
}

test("status: specs, worktrees, PRs with gate and review, sessions with their gate, and the cap's warning", (t) => {
  const w = world();
  t.after(w.r.dispose);
  const { api } = github(w.head);
  const snap = snapshot({
    repos: [
      { path: w.r.root, github: "acme/app" },
      { path: join(w.r.root, "nope"), github: "" },
    ],
    api: () => api,
    busy: [],
  });
  const [mine, missing] = snap.repos;
  assert.equal(missing.error, "missing");
  assert.deepEqual(
    mine.specs.map((/** @type {any} */ s) => [s.folder, s.status, s.session]).sort(),
    [
      ["sta-1-alpha", "tasked", "os-services-b"],
      ["sta-2-beta", "implementing", "s2"],
      ["sta-3-gamma", "tasked", "s3"],
    ],
  );
  const byBranch = Object.fromEntries(mine.worktrees.map((/** @type {any} */ t) => [t.branch, t]));
  assert.equal(byBranch["figentra/sta-2-beta"].dirty, true);
  assert.equal(byBranch.scratch.key, null);
  assert.equal(byBranch["figentra/sta-1-alpha"].key, "sta-1");
  const [seven, eight] = mine.prs;
  assert.deepEqual(
    [seven.gate.state, seven.gate.trusted, seven.review, seven.stacked],
    ["success", true, "PASS", false],
  );
  assert.equal(eight.stacked, true);
  const session = mine.sessions.find((/** @type {any} */ s) => s.name === "os-services-b");
  assert.deepEqual(session, {
    name: "os-services-b",
    specs: ["sta-1"],
    worktrees: [w.alpha],
    gates: ["success"],
    building: true,
  });
  assert.match(snap.warnings.join(), /3 sessions are building .*the cap is 2: 1 over/);
  const text = render(snap);
  assert.match(text, /#7 alpha — fflow\/gate success, review PASS/);
  assert.match(text, /#8 on top .*stacked on figentra\/sta-1-alpha/);
  assert.match(text, /os-services-b \(building\): sta-1; worktree .*sta-1-alpha; gate success/);
  assert.match(text, /skipped: missing/);
  assert.match(text, /warning: 3 sessions are building/);
});

test("status --offline: no GitHub call; the cap is the owner's", (t) => {
  const w = world();
  t.after(w.r.dispose);
  const { api, calls } = github(w.head);
  const snap = snapshot({
    repos: [{ path: w.r.root, github: "acme/app" }],
    api: () => api,
    offline: true,
    cap: 3,
  });
  assert.deepEqual(calls, []);
  assert.equal(snap.repos[0].prsProblem, "offline");
  assert.deepEqual(snap.warnings, []);
  assert.equal(snap.version, "fflow.status/1");
});

// @covers sta-1945:FR-25 sta-1945:AC-27 sta-1945:P-030
test("status lists a Done spec's skipped optional tasks", (t) => {
  const r = repo();
  t.after(r.dispose);
  for (const [folder, status] of [
    ["sta-5-done", "Done"],
    ["sta-6-open", "Implementing"],
  ]) {
    const dir = join(r.root, ".agents/specs", folder);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "spec.md"), spec(status, "s5"));
    writeFileSync(
      join(dir, "tasks.md"),
      "## Phase 1\n- [x] T001 Do\n- [ ] T002* Polish\n- [x] T003* Docs\n- [ ] ~~T004*~~ gone\n",
    );
  }
  const snap = snapshot({ repos: [{ path: r.root, github: "acme/app" }], offline: true });
  const skipped = Object.fromEntries(
    snap.repos[0].specs.map((/** @type {any} */ s) => [s.folder, s.skipped]),
  );
  assert.deepEqual(skipped, { "sta-5-done": ["T002"], "sta-6-open": [] });
  assert.match(render(snap), /done sta-5-done .*skipped optional T002/);
});

// @covers sta-1945:FR-20 sta-1945:AC-19 sta-1945:P-025
test("status shows the live sessions by title, state, worktree and stage, and warns on a bad title", (t) => {
  const r = repo();
  t.after(r.dispose);
  const path = join(r.root, ".claude/worktrees/sta-5-live");
  sh(r.root, "worktree", "add", "-q", "-b", "figentra/sta-5-live", path, "main");
  updateRecord(path, "sta-5", (rec) => ({ ...rec, stage: "gate" }));
  const snap = snapshot({
    repos: [{ path: r.root, github: "acme/app" }],
    offline: true,
    live: {
      processes: () => [
        { pid: 31, cwd: path, args: ["claude"] },
        { pid: 32, cwd: path, args: ["claude"] },
        // OpenCode's title is not readable: a note, never a warning.
        { pid: 33, cwd: path, args: ["opencode"] },
      ],
      sessionFiles: () => [
        { path: "/s/31.json", name: "FLOW · live sessions (STA-5)", pid: 31 },
        { path: "/s/32.json", name: "projects-2e", pid: 32 },
      ],
    },
  });
  assert.deepEqual(
    snap.repos[0].live?.map((s) => [s.name, s.state, s.worktree, s.stage, s.problem]),
    [
      ["FLOW · live sessions (STA-5)", "active", path, "gate", undefined],
      ["projects-2e", "active", path, "gate", "not `TRACK · job (key)` (ADR 0001)"],
      ["", "active", path, "gate", undefined],
    ],
  );
  assert.deepEqual(snap.warnings, [
    `session "projects-2e" in ${path}: not \`TRACK · job (key)\` (ADR 0001)`,
  ]);
  const text = render(snap);
  assert.match(
    text,
    /live sessions:\n {4}FLOW · live sessions \(STA-5\) — active, .*sta-5-live, stage gate, pid 31\n/,
  );
  assert.match(text, /projects-2e — active, .*, pid 32 — not `TRACK · job \(key\)`/);
  assert.match(text, /\(untitled\) — active, .*, pid 33 \(title not readable for opencode\)\n/);
  assert.match(text, /warning: session "projects-2e"/);
  assert.equal(snapshot({ repos: [{ path: r.root }], offline: true }).repos[0].live, undefined);
});
