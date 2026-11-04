/**
 * Figentra Flow file contract:
 * Purpose: hold `fflow land` to its contract (the pure rules are `land-rules.test.mjs`'s): a green PR squash-merges
 *   on its exact head with `Refs:`, the AI review's verdict and co-author trailers; a reviewed tier with no PASS, or a
 *   FAIL, only warns and lands (ADR 0523 decision 6); then Linear Done, the merge commit recorded, the worktree
 *   removed though its squash has a new patch id, the branch deleted and a comment; a refused merge changes nothing after it; a
 *   failed Linear call only warns; `--stack` lands bottom-up and stops at a red gate, the next PR updated by a merge
 *   commit and a normal push. STA-1856: an owner-only path refuses, one an override's `extend` of `owner-only` adds
 *   among them (STA-1945); a ruleset that requires a review the head lacks, on a base with no land
 *   lane, refuses and dispatches nothing (the L2 design's PR G); `land` on a merged PR runs only the steps after the
 *   merge. STA-1945 FR-16: a three-PR
 *   stack lands with no human step; a conflict that is only the landed parent's change is resolved, any other stops
 *   the stack with the file named; a PR GitHub did not retarget is retargeted, and a refused retarget stops; a re-run
 *   after a stop resumes from the record, also after a run that died right after a merge; a missing worktree, a
 *   refused push, a red gate and a branch with no PR below each stop; `--dry-run` prints the plan and changes nothing.
 *   STA-1945 FR-17: given `refs` on a
 *   branch that is no key branch, the squash's `Refs:` names it whatever key the slug seems to carry, no spec is read
 *   and nothing moves to Done; a key branch keeps its key, spec gate and Done. The L2 design (PR E): when the base's
 *   approval workflow takes `LAND_LABEL`, `land` adds the label (or comments `/fflow land` once on a labelled PR) and
 *   never dispatches, auto-merges or merges; it waits for the merge (then finishes), a refusal (exit 1 with the lane's
 *   reasons), the owner (4), a moved head (1) or a timeout (4), ignoring a verdict from another login or an earlier
 *   request; `--no-wait` returns once asked; `--dry-run` names the path; a branch GitHub already deleted counts as deleted; `--stack` waits on each PR.
 * Boundary: temporary repositories with a local bare origin; GitHub, Linear and the gate injected; no network.
 * Runtime: node
 * Governing contract: ADR 0022; Stackra ADR 0503; ADR 0523 (decision 6); STA-1729 phase 3; the L2 design (PR E,
 *   PR G).
 */
// @covers sta-1729:FR-6 sta-1729:AC-010 sta-1729:AC-011 sta-1729:AC-017 sta-1729:AC-029 sta-1729:AC-030 sta-1729:P-006
// @covers sta-1856:FR-1 sta-1856:FR-2 sta-1856:FR-3 sta-1856:FR-6
// @covers sta-1856:AC-001 sta-1856:AC-003 sta-1856:AC-004 sta-1856:AC-005 sta-1856:AC-006 sta-1856:AC-007
// @covers sta-1856:P-001 sta-1856:P-002 sta-1856:P-003
// @covers sta-1945:FR-15 sta-1945:AC-40 sta-1945:P-021
// @covers sta-1945:FR-16 sta-1945:AC-14 sta-1945:P-022 sta-1945:FR-17
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { landOne, landRules, landStack } from "../commands/land.mjs";
import {
  APPROVE_WORKFLOW,
  LAND_COMMAND,
  LAND_CONTEXT,
  LAND_LABEL,
  LAND_MARKER,
} from "../lib/product.mjs";
import { readRecord, recordPath, updateRecord } from "../lib/record.mjs";
import { allRecords } from "../lib/records.mjs";
import { ledger } from "../commands/ledger.mjs";

/** The gate App login the configuration names. */
const GATE_APP = "figentra-gate[bot]";
import { commit, repo, sh } from "./__fixtures__/repo.mjs";

const SHA = "c".repeat(40);
const GREEN = [{ context: "fflow/gate", state: "success", creator: { login: GATE_APP } }];
/** @param {Record<string, unknown>} [over] */
const pr = (over = {}) => ({
  number: 7,
  state: "open",
  draft: false,
  mergeable_state: "clean",
  title: "feat(flow): land",
  base: { ref: "main" },
  head: { sha: SHA, ref: "figentra/sta-5-land" },
  ...over,
});
const quiet = { log: () => {}, warn: () => {} };

/**
 * A repository with a two-commit branch in its worktree, and a GitHub stand-in whose merge squashes it onto main and
 * pushes, as GitHub would.
 */
function world({
  failMerge = false,
  review = false,
  merged = false,
  /** @type {{ context: string, integration_id?: number }[]} */ required = [],
  moved = false,
  /** @type {{ filename: string, status: string }[]} */ files = [],
  blocked = false,
  brokenRecord = false,
  branch = "figentra/sta-5-land",
  /** @type {string | undefined} */ spec = undefined,
  /** @type {any[]} */ comments = [],
} = {}) {
  const r = repo();
  const path = join(r.root, ".claude", "worktrees", "sta-5-land");
  sh(r.root, "worktree", "add", "-q", "-b", branch, path, "main");
  commit(path, "a.txt");
  commit(path, "b.txt");
  // STA-1945 AC-40: the review workflow confirmed a blocking finding, recorded on the branch.
  if (blocked) {
    updateRecord(path, "sta-5", (rec) => ({
      ...rec,
      review: [
        {
          sha: "d".repeat(40),
          verdict: "FAIL",
          findings: 1,
          blocking: [{ id: "security-tenancy-1", file: "a.txt", text: "leaks the token" }],
        },
      ],
    }));
    sh(path, "add", "-A");
    sh(path, "commit", "-q", "-m", "record");
  }
  // A record at the head that is not JSON: it could hide a finding.
  if (brokenRecord) {
    mkdirSync(dirname(recordPath(path, "sta-5")), { recursive: true });
    writeFileSync(recordPath(path, "sta-5"), "{ not json\n");
    sh(path, "add", "-A");
    sh(path, "commit", "-q", "-m", "record");
  }
  const head = sh(path, "rev-parse", "HEAD");
  /** GitHub's squash of the branch onto main, pushed. */
  const squash = (/** @type {string} */ title) => {
    sh(r.root, "merge", "-q", "--squash", branch);
    sh(r.root, "commit", "-q", "-m", title);
    sh(r.root, "push", "-q", "origin", "main");
    return sh(r.root, "rev-parse", "HEAD");
  };
  // Auto-merge already happened on GitHub.
  const mergedAs = merged ? squash("feat(flow): land (#7)") : undefined;
  /** @type {{ method: string, path: string, body?: any }[]} */
  const calls = [];
  /** @type {import("../lib/github.mjs").Api} */
  const api = (method, p, body) => {
    calls.push({ method, path: p, body });
    const ok = (/** @type {unknown} */ json) => ({ ok: true, json, err: "" });
    if (method === "GET" && p === "/repos/figentra/flow/pulls/7")
      return ok(
        pr({
          head: { sha: head, ref: branch },
          node_id: "PR_7",
          ...(mergedAs ? { state: "closed", merged: true, merge_commit_sha: mergedAs } : {}),
        }),
      );
    if (p.startsWith(`/repos/figentra/flow/commits/${head}/statuses`)) return ok(GREEN);
    if (p === "/repos/figentra/flow/rules/branches/main")
      return ok([
        {
          type: "required_status_checks",
          parameters: {
            required_status_checks: [{ context: "fflow/gate" }, ...required],
          },
        },
        ...(review
          ? [{ type: "pull_request", parameters: { required_approving_review_count: 1 } }]
          : []),
      ]);
    if (p.startsWith("/repos/figentra/flow/pulls/7/files"))
      return ok(p.endsWith("page=1") ? files : []);
    if (p === `/repos/figentra/flow/git/ref/heads/${branch}`)
      return ok({ object: { sha: moved ? "e".repeat(40) : head } });
    // The spec at the head, when the world has one (ADR 0523 decision 6's advisory review reads its tier).
    if (spec !== undefined && p === `/repos/figentra/flow/contents/.agents/specs?ref=${head}`)
      return ok([{ type: "dir", name: "sta-5-land" }]);
    if (
      spec !== undefined &&
      p.startsWith("/repos/figentra/flow/contents/.agents/specs/sta-5-land/")
    )
      return ok({ content: Buffer.from(spec).toString("base64") });
    if (p.startsWith("/repos/figentra/flow/contents/"))
      return { ok: false, json: undefined, err: "HTTP 404" };
    if (p.startsWith("/repos/figentra/flow/issues/7/comments") && method === "GET")
      return ok(comments.map((c) => ({ ...c, body: c.body.replace("<head>", head) })));
    if (p.startsWith("/repos/figentra/flow/pulls/7/commits"))
      return ok([{ commit: { message: "feat: a" } }]);
    if (method === "PUT" && p === "/repos/figentra/flow/pulls/7/merge") {
      if (failMerge)
        return { ok: false, json: undefined, err: "gh: Head branch was modified (HTTP 409)" };
      return ok({ sha: squash(/** @type {any} */ (body).commit_title) });
    }
    return ok({});
  };
  return { r, branch, path, head, calls, api };
}

test("land: a green PR squash-merges on its head, then Done, the record, the worktree, the branch and a comment", async (t) => {
  const w = world();
  t.after(w.r.dispose);
  /** @type {string[]} */
  const done = [];
  const result = await landOne({
    root: w.r.root,
    repo: "figentra/flow",
    base: "main",
    number: 7,
    gateApp: GATE_APP,
    deps: { api: w.api, done: async (key) => void done.push(key), ...quiet },
  });
  assert.equal(result.code, 0, JSON.stringify(result));
  const merge = w.calls.find((c) => c.method === "PUT");
  assert.deepEqual(merge?.body, {
    merge_method: "squash",
    sha: w.head,
    commit_title: "feat(flow): land (#7)",
    commit_message: "Refs: STA-5\nAI-Review: none",
  });
  assert.deepEqual(done, ["sta-5"]);
  // AC-029: the squash has a new patch id, yet the worktree went and its branch with it.
  assert.equal(existsSync(w.path), false);
  assert.equal(sh(w.r.root, "branch", "--list", w.branch), "");
  assert.deepEqual(
    w.calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.path}`),
    [
      "PUT /repos/figentra/flow/pulls/7/merge",
      `DELETE /repos/figentra/flow/git/refs/heads/${w.branch}`,
      "POST /repos/figentra/flow/issues/7/comments",
    ],
  );
});

// @covers sta-1945:FR-14 sta-1945:AC-42 sta-1945:P-019
test("land: the merge records land done with the PR in the worktree, committed there and never pushed", async (t) => {
  const w = world();
  t.after(w.r.dispose);
  // Work left in the worktree keeps it (clean's rules), so the record can be read after the land.
  writeFileSync(join(w.path, "notes.txt"), "x\n");
  const result = await landOne({
    root: w.r.root,
    repo: "figentra/flow",
    base: "main",
    number: 7,
    gateApp: GATE_APP,
    deps: { api: w.api, done: async () => {}, ...quiet },
  });
  assert.equal(result.code, 0, JSON.stringify(result));
  const record = readRecord(w.path, "sta-5");
  assert.deepEqual([record?.stage, record?.state, record?.prs], ["land", "done", [7]]);
  assert.equal(sh(w.path, "rev-parse", "HEAD^"), w.head);
  assert.equal(sh(w.path, "show", "--name-only", "--format=", "HEAD"), ".flow/record/sta-5.json");
  assert.equal(existsSync(join(w.path, "notes.txt")), true);
  // AC-42: the ledger reads the landing from the record.
  const rows = ledger(allRecords([w.r.root])).rows.map((r) => [r.what, r.key, r.prs]);
  assert.deepEqual(rows, [["landed", "sta-5", [7]]]);
});

test("land: a reviewed tier without an AI review PASS, or with a FAIL, lands with a warning and records the verdict (ADR 0523 decision 6)", async (t) => {
  const spec = "# Spec\n\n**Status**: Tasked\n\n**Tier**: small\n";
  const byReviewer = (/** @type {string} */ body) => ({
    body,
    user: { login: "figentra-flow[bot]", type: "Bot" },
    performed_via_github_app: { slug: "figentra-flow" },
    created_at: "2026-11-04T10:00:00Z",
    updated_at: "2026-11-04T10:00:00Z",
  });
  for (const { comments, line, warns } of [
    { comments: [], line: "AI-Review: none", warns: true },
    {
      comments: [byReviewer("AI-REVIEW: FAIL <head>")],
      line: "AI-Review: FAIL <head>",
      warns: true,
    },
    {
      comments: [byReviewer("AI-REVIEW: PASS <head> base=main")],
      line: "AI-Review: PASS <head>",
      warns: false,
    },
  ]) {
    const w = world({ spec, comments });
    t.after(w.r.dispose);
    /** @type {string[]} */
    const warned = [];
    const result = await landOne({
      root: w.r.root,
      repo: "figentra/flow",
      base: "main",
      number: 7,
      gateApp: GATE_APP,
      reviewer: "figentra-flow",
      deps: {
        api: w.api,
        done: async () => {},
        log: () => {},
        warn: (s) => void warned.push(s),
      },
    });
    assert.equal(result.code, 0, `${line}: ${JSON.stringify(result)}`);
    assert.equal(
      w.calls.find((c) => c.method === "PUT")?.body.commit_message,
      `Refs: STA-5\n${line.replace("<head>", w.head)}`,
    );
    assert.equal(
      warned.some((s) => /warning: advisory, not blocking.*no AI review PASS/.test(s)),
      warns,
      `${line}: ${warned.join("; ")}`,
    );
  }
});

test("land: a confirmed blocking finding in the record at the head refuses the PR and names it (STA-1945 AC-40)", async (t) => {
  const w = world({ blocked: true });
  t.after(w.r.dispose);
  const result = await landOne({
    root: w.r.root,
    repo: "figentra/flow",
    base: "main",
    number: 7,
    gateApp: GATE_APP,
    deps: { api: w.api, done: async () => {}, ...quiet },
  });
  assert.equal(result.code, 1);
  assert.match(
    result.problems?.join("\n") ?? "",
    /the review confirmed a blocking finding: security-tenancy-1 in a\.txt: leaks the token/,
  );
  assert.equal(
    w.calls.some((c) => c.method === "PUT"),
    false,
  );
  assert.deepEqual(
    landRules({
      pr: pr(),
      statuses: GREEN,
      base: "main",
      required: true,
      gateApp: GATE_APP,
      blocking: [],
    }),
    [],
  );
});

test("land: a record at the head that cannot be read refuses the PR, since it could hide a finding (STA-1945 AC-40)", async (t) => {
  const w = world({ brokenRecord: true });
  t.after(w.r.dispose);
  const result = await landOne({
    root: w.r.root,
    repo: "figentra/flow",
    base: "main",
    number: 7,
    gateApp: GATE_APP,
    deps: { api: w.api, done: async () => {}, ...quiet },
  });
  assert.equal(result.code, 1);
  assert.match(
    result.problems?.join("\n") ?? "",
    /the record at the head cannot be read: .*sta-5\.json: not valid JSON/,
  );
  assert.equal(
    w.calls.some((c) => c.method === "PUT"),
    false,
  );
});

test("land: on a branch that is no key branch, `refs` names the squash and nothing moves to Done", async (t) => {
  for (const { what, branch, merged } of [
    { what: "the branch names no issue", branch: "adr/0008-queues", merged: false },
    { what: "the slug only looks like a key", branch: "adr/0008-sta-12-cleanup", merged: false },
    { what: "an auto-merged PR finishing", branch: "adr/0008-sta-12-cleanup", merged: true },
  ]) {
    const w = world({ branch, merged });
    t.after(w.r.dispose);
    /** @type {string[]} */
    const done = [];
    const result = await landOne({
      root: w.r.root,
      repo: "figentra/flow",
      base: "main",
      number: 7,
      gateApp: GATE_APP,
      refs: "sta-1945",
      deps: { api: w.api, done: async (key) => void done.push(key), ...quiet },
    });
    assert.equal(result.code, 0, `${what}: ${JSON.stringify(result)}`);
    if (!merged)
      assert.equal(
        w.calls.find((c) => c.method === "PUT")?.body.commit_message,
        "Refs: STA-1945\nAI-Review: none",
        what,
      );
    assert.ok(!w.calls.some((c) => c.path.includes("/contents/.agents/specs")), what);
    assert.deepEqual(done, [], what);
  }
});

test("land: on a key branch, `refs` leaves the branch's key, its spec gate and its Done in place", async (t) => {
  const w = world({ branch: "figentra/sta-1945-land" });
  t.after(w.r.dispose);
  /** @type {string[]} */
  const done = [];
  const result = await landOne({
    root: w.r.root,
    repo: "figentra/flow",
    base: "main",
    number: 7,
    gateApp: GATE_APP,
    refs: "sta-1945",
    deps: { api: w.api, done: async (key) => void done.push(key), ...quiet },
  });
  assert.equal(result.code, 0, JSON.stringify(result));
  assert.equal(
    w.calls.find((c) => c.method === "PUT")?.body.commit_message,
    "Refs: STA-1945\nAI-Review: none",
  );
  assert.ok(w.calls.some((c) => c.path.includes("/contents/.agents/specs")));
  assert.deepEqual(done, ["sta-1945"]);
});

test("land: a refused merge changes nothing after it; a failed Linear call only warns", async (t) => {
  const refused = world({ failMerge: true });
  t.after(refused.r.dispose);
  const deps = { api: refused.api, done: async () => {}, ...quiet };
  const no = await landOne({
    root: refused.r.root,
    repo: "figentra/flow",
    base: "main",
    number: 7,
    gateApp: GATE_APP,
    deps,
  });
  assert.equal(no.code, 1);
  assert.match(no.problems?.join() ?? "", /Head branch was modified/);
  assert.equal(
    refused.calls.some((c) => c.method === "DELETE"),
    false,
  );
  assert.equal(existsSync(refused.path), true);

  const flaky = world();
  t.after(flaky.r.dispose);
  /** @type {string[]} */
  const warnings = [];
  const warned = await landOne({
    root: flaky.r.root,
    repo: "figentra/flow",
    base: "main",
    number: 7,
    gateApp: GATE_APP,
    deps: {
      api: flaky.api,
      done: async () => Promise.reject(new Error("Linear down")),
      log: () => {},
      warn: (s) => void warnings.push(s),
    },
  });
  assert.equal(warned.code, 3);
  assert.match(warnings.join(), /tracker STA-5 Done: Linear down/);
  assert.ok(flaky.calls.some((c) => c.method === "DELETE"));
});

test("land --stack: lands the bottom, updates the next by a merge commit and a push, and stops at its red gate", async (t) => {
  const w = world();
  t.after(w.r.dispose);
  const top = "figentra/sta-6-top";
  const topPath = join(w.r.root, ".claude", "worktrees", "sta-6-top");
  sh(w.r.root, "worktree", "add", "-q", "-b", top, topPath, w.branch);
  commit(topPath, "c.txt");
  /** @type {import("../lib/github.mjs").Api} */
  const api = (method, p, body) => {
    if (method === "GET" && p === "/repos/figentra/flow/pulls/8")
      return {
        ok: true,
        json: pr({ number: 8, base: { ref: w.branch }, head: { sha: "d".repeat(40), ref: top } }),
        err: "",
      };
    if (method === "GET" && p.startsWith("/repos/figentra/flow/pulls?state=all&head=figentra:"))
      return {
        ok: true,
        json: [{ number: 7, state: "open", base: { ref: "main" }, head: { ref: w.branch } }],
        err: "",
      };
    return w.api(method, p, body);
  };
  /** @type {string[]} */
  const gated = [];
  const result = await landStack({
    root: w.r.root,
    repo: "figentra/flow",
    base: "main",
    number: 8,
    gateApp: GATE_APP,
    deps: { api, done: async () => {}, ...quiet, gate: async (dir) => (gated.push(dir), 1) },
  });
  assert.equal(result.code, 1);
  assert.match(
    "problems" in result ? result.problems.join() : "",
    /#8: fflow gate run exited 1; the stack stops here/,
  );
  assert.deepEqual(gated, [topPath]);
  // The bottom landed; the top got main by a merge commit (two parents), pushed without a rewrite.
  assert.equal(existsSync(w.path), false);
  assert.equal(sh(topPath, "rev-list", "--parents", "-n", "1", "HEAD").split(" ").length, 3);
  assert.equal(sh(w.r.origin, "rev-parse", `refs/heads/${top}`), sh(topPath, "rev-parse", "HEAD"));
});

test("land: a required review with no land lane on the base refuses, naming secrets.oidc; nothing is dispatched or merged", async (t) => {
  const w = world({ review: true });
  t.after(w.r.dispose);
  // Even with an approval workflow of the retired dispatched kind installed, land never dispatches it.
  mkdirSync(join(w.r.root, ".github/workflows"), { recursive: true });
  writeFileSync(join(w.r.root, ".github/workflows/fflow-approve.yml"), "name: x\n");
  const refused = await landOne({
    root: w.r.root,
    repo: "figentra/flow",
    base: "main",
    number: 7,
    gateApp: GATE_APP,
    deps: { api: w.api, done: async () => {}, ...quiet },
  });
  assert.equal(refused.code, 1);
  assert.match(
    refused.problems?.join() ?? "",
    /requires an approving review the head lacks.*takes no fflow:land request: add secrets\.oidc/,
  );
  assert.deepEqual(
    w.calls.filter((c) => c.method !== "GET"),
    [],
  );
  assert.ok(!w.calls.some((c) => /dispatches|graphql/.test(c.path)));
  assert.equal(existsSync(w.path), true, "nothing after the merge ran");
});

test("land: a merged PR only finishes: Done, the worktree, the branch and a comment", async (t) => {
  const w = world({ merged: true });
  t.after(w.r.dispose);
  /** @type {string[]} */
  const done = [];
  const result = await landOne({
    root: w.r.root,
    repo: "figentra/flow",
    base: "main",
    number: 7,
    gateApp: GATE_APP,
    deps: { api: w.api, done: async (key) => void done.push(key), ...quiet },
  });
  assert.equal(result.code, 0, JSON.stringify(result));
  assert.deepEqual(done, ["sta-5"]);
  assert.equal(existsSync(w.path), false);
  assert.deepEqual(
    w.calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.path}`),
    [
      `DELETE /repos/figentra/flow/git/refs/heads/${w.branch}`,
      "POST /repos/figentra/flow/issues/7/comments",
    ],
  );
});

test("land: a merged PR finishes only on its base, and keeps a branch that moved after the merge", async (t) => {
  const elsewhere = world({ merged: true });
  t.after(elsewhere.r.dispose);
  const deps = { done: async () => {}, ...quiet };
  const other = await landOne({
    root: elsewhere.r.root,
    repo: "figentra/flow",
    base: "release",
    number: 7,
    gateApp: GATE_APP,
    deps: { ...deps, api: elsewhere.api },
  });
  assert.deepEqual(other, { code: 1, problems: ["#7 merged into main, not release"] });

  const moved = world({ merged: true, moved: true });
  t.after(moved.r.dispose);
  /** @type {string[]} */
  const warnings = [];
  const kept = await landOne({
    root: moved.r.root,
    repo: "figentra/flow",
    base: "main",
    number: 7,
    gateApp: GATE_APP,
    deps: { ...deps, api: moved.api, warn: (s) => void warnings.push(s) },
  });
  assert.equal(kept.code, 3);
  assert.match(warnings.join(), /delete the branch: .* is at e{40}, not the landed/);
  assert.equal(
    moved.calls.some((c) => c.method === "DELETE"),
    false,
  );
});

test("land: the branch's slash stays a path separator in both the read and the delete", async (t) => {
  const w = world();
  t.after(w.r.dispose);
  await landOne({
    root: w.r.root,
    repo: "figentra/flow",
    base: "main",
    number: 7,
    gateApp: GATE_APP,
    deps: { api: w.api, done: async () => {}, ...quiet },
  });
  const refs = w.calls.filter((c) => c.path.includes("/git/ref"));
  assert.deepEqual(
    refs.map((c) => `${c.method} ${c.path}`),
    [
      "GET /repos/figentra/flow/git/ref/heads/figentra/sta-5-land",
      "DELETE /repos/figentra/flow/git/refs/heads/figentra/sta-5-land",
    ],
  );
});

// @covers sta-1945:FR-5 sta-1945:AC-5 sta-1945:P-008
test("land: a path an override's extend of owner-only adds is the owner's to land", async (t) => {
  const w = world({ files: [{ filename: "deploy/run.sh", status: "added" }] });
  t.after(w.r.dispose);
  mkdirSync(join(w.r.root, ".flow/overrides/policies"), { recursive: true });
  writeFileSync(
    join(w.r.root, ".flow/overrides/policies/owner.yml"),
    'kind: extend\ntarget: owner-only\nitems:\n  - "deploy/**"\n',
  );
  const result = await landOne({
    root: w.r.root,
    repo: "figentra/flow",
    base: "main",
    number: 7,
    gateApp: GATE_APP,
    deps: { api: w.api, done: async () => {}, ...quiet },
  });
  assert.equal(result.code, 1);
  assert.match(
    result.problems?.join() ?? "",
    /owner-only paths, so the owner lands it: deploy\/run\.sh/,
  );
  assert.ok(!w.calls.some((c) => c.method === "PUT"), "nothing merges");
});

test("land: an unreadable package.json refuses, and so do 300 changed files", async (t) => {
  const deps = { done: async () => {}, ...quiet };
  const unread = world({ files: [{ filename: "packages/x/package.json", status: "modified" }] });
  t.after(unread.r.dispose);
  const a = await landOne({
    root: unread.r.root,
    repo: "figentra/flow",
    base: "main",
    number: 7,
    gateApp: GATE_APP,
    deps: { ...deps, api: unread.api },
  });
  assert.equal(a.code, 1);
  assert.match(
    a.problems?.join() ?? "",
    /packages\/x\/package\.json cannot be read at the merge base/,
  );

  const many = world({
    files: Array.from({ length: 300 }, (_, i) => ({ filename: `f${i}.txt`, status: "added" })),
  });
  t.after(many.r.dispose);
  const b = await landOne({
    root: many.r.root,
    repo: "figentra/flow",
    base: "main",
    number: 7,
    gateApp: GATE_APP,
    deps: { ...deps, api: many.api },
  });
  assert.equal(b.code, 1);
  assert.match(b.problems?.join() ?? "", /300 files changed, at the approval check's limit of 300/);
});

/**
 * A stack of PRs #7, #8, … each in its own worktree on the one below, and a GitHub stand-in that keeps their state:
 * a head is origin's tip, a merge squashes onto main and pushes, deleting a head branch retargets the PRs on it
 * (unless `retarget` is off), and `fflow/gate` from the gate App is on each commit the injected gate passed.
 * @param {{ layers: [string, string][][], files?: Record<string, string>, retarget?: boolean,
 *           failPatch?: boolean, hotfix?: [string, string], gateCode?: number, crash?: boolean,
 *           hide?: number, lane?: boolean }} options  `layers[i]` is PR i's commits, bottom first; `hotfix` lands
 *   on main right after the bottom PR merges; `crash` throws right after that merge, its branch deleted (the process
 *   died); `hide` leaves that PR out of the head lookup; with `lane`, main's approval workflow takes `LAND_LABEL`
 *   and a PR merges at its tip when it is labelled, as main's land lane would
 */
function stackWorld({
  layers,
  files = {},
  retarget = true,
  failPatch = false,
  hotfix,
  gateCode = 0,
  crash = false,
  hide,
  lane = false,
}) {
  const r = repo(files);
  /** @type {{ number: number, branch: string, path: string, base: string, merged?: string, head?: string }[]} */
  const prs = [];
  let below = "main";
  for (const [i, layer] of layers.entries()) {
    const branch = `figentra/sta-${5 + i}-layer${i}`;
    const path = join(r.root, ".claude", "worktrees", `sta-${5 + i}-layer${i}`);
    sh(r.root, "worktree", "add", "-q", "-b", branch, path, below);
    for (const [name, text] of layer) commit(path, name, text);
    sh(path, "push", "-q", "origin", branch);
    prs.push({ number: 7 + i, branch, path, base: below });
    below = branch;
  }
  const tip = (/** @type {string} */ branch) => {
    try {
      return sh(r.origin, "rev-parse", "-q", "--verify", `refs/heads/${branch}`);
    } catch {
      return undefined;
    }
  };
  const passed = new Set([tip(prs[0].branch)]);
  /** @type {{ method: string, path: string, body?: any }[]} */
  const calls = [];
  /** @type {string[]} */
  const logs = [];
  const view = (/** @type {(typeof prs)[number]} */ p) => ({
    number: p.number,
    state: p.merged ? "closed" : "open",
    merged: Boolean(p.merged),
    merged_at: p.merged ? "2026-11-02T00:00:00Z" : null,
    merge_commit_sha: p.merged ?? null,
    draft: false,
    mergeable_state: "clean",
    title: `feat(flow): layer ${p.number}`,
    node_id: `PR_${p.number}`,
    base: { ref: p.base },
    head: { ref: p.branch, sha: p.head ?? tip(p.branch) },
  });
  const ok = (/** @type {unknown} */ json) => ({ ok: true, json, err: "" });
  const no = (/** @type {string} */ err) => ({ ok: false, json: undefined, err });
  /** GitHub's squash of PR `p` at `sha`, pushed; a refusal's text, or the squash commit. */
  const squash = (/** @type {(typeof prs)[number]} */ p, /** @type {string} */ sha, title = "") => {
    if (p.base !== "main") return no(`#${p.number} is based on ${p.base}`);
    if (sha !== tip(p.branch)) return no("Head branch was modified (HTTP 409)");
    sh(r.root, "fetch", "-q", "origin");
    sh(r.root, "merge", "-q", "--squash", `origin/${p.branch}`);
    sh(r.root, "commit", "-q", "-m", title || `feat(flow): layer ${p.number} (#${p.number})`);
    sh(r.root, "push", "-q", "origin", "main");
    p.head = sha;
    p.merged = sh(r.root, "rev-parse", "HEAD");
    if (hotfix && p === prs[0]) {
      commit(r.root, ...hotfix);
      sh(r.root, "push", "-q", "origin", "main");
    }
    if (crash && p === prs[0]) {
      sh(r.origin, "update-ref", "-d", `refs/heads/${p.branch}`);
      for (const x of prs) if (x.base === p.branch) x.base = "main";
      throw new Error("killed after the merge");
    }
    return ok({ sha: p.merged });
  };
  /** @type {import("../lib/github.mjs").Api} */
  const api = (method, full, body) => {
    calls.push({ method, path: full, body });
    const b = /** @type {any} */ (body);
    const at = full.replace("/repos/figentra/flow", "");
    const n = Number(at.match(/^\/(?:pulls|issues)\/(\d+)/)?.[1]);
    const p = prs.find((x) => x.number === n);
    if (lane && at === `/contents/.github/workflows/${APPROVE_WORKFLOW}?ref=main`)
      return ok({ content: Buffer.from(`# ${LAND_LABEL}\n`).toString("base64") });
    // Main's land lane: the label's event approves and merges the PR at its tip.
    if (lane && method === "POST" && p && at === `/issues/${n}/labels`) {
      const merged = squash(p, tip(p.branch) ?? "");
      return merged.ok ? ok([]) : merged;
    }
    if (method === "GET" && p && at === `/pulls/${n}`) return ok(view(p));
    if (method === "GET" && at.startsWith("/pulls?state=all&head=figentra:")) {
      const branch = decodeURIComponent(at.split("head=figentra:")[1]);
      return ok(prs.filter((x) => x.branch === branch && x.number !== hide).map(view));
    }
    if (/^\/commits\/\w+\/statuses/.test(at)) return ok(passed.has(at.split("/")[2]) ? GREEN : []);
    if (at === "/rules/branches/main")
      return ok([
        {
          type: "required_status_checks",
          parameters: { required_status_checks: [{ context: "fflow/gate" }] },
        },
      ]);
    if (method === "GET" && at.startsWith("/git/ref/heads/")) {
      const sha = tip(at.slice("/git/ref/heads/".length));
      return sha ? ok({ object: { sha } }) : no("HTTP 404");
    }
    if (at.startsWith("/contents/")) return no("HTTP 404");
    if (method === "PUT" && p && at === `/pulls/${n}/merge`)
      return squash(p, b.sha, b.commit_title);
    if (method === "DELETE" && at.startsWith("/git/refs/heads/")) {
      const branch = at.slice("/git/refs/heads/".length);
      sh(r.origin, "update-ref", "-d", `refs/heads/${branch}`);
      if (retarget) for (const x of prs) if (x.base === branch) x.base = "main";
      return ok({});
    }
    if (method === "PATCH" && p) {
      if (failPatch) return no("HTTP 422");
      p.base = b.base;
      return ok({});
    }
    if (/^\/pulls\/\d+\/commits/.test(at)) return ok([{ commit: { message: "feat: x" } }]);
    return ok([]);
  };
  /** @type {string[]} */
  const gated = [];
  const deps = {
    api,
    done: async () => {},
    log: (/** @type {string} */ s) => void logs.push(s),
    warn: () => {},
    gate: async (/** @type {string} */ dir) => {
      gated.push(dir);
      if (gateCode === 0) passed.add(sh(dir, "rev-parse", "HEAD"));
      return gateCode;
    },
  };
  /** `fflow land --stack <top>` against this world. */
  const land = (/** @type {{ number?: number, dry?: boolean, wait?: number }} */ over = {}) =>
    landStack({
      root: r.root,
      repo: "figentra/flow",
      base: "main",
      number: prs[prs.length - 1].number,
      gateApp: GATE_APP,
      deps,
      ...over,
    });
  const main = (/** @type {string} */ name) => sh(r.root, "show", `origin/main:${name}`);
  return { r, prs, calls, logs, gated, land, main, tip };
}

/** Three PRs, each adding its own file. */
const THREE = /** @type {[string, string][][]} */ ([
  [["a.txt", "a\n"]],
  [["b.txt", "b\n"]],
  [["c.txt", "c\n"]],
]);

test("land --stack: --dry-run prints the plan, checks the bottom and changes nothing", async (t) => {
  const w = stackWorld({ layers: THREE });
  t.after(w.r.dispose);
  const tips = w.prs.map((p) => w.tip(p.branch));
  const result = await w.land({ dry: true });
  assert.equal(result.code, 0, JSON.stringify(result));
  assert.match(w.logs.join("\n"), /#7 → #8 → #9 into main, bottom first/);
  assert.match(w.logs.join("\n"), /would squash-merge #7/);
  assert.match(w.logs.join("\n"), /would merge main into figentra\/sta-6-layer1 .*retarget #8/);
  assert.match(w.logs.join("\n"), /would merge main into figentra\/sta-7-layer2 .*retarget #9/);
  assert.deepEqual(
    w.calls.filter((c) => c.method !== "GET"),
    [],
  );
  assert.deepEqual(
    w.prs.map((p) => w.tip(p.branch)),
    tips,
  );
  assert.deepEqual(w.gated, []);
});

test("land --stack: a clean three-PR stack lands bottom-up with no human step, each update a merge commit", async (t) => {
  const w = stackWorld({ layers: THREE });
  t.after(w.r.dispose);
  const heads = w.prs.map((p) => w.tip(p.branch) ?? "");
  const result = await w.land();
  assert.equal(result.code, 0, JSON.stringify(result));
  assert.deepEqual(
    w.prs.map((p) => Boolean(p.merged)),
    [true, true, true],
  );
  assert.deepEqual([w.main("a.txt"), w.main("b.txt"), w.main("c.txt")], ["a", "b", "c"]);
  // Each upper PR was gated on its new head, which keeps its old head as an ancestor: a merge, never a rewrite.
  assert.deepEqual(w.gated, [w.prs[1].path, w.prs[2].path]);
  for (const [i, p] of w.prs.entries())
    assert.equal(sh(w.r.root, "merge-base", "--is-ancestor", heads[i], p.head ?? ""), "");
  assert.equal(
    w.calls.some((c) => c.method === "PATCH"),
    false,
  );
  for (const p of w.prs) assert.equal(existsSync(p.path), false);
});

test("land --stack: a conflict that is only the landed parent's change is resolved; any other stops and names the file", async (t) => {
  const layers = /** @type {[string, string][][]} */ ([
    [["shared.txt", "one\n"]],
    [["shared.txt", "two\n"]],
  ]);
  const w = stackWorld({ layers, files: { "shared.txt": "zero\n" } });
  t.after(w.r.dispose);
  const result = await w.land();
  assert.equal(result.code, 0, JSON.stringify(result));
  assert.equal(w.main("shared.txt"), "two");
  assert.match(
    w.logs.join("\n"),
    /#8: resolved shared\.txt, where main holds the landed parent's version/,
  );

  const real = stackWorld({ layers: THREE, hotfix: ["b.txt", "hotfix\n"] });
  t.after(real.r.dispose);
  const before = sh(real.prs[1].path, "rev-parse", "HEAD");
  const stopped = await real.land();
  assert.equal(stopped.code, 1);
  assert.match(
    stopped.problems?.join() ?? "",
    /#8: merging main into figentra\/sta-6-layer1 conflicts in b\.txt, which main changed beyond the landed parent; the merge is aborted/,
  );
  // The bottom landed; the next is untouched and unmerged, its worktree clean.
  assert.deepEqual(
    real.prs.map((p) => Boolean(p.merged)),
    [true, false, false],
  );
  assert.equal(sh(real.prs[1].path, "rev-parse", "HEAD"), before);
  assert.equal(sh(real.prs[1].path, "status", "--porcelain"), "");
});

test("land --stack: a PR GitHub did not retarget is retargeted; a refused retarget stops with the PR on its old base", async (t) => {
  const two = THREE.slice(0, 2);
  const w = stackWorld({ layers: two, retarget: false });
  t.after(w.r.dispose);
  const result = await w.land();
  assert.equal(result.code, 0, JSON.stringify(result));
  assert.deepEqual(
    w.calls.filter((c) => c.method === "PATCH").map((c) => [c.path, c.body]),
    [["/repos/figentra/flow/pulls/8", { base: "main" }]],
  );
  assert.equal(w.prs[1].base, "main");

  const refused = stackWorld({ layers: two, retarget: false, failPatch: true });
  t.after(refused.r.dispose);
  const stopped = await refused.land();
  assert.equal(stopped.code, 1);
  assert.match(
    stopped.problems?.join() ?? "",
    /#8: retargeting to main failed: HTTP 422; it stays on `figentra\/sta-5-layer0`/,
  );
  assert.equal(refused.prs[1].merged, undefined);
});

test("land --stack: run again after a stop, it resumes from the record and lands the rest", async (t) => {
  const w = stackWorld({ layers: THREE, hotfix: ["b.txt", "hotfix\n"] });
  t.after(w.r.dispose);
  assert.equal((await w.land()).code, 1);
  // GitHub retargeted #8 when #7's branch went, so only the record still names #8's landed parent.
  assert.equal(w.prs[1].base, "main");
  // The human resolves the real conflict in #8's worktree and commits; Flow pushes, gates and lands from there.
  const path = w.prs[1].path;
  try {
    sh(path, "merge", "-q", "--no-edit", "origin/main");
  } catch {
    // conflicts, as the stop said
  }
  writeFileSync(join(path, "b.txt"), "both\n");
  sh(path, "add", "b.txt");
  sh(path, "commit", "-q", "--no-edit");
  const result = await w.land();
  assert.equal(result.code, 0, JSON.stringify(result));
  assert.deepEqual(
    w.prs.map((p) => Boolean(p.merged)),
    [true, true, true],
  );
  // #9 took b.txt as its parent's resolution left it, and kept its own c.txt.
  assert.equal(w.main("b.txt"), "both");
  assert.equal(w.main("c.txt"), "c");
  assert.equal(readFileSync(join(w.r.root, "b.txt"), "utf8"), "both\n");
});

test("land --stack: a PR stacked on a branch with no open PR and none merged refuses before any change", async (t) => {
  const w = stackWorld({ layers: THREE, hide: 8 });
  t.after(w.r.dispose);
  const result = await w.land();
  assert.equal(result.code, 1);
  assert.match(
    result.problems?.join() ?? "",
    /#9 is stacked on `figentra\/sta-6-layer1`, which has no open PR and none merged into main/,
  );
  assert.deepEqual(
    w.calls.filter((c) => c.method !== "GET"),
    [],
  );
});

test("land --stack: the next PR stops when it has no worktree, its push is refused or its gate fails", async (t) => {
  const two = THREE.slice(0, 2);
  const gone = stackWorld({ layers: two });
  t.after(gone.r.dispose);
  sh(gone.r.root, "worktree", "remove", "--force", gone.prs[1].path);
  const a = await gone.land();
  assert.equal(a.code, 1);
  assert.match(
    a.problems?.join() ?? "",
    /#8 \(figentra\/sta-6-layer1\) has no local worktree to update/,
  );
  assert.deepEqual(
    gone.prs.map((p) => Boolean(p.merged)),
    [true, false],
  );

  const refused = stackWorld({ layers: two });
  t.after(refused.r.dispose);
  const hooks = join(refused.r.origin, "hooks");
  mkdirSync(hooks, { recursive: true });
  writeFileSync(
    join(hooks, "pre-receive"),
    '#!/bin/sh\nwhile read o n ref; do [ "$ref" = refs/heads/figentra/sta-6-layer1 ] && { echo denied >&2; exit 1; }; done\nexit 0\n',
    { mode: 0o755 },
  );
  const b = await refused.land();
  assert.equal(b.code, 1);
  assert.match(b.problems?.join() ?? "", /#8: push failed: .*denied/s);
  assert.equal(refused.prs[1].merged, undefined);

  const red = stackWorld({ layers: two, gateCode: 1 });
  t.after(red.r.dispose);
  const c = await red.land();
  assert.equal(c.code, 1);
  assert.match(c.problems?.join() ?? "", /#8: fflow gate run exited 1; the stack stops here/);
  assert.deepEqual(red.gated, [red.prs[1].path]);
  assert.equal(red.prs[1].merged, undefined);
});

test("land --stack: a run that dies right after a merge resumes, the next PR's parent recorded before it", async (t) => {
  const layers = /** @type {[string, string][][]} */ ([
    [["shared.txt", "one\n"]],
    [["shared.txt", "two\n"]],
  ]);
  const w = stackWorld({ layers, files: { "shared.txt": "zero\n" }, crash: true });
  t.after(w.r.dispose);
  await assert.rejects(w.land(), /killed after the merge/);
  // GitHub retargeted #8 and #7's finish never ran: only the record written before the merge names the parent.
  assert.equal(w.prs[1].base, "main");
  const result = await w.land();
  assert.equal(result.code, 0, JSON.stringify(result));
  assert.equal(w.main("shared.txt"), "two");
  assert.match(
    w.logs.join("\n"),
    /#8: resolved shared\.txt, where main holds the landed parent's version/,
  );
});

// ---- the L2 design's label path (PR E) --------------------------------------------------------------------------

/**
 * `w`'s GitHub with main's approval workflow taking `LAND_LABEL`. After the request, each read of the PR is the next
 * of `steps` (the last repeats): `merged` squashes the branch onto main, `head` moves it, `verdict` is the newest
 * status on the head. `before` is a verdict already on the head from an earlier request.
 * @param {ReturnType<typeof world>} w
 * @param {{ labelled?: boolean, before?: object, steps?: { merged?: boolean, head?: string, verdict?: object }[] }} [o]
 */
function onLane(w, { labelled = false, before, steps = [{}] } = {}) {
  let asked = false;
  let poll = -1;
  /** @type {string | undefined} */
  let merged;
  let prReads = 0;
  /** @returns {{ merged?: boolean, head?: string, verdict?: object }} */
  const step = () => (asked ? steps[Math.min(poll, steps.length - 1)] : {});
  const ok = (/** @type {unknown} */ json) => ({ ok: true, json, err: "" });
  /** @type {import("../lib/github.mjs").Api} */
  const api = (method, p, body) => {
    if (p === `/repos/figentra/flow/contents/.github/workflows/${APPROVE_WORKFLOW}?ref=main`) {
      w.calls.push({ method, path: p });
      return ok({ content: Buffer.from(`# ${LAND_LABEL}\n`).toString("base64") });
    }
    const r = w.api(method, p, body);
    const b = /** @type {any} */ (body);
    if (
      method === "POST" &&
      (p.endsWith("/issues/7/labels") ||
        (p.endsWith("/issues/7/comments") && b?.body === LAND_COMMAND))
    )
      asked = true;
    if (method === "GET" && p === "/repos/figentra/flow/pulls/7") {
      prReads++;
      if (asked) poll++;
      const s = step();
      if (s.merged && !merged) {
        sh(w.r.root, "merge", "-q", "--squash", w.branch);
        sh(w.r.root, "commit", "-q", "-m", "feat(flow): land (#7)");
        sh(w.r.root, "push", "-q", "origin", "main");
        merged = sh(w.r.root, "rev-parse", "HEAD");
      }
      return ok({
        ...r.json,
        labels: labelled ? [{ name: LAND_LABEL }] : [],
        ...(merged ? { state: "closed", merged: true, merge_commit_sha: merged } : {}),
        ...(s.head ? { head: { ...r.json.head, sha: s.head } } : {}),
      });
    }
    if (p.startsWith(`/repos/figentra/flow/commits/${w.head}/statuses`)) {
      const s = step();
      return ok([...(s.verdict ? [s.verdict] : []), ...(before ? [before] : []), ...GREEN]);
    }
    return r;
  };
  return { api, prReads: () => prReads };
}

/** A verdict of main's land lane on the head. */
const verdict = (
  /** @type {string} */ state,
  /** @type {string} */ description,
  id = 2,
  login = GATE_APP,
) => ({
  id,
  context: LAND_CONTEXT,
  state,
  description,
  creator: { login },
});

/**
 * `landOne` on `w` through `api`, without real waits.
 * @param {ReturnType<typeof world>} w
 * @param {import("../lib/github.mjs").Api} api
 * @param {{ wait?: number, dry?: boolean }} [over]
 */
async function landVia(w, api, over = {}) {
  /** @type {string[]} */
  const logs = [];
  let slept = 0;
  const result = await landOne({
    root: w.r.root,
    repo: "figentra/flow",
    base: "main",
    number: 7,
    gateApp: GATE_APP,
    deps: {
      api,
      done: async () => {},
      log: (s) => void logs.push(s),
      warn: () => {},
      sleep: async () => void slept++,
    },
    ...over,
  });
  return { result, logs, slept };
}

test("land: when the base's workflow takes the label, land adds it and waits for the merge; never dispatch, auto-merge or merge", async (t) => {
  const w = world({ review: true });
  t.after(w.r.dispose);
  const waiting = verdict("pending", "waiting: required checks still running: verify");
  const lane = onLane(w, {
    steps: [
      { verdict: waiting },
      { verdict: waiting },
      { verdict: verdict("success", "approved: ok", 3) },
      { merged: true },
    ],
  });
  const { result, logs } = await landVia(w, lane.api);
  assert.equal(result.code, 0, JSON.stringify(result));
  assert.ok(result.merged);
  const writes = w.calls.filter((c) => c.method !== "GET");
  assert.deepEqual(
    writes.map((c) => `${c.method} ${c.path}`),
    [
      "POST /repos/figentra/flow/issues/7/labels",
      `DELETE /repos/figentra/flow/git/refs/heads/${w.branch}`,
      "POST /repos/figentra/flow/issues/7/comments",
    ],
  );
  assert.deepEqual(writes[0].body, { labels: [LAND_LABEL] });
  assert.ok(!w.calls.some((c) => /dispatches|graphql|\/merge$/.test(c.path)));
  // Each new verdict is printed once.
  assert.equal(logs.filter((l) => l.includes("waiting: required checks")).length, 1);
  assert.equal(existsSync(w.path), false, "finish ran");
});

test("land: an already-labelled PR is asked again by exactly one comment", async (t) => {
  const w = world();
  t.after(w.r.dispose);
  const { result } = await landVia(w, onLane(w, { labelled: true, steps: [{ merged: true }] }).api);
  assert.equal(result.code, 0, JSON.stringify(result));
  const asks = w.calls.filter((c) => c.method === "POST" && c.body?.body === LAND_COMMAND);
  assert.equal(asks.length, 1);
  assert.ok(!w.calls.some((c) => c.path.endsWith("/labels")));
});

test("land: the wait ends on a refusal, the owner, a moved head or a timeout; a status from another creator is ignored", async (t) => {
  const sticky = {
    body: `${LAND_MARKER}\nhead: <head> state: refused\n\n- the title is bad\n- spec: no approval\n\nFix it.`,
    user: { login: GATE_APP, type: "Bot" },
    created_at: "2026-11-04T10:00:00Z",
    updated_at: "2026-11-04T10:00:00Z",
  };
  const refused = world({ comments: [sticky] });
  t.after(refused.r.dispose);
  const no = await landVia(
    refused,
    onLane(refused, { steps: [{ verdict: verdict("failure", "refused: the title is bad") }] }).api,
  );
  assert.equal(no.result.code, 1);
  assert.deepEqual(no.result.problems, ["the title is bad", "spec: no approval"]);

  const owner = world();
  t.after(owner.r.dispose);
  const theirs = await landVia(
    owner,
    onLane(owner, { steps: [{ verdict: verdict("pending", "owner: owner-only paths: x") }] }).api,
  );
  assert.equal(theirs.result.code, 4);
  assert.equal(theirs.result.owner, true);

  const moved = world();
  t.after(moved.r.dispose);
  const gone = await landVia(moved, onLane(moved, { steps: [{ head: "f".repeat(40) }] }).api);
  assert.equal(gone.result.code, 1);
  assert.match(gone.result.problems?.join() ?? "", /the head moved to f+; land again/);

  const slow = world();
  t.after(slow.r.dispose);
  const late = await landVia(slow, onLane(slow).api, { wait: 0.05 });
  assert.equal(late.result.code, 4);
  assert.equal(late.result.queued, true);
  assert.equal(late.slept, 1);
  assert.match(late.logs.join("\n"), /still queued .*`fflow land 7` again finishes it/);

  const spoof = world();
  t.after(spoof.r.dispose);
  const fake = await landVia(
    spoof,
    onLane(spoof, { steps: [{ verdict: verdict("failure", "refused: x", 2, "someone") }] }).api,
    { wait: 0.05 },
  );
  assert.equal(
    fake.result.code,
    4,
    "a status from a login that is not the gate App's does not count",
  );
});

test("land: a verdict from an earlier request does not answer this one; --no-wait returns once asked", async (t) => {
  const stale = world();
  t.after(stale.r.dispose);
  const old = verdict("failure", "refused: an earlier reason", 1);
  const lane = onLane(stale, { before: old, steps: [{}, { merged: true }] });
  const { result } = await landVia(stale, lane.api);
  assert.equal(result.code, 0, JSON.stringify(result));

  const quick = world();
  t.after(quick.r.dispose);
  const q = onLane(quick);
  const asked = await landVia(quick, q.api, { wait: 0 });
  assert.deepEqual(asked.result, { code: 0, queued: true, requested: true });
  assert.equal(q.prReads(), 1, "no wait: the PR is read only before the request");
});

test("land: --dry-run names the label path and changes nothing", async (t) => {
  const w = world();
  t.after(w.r.dispose);
  const { result, logs } = await landVia(w, onLane(w).api, { dry: true });
  assert.equal(result.code, 0);
  assert.match(logs.join("\n"), new RegExp(`would request the land with ${LAND_LABEL}`));
  assert.deepEqual(
    w.calls.filter((c) => c.method !== "GET"),
    [],
  );
});

test("land: a branch GitHub already deleted after the merge counts as deleted", async (t) => {
  const w = world({ merged: true });
  t.after(w.r.dispose);
  /** @type {import("../lib/github.mjs").Api} */
  const api = (method, p, body) =>
    p === `/repos/figentra/flow/git/ref/heads/${w.branch}`
      ? { ok: false, json: undefined, err: "gh: Not Found (HTTP 404)" }
      : w.api(method, p, body);
  const { result } = await landVia(w, api);
  assert.equal(result.code, 0, JSON.stringify(result));
  assert.ok(!w.calls.some((c) => c.method === "DELETE"));
});

test("land --stack: on the label path each PR is asked for and waited on, so the stack goes on after each merge", async (t) => {
  const w = stackWorld({ layers: THREE, lane: true });
  t.after(w.r.dispose);
  const result = await w.land({ wait: 1 });
  assert.equal(result.code, 0, JSON.stringify(result));
  assert.deepEqual(
    w.prs.map((p) => Boolean(p.merged)),
    [true, true, true],
  );
  assert.deepEqual([w.main("a.txt"), w.main("b.txt"), w.main("c.txt")], ["a", "b", "c"]);
  assert.deepEqual(
    w.calls.filter((c) => c.path.endsWith("/labels")).map((c) => c.path),
    [7, 8, 9].map((n) => `/repos/figentra/flow/issues/${n}/labels`),
  );
  assert.ok(!w.calls.some((c) => c.method === "PUT" || /dispatches|graphql/.test(c.path)));
});
