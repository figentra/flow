/**
 * Figentra Flow file contract:
 * Purpose: hold the approval check to its contract (STA-1856 FR-4, the security review of 2026-11-01). Against a stubbed
 *   GitHub, a PR at the checked head, with no owner-only change and every required check green from its trusted
 *   source, is approved at that head. Each of these refuses with its reason:
 *   - a check still running;
 *   - only skipped checks;
 *   - a status from an untrusted poster;
 *   - an owner-only rename;
 *   - a catalog swap;
 *   - a moved head;
 *   - an unprotected environment or a wrong ref;
 *   - the approving App as author.
 *   A refusal is one comment and no review; a head that moves after the approval gets the review dismissed.
 * Boundary: no network: the read and write APIs are stubs.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1856.
 */
// @covers sta-1856:FR-4 sta-1856:FR-6
import { test } from "node:test";
import assert from "node:assert/strict";

import { decide, main } from "../lib/approve-check.mjs";
import { requiredCheckState } from "../lib/required-checks.mjs";

const REPO = "figentra/x";
const SHA = "a".repeat(40);
const BASE = "b".repeat(40);
const FORK = "c".repeat(40);
const ENV = "figentra-flow-approve";
const APPROVER = "flow-approver[bot]";
const TRUSTED = { "figentra-flow/gate": "figentra-gate[bot]" };
const PR = {
  state: "open",
  draft: false,
  head: { sha: SHA, repo: { full_name: REPO } },
  base: { sha: BASE, ref: "main" },
  user: { login: "stackra-bot[bot]" },
};
const VERIFY = {
  id: 1,
  name: "verify",
  status: "completed",
  conclusion: "success",
  app: { id: 15368, slug: "github-actions" },
};

/**
 * A stubbed GitHub; `over` replaces parts of a green, safe PR.
 * @param {Record<string, any>} [over]
 */
function github(over = {}) {
  const s = {
    repo: { default_branch: "main" },
    env: { deployment_branch_policy: { custom_branch_policies: true } },
    policies: { branch_policies: [{ name: "main", type: "branch" }] },
    pr: PR,
    files: [{ filename: "src/a.mjs", status: "modified" }],
    /** @type {Record<string, string>} path@ref → text */
    contents: {},
    required: [{ context: "figentra-flow/gate" }, { context: "verify", integration_id: 15368 }],
    statuses: [
      { context: "figentra-flow/gate", state: "success", creator: { login: "figentra-gate[bot]" } },
    ],
    runs: [VERIFY],
    headAfter: SHA,
    ...over,
  };
  /** @type {{ method: string, path: string, body?: any }[]} */
  const writes = [];
  let prReads = 0;
  const ok = (/** @type {unknown} */ json) => ({ ok: true, status: 200, json });
  /** @type {import("../lib/approve-check.mjs").Rest} */
  const read = async (method, path) => {
    if (path === `/repos/${REPO}`) return ok(s.repo);
    if (path === `/repos/${REPO}/environments/${ENV}`) return ok(s.env);
    if (path === `/repos/${REPO}/environments/${ENV}/deployment-branch-policies`)
      return ok(s.policies);
    if (path === `/repos/${REPO}/pulls/7`)
      return ok(prReads++ === 0 ? s.pr : { ...s.pr, head: { ...s.pr.head, sha: s.headAfter } });
    if (path === `/repos/${REPO}/compare/${BASE}...${SHA}`)
      return ok({ files: s.files, merge_base_commit: { sha: FORK } });
    const content = path.match(/^\/repos\/figentra\/x\/contents\/(.+)\?ref=(\w+)$/);
    if (content) {
      const text = s.contents[`${decodeURIComponent(content[1])}@${content[2]}`];
      return text === undefined
        ? { ok: false, status: 404, json: undefined }
        : ok({ content: Buffer.from(text).toString("base64") });
    }
    if (path === `/repos/${REPO}/rules/branches/main`)
      return ok([
        { type: "required_status_checks", parameters: { required_status_checks: s.required } },
      ]);
    if (path.startsWith(`/repos/${REPO}/commits/${SHA}/statuses`)) return ok(s.statuses);
    if (path.startsWith(`/repos/${REPO}/commits/${SHA}/check-runs`))
      return ok({ check_runs: s.runs });
    throw new Error(`unexpected ${method} ${path}`);
  };
  /** @type {import("../lib/approve-check.mjs").Rest} */
  const write = async (method, path, body) => {
    writes.push({ method, path, body });
    return ok({ id: 42 });
  };
  return { read, write, writes };
}

/** `decide` against `over`, with the usual inputs. */
const refusals = async (/** @type {Record<string, any>} */ over = {}, input = {}) =>
  (
    await decide({
      api: github(over).read,
      repo: REPO,
      number: 7,
      expectedHead: SHA,
      approver: APPROVER,
      ref: "refs/heads/main",
      environment: ENV,
      trusted: TRUSTED,
      ...input,
    })
  ).refuse.join("\n");

test("approve: a safe PR, green from its trusted sources at the checked head, has nothing against it", async () => {
  assert.equal(await refusals(), "");
});

test("approve: each unsafe case refuses with its reason", async () => {
  const run = (/** @type {Record<string, any>} */ r) => [{ ...VERIFY, ...r }];
  const cases = /** @type {[Record<string, any>, Record<string, any>, RegExp][]} */ ([
    [
      { runs: run({ status: "in_progress", conclusion: null }) },
      {},
      /required checks still running: verify/,
    ],
    [
      {
        required: [{ context: "verify", integration_id: 15368 }],
        runs: run({ conclusion: "skipped" }),
      },
      {},
      /no required check succeeded \(all were skipped\)/,
    ],
    [
      {
        statuses: [
          { context: "figentra-flow/gate", state: "success", creator: { login: "someone" } },
        ],
      },
      {},
      /figentra-flow\/gate was posted by someone, not figentra-gate\[bot\]/,
    ],
    [
      { runs: run({ app: { id: 999, slug: "lookalike" } }) },
      {},
      /required checks still running: verify/,
    ],
    [{ required: [{ context: "ci" }] }, {}, /ci is pinned to no App/],
    [
      {
        files: [
          {
            filename: "docs/x.yml",
            previous_filename: ".github/workflows/x.yml",
            status: "renamed",
          },
        ],
      },
      {},
      /owner-only paths: \.github\/workflows\/x\.yml/,
    ],
    [
      {
        files: [{ filename: "packages/a/package.json", status: "modified" }],
        contents: {
          [`packages/a/package.json@${FORK}`]: '{"dependencies":{"zod":"catalog:"}}',
          [`packages/a/package.json@${SHA}`]: '{"dependencies":{"zod":"4.0.0"}}',
        },
      },
      {},
      /packages\/a\/package\.json: zod moved off its catalog to "4\.0\.0"/,
    ],
    [{ files: [{ filename: "src/a\nb.mjs", status: "added" }] }, {}, /control character/],
    [
      { files: Array.from({ length: 300 }, (_, i) => ({ filename: `f${i}`, status: "added" })) },
      {},
      /300 files changed/,
    ],
    [{}, { expectedHead: "d".repeat(40) }, /the head is a{40}, not the d{40} that was checked/],
    [{ env: { deployment_branch_policy: null } }, {}, /must allow the default branch only/],
    [
      {
        policies: {
          branch_policies: [
            { name: "main", type: "branch" },
            { name: "x", type: "branch" },
          ],
        },
      },
      {},
      /must allow the default branch only/,
    ],
    [
      {},
      { ref: "refs/heads/feature" },
      /runs on refs\/heads\/feature, not the default branch main/,
    ],
    [
      { pr: { ...PR, user: { login: APPROVER } } },
      {},
      /the author is flow-approver\[bot\], the approving App/,
    ],
  ]);
  for (const [over, input, reason] of cases)
    assert.match(await refusals(over, input), reason, String(reason));
});

test("approve: a refusal is one comment and no review", async () => {
  const gh = github({ runs: [] });
  const code = await main(env(), { read: gh.read, write: gh.write, log: () => {} });
  assert.equal(code, 1);
  assert.deepEqual(
    gh.writes.map((w) => `${w.method} ${w.path}`),
    [`POST /repos/${REPO}/issues/7/comments`],
  );
  assert.match(
    gh.writes[0].body.body,
    /Approval refused .*\n\n- required checks still running: verify/,
  );
});

test("approve: approves at the checked head; a head that moves meanwhile gets the review dismissed", async () => {
  const gh = github();
  assert.equal(await main(env(), { read: gh.read, write: gh.write, log: () => {} }), 0);
  assert.deepEqual(
    gh.writes.map((w) => `${w.method} ${w.path}`),
    [`POST /repos/${REPO}/pulls/7/reviews`],
  );
  assert.equal(gh.writes[0].body.commit_id, SHA);
  assert.equal(gh.writes[0].body.event, "APPROVE");

  const moved = github({ headAfter: "e".repeat(40) });
  assert.equal(await main(env(), { read: moved.read, write: moved.write, log: () => {} }), 1);
  assert.deepEqual(
    moved.writes.map((w) => `${w.method} ${w.path}`),
    [`POST /repos/${REPO}/pulls/7/reviews`, `PUT /repos/${REPO}/pulls/7/reviews/42/dismissals`],
  );
});

test("required checks: an App-pinned context counts only that App's newest run; a status only from its trusted login", () => {
  const required = [{ context: "verify", integration_id: 1 }, { context: "gate" }];
  const state = requiredCheckState({
    required,
    checkRuns: [
      { id: 1, name: "verify", status: "completed", conclusion: "failure", app: { id: 1 } },
      { id: 2, name: "verify", status: "completed", conclusion: "success", app: { id: 1 } },
    ],
    statuses: [{ context: "gate", state: "success", creator: { login: "gate[bot]" } }],
    trusted: { gate: "gate[bot]" },
  });
  assert.deepEqual(state, {
    passed: ["verify", "gate"],
    pending: [],
    failed: [],
    untrusted: [],
    succeeded: 2,
  });
});

/** The workflow's environment for `main`. */
function env() {
  return {
    REPO,
    PR: "7",
    EXPECTED_HEAD: SHA,
    APPROVER,
    GITHUB_REF: "refs/heads/main",
    ENVIRONMENT: ENV,
    RUN_URL: "https://github.com/run/1",
    TRUSTED: JSON.stringify(TRUSTED),
    OWNER_ONLY_EXTRA: "[]",
  };
}
