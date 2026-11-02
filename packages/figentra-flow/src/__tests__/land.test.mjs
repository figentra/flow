/**
 * Figentra Flow file contract:
 * Purpose: hold `fflow land` to its contract: every rule refuses with its reason (state, draft, conflict, stacked
 *   base, no, red or foreign gate, title, approvals, the ruleset before phase 6); a green PR squash-merges on its exact
 *   head with `Refs:` and co-author trailers, then Linear Done, the merge commit recorded, the worktree removed though
 *   its squash has a new patch id, the branch deleted and a comment; a refused merge changes nothing after it; a
 *   failed Linear call only warns; `--stack` lands bottom-up and stops at a red gate, the next PR updated by a merge
 *   commit and a normal push. STA-1856: an owner-only path refuses; a ruleset that requires a review gets the
 *   approval workflow dispatched and auto-merge turned on at the head instead of a merge, or a refusal when the
 *   workflow is not installed; `land` on a merged PR runs only the steps after the merge.
 * Boundary: temporary repositories with a local bare origin; GitHub, Linear and the gate injected; no network.
 * Runtime: node
 * Governing contract: ADR 0022; Stackra ADR 0503; STA-1729 phase 3.
 */
// @covers sta-1729:FR-6 sta-1729:AC-010 sta-1729:AC-011 sta-1729:AC-017 sta-1729:AC-029 sta-1729:AC-030 sta-1729:P-006
// @covers sta-1856:FR-1 sta-1856:FR-2 sta-1856:FR-3 sta-1856:FR-6
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { landOne, landRules, landStack, squashMessage } from "../commands/land.mjs";

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
const PASSED = { verdict: "PASS", ignored: [] };

test("rules: a green, approved, conventional PR on main may land; each rule names its reason", () => {
  const ok = { pr: pr(), statuses: GREEN, base: "main", required: true, gateApp: GATE_APP };
  assert.deepEqual(landRules(ok), []);
  const cases = [
    [{ pr: pr({ state: "closed" }) }, /is closed/],
    [{ pr: pr({ draft: true }) }, /draft/],
    [{ pr: pr({ mergeable_state: "dirty" }) }, /conflicts with main/],
    [{ pr: pr({ base: { ref: "figentra/sta-4-x" } }) }, /stacked on `figentra\/sta-4-x`.*--stack/],
    [{ statuses: [] }, /no fflow\/gate on the head c{12}/],
    [
      {
        statuses: [
          { context: "fflow/gate", state: "failure", creator: { login: GATE_APP } },
          ...GREEN,
        ],
      },
      /is failure/,
    ],
    [
      {
        statuses: [{ context: "fflow/gate", state: "success", creator: { login: "someone" } }],
      },
      /posted by someone, not figentra-gate\[bot\]/,
    ],
    [{ pr: pr({ title: "Land it" }) }, /conventional commit header/],
    [{ required: false }, /does not require fflow\/gate yet.*--manual-ok/],
  ];
  for (const [over, reason] of cases)
    assert.match(
      landRules({ ...ok, .../** @type {object} */ (over) }).join("\n"),
      /** @type {RegExp} */ (reason),
    );
  assert.deepEqual(landRules({ ...ok, required: false, manualOk: true }), []);
  assert.deepEqual(landRules({ ...ok, pr: pr({ base: { ref: "x" } }), stack: true }), []);
});

test("rules: a feature spec needs its approval and Tasked; a spec without a tier passes", () => {
  const ok = {
    pr: pr(),
    statuses: GREEN,
    base: "main",
    required: true,
    gateApp: GATE_APP,
    review: PASSED,
  };
  const feature = (/** @type {string} */ status) =>
    `# Spec\n\n**Status**: ${status}\n\n**Tier**: feature\n\n**Approver**: leader\n\n## Status history\n\n- Draft → Clarified\n`;
  assert.match(
    landRules({ ...ok, spec: feature("Planned") }).join("\n"),
    /lands from Tasked or later; it is planned/,
  );
  // At Tasked without the recorded stop, the approval rule of ADR 0502 refuses.
  assert.match(landRules({ ...ok, spec: feature("Tasked") }).join("\n"), /^spec: /m);
  assert.deepEqual(landRules({ ...ok, spec: "# Spec\n\n**Status**: Draft\n" }), []);
});

test("rules: a change with a spec needs the AI review PASS on its head (AC-031); trivial work, with no spec, is exempt", () => {
  const base = { pr: pr(), statuses: GREEN, base: "main", required: true, gateApp: GATE_APP };
  const small = "# Spec\n\n**Status**: Tasked\n\n**Tier**: small\n";
  assert.deepEqual(landRules(base), []);
  assert.deepEqual(landRules({ ...base, spec: "# Spec\n\n**Tier**: trivial\n" }), []);
  assert.match(
    landRules({ ...base, spec: small }).join(),
    /no AI review PASS for c{40} \(counted verdict: none\).*AI-REVIEW: PASS c{40} base=main/,
  );
  assert.match(
    landRules({
      ...base,
      spec: small,
      review: { verdict: "FAIL", ignored: ["x is not the stackra-reviewer app"] },
    }).join(),
    /counted verdict: FAIL.*ignored: x is not the stackra-reviewer app/,
  );
  // `review.required` narrows the tiers: a small change passes when only feature and big need the review.
  assert.deepEqual(landRules({ ...base, spec: small, reviewTiers: ["feature", "big"] }), []);
  assert.equal(
    landRules({ ...base, spec: "# Spec\n\n**Tier**: trivial\n", reviewTiers: ["trivial"] }).length,
    1,
  );
  assert.deepEqual(landRules({ ...base, spec: small, review: PASSED }), []);
});

test("squash message: one Refs line and each co-author once", () => {
  const commits = [
    { commit: { message: "feat: a\n\nCo-authored-by: Ann <a@x>" } },
    { commit: { message: "fix: b\n\nCo-Authored-By: Ann <a@x>\nCo-authored-by: Bo <b@x>" } },
  ];
  assert.equal(
    squashMessage("sta-5", commits),
    "Refs: STA-5\nCo-Authored-By: Ann <a@x>\nCo-Authored-By: Bo <b@x>",
  );
});

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
} = {}) {
  const r = repo();
  const branch = "figentra/sta-5-land";
  const path = join(r.root, ".claude", "worktrees", "sta-5-land");
  sh(r.root, "worktree", "add", "-q", "-b", branch, path, "main");
  commit(path, "a.txt");
  commit(path, "b.txt");
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
    if (p.startsWith("/repos/figentra/flow/contents/"))
      return { ok: false, json: undefined, err: "HTTP 404" };
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
    commit_message: "Refs: STA-5",
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
    if (method === "GET" && p.startsWith("/repos/figentra/flow/pulls?state=open&head=figentra:"))
      return {
        ok: true,
        json: [{ number: 7, base: { ref: "main" }, head: { ref: w.branch } }],
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

test("rules: with no gate App configured nothing lands", () => {
  const problems = landRules({ pr: pr(), statuses: GREEN, base: "main", required: true });
  assert.match(problems.join(), /no gate App is configured: set apps\.gate\.login/);
});

test("rules: a PR that changes an owner-only path is the owner's to land (STA-1856 FR-1)", () => {
  const ok = { pr: pr(), statuses: GREEN, base: "main", required: true, gateApp: GATE_APP };
  assert.deepEqual(landRules({ ...ok, files: ["src/a.mjs", ".agents/agents/git-steward.md"] }), []);
  assert.match(landRules({ ...ok, files: [".GitHub/Workflows/x.yml"] }).join(), /owner-only paths/);
  assert.match(
    landRules({ ...ok, files: ["deploy/run.sh"], ownerOnly: ["deploy/**"] }).join(),
    /owner-only paths, so the owner lands it: deploy\/run\.sh/,
  );
  assert.match(
    landRules({ ...ok, ownerFindings: ["package.json: the root scripts changed"] }).join(),
    /owner-only change, so the owner lands it: package\.json: the root scripts changed/,
  );
  assert.match(
    landRules({
      ...ok,
      files: ["src/a.mjs", ".github/workflows/ci.yml", "pnpm-workspace.yaml"],
    }).join(),
    /owner-only paths, so the owner lands it: \.github\/workflows\/ci\.yml, pnpm-workspace\.yaml/,
  );
});

test("land: a required review dispatches the approval workflow and turns on auto-merge at the head, never a merge", async (t) => {
  const w = world({ review: true });
  t.after(w.r.dispose);
  const land = () =>
    landOne({
      root: w.r.root,
      repo: "figentra/flow",
      base: "main",
      number: 7,
      gateApp: GATE_APP,
      deps: { api: w.api, done: async () => {}, ...quiet },
    });
  const missing = await land();
  assert.equal(missing.code, 1);
  assert.match(
    missing.problems?.join() ?? "",
    /requires an approving review.*fflow-approve\.yml is not installed/,
  );

  mkdirSync(join(w.r.root, ".github/workflows"), { recursive: true });
  writeFileSync(join(w.r.root, ".github/workflows/fflow-approve.yml"), "name: x\n");
  const queued = await land();
  assert.deepEqual(queued, { code: 0, queued: true });
  const writes = w.calls.filter((c) => c.method !== "GET");
  assert.deepEqual(
    writes.map((c) => `${c.method} ${c.path}`),
    ["POST /repos/figentra/flow/actions/workflows/fflow-approve.yml/dispatches", "POST /graphql"],
  );
  assert.deepEqual(writes[0].body, { ref: "main", inputs: { pr: "7", head: w.head } });
  assert.match(
    writes[1].body.query,
    /enablePullRequestAutoMerge.*mergeMethod: SQUASH, expectedHeadOid: \$head/s,
  );
  assert.deepEqual(writes[1].body.variables, {
    id: "PR_7",
    head: w.head,
    title: "feat(flow): land (#7)",
    body: "Refs: STA-5",
  });
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

test("land: required checks still running wait, without asking for the approval; an unpinned one refuses", async (t) => {
  const w = world({ review: true, required: [{ context: "verify", integration_id: 15368 }] });
  t.after(w.r.dispose);
  mkdirSync(join(w.r.root, ".github/workflows"), { recursive: true });
  writeFileSync(join(w.r.root, ".github/workflows/fflow-approve.yml"), "name: x\n");
  const deps = { api: w.api, done: async () => {}, ...quiet };
  const base = {
    root: w.r.root,
    repo: "figentra/flow",
    base: "main",
    number: 7,
    gateApp: GATE_APP,
    deps,
  };
  const waiting = await landOne(base);
  assert.deepEqual(waiting, { code: 4, queued: true, waiting: ["verify"] });
  assert.deepEqual(
    w.calls.filter((c) => c.method !== "GET"),
    [],
    "nothing dispatched",
  );

  const loose = world({ review: true, required: [{ context: "ci" }] });
  t.after(loose.r.dispose);
  mkdirSync(join(loose.r.root, ".github/workflows"), { recursive: true });
  writeFileSync(join(loose.r.root, ".github/workflows/fflow-approve.yml"), "name: x\n");
  const refused = await landOne({ ...base, root: loose.r.root, deps: { ...deps, api: loose.api } });
  assert.equal(refused.code, 1);
  assert.match(refused.problems?.join() ?? "", /required check: ci is pinned to no App/);
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
