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
 *   On a red main (STA-1945 FR-22) a required check failing on the head and on main's recorded baseline too is
 *   tolerated beside a green, required `Baseline` check, and the approval names the baseline and what it tolerated.
 *   A check that passed (or never ran) on the baseline, a missing or planted baseline, a red, skipped or unrequired
 *   `Baseline`, and every guard above still refuse.
 * Boundary: no network: the read and write APIs are stubs.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1856; STA-1945 FR-22.
 */
// @covers sta-1856:FR-4 sta-1856:FR-6 sta-1945:FR-22 sta-1945:AC-17
import { test } from "node:test";
import assert from "node:assert/strict";

import { decide, main } from "../lib/approve-check.mjs";
import { ANCESTORS, artifactName } from "../lib/baseline.mjs";
import { requiredCheckState } from "../lib/required-checks.mjs";

const REPO = "figentra/x";
const SHA = "a".repeat(40);
const BASE = "b".repeat(40);
const FORK = "c".repeat(40);
/** The ancestor of BASE whose push left main's baseline. */
const MAIN = "f".repeat(40);
const ENV = "fflow-approve";
const APPROVER = "flow-approver[bot]";
const TRUSTED = { "fflow/gate": "figentra-gate[bot]" };
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
    contents: { [`.github/CODEOWNERS@${BASE}`]: "/.github/workflows/** @figentra-usr\n" },
    codeOwnerReview: true,
    dismissFails: false,
    requestFails: false,
    graphqlError: "",
    required: [{ context: "fflow/gate" }, { context: "verify", integration_id: 15368 }],
    statuses: [
      { context: "fflow/gate", state: "success", creator: { login: "figentra-gate[bot]" } },
    ],
    runs: [VERIFY],
    /** @type {{ sha: string, event?: string, statuses: any[], runs: any[] } | undefined} main's recorded baseline */
    baseline: undefined,
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
        {
          type: "pull_request",
          parameters: {
            required_approving_review_count: 1,
            require_code_owner_review: s.codeOwnerReview,
          },
        },
      ]);
    const at = path.match(/^\/repos\/figentra\/x\/commits\/(\w+)\/(statuses|check-runs)\?/);
    const commit = at?.[1] === SHA ? s : at?.[1] === s.baseline?.sha ? s.baseline : undefined;
    if (at && commit)
      return ok(at[2] === "statuses" ? commit.statuses : { check_runs: commit.runs });
    if (at) return ok(at[2] === "statuses" ? [] : { check_runs: [] });
    if (path === `/repos/${REPO}/commits?sha=${BASE}&per_page=${ANCESTORS}`)
      return ok([{ sha: BASE }, { sha: MAIN }]);
    const artifact = path.match(/^\/repos\/figentra\/x\/actions\/artifacts\?name=([\w-]+)&/);
    if (artifact) {
      const b = s.baseline;
      const hit = b && artifact[1] === artifactName(b.sha);
      return ok({
        artifacts: hit ? [{ workflow_run: { id: 9, head_sha: b.sha, head_branch: "main" } }] : [],
      });
    }
    if (path === `/repos/${REPO}/actions/runs/9`) return ok({ event: s.baseline?.event ?? "push" });
    throw new Error(`unexpected ${method} ${path}`);
  };
  /** @type {import("../lib/approve-check.mjs").Rest} */
  const write = async (method, path, body) => {
    writes.push({ method, path, body });
    if (s.dismissFails && path.endsWith("/dismissals"))
      return { ok: false, status: 403, json: undefined };
    if (s.requestFails && /** @type {any} */ (body)?.event === "REQUEST_CHANGES")
      return { ok: false, status: 422, json: undefined };
    if (s.graphqlError && path === "/graphql") return ok({ errors: [{ message: s.graphqlError }] });
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

const run = (/** @type {Record<string, any>} */ r) => [{ ...VERIFY, ...r }];

/** Every guard's unsafe case: what it replaces, the `decide` input it replaces, and the reason it refuses with. */
const CASES = /** @type {[Record<string, any>, Record<string, any>, RegExp][]} */ ([
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
      statuses: [{ context: "fflow/gate", state: "success", creator: { login: "someone" } }],
    },
    {},
    /fflow\/gate was posted by someone, not figentra-gate\[bot\]/,
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
  [{}, { ref: "refs/heads/feature" }, /runs on refs\/heads\/feature, not the default branch main/],
  [
    { pr: { ...PR, user: { login: APPROVER } } },
    {},
    /the author is flow-approver\[bot\], the approving App/,
  ],
  [{ codeOwnerReview: false }, {}, /main's ruleset does not require the code owner's review/],
  [{ contents: {} }, {}, /main has no \.github\/CODEOWNERS/],
  [
    { files: [{ filename: "packages/a/package.json", status: "modified" }] },
    {},
    /packages\/a\/package\.json cannot be read at the merge base/,
  ],
  // What a deploy, promote or release runs, and the repository's own owner-only globs.
  [
    { files: [{ filename: "apps/web/wrangler.toml", status: "modified" }] },
    {},
    /owner-only paths: apps\/web\/wrangler\.toml/,
  ],
  [
    { files: [{ filename: ".changeset/config.json", status: "modified" }] },
    {},
    /owner-only paths: \.changeset\/config\.json/,
  ],
  [
    { files: [{ filename: "deploy/promote.sh", status: "modified" }] },
    { extraOwnerOnly: ["deploy/**"] },
    /owner-only paths: deploy\/promote\.sh/,
  ],
]);

test("approve: each unsafe case refuses with its reason", async () => {
  for (const [over, input, reason] of CASES)
    assert.match(await refusals(over, input), reason, String(reason));
});

/** Baseline is the per-task comparison: the job `sync` renders, from GitHub Actions. */
const GATE = { ...VERIFY, id: 2, name: "Baseline" };
const RED = { ...VERIFY, conclusion: "failure" };

/** A red main: `verify` fails on the head and on main's baseline commit, and `Baseline` is green and required. */
const RED_MAIN = {
  required: [
    { context: "fflow/gate" },
    { context: "verify", integration_id: 15368 },
    { context: "Baseline", integration_id: 15368 },
  ],
  runs: [RED, GATE],
  baseline: { sha: MAIN, statuses: [], runs: [RED, GATE] },
};

test("approve: on a red main, a required check failing on the baseline too is tolerated beside a green Baseline", async () => {
  // A newly reached task failure is Baseline's to judge (`compare`); it stays green, so only the check level is left.
  const result = await decide({
    api: github(RED_MAIN).read,
    repo: REPO,
    number: 7,
    expectedHead: SHA,
    approver: APPROVER,
    ref: "refs/heads/main",
    environment: ENV,
    trusted: TRUSTED,
  });
  assert.deepEqual(result.refuse, []);
  assert.deepEqual(result.baseline, { sha: MAIN, tolerated: ["verify"] });

  // The approval says what it compared against and what it tolerated.
  const gh = github(RED_MAIN);
  assert.equal(await main(env(), { read: gh.read, write: gh.write, log: () => {} }), 0);
  assert.equal(gh.writes[0].body.event, "APPROVE");
  assert.match(gh.writes[0].body.body, new RegExp(`baseline at ${MAIN}\\. Tolerated.*\`verify\``));
});

test("approve: on a red main, each new or unproven failure refuses with its reason", async () => {
  const cases = /** @type {[Record<string, any>, RegExp][]} */ ([
    // Passed on the baseline, fails now: a regression.
    [
      { baseline: { ...RED_MAIN.baseline, runs: [VERIFY, GATE] } },
      new RegExp(`required checks failed that do not fail on the baseline at ${MAIN}: verify`),
    ],
    // Never ran on the baseline: nothing shows it failed before.
    [
      { baseline: { ...RED_MAIN.baseline, runs: [GATE] } },
      /required checks failed that do not fail on the baseline at f{40}: verify/,
    ],
    // A failure on the baseline from an untrusted source proves nothing.
    [
      { baseline: { ...RED_MAIN.baseline, runs: [{ ...RED, app: { id: 999 } }, GATE] } },
      /required checks failed that do not fail on the baseline at f{40}: verify/,
    ],
    // No baseline: every required check must be green, as before.
    [
      { baseline: undefined },
      /no baseline at b{40} or its 1 nearest ancestors, so every required check must be green\n.*required checks failed: verify/s,
    ],
    // An artifact a pull_request run left is not main's baseline.
    [
      { baseline: { ...RED_MAIN.baseline, event: "pull_request" } },
      /no baseline at b{40}.*\n.*required checks failed: verify/s,
    ],
    // Without the per-task comparison, a red check may hide a new task failure.
    [
      { required: RED_MAIN.required.slice(0, 2) },
      /a failure is tolerated only beside a green `Baseline` check, which main's ruleset must require/,
    ],
    [
      { runs: [RED, { ...GATE, conclusion: "skipped" }] },
      /a failure is tolerated only beside a green `Baseline` check/,
    ],
    // Baseline red on the head is a new task failure, even when the baseline's own run was red.
    [
      { runs: [RED, { ...GATE, conclusion: "failure" }] },
      /required checks failed: verify, Baseline/,
    ],
    [
      {
        runs: [RED, { ...GATE, conclusion: "failure" }],
        baseline: { ...RED_MAIN.baseline, runs: [RED, { ...GATE, conclusion: "failure" }] },
      },
      /required checks failed: verify, Baseline/,
    ],
  ]);
  for (const [over, reason] of cases)
    assert.match(await refusals({ ...RED_MAIN, ...over }), reason, String(reason));
});

test("approve: on a red main, every other guard still refuses", async () => {
  for (const [over, input, reason] of CASES)
    assert.match(await refusals({ ...RED_MAIN, ...over }, input), reason, String(reason));
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

  // A dismissal GitHub refuses: the same App requests changes, auto-merge goes off, and the PR says so.
  const stuck = github({
    headAfter: "e".repeat(40),
    dismissFails: true,
    pr: { ...PR, node_id: "PR_7" },
  });
  assert.equal(await main(env(), { read: stuck.read, write: stuck.write, log: () => {} }), 1);
  assert.deepEqual(
    stuck.writes.map((w) => `${w.method} ${w.path}`),
    [
      `POST /repos/${REPO}/pulls/7/reviews`,
      `PUT /repos/${REPO}/pulls/7/reviews/42/dismissals`,
      `POST /repos/${REPO}/pulls/7/reviews`,
      "POST /graphql",
      `POST /repos/${REPO}/issues/7/comments`,
    ],
  );
  assert.equal(stuck.writes[2].body.event, "REQUEST_CHANGES");
  assert.match(stuck.writes[3].body.query, /disablePullRequestAutoMerge/);
  assert.equal(stuck.writes[3].body.variables.id, "PR_7");
  assert.match(stuck.writes[4].body.body, /Dismissing the approval failed \(HTTP 403\)/);
  assert.match(
    stuck.writes[4].body.body,
    /This App now requests changes, which replaces its approval\./,
  );
  assert.match(stuck.writes[4].body.body, /- Auto-merge is off\./);
});

test("approve: when every fallback fails too, the comment says the approval may still stand", async () => {
  const worst = github({
    headAfter: "e".repeat(40),
    dismissFails: true,
    requestFails: true,
    graphqlError: "Pull request is not in the correct state",
    pr: { ...PR, node_id: "PR_7" },
  });
  assert.equal(await main(env(), { read: worst.read, write: worst.write, log: () => {} }), 1);
  const comment = worst.writes.at(-1)?.body.body ?? "";
  assert.match(comment, /Requesting changes failed too \(HTTP 422\): the approval may still stand/);
  assert.match(
    comment,
    /Turning auto-merge off failed: Pull request is not in the correct state\./,
  );
  assert.doesNotMatch(comment, /Auto-merge is off/);
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
