/**
 * Figentra Flow file contract:
 * Purpose: hold `figentra-flow land` to its contract: every rule refuses with its reason (state, draft, conflict, stacked
 *   base, no, red or foreign gate, title, approvals, the ruleset before phase 6); a green PR squash-merges on its exact
 *   head with `Refs:` and co-author trailers, then Linear Done, the merge commit recorded, the worktree removed though
 *   its squash has a new patch id, the branch deleted and a comment; a refused merge changes nothing after it; a
 *   failed Linear call only warns; `--stack` lands bottom-up and stops at a red gate, the next PR updated by a merge
 *   commit and a normal push.
 * Boundary: temporary repositories with a local bare origin; GitHub, Linear and the gate injected; no network.
 * Runtime: node
 * Governing contract: ADR 0022; Stackra ADR 0503; STA-1729 phase 3.
 */
// @covers sta-1729:FR-6 sta-1729:AC-010 sta-1729:AC-011 sta-1729:AC-017 sta-1729:AC-029 sta-1729:AC-030 sta-1729:P-006
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { landOne, landRules, landStack, squashMessage } from "../commands/land.mjs";

/** The gate App login the configuration names. */
const GATE_APP = "figentra-gate[bot]";
import { commit, repo, sh } from "./__fixtures__/repo.mjs";

const SHA = "c".repeat(40);
const GREEN = [{ context: "figentra-flow/gate", state: "success", creator: { login: GATE_APP } }];
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
    [{ statuses: [] }, /no figentra-flow\/gate on the head c{12}/],
    [
      {
        statuses: [
          { context: "figentra-flow/gate", state: "failure", creator: { login: GATE_APP } },
          ...GREEN,
        ],
      },
      /is failure/,
    ],
    [
      {
        statuses: [
          { context: "figentra-flow/gate", state: "success", creator: { login: "someone" } },
        ],
      },
      /posted by someone, not figentra-gate\[bot\]/,
    ],
    [{ pr: pr({ title: "Land it" }) }, /conventional commit header/],
    [{ required: false }, /does not require figentra-flow\/gate yet.*--manual-ok/],
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
function world({ failMerge = false } = {}) {
  const r = repo();
  const branch = "figentra/sta-5-land";
  const path = join(r.root, ".claude", "worktrees", "sta-5-land");
  sh(r.root, "worktree", "add", "-q", "-b", branch, path, "main");
  commit(path, "a.txt");
  commit(path, "b.txt");
  const head = sh(path, "rev-parse", "HEAD");
  /** @type {{ method: string, path: string, body?: any }[]} */
  const calls = [];
  /** @type {import("../lib/github.mjs").Api} */
  const api = (method, p, body) => {
    calls.push({ method, path: p, body });
    const ok = (/** @type {unknown} */ json) => ({ ok: true, json, err: "" });
    if (method === "GET" && p === "/repos/figentra/flow/pulls/7")
      return ok(pr({ head: { sha: head, ref: branch } }));
    if (p.startsWith(`/repos/figentra/flow/commits/${head}/statuses`)) return ok(GREEN);
    if (p === "/repos/figentra/flow/rules/branches/main")
      return ok([
        {
          type: "required_status_checks",
          parameters: { required_status_checks: [{ context: "figentra-flow/gate" }] },
        },
      ]);
    if (p.startsWith("/repos/figentra/flow/contents/"))
      return { ok: false, json: undefined, err: "HTTP 404" };
    if (p.startsWith("/repos/figentra/flow/pulls/7/commits"))
      return ok([{ commit: { message: "feat: a" } }]);
    if (method === "PUT" && p === "/repos/figentra/flow/pulls/7/merge") {
      if (failMerge)
        return { ok: false, json: undefined, err: "gh: Head branch was modified (HTTP 409)" };
      sh(r.root, "merge", "-q", "--squash", branch);
      sh(r.root, "commit", "-q", "-m", /** @type {any} */ (body).commit_title);
      sh(r.root, "push", "-q", "origin", "main");
      return ok({ sha: sh(r.root, "rev-parse", "HEAD") });
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
    /#8: figentra-flow gate run exited 1; the stack stops here/,
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
