/**
 * Figentra Flow file contract:
 * Purpose: hold the AI review reader to ADR 0230: a PASS counts only from the reviewer App (by App identity, not a
 *   login), unedited, naming the head and the PR's base; the change's own authors cannot review it; an edit voids
 *   earlier verdicts; a FAIL for the head (even a sloppy one) beats a PASS; a verdict for an older commit does not
 *   count; the owner's APPROVED review with `owner-approval` on the head counts; a verdict counts from any listed
 *   reviewer App, and only the gate's marker comment may be edited without voiding.
 * Boundary: pure; REST-shaped comments and reviews built here.
 * Runtime: node
 * Governing contract: ADR 0022; Stackra ADR 0230; STA-1729 phase 3 (AC-031).
 */
// @covers sta-1729:FR-6 sta-1729:AC-031
import { test } from "node:test";
import assert from "node:assert/strict";

import { actor, aiReview } from "../lib/review.mjs";
import { GATE_MARKER } from "../lib/product.mjs";

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

test("review: an edited verdict is void, and an edit voids earlier verdicts unless it is the gate's marker comment", () => {
  const pass = byFlow(`AI-REVIEW: PASS ${SHA} base=main`);
  const later = { created_at: "2026-10-31T10:01:00Z", updated_at: "2026-10-31T10:02:00Z" };
  const marker = byFlow(`${GATE_MARKER}\n**fflow/gate** passed`, later);
  assert.equal(aiReview(PR, [pass, marker], [], [], LISTED).verdict, "PASS");
  const note = aiReview(PR, [pass, byFlow("note", later)], [], [], LISTED);
  assert.equal(note.verdict, null);
  assert.match(note.ignored.join(), /edited after this verdict/);
  // The marker must open the body: one quoted further down does not exempt the edit.
  assert.equal(
    aiReview(PR, [pass, byFlow(`note ${GATE_MARKER}`, later)], [], [], LISTED).verdict,
    null,
  );
  const edited = byFlow(`AI-REVIEW: PASS ${SHA} base=main`, { updated_at: "2026-10-31T10:05:00Z" });
  assert.match(aiReview(PR, [edited, marker], [], [], LISTED).ignored.join(), /was edited/);
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
