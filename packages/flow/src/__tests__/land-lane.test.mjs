/**
 * Figentra Flow file contract:
 * Purpose: hold main's event-driven approve and merge lane to the L2 design (PR D):
 *   - `requestProblems`: a write or admin User and a listed Bot may ask; a read or triage User, an unlisted Bot,
 *     `github-actions` and the Flow App may not, and a label re-added by a non-writer does not count;
 *   - `select` and `land-route.mjs`: only open, labelled PRs on the default branch with their head here and no HOLD;
 *   - `approve-check.mjs` in event mode: approves at the head once, never twice; HOLD, a frozen or `merge-only`
 *     automation variable and the land rules (title, spec approvals) refuse; the AI review is advisory; pending
 *     checks are `waiting`, owner-only changes `owner`; the sticky comment is made once, rewritten only on change, and
 *     the status is not reposted when nothing changed; nothing is minted when nothing is written;
 *   - `merge.mjs`: merges at the head with `sha` only with the Flow App's approval at that head or, for an owner-only
 *     change, the owner's; `merge-workflows` only for an owner-approved workflow change; refuses every
 *     `mergeable_state` but clean, unstable and has_hooks; a 405 on a merged PR is success, a 409 a waiting comment;
 *     one token per PR, in PR order, with the key from the default branch's configuration;
 *   - every comment the lane writes starts with `LAND_MARKER`;
 *   - the rendered lane: its triggers, guards, permissions, environment, concurrency, pinned integrity, and no event
 *     text in a `run:` block; `sync` renders it only with `secrets.oidc`.
 * Boundary: a fake GitHub (injected REST functions) and temporary folders; no network.
 * Runtime: node
 * Governing contract: ADR 0523; the L2 design (PR D; Tests); STA-1945.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sync } from "../commands/sync.mjs";
import { classify, main as approve, requestProblems, select } from "../lib/approve-check.mjs";
import { approveWorkflow } from "../lib/approve-workflow.mjs";
import { SCHEMA, validate } from "../lib/config.mjs";
import { main as route } from "../lib/land-route.mjs";
import { main as merge } from "../lib/merge.mjs";
import {
  APPROVE_ENVIRONMENT,
  APPROVE_WORKFLOW,
  AUTOMATION_VARIABLE,
  HOLD_LABEL,
  LAND_COMMAND,
  LAND_CONTEXT,
  LAND_LABEL,
  LAND_MARKER,
  NAME,
  STATUS_CONTEXT,
} from "../lib/product.mjs";

const REPO = "figentra/x";
const SHA = "a".repeat(40);
const BASE = "b".repeat(40);
const FORK = "c".repeat(40);
const OLD = "d".repeat(40);
const MERGED = "e".repeat(40);
const FLOW = "figentra-flow[bot]";
const OWNER = "figentra-usr";
const OIDC = {
  identityId: "0f4b2c1e-9a8d-4c3b-8e7f-6a5b4c3d2e1f",
  audience: "fflow-ci",
  domain: "https://eu.infisical.com",
  projectId: "86c297d4-ce42-4e94-b4b3-810a715812f2",
  env: "prod",
  path: "/ci/gate",
};
const ENV = Object.freeze({
  MODE: "event",
  AUTOMATION: "on",
  REPO,
  DEFAULT_BRANCH: "main",
  GITHUB_REF: "refs/heads/main",
  ENVIRONMENT: APPROVE_ENVIRONMENT,
  RUN_URL: "https://github.com/run/1",
  TRUSTED: JSON.stringify({ [STATUS_CONTEXT]: FLOW }),
  OWNER_ONLY_EXTRA: "[]",
  REQUESTERS: '["stackra-bot"]',
  REVIEWERS: '["stackra-reviewer"]',
  OWNER,
  OIDC: JSON.stringify(OIDC),
});
const GATE = { context: STATUS_CONTEXT, state: "success", creator: { login: FLOW } };
const BOT_LABEL = {
  id: 1,
  event: "labeled",
  label: { name: LAND_LABEL },
  actor: { login: "stackra-bot[bot]", type: "Bot" },
  performed_via_github_app: { slug: "stackra-bot" },
};

/**
 * A PR on main from this repository, labelled `LAND_LABEL`.
 * @param {number} number
 * @param {Record<string, any>} [over]
 */
const pullRequest = (number, over = {}) => ({
  number,
  state: "open",
  draft: false,
  merged: false,
  title: "feat(x): a thing",
  mergeable_state: "clean",
  node_id: `PR_${number}`,
  head: { sha: SHA, ref: `figentra/sta-${number}-thing`, repo: { full_name: REPO } },
  base: { sha: BASE, ref: "main" },
  user: { login: "stackra-bot[bot]" },
  labels: [{ name: LAND_LABEL }],
  ...over,
});

/**
 * A stateful fake GitHub: writes change what later reads see. `over` replaces parts of one safe, green PR #7.
 * @param {Record<string, any>} [over]
 */
function github(over = {}) {
  const s = {
    prs: [pullRequest(7)],
    issues: /** @type {any[] | undefined} */ (undefined),
    events: [BOT_LABEL],
    permissions: /** @type {Record<string, string>} */ ({}),
    files: [{ filename: "src/a.mjs", status: "modified" }],
    statuses: [GATE],
    runs: /** @type {any[]} */ ([]),
    required: [{ context: STATUS_CONTEXT }],
    reviews: /** @type {any[]} */ ([]),
    comments: /** @type {any[]} */ ([]),
    spec: /** @type {string | undefined} */ (undefined),
    config: JSON.stringify({ tracker: { kind: "linear", team: "STA", branchPrefix: "figentra" } }),
    mergeStatus: 200,
    mergedAfter: false,
    ...over,
  };
  /** @type {{ method: string, path: string, body?: any, token?: string }[]} */
  const writes = [];
  const ok = (/** @type {unknown} */ json) => ({ ok: true, status: 200, json });
  const missing = { ok: false, status: 404, json: undefined };
  const pr = (/** @type {number} */ n) => s.prs.find((p) => p.number === n);
  /** @type {import("../lib/approve-check.mjs").Rest} */
  const read = async (method, path) => {
    const [p, query = ""] = path.split("?");
    const page = Number(new URLSearchParams(query).get("page") ?? "1");
    const list = (/** @type {any[]} */ items) => ok(page > 1 ? [] : items);
    if (p === `/repos/${REPO}`) return ok({ default_branch: "main" });
    if (p === `/repos/${REPO}/environments/${APPROVE_ENVIRONMENT}`)
      return ok({ deployment_branch_policy: { custom_branch_policies: true } });
    if (p === `/repos/${REPO}/environments/${APPROVE_ENVIRONMENT}/deployment-branch-policies`)
      return ok({ branch_policies: [{ name: "main", type: "branch" }] });
    if (p === `/repos/${REPO}/issues`)
      return list(
        s.issues ?? s.prs.map((x) => ({ number: x.number, pull_request: {}, labels: x.labels })),
      );
    let m = p.match(/^\/repos\/figentra\/x\/pulls\/(\d+)$/);
    if (m) return pr(Number(m[1])) ? ok(pr(Number(m[1]))) : missing;
    m = p.match(/^\/repos\/figentra\/x\/issues\/(\d+)\/events$/);
    if (m) return list(s.events);
    m = p.match(/^\/repos\/figentra\/x\/collaborators\/(.+)\/permission$/);
    if (m) return ok({ permission: s.permissions[decodeURIComponent(m[1])] ?? "none" });
    if (p === `/repos/${REPO}/compare/${BASE}...${SHA}`)
      return ok({ files: s.files, merge_base_commit: { sha: FORK } });
    if (p === `/repos/${REPO}/contents/.agents/specs`)
      return s.spec ? ok([{ type: "dir", name: "sta-7-thing" }]) : missing;
    if (p === `/repos/${REPO}/contents/.agents/specs/sta-7-thing/spec.md`)
      return ok({ content: Buffer.from(String(s.spec)).toString("base64") });
    if (p === `/repos/${REPO}/contents/flow.config.json` && query === "ref=main")
      return ok({ content: Buffer.from(s.config).toString("base64") });
    if (p === `/repos/${REPO}/contents/.github/CODEOWNERS`)
      return ok({ content: Buffer.from("x").toString("base64") });
    if (p.startsWith(`/repos/${REPO}/contents/`)) return missing;
    if (p === `/repos/${REPO}/rules/branches/main`)
      return ok([
        { type: "required_status_checks", parameters: { required_status_checks: s.required } },
        { type: "pull_request", parameters: { require_code_owner_review: true } },
      ]);
    if (p === `/repos/${REPO}/commits/${SHA}/statuses`) return list(s.statuses);
    if (p === `/repos/${REPO}/commits/${SHA}/check-runs`) return ok({ check_runs: s.runs });
    if (p === `/repos/${REPO}/commits/${SHA}`)
      return ok({ author: { login: "builder" }, committer: { login: "web-flow" } });
    m = p.match(/^\/repos\/figentra\/x\/pulls\/(\d+)\/reviews$/);
    if (m) return list(s.reviews);
    m = p.match(/^\/repos\/figentra\/x\/issues\/(\d+)\/comments$/);
    if (m) return list(s.comments);
    m = p.match(/^\/repos\/figentra\/x\/pulls\/(\d+)\/commits$/);
    if (m) return list([{ commit: { message: "x\n\nCo-authored-by: Ann <ann@example.com>" } }]);
    throw new Error(`unexpected ${method} ${path}`);
  };
  /**
   * The App's API, as `token`.
   * @param {string} [token]
   * @returns {import("../lib/approve-check.mjs").Rest}
   */
  const writer = (token) => async (method, path, body) => {
    writes.push({ method, path, body, token });
    const b = /** @type {any} */ (body);
    let m = path.match(/^\/repos\/figentra\/x\/pulls\/(\d+)\/reviews$/);
    if (method === "POST" && m) {
      s.reviews.push({ id: 42, state: "APPROVED", commit_id: b.commit_id, user: { login: FLOW } });
      return ok({ id: 42 });
    }
    m = path.match(/^\/repos\/figentra\/x\/issues\/(\d+)\/comments$/);
    if (method === "POST" && m) {
      const c = { id: s.comments.length + 1, body: b.body, user: { login: FLOW } };
      s.comments.push({ ...c, html_url: `https://github.com/${REPO}/pull/${m[1]}#c${c.id}` });
      return ok(s.comments.at(-1));
    }
    m = path.match(/^\/repos\/figentra\/x\/issues\/comments\/(\d+)$/);
    if (method === "PATCH" && m) {
      const c = s.comments.find((x) => x.id === Number(m?.[1]));
      c.body = b.body;
      return ok(c);
    }
    if (method === "POST" && path === `/repos/${REPO}/statuses/${SHA}`) {
      s.statuses.unshift({ ...b, creator: { login: FLOW } });
      return ok({});
    }
    m = path.match(/^\/repos\/figentra\/x\/pulls\/(\d+)\/merge$/);
    if (method === "PUT" && m) {
      const n = Number(m[1]);
      if (s.mergeStatus !== 200) {
        if (s.mergedAfter) Object.assign(pr(n), { merged: true, merge_commit_sha: MERGED });
        return {
          ok: false,
          status: s.mergeStatus,
          json: { message: "Base branch was modified" },
        };
      }
      Object.assign(pr(n), { merged: true, state: "closed" });
      return ok({ sha: MERGED, merged: true });
    }
    if (method === "DELETE" && path.includes("/labels/")) return ok([]);
    throw new Error(`unexpected write ${method} ${path}`);
  };
  return { s, read, write: writer(), writer, writes };
}

/** Runs the approve sweep against `gh`. */
const sweep = async (/** @type {ReturnType<typeof github>} */ gh, env = {}) =>
  approve({ ...ENV, ...env }, { read: gh.read, write: gh.write, log: () => {} });

/** The writes as `METHOD path`. */
const calls = (/** @type {{ method: string, path: string }[]} */ writes) =>
  writes.map((w) => `${w.method} ${w.path}`);

// ---- requestProblems --------------------------------------------------------------------------------------------

test("request: a write or admin User and a listed Bot may ask; anyone else may not", async () => {
  /**
   * The problems for one `labeled` event (`actor`, `slug`) or a list of events.
   * @param {any[]} events
   * @param {Record<string, string>} [permissions]
   */
  const problems = (events, permissions = {}) =>
    requestProblems(github({ events, permissions }).read, REPO, 7, ["stackra-bot"], [FLOW]);
  const by = (/** @type {string} */ login, type = "User", slug = undefined, id = 1) => ({
    id,
    event: "labeled",
    label: { name: LAND_LABEL },
    actor: { login, type },
    ...(slug ? { performed_via_github_app: { slug } } : {}),
  });
  assert.deepEqual(await problems([by("ann")], { ann: "write" }), []);
  assert.deepEqual(await problems([by("ann")], { ann: "admin" }), []);
  for (const p of ["read", "triage", "none"])
    assert.match(
      (await problems([by("ann")], { ann: p })).join(),
      new RegExp(`permission is ${p}`),
    );
  assert.deepEqual(await problems([BOT_LABEL]), []);
  assert.match(
    (await problems([by("other-bot[bot]", "Bot", "other-bot")])).join(),
    /an App approve\.requesters does not list/,
  );
  assert.match(
    (await problems([by("github-actions[bot]", "Bot", "github-actions")])).join(),
    /never requests a land/,
  );
  assert.match((await problems([by(FLOW, "Bot", "figentra-flow")])).join(), /never requests/);
  // The App's own slug through another login is still the App.
  assert.match((await problems([by("x[bot]", "Bot", "figentra-flow")])).join(), /never requests/);
  // Removed, then re-added by a non-writer: the newest adder counts.
  assert.match(
    (
      await problems(
        [
          by("ann", "User", undefined, 1),
          { id: 2, event: "unlabeled", label: { name: LAND_LABEL }, actor: { login: "ann" } },
          by("eve", "User", undefined, 3),
        ],
        { ann: "admin", eve: "triage" },
      )
    ).join(),
    /eve, whose permission is triage/,
  );
  // Another label's event is not a request.
  assert.match(
    (await problems([{ ...by("ann"), label: { name: "docs" } }], { ann: "admin" })).join(),
    /no one is recorded adding/,
  );
});

// ---- select and route -------------------------------------------------------------------------------------------

test("route: only open, labelled PRs on the default branch with their head here and no HOLD count", async () => {
  const gh = github({
    prs: [
      pullRequest(1),
      pullRequest(2, { labels: [{ name: LAND_LABEL }, { name: HOLD_LABEL }] }),
      pullRequest(3, { base: { sha: BASE, ref: "release" } }),
      pullRequest(4, { head: { sha: SHA, ref: "x", repo: { full_name: "eve/x" } } }),
      pullRequest(5, { state: "closed" }),
    ],
  });
  // An issue, not a PR, never counts.
  gh.s.issues = [
    { number: 9, labels: [{ name: LAND_LABEL }] },
    ...gh.s.prs.map((p) => ({ number: p.number, pull_request: {}, labels: p.labels })),
  ];
  assert.deepEqual(
    (await select(gh.read, REPO, "main")).map((p) => p.number),
    [1],
  );
  /** @type {string[]} */
  const out = [];
  const env = { REPO, DEFAULT_BRANCH: "main" };
  assert.equal(await route(env, { read: gh.read, log: () => {}, output: (l) => out.push(l) }), 0);
  gh.s.issues = [];
  await route(env, { read: gh.read, log: () => {}, output: (l) => out.push(l) });
  assert.deepEqual(out, ["any=true\n", "any=false\n"]);
});

// ---- approve, event mode ----------------------------------------------------------------------------------------

test("approve: a valid request is approved at its head once, with the sticky comment and the status", async () => {
  const gh = github();
  assert.equal(await sweep(gh), 0);
  assert.deepEqual(calls(gh.writes), [
    `POST /repos/${REPO}/pulls/7/reviews`,
    `POST /repos/${REPO}/issues/7/comments`,
    `POST /repos/${REPO}/statuses/${SHA}`,
  ]);
  assert.equal(gh.writes[0].body.commit_id, SHA);
  assert.equal(gh.writes[0].body.event, "APPROVE");
  assert.equal(gh.writes[1].body.body.split("\n")[0], LAND_MARKER);
  assert.equal(gh.writes[1].body.body.split("\n")[1], `head: ${SHA} state: approved`);
  assert.equal(gh.writes[2].body.context, LAND_CONTEXT);
  assert.equal(gh.writes[2].body.state, "success");
  assert.match(gh.writes[2].body.target_url, /^https:\/\/github\.com\/.*#c1$/);
  // A repeated event: no second approval, no rewrite, no status, and so nothing minted.
  const before = gh.writes.length;
  let minted = 0;
  const again = await approve(ENV, {
    read: gh.read,
    log: () => {},
    mint: async () => {
      minted++;
      throw new Error("nothing should be minted");
    },
  });
  assert.equal(again, 0);
  assert.equal(minted, 0);
  assert.equal(gh.writes.length, before);
});

test("approve: an existing Flow approval at the head is not posted again", async () => {
  const gh = github({
    reviews: [{ id: 1, state: "APPROVED", commit_id: SHA, user: { login: FLOW } }],
  });
  await sweep(gh);
  assert.equal(calls(gh.writes).includes(`POST /repos/${REPO}/pulls/7/reviews`), false);
  // At an older head it is not the same approval.
  const older = github({
    reviews: [{ id: 1, state: "APPROVED", commit_id: OLD, user: { login: FLOW } }],
  });
  await sweep(older);
  assert.equal(calls(older.writes)[0], `POST /repos/${REPO}/pulls/7/reviews`);
});

test("approve: a frozen, missing or merge-only automation variable, or HOLD, posts nothing", async () => {
  for (const AUTOMATION of ["", "frozen", "merge-only", "off"]) {
    const gh = github();
    assert.equal(await sweep(gh, { AUTOMATION }), 0);
    assert.deepEqual(gh.writes, [], AUTOMATION);
  }
  const held = github({
    prs: [pullRequest(7, { labels: [{ name: LAND_LABEL }, { name: HOLD_LABEL }] })],
  });
  await sweep(held);
  assert.deepEqual(held.writes, []);
});

test("approve: an unlisted requester, a bad title or a spec without its approvals refuses", async () => {
  const stranger = github({
    events: [{ ...BOT_LABEL, performed_via_github_app: { slug: "other" } }],
  });
  await sweep(stranger);
  assert.equal(calls(stranger.writes).includes(`POST /repos/${REPO}/pulls/7/reviews`), false);
  assert.match(stranger.writes[0].body.body, /state: refused/);
  assert.match(stranger.writes[0].body.body, /approve\.requesters does not list/);
  assert.equal(stranger.writes[1].body.state, "failure");

  const title = github({ prs: [pullRequest(7, { title: "a thing" })] });
  await sweep(title);
  assert.match(title.writes[0].body.body, /not a conventional commit header/);

  const spec = github({
    spec: "**Status**: Draft\n**Tier**: feature\n",
    config: JSON.stringify({ tracker: { kind: "linear", team: "STA", branchPrefix: "figentra" } }),
  });
  await sweep(spec);
  assert.match(spec.writes[0].body.body, /state: refused/);
  assert.match(spec.writes[0].body.body, /- spec: /);
});

test("approve: the AI review is advisory, so a PR with no verdict is approved", async () => {
  const gh = github({
    comments: [{ id: 5, body: `AI-REVIEW: FAIL ${SHA}`, user: { login: "stackra-bot[bot]" } }],
  });
  await sweep(gh);
  assert.equal(calls(gh.writes)[0], `POST /repos/${REPO}/pulls/7/reviews`);
});

test("approve: running checks wait, owner-only changes are the owner's, and the comment is rewritten only on change", async () => {
  const gh = github({ statuses: [{ ...GATE, state: "pending" }] });
  await sweep(gh);
  assert.deepEqual(calls(gh.writes), [
    `POST /repos/${REPO}/issues/7/comments`,
    `POST /repos/${REPO}/statuses/${SHA}`,
  ]);
  assert.match(gh.writes[0].body.body, /state: waiting/);
  assert.equal(gh.writes[1].body.state, "pending");
  assert.match(gh.writes[1].body.description, /^waiting: /);
  // Unchanged: nothing is written. Changed: the one comment is edited, not a second posted.
  await sweep(gh);
  assert.equal(gh.writes.length, 2);
  gh.s.statuses = [GATE];
  await sweep(gh);
  assert.deepEqual(calls(gh.writes).slice(2), [
    `POST /repos/${REPO}/pulls/7/reviews`,
    `PATCH /repos/${REPO}/issues/comments/1`,
    `POST /repos/${REPO}/statuses/${SHA}`,
  ]);
  assert.equal(gh.s.comments.length, 1);

  const owner = github({ files: [{ filename: ".github/workflows/ci.yml", status: "modified" }] });
  await sweep(owner);
  assert.match(owner.writes[0].body.body, /state: owner/);
  assert.match(owner.writes[0].body.body, /owner-only paths: \.github\/workflows\/ci\.yml/);
  assert.equal(owner.writes[1].body.state, "pending");
  assert.match(owner.writes[1].body.description, /^owner: /);
});

test("classify: no reasons approve; only waiting reasons wait; owner reasons are the owner's; anything else refuses", () => {
  assert.equal(classify([]), "approved");
  assert.equal(classify(["required checks still running: verify", "the PR is a draft"]), "waiting");
  assert.equal(classify([`${STATUS_CONTEXT} is pending on the head x`]), "waiting");
  assert.equal(
    classify(["owner-only paths: a", "required checks still running: x"], ["owner-only paths: a"]),
    "owner",
  );
  assert.equal(
    classify(["owner-only paths: a", "the title is bad"], ["owner-only paths: a"]),
    "refused",
  );
  assert.equal(classify(["required checks failed: verify"]), "refused");
});

// ---- merge ------------------------------------------------------------------------------------------------------

/**
 * Runs the merge lane against `gh`, recording each minted role.
 * @param {ReturnType<typeof github>} gh
 * @param {Record<string, string>} [env]
 */
async function lane(gh, env = {}) {
  /** @type {string[]} */
  const roles = [];
  /** @type {string[]} */
  const log = [];
  const code = await merge(
    { ...ENV, ...env },
    {
      read: gh.read,
      write: gh.writer,
      withToken: async (role, _options, use) => {
        roles.push(role);
        return use(`token-${roles.length}`, "figentra-flow");
      },
      log: (l) => log.push(l),
    },
  );
  return { code, roles, log };
}

const FLOW_OK = { id: 1, state: "APPROVED", commit_id: SHA, user: { login: FLOW, type: "Bot" } };
const OWNER_OK = { id: 2, state: "APPROVED", commit_id: SHA, user: { login: OWNER, type: "User" } };

test("merge: the Flow App's approval at the head merges with sha, the key from main's config and the label removed", async () => {
  const gh = github({ reviews: [FLOW_OK] });
  const r = await lane(gh);
  assert.equal(r.code, 0);
  assert.deepEqual(r.roles, ["merge"]);
  assert.deepEqual(calls(gh.writes), [
    `PUT /repos/${REPO}/pulls/7/merge`,
    `DELETE /repos/${REPO}/issues/7/labels/${encodeURIComponent(LAND_LABEL)}`,
    `POST /repos/${REPO}/issues/7/comments`,
  ]);
  const body = gh.writes[0].body;
  assert.equal(body.sha, SHA);
  assert.equal(body.merge_method, "squash");
  assert.equal(body.commit_title, "feat(x): a thing (#7)");
  assert.match(body.commit_message, /^Refs: STA-7\nAI-Review: none\nCo-Authored-By: Ann/);
  assert.match(gh.writes[2].body.body, new RegExp(`state: merged[\\s\\S]*merged as ${MERGED}`));
});

test("merge: no approval, a dismissed one or one at an older head merges nothing", async () => {
  for (const reviews of [
    [],
    [{ ...FLOW_OK, state: "DISMISSED" }],
    [{ ...FLOW_OK, commit_id: OLD }],
    [FLOW_OK, { ...FLOW_OK, id: 3, state: "CHANGES_REQUESTED" }],
  ]) {
    const gh = github({ reviews });
    const r = await lane(gh);
    assert.equal(r.code, 0);
    assert.deepEqual(gh.writes, [], JSON.stringify(reviews));
  }
});

test("merge: an owner-only change needs the owner's approval; a workflow change mints merge-workflows", async () => {
  const workflow = [{ filename: ".github/workflows/ci.yml", status: "modified" }];
  const flowOnly = github({ files: workflow, reviews: [FLOW_OK] });
  await lane(flowOnly);
  assert.deepEqual(flowOnly.writes, [], "the Flow App never merges an owner-only change");

  const owner = github({ files: workflow, reviews: [OWNER_OK] });
  const r = await lane(owner);
  assert.deepEqual(r.roles, ["merge-workflows"]);
  assert.equal(owner.writes[0].path, `/repos/${REPO}/pulls/7/merge`);

  const plain = github({ reviews: [OWNER_OK] });
  assert.deepEqual((await lane(plain)).roles, ["merge"]);
});

test("merge: every mergeable_state but clean, unstable and has_hooks waits", async () => {
  for (const state of ["blocked", "dirty", "behind", "unknown", null]) {
    const gh = github({ prs: [pullRequest(7, { mergeable_state: state })], reviews: [FLOW_OK] });
    await lane(gh);
    assert.deepEqual(gh.writes, [], String(state));
  }
  for (const state of ["unstable", "has_hooks"]) {
    const gh = github({ prs: [pullRequest(7, { mergeable_state: state })], reviews: [FLOW_OK] });
    await lane(gh);
    assert.equal(gh.writes[0]?.method, "PUT", state);
  }
});

test("merge: a 405 on a PR that merged meanwhile is success; a 409 writes a waiting comment and keeps the label", async () => {
  const done = github({ reviews: [FLOW_OK], mergeStatus: 405, mergedAfter: true });
  const r = await lane(done);
  assert.equal(r.code, 0);
  assert.match(r.log.join("\n"), new RegExp(`#7 merged as ${MERGED}`));
  assert.deepEqual(calls(done.writes), [`PUT /repos/${REPO}/pulls/7/merge`]);

  const conflict = github({ reviews: [FLOW_OK], mergeStatus: 409 });
  assert.equal((await lane(conflict)).code, 0);
  assert.deepEqual(calls(conflict.writes), [
    `PUT /repos/${REPO}/pulls/7/merge`,
    `POST /repos/${REPO}/issues/7/comments`,
  ]);
  assert.match(conflict.writes[1].body.body, /state: waiting[\s\S]*Base branch was modified/);

  const broken = github({ reviews: [FLOW_OK], mergeStatus: 500 });
  assert.equal((await lane(broken)).code, 1, "an infrastructure error turns the run red");
});

test("merge: HOLD, a missing label, an invalid requester, a moved head or frozen automation merges nothing", async () => {
  const cases = [
    github({
      reviews: [FLOW_OK],
      prs: [pullRequest(7, { labels: [{ name: LAND_LABEL }, { name: HOLD_LABEL }] })],
    }),
    github({ reviews: [FLOW_OK], prs: [pullRequest(7, { labels: [] })] }),
    github({
      reviews: [FLOW_OK],
      events: [{ ...BOT_LABEL, performed_via_github_app: { slug: "x" } }],
    }),
    github({ reviews: [{ ...FLOW_OK, commit_id: OLD }] }),
  ];
  for (const gh of cases) {
    await lane(gh);
    assert.deepEqual(gh.writes, []);
  }
  for (const AUTOMATION of ["", "frozen"]) {
    const gh = github({ reviews: [FLOW_OK] });
    await lane(gh, { AUTOMATION });
    assert.deepEqual(gh.writes, [], AUTOMATION);
  }
  const mergeOnly = github({ reviews: [FLOW_OK] });
  await lane(mergeOnly, { AUTOMATION: "merge-only" });
  assert.equal(mergeOnly.writes[0].method, "PUT", "merge-only still merges what was approved");
});

test("merge: one token per PR, in PR order", async () => {
  const gh = github({ prs: [pullRequest(9), pullRequest(8)], reviews: [FLOW_OK] });
  const r = await lane(gh);
  assert.deepEqual(r.roles, ["merge", "merge"]);
  const puts = gh.writes.filter((w) => w.method === "PUT");
  assert.deepEqual(
    puts.map((w) => [w.path, w.token]),
    [
      [`/repos/${REPO}/pulls/8/merge`, "token-1"],
      [`/repos/${REPO}/pulls/9/merge`, "token-2"],
    ],
  );
});

test("comments: every comment the lane writes starts with LAND_MARKER", async () => {
  const worlds = [
    github(),
    github({ statuses: [{ ...GATE, state: "pending" }] }),
    github({ prs: [pullRequest(7, { title: "bad" })] }),
  ];
  for (const gh of worlds) await sweep(gh);
  const merged = github({ reviews: [FLOW_OK] });
  await lane(merged);
  const waiting = github({ reviews: [FLOW_OK], mergeStatus: 409 });
  await lane(waiting);
  const bodies = [...worlds, merged, waiting]
    .flatMap((gh) => gh.writes)
    .filter((w) => /\/comments(?:\/\d+)?$/.test(w.path))
    .map((w) => String(w.body.body));
  assert.ok(bodies.length >= 5);
  for (const body of bodies) assert.equal(body.split("\n")[0], LAND_MARKER);
});

// ---- the rendered lane ------------------------------------------------------------------------------------------

const BASE_OPTIONS = {
  version: "0.2.3",
  integrity: "sha512-AbC+/9==",
  appId: "FFLOW_APPROVER_APP_ID",
  privateKey: "FFLOW_APPROVER_PRIVATE_KEY",
  trusted: { [STATUS_CONTEXT]: FLOW },
  ownerOnly: ["it's/**"],
};
const LANE = {
  defaultBranch: "main",
  oidc: OIDC,
  owner: OWNER,
  workflows: ["Quality Gate"],
  requesters: ["stackra-bot"],
  reviewers: ["stackra-reviewer"],
};

/** Each job's block, by name. */
const jobsOf = (/** @type {string} */ yaml) =>
  Object.fromEntries(
    yaml
      .split(/^jobs:$/m)[1]
      .split(/^(?= {2}[\w-]+:$)/m)
      .filter((b) => b.trim())
      .map((b) => [b.trim().split(":")[0], b]),
  );

/** The trigger names of a rendered workflow. */
const triggers = (/** @type {string} */ yaml) =>
  [
    ...yaml
      .split(/^on:$/m)[1]
      .split(/^permissions:/m)[0]
      .matchAll(/^ {2}(\w+):/gm),
  ].map((m) => m[1]);

test("lane render: the triggers are exactly the listed set", () => {
  const yaml = approveWorkflow({ ...BASE_OPTIONS, lane: LANE });
  assert.deepEqual(triggers(yaml), [
    "workflow_dispatch",
    "pull_request_target",
    "status",
    "issue_comment",
    "schedule",
    "workflow_run",
  ]);
  assert.match(yaml, /types: \[labeled, synchronize, ready_for_review\]/);
  assert.match(yaml, /workflows: \["Quality Gate"\]\n {4}types: \[completed\]/);
  assert.match(yaml, /- cron: "7,22,37,52 \* \* \* \*"/);
  // workflow_run only with a listed workflow or the verdict.
  assert.equal(
    triggers(approveWorkflow({ ...BASE_OPTIONS, lane: { ...LANE, workflows: [] } })).includes(
      "workflow_run",
    ),
    false,
  );
  const both = approveWorkflow({
    ...BASE_OPTIONS,
    lane: LANE,
    verdict: { gatePath: `.github/workflows/${NAME}-gate.yml`, defaultBranch: "main", oidc: OIDC },
  });
  assert.match(both, new RegExp(`workflows: \\["Quality Gate", "${STATUS_CONTEXT}"\\]`));
  assert.deepEqual(Object.keys(jobsOf(both)), [
    "approve-dispatch",
    "cancel",
    "route",
    "approve",
    "merge",
    "verdict",
  ]);
  assert.doesNotMatch(
    yaml,
    /^ {2}(?:pull_request|pull_request_review|push|workflow_call|repository_dispatch):/m,
  );
});

test("lane render: permissions, environment, guards, concurrency and integrity", () => {
  const yaml = approveWorkflow({ ...BASE_OPTIONS, lane: LANE });
  assert.match(yaml, /^permissions: \{\}$/m);
  const jobs = jobsOf(yaml);
  assert.deepEqual(Object.keys(jobs), ["approve-dispatch", "cancel", "route", "approve", "merge"]);
  const ref = "github.ref == 'refs/heads/main'";
  const runs = `(vars.${AUTOMATION_VARIABLE} == 'on' || vars.${AUTOMATION_VARIABLE} == 'merge-only')`;
  for (const [name, block] of Object.entries(jobs)) {
    assert.ok(block.includes(ref), `${name} carries the default ref`);
    assert.equal(/id-token: write/.test(block), name === "approve" || name === "merge", name);
    assert.equal(
      new RegExp(`^ {4}environment: ${APPROVE_ENVIRONMENT}$`, "m").test(block),
      name !== "cancel" && name !== "route",
      name,
    );
    if (name !== "cancel") {
      assert.match(block, /INTEGRITY: 'sha512-AbC\+\/9=='/, name);
      assert.ok(block.indexOf('"$INTEGRITY" ]') < block.indexOf("node flow/"), name);
    }
  }
  assert.ok(jobs.route.includes(runs));
  assert.ok(jobs.merge.includes(runs));
  assert.ok(jobs.approve.includes(`${ref} && vars.${AUTOMATION_VARIABLE} == 'on'`));
  assert.ok(!jobs.approve.includes("merge-only"), "approve runs only while automation is on");
  assert.match(jobs.approve, /needs: route\n/);
  assert.match(jobs.merge, /needs: \[route, approve\]\n/);
  assert.match(jobs.merge, /needs\.approve\.result != 'cancelled'/);
  assert.match(jobs.approve, new RegExp(`group: ${NAME}-approve\\n {6}cancel-in-progress: false`));
  assert.match(jobs.merge, new RegExp(`group: ${NAME}-merge\\n {6}cancel-in-progress: false`));
  assert.match(jobs.approve, /MODE: event\n/);
  assert.match(jobs.approve, /node flow\/package\/src\/lib\/approve-check\.mjs/);
  assert.match(jobs.merge, /node flow\/package\/src\/lib\/merge\.mjs/);
  assert.match(jobs.route, /node flow\/package\/src\/lib\/land-route\.mjs/);
  assert.match(
    jobs.route,
    /^ {4}permissions:\n {6}contents: read\n {6}issues: read\n {6}pull-requests: read\n/m,
  );
  assert.match(jobs.route, /any: \$\{\{ steps\.route\.outputs\.any \}\}/);
  for (const name of ["approve", "merge"]) {
    assert.ok(jobs[name].includes(`OIDC: '${JSON.stringify(OIDC)}'`), name);
    assert.ok(jobs[name].includes(`REQUESTERS: '["stackra-bot"]'`), name);
    assert.ok(jobs[name].includes(`OWNER: '${OWNER}'`), name);
    assert.match(jobs[name], /AUTOMATION: \$\{\{ vars\.FIGENTRA_AUTOMATION \}\}/, name);
    assert.doesNotMatch(jobs[name], /secrets\./, `${name} names no secret`);
  }
  // The route filter drops Flow's own statuses and comments that are not commands.
  assert.ok(jobs.route.includes(`github.event.context == '${STATUS_CONTEXT}'`));
  assert.ok(jobs.route.includes(`startsWith(github.event.comment.body, '${LAND_COMMAND}')`));
  assert.ok(jobs.route.includes(`github.event.label.name == '${LAND_LABEL}'`));
  for (const [, uses] of yaml.matchAll(/uses: [\w/-]+@(\S+)/g))
    assert.match(uses, /^[0-9a-f]{40}$/);
  assert.doesNotMatch(yaml, /actions\/checkout|download-artifact|upload-artifact|cache:/);
  assert.throws(() => approveWorkflow({ ...BASE_OPTIONS, integrity: "md5-x", lane: LANE }));
});

test("lane render: cancel removes the label with the job's token and env values only, and no event text runs", () => {
  const yaml = approveWorkflow({ ...BASE_OPTIONS, lane: LANE });
  const cancel = jobsOf(yaml).cancel;
  assert.match(cancel, /^ {4}permissions:\n {6}pull-requests: write\n {4}steps:/m);
  assert.doesNotMatch(cancel, /id-token|environment:|secrets\./);
  assert.ok(cancel.includes(`contains(github.event.pull_request.labels.*.name, '${LAND_LABEL}')`));
  assert.match(cancel, /github\.event\.action == 'synchronize'/);
  assert.ok(
    cancel.includes(
      `run: gh api -X DELETE "repos/$REPO/issues/$PR/labels/${encodeURIComponent(LAND_LABEL)}" --silent`,
    ),
  );
  for (const [, run] of yaml.matchAll(/^ {8}run: \|\n((?: {10}.*\n)+)/gm))
    assert.doesNotMatch(run, /\$\{\{/);
  for (const [, run] of yaml.matchAll(/^ {8}run: (?!\|)(.*)$/gm))
    assert.doesNotMatch(run, /\$\{\{/);
});

test("lane render: inputs that are not plain names refuse", () => {
  for (const bad of [
    { defaultBranch: "main' || true" },
    { owner: "o'wner" },
    { workflows: ["a'b"] },
    { requesters: ["a b"] },
    { reviewers: ["x}}"] },
  ])
    assert.throws(() => approveWorkflow({ ...BASE_OPTIONS, lane: { ...LANE, ...bad } }), /lane:/);
});

test("sync renders the lane only with secrets.oidc, from approve.workflows and approve.requesters", (t) => {
  const secrets = {
    kind: "infisical",
    projectId: OIDC.projectId,
    env: "prod",
    domain: OIDC.domain,
    paths: { gate: "/ci/gate" },
    oidc: { identityId: OIDC.identityId, audience: OIDC.audience },
  };
  for (const [name, extra, rendered] of /** @type {[string, object, boolean][]} */ ([
    ["oidc", { secrets }, true],
    ["no oidc", { secrets: { ...secrets, oidc: undefined } }, false],
  ])) {
    const root = mkdtempSync(join(tmpdir(), "flow-lane-sync-"));
    t.after(() => rmSync(root, { recursive: true }));
    writeFileSync(
      join(root, "flow.config.json"),
      JSON.stringify({
        version: 1,
        preset: "neutral",
        apps: { owner: OWNER, gate: { login: FLOW } },
        approve: { workflows: ["Quality Gate"], requesters: ["stackra-bot"] },
        runner: { kind: "command", run: ["x", "{command}"] },
        ...extra,
      }),
    );
    sync(root, { direct: true, log: () => {} });
    const text = readFileSync(join(root, ".github/workflows", APPROVE_WORKFLOW), "utf8");
    assert.equal(/^ {2}merge:$/m.test(text), rendered, name);
    assert.equal(/^ {2}verdict:$/m.test(text), false, `${name}: no verdict for a command runner`);
    if (rendered) {
      assert.ok(text.includes(`REQUESTERS: '["stackra-bot"]'`), name);
      assert.match(text, /workflows: \["Quality Gate"\]/, name);
    }
  }
});

test("config: approve.workflows and approve.requesters are arrays of plain names", () => {
  const problems = (/** @type {any} */ approve) => validate(SCHEMA, { version: 1, approve });
  assert.deepEqual(problems({ workflows: ["Quality Gate"], requesters: ["stackra-bot"] }), []);
  assert.match(
    problems({ workflows: "Quality Gate" }).join(),
    /approve\.workflows: must be a array/,
  );
  assert.match(
    problems({ requesters: "stackra-bot" }).join(),
    /approve\.requesters: must be a array/,
  );
  assert.match(problems({ requesters: ["a b"] }).join(), /must match/);
});
