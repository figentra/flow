/**
 * Vellum file contract:
 * Purpose: hold the AI review reader to ADR 0230: a PASS counts only from the reviewer App (by App identity, not a
 *   login), unedited, naming the head and the PR's base; the change's own authors cannot review it; an edit voids
 *   earlier verdicts; a FAIL for the head (even a sloppy one) beats a PASS; a verdict for an older commit does not
 *   count; the owner's APPROVED review with `owner-approval` on the head counts.
 * Boundary: pure; REST-shaped comments and reviews built here.
 * Runtime: node
 * Governing contract: ADR 0022; Stackra ADR 0230; STA-1729 phase 3 (AC-031).
 */
// @covers sta-1729:FR-6 sta-1729:AC-031
import { test } from "node:test";
import assert from "node:assert/strict";

import { actor, aiReview, OWNER, REVIEWER } from "../lib/review.mjs";

const SHA = "a".repeat(40);
const PR = { sha: SHA, base: "main" };
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
  assert.deepEqual(
    aiReview(PR, [comment(`AI-REVIEW: PASS ${SHA} base=main\n\nLooks right.`)], []),
    {
      verdict: "PASS",
      ignored: [],
    },
  );
});

test("review: a login string, a self-review, an edit and a wrong base never count", () => {
  const pass = `AI-REVIEW: PASS ${SHA} base=main`;
  const impostor = comment(pass, {
    user: { login: `${REVIEWER}[bot]`, type: "User" },
    performed_via_github_app: null,
  });
  assert.match(aiReview(PR, [impostor], []).ignored.join(), /is not the stackra-reviewer app/);
  assert.equal(aiReview(PR, [impostor], []).verdict, null);
  assert.match(
    aiReview(PR, [comment(pass)], [], ["stackra-reviewer"]).ignored.join(),
    /authored this change/,
  );
  assert.match(
    aiReview(PR, [comment(pass, { updated_at: "2026-10-31T10:05:00Z" })], []).ignored.join(),
    /was edited/,
  );
  const voided = [
    comment(pass),
    comment("note", { created_at: "2026-10-31T10:01:00Z", updated_at: "2026-10-31T10:02:00Z" }),
  ];
  assert.match(aiReview(PR, voided, []).ignored.join(), /edited after this verdict/);
  assert.match(
    aiReview(PR, [comment(`AI-REVIEW: PASS ${SHA} base=dev`)], []).ignored.join(),
    /names base dev/,
  );
});

test("review: a FAIL for the head beats a PASS, a sloppy FAIL still counts, an older commit's verdict does not", () => {
  assert.equal(
    aiReview(
      PR,
      [comment(`AI-REVIEW: PASS ${SHA} base=main`), comment(`AI-REVIEW: FAIL ${SHA}`)],
      [],
    ).verdict,
    "FAIL",
  );
  assert.equal(aiReview(PR, [comment("**AI-REVIEW: FAILED** see notes")], []).verdict, "FAIL");
  assert.equal(
    aiReview(PR, [comment(`AI-REVIEW: PASS ${"b".repeat(40)} base=main`)], []).verdict,
    null,
  );
  assert.equal(aiReview(PR, [comment("AI-REVIEW: FAIL bbbbbbb")], []).verdict, null);
});

test("review: the owner's APPROVED review with owner-approval on the head counts, unless the owner wrote the change", () => {
  const review = {
    user: { login: OWNER, type: "User" },
    state: "APPROVED",
    commit_id: SHA,
    body: "ok owner-approval",
  };
  assert.equal(aiReview(PR, [], [review]).verdict, "PASS");
  assert.equal(aiReview(PR, [], [{ ...review, commit_id: "b".repeat(40) }]).verdict, null);
  assert.equal(aiReview(PR, [], [review], [OWNER]).verdict, null);
});

test("actor: app/, [bot] and case fold to one login", () => {
  assert.equal(actor("app/Stackra-Reviewer"), "stackra-reviewer");
  assert.equal(actor("stackra-reviewer[bot]"), "stackra-reviewer");
});
