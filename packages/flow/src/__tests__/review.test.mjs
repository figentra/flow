/**
 * Figentra Flow file contract:
 * Purpose: hold the AI review reader to ADR 0230: a PASS counts only from the reviewer App (by App identity, not a
 *   login), unedited, naming the head and the PR's base; the change's own authors cannot review it; an edit voids
 *   earlier verdicts; a FAIL for the head (even a sloppy one) beats a PASS; a verdict for an older commit does not
 *   count; the owner's APPROVED review with `owner-approval` on the head counts; a verdict counts from any listed
 *   reviewer App, and an edit to any listed App's comment, the gate's marker comment included, voids earlier verdicts.
 *   And `fflow review` (STA-1945 FR-15): `--input` hands the review workflow its input; `--record` refuses invalid
 *   findings and records the verdict and the confirmed blocking findings that `land` refuses on.
 * Boundary: the reader is pure, REST-shaped comments and reviews built here; the command runs in temporary
 *   repositories with a local bare origin; no network.
 * Runtime: node
 * Governing contract: ADR 0022; Stackra ADR 0230; STA-1729 phase 3 (AC-031).
 */
// @covers sta-1729:FR-6 sta-1729:AC-031
// @covers sta-1945:FR-15 sta-1945:AC-40 sta-1945:P-021
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { blockingFindings } from "../commands/land.mjs";
import {
  findingProblems,
  recordReview,
  ReviewError,
  reviewInput,
  REVIEWERS,
  run,
} from "../commands/review.mjs";
import { readRecord } from "../lib/record.mjs";
import { actor, aiReview } from "../lib/review.mjs";
import { GATE_MARKER } from "../lib/product.mjs";
import { commit, repo, sh } from "./__fixtures__/repo.mjs";

const DIR = ".agents/specs/sta-7-x";

const REVIEWER = "stackra-reviewer";
const OWNER = "figentra-usr";
const IDS = { reviewer: REVIEWER, owner: OWNER };

const SHA = "a".repeat(40);
const PR = { sha: SHA, base: "main" };
/** The verdict for `PR` with the configured identities. */
const review = (
  /** @type {any[]} */ comments,
  /** @type {any[]} */ reviews,
  /** @type {string[]} */ authors = [],
) => aiReview(PR, comments, reviews, authors, IDS);
const T0 = "2026-10-31T10:00:00Z";

/**
 * A comment by the reviewer App unless `over` says otherwise.
 * @param {string} body
 * @param {Record<string, unknown>} [over]
 */
function comment(body, over = {}) {
  return {
    body,
    user: { login: `${REVIEWER}[bot]`, type: "Bot" },
    performed_via_github_app: { slug: REVIEWER },
    created_at: T0,
    updated_at: T0,
    ...over,
  };
}

test("review: the App's unedited PASS on the head and base counts", () => {
  assert.deepEqual(review([comment(`AI-REVIEW: PASS ${SHA} base=main\n\nLooks right.`)], []), {
    verdict: "PASS",
    ignored: [],
    passes: [{ role: null, session: null }],
  });
});

test("review: a login string, a self-review, an edit and a wrong base never count", () => {
  const pass = `AI-REVIEW: PASS ${SHA} base=main`;
  const impostor = comment(pass, {
    user: { login: `${REVIEWER}[bot]`, type: "User" },
    performed_via_github_app: null,
  });
  assert.match(review([impostor], []).ignored.join(), /is not the stackra-reviewer app/);
  assert.equal(review([impostor], []).verdict, null);
  assert.match(
    review([comment(pass)], [], ["stackra-reviewer"]).ignored.join(),
    /authored this change/,
  );
  assert.match(
    review([comment(pass, { updated_at: "2026-10-31T10:05:00Z" })], []).ignored.join(),
    /was edited/,
  );
  const voided = [
    comment(pass),
    comment("note", { created_at: "2026-10-31T10:01:00Z", updated_at: "2026-10-31T10:02:00Z" }),
  ];
  assert.match(review(voided, []).ignored.join(), /edited after this verdict/);
  assert.match(
    review([comment(`AI-REVIEW: PASS ${SHA} base=dev`)], []).ignored.join(),
    /names base dev/,
  );
});

test("review: a FAIL for the head beats a PASS, a sloppy FAIL still counts, an older commit's verdict does not", () => {
  assert.equal(
    review([comment(`AI-REVIEW: PASS ${SHA} base=main`), comment(`AI-REVIEW: FAIL ${SHA}`)], [])
      .verdict,
    "FAIL",
  );
  assert.equal(review([comment("**AI-REVIEW: FAILED** see notes")], []).verdict, "FAIL");
  assert.equal(review([comment(`AI-REVIEW: PASS ${"b".repeat(40)} base=main`)], []).verdict, null);
  assert.equal(review([comment("AI-REVIEW: FAIL bbbbbbb")], []).verdict, null);
});

test("review: the owner's APPROVED review with owner-approval on the head counts, unless the owner wrote the change", () => {
  const approval = {
    user: { login: OWNER, type: "User" },
    state: "APPROVED",
    commit_id: SHA,
    body: "ok owner-approval",
  };
  assert.equal(review([], [approval]).verdict, "PASS");
  assert.equal(review([], [{ ...approval, commit_id: "b".repeat(40) }]).verdict, null);
  assert.equal(review([], [approval], [OWNER]).verdict, null);
});

test("actor: app/, [bot] and case fold to one login", () => {
  assert.equal(actor("app/Stackra-Reviewer"), "stackra-reviewer");
  assert.equal(actor("stackra-reviewer[bot]"), "stackra-reviewer");
});

test("review: with no review App configured nothing counts, and with no owner no owner review counts", () => {
  const pass = { ...comment(`AI-REVIEW: PASS ${SHA} base=main`) };
  assert.equal(aiReview(PR, [pass], [], [], { reviewer: undefined }).verdict, null);
  assert.match(
    aiReview(PR, [pass], [], [], { reviewer: undefined }).ignored.join(),
    /no review App/,
  );
  const approve = {
    user: { login: OWNER, type: "User" },
    state: "APPROVED",
    commit_id: SHA,
    body: "owner-approval",
  };
  assert.equal(aiReview(PR, [], [approve], [], { reviewer: REVIEWER }).verdict, null);
});

/** A repository on the STA-7 branch with its spec and one change past main. */
function task(t) {
  const r = repo();
  t.after(r.dispose);
  sh(r.root, "checkout", "-q", "-b", "figentra/sta-7-x");
  mkdirSync(join(r.root, DIR), { recursive: true });
  writeFileSync(
    join(r.root, DIR, "spec.md"),
    "# x\n\n**Status**: Tasked\n\n- **FR-001**: WHEN a THE b SHALL c.\n- **AC-001**: WHEN a THE b SHALL c.\n",
  );
  sh(r.root, "add", "-A");
  sh(r.root, "commit", "-q", "-m", "spec");
  commit(r.root, "a.mjs");
  return r.root;
}

/**
 * A finding as the workflow writes it, `over` replacing fields (an invalid one too).
 * @param {Record<string, unknown>} [over]
 * @returns {any}
 */
const finding = (over = {}) => ({
  id: "correctness-1",
  reviewer: "correctness",
  blocking: true,
  confirmed: true,
  file: "a.mjs:1",
  text: "drops the error",
  ...over,
});

test("review --input: the PR, its head and base, the changed files, the spec's FRs and ACs and the four reviewers", (t) => {
  const root = task(t);
  assert.deepEqual(reviewInput(root, 12), {
    pr: 12,
    key: "sta-7",
    sha: sh(root, "rev-parse", "HEAD"),
    base: "main",
    changed: [`${DIR}/spec.md`, "a.mjs"].toSorted(),
    frs: ["FR-001"],
    acs: ["AC-001"],
    files: [`${DIR}/spec.md`],
    reviewers: REVIEWERS,
  });
});

test("review --record: a confirmed blocking finding fails the review and is recorded for land; refuted or minor ones pass", (t) => {
  const root = task(t);
  const head = sh(root, "rev-parse", "HEAD");
  const found = [
    finding(),
    finding({ id: "simplicity-1", reviewer: "simplicity", confirmed: false }),
    finding({ id: "contracts-1", reviewer: "contracts", blocking: false }),
  ];
  const { blocking, problems } = recordReview(root, 12, found);
  assert.deepEqual(problems, []);
  assert.deepEqual(
    blocking.map((f) => f.id),
    ["correctness-1"],
  );
  const record = readRecord(root, "sta-7");
  assert.equal(record?.stage, "review");
  assert.equal(record?.state, "failed");
  assert.deepEqual(record?.prs, [12]);
  assert.deepEqual(record?.review, [
    {
      sha: head,
      verdict: "FAIL",
      findings: 3,
      pr: 12,
      blocking: [{ id: "correctness-1", file: "a.mjs:1", text: "drops the error" }],
    },
  ]);
  assert.deepEqual(blockingFindings(record), ["correctness-1 in a.mjs:1: drops the error"]);
  recordReview(root, 12, []);
  const again = readRecord(root, "sta-7");
  assert.equal(again?.review.at(-1)?.verdict, "PASS");
  assert.deepEqual(again?.prs, [12]);
  assert.deepEqual(
    blockingFindings(again),
    ["correctness-1 in a.mjs:1: drops the error"],
    "a second review of the same head does not clear a finding",
  );
  commit(root, "fix.mjs");
  recordReview(root, 12, [finding({ confirmed: false })]);
  assert.deepEqual(
    blockingFindings(readRecord(root, "sta-7")),
    [],
    "a review of the new head clears it",
  );
});

test("review: a branch with no issue key and a findings file that is not JSON are refused", (t) => {
  const r = repo();
  t.after(r.dispose);
  assert.throws(() => reviewInput(r.root, 12), /no issue key in the branch `main`/);
  assert.throws(() => recordReview(r.root, 12, []), ReviewError);
  const bad = join(r.root, "findings.json");
  writeFileSync(bad, "not json\n");
  assert.equal(run(["12", "--record", bad]), 2);
  assert.equal(run(["12", "--record", join(r.root, "missing.json")]), 2);
  assert.equal(run(["12"]), 2, "neither --input nor --record");
  assert.equal(run(["x", "--input"]), 2);
});

test("review --record: output that is not a list of findings is refused, each problem named, and nothing written", (t) => {
  const root = task(t);
  assert.deepEqual(findingProblems({}), ["the findings are not a JSON list"]);
  const { problems } = recordReview(root, 12, [
    finding({ reviewer: "style", blocking: "yes", text: "" }),
  ]);
  assert.deepEqual(problems, [
    "finding 1 (correctness-1) has no `text`",
    "finding 1 (correctness-1): reviewer is not one of correctness, simplicity, security-tenancy, contracts",
    "finding 1 (correctness-1): `blocking` is not true or false",
  ]);
  assert.equal(readRecord(root, "sta-7"), undefined);
});

const FLOW = "figentra-flow";
const LISTED = { reviewer: [REVIEWER, FLOW], owner: OWNER };
/** A comment by the Flow App, the second listed reviewer. */
const byFlow = (/** @type {string} */ body, /** @type {Record<string, unknown>} */ over = {}) =>
  comment(body, {
    user: { login: `${FLOW}[bot]`, type: "Bot" },
    performed_via_github_app: { slug: FLOW },
    ...over,
  });

test("review: with a list of reviewer Apps a verdict from either listed slug counts", () => {
  const pass = `AI-REVIEW: PASS ${SHA} base=main`;
  assert.equal(aiReview(PR, [comment(pass)], [], [], LISTED).verdict, "PASS");
  assert.equal(aiReview(PR, [byFlow(pass)], [], [], LISTED).verdict, "PASS");
  assert.equal(aiReview(PR, [byFlow(`AI-REVIEW: FAIL ${SHA}`)], [], [], LISTED).verdict, "FAIL");
});

test("review: an unlisted App, a User and a verdict below the first line are ignored", () => {
  const pass = `AI-REVIEW: PASS ${SHA} base=main`;
  const other = comment(pass, {
    user: { login: "stackra-bot[bot]", type: "Bot" },
    performed_via_github_app: { slug: "stackra-bot" },
  });
  const user = byFlow(pass, { user: { login: `${FLOW}[bot]`, type: "User" } });
  for (const c of [other, user]) {
    const result = aiReview(PR, [c], [], [], LISTED);
    assert.equal(result.verdict, null);
    assert.match(result.ignored.join(), /is not the stackra-reviewer or figentra-flow app/);
  }
  assert.deepEqual(aiReview(PR, [byFlow(`Looks right.\n${pass}`)], [], [], LISTED), {
    verdict: null,
    ignored: [],
    passes: [],
  });
});

test("review: an edit to any listed App's comment voids earlier verdicts, the gate's marker comment too", () => {
  const pass = byFlow(`AI-REVIEW: PASS ${SHA} base=main`);
  const later = { created_at: "2026-10-31T10:01:00Z", updated_at: "2026-10-31T10:02:00Z" };
  for (const body of ["note", `${GATE_MARKER}\n**fflow/gate** passed`]) {
    const result = aiReview(PR, [pass, byFlow(body, later)], [], [], LISTED);
    assert.equal(result.verdict, null);
    assert.match(result.ignored.join(), /edited after this verdict/);
  }
  const edited = byFlow(`AI-REVIEW: PASS ${SHA} base=main`, { updated_at: "2026-10-31T10:05:00Z" });
  assert.match(aiReview(PR, [edited], [], [], LISTED).ignored.join(), /was edited/);
});

test("review: a FAIL edited to open with the gate marker does not bring back an earlier PASS", () => {
  const pass = comment(`AI-REVIEW: PASS ${SHA} base=main`);
  const fail = comment(`${GATE_MARKER}\nok`, {
    created_at: "2026-10-31T10:01:00Z",
    updated_at: "2026-10-31T10:02:00Z",
  });
  assert.notEqual(aiReview(PR, [pass, fail], [], [], LISTED).verdict, "PASS");
  assert.notEqual(review([pass, fail], []).verdict, "PASS");
});

test("review: a marker comment never parses as a verdict", () => {
  const none = { verdict: null, ignored: [], passes: [] };
  for (const verdict of [`AI-REVIEW: PASS ${SHA} base=main`, `AI-REVIEW: FAIL ${SHA}`])
    for (const body of [`${GATE_MARKER} ${verdict}`, `${GATE_MARKER}\n${verdict}`])
      assert.deepEqual(aiReview(PR, [byFlow(body)], [], [], LISTED), none);
});

test("review: an empty list of reviewer Apps means none is configured", () => {
  const pass = comment(`AI-REVIEW: PASS ${SHA} base=main`);
  for (const reviewer of [[], [undefined, ""]]) {
    const result = aiReview(PR, [pass], [], [], { reviewer });
    assert.equal(result.verdict, null);
    assert.match(result.ignored.join(), /no review App is configured/);
  }
});
