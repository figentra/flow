/**
 * Figentra Flow file contract:
 * Purpose: hold `figentra-flow status` and its snapshot to FR-7, AC-012, AC-024 and AC-026: specs by status (a
 *   worktree's copy wins for its own key), worktrees (dirty, idle, no key), open PRs with the head's gate, the counted
 *   review and stacking, sessions with their spec, worktree and gate, the cap's warning naming the excess, a missing
 *   repository reported and skipped, and `--offline` making no GitHub call.
 * Boundary: temporary repositories with a local bare origin; GitHub injected; no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1729 phase 4.
 */
// @covers sta-1729:FR-7 sta-1729:AC-012 sta-1729:AC-024 sta-1729:AC-026
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { render } from "../commands/status.mjs";
import { CONFIG_FILE, STATUS_CONTEXT } from "../lib/product.mjs";
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
  assert.match(text, /#7 alpha — figentra-flow\/gate success, review PASS/);
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
  assert.equal(snap.version, "figentra-flow.status/1");
});
