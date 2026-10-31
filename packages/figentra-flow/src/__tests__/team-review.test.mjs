/**
 * Figentra Flow file contract:
 * Purpose: hold the roster's review and approval rules to AC-051 to AC-053: a verdict line's optional `role=` and
 *   `session=` reach the counted PASSes; `REVIEWER_IS_BUILDER` refuses a PASS with no role, from the builder's role,
 *   from a role outside the builder's `reviewed_by` or from the builder's session; roster globs and the path findings
 *   (a role with `changes: []` may change nothing, a repository the role does not name is not checked); and an
 *   owner-kept spec's stage approvals are the owner's only.
 * Boundary: pure functions over texts, comments and an in-memory roster.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1729 phase 7.
 */
// @covers sta-1729:FR-12 sta-1729:AC-051 sta-1729:AC-052 sta-1729:AC-053
import { test } from "node:test";
import assert from "node:assert/strict";

import { ownerApprovalProblems } from "../commands/gate.mjs";
import { aiReview } from "../lib/review.mjs";
import { globRe, pathProblems, reviewerProblems } from "../lib/roles.mjs";

const SHA = "a".repeat(40);
/** @type {any} */
const TEAM = {
  roster: { owner: { keeps: ["money"] } },
  roles: new Map([
    [
      "backend",
      {
        changes: [{ repo: "acme/app", paths: ["services/**", "packages/*-ui/**"] }],
        reviewed_by: ["reviewer"],
      },
    ],
    ["reviewer", { changes: [], reviewed_by: [] }],
    ["architect", { changes: [{ repo: "acme/docs", paths: ["**"] }], reviewed_by: [] }],
  ]),
  problems: [],
};
const SPEC = "# X\n\n**Role**: backend\n**Session**: Backend A\n";

test("review: role= and session= on a verdict reach the counted PASSes", () => {
  const comment = (/** @type {string} */ body) => ({
    body,
    user: { login: "reviewer[bot]", type: "Bot" },
    performed_via_github_app: { slug: "reviewer" },
    created_at: "1",
    updated_at: "1",
  });
  const review = aiReview(
    { sha: SHA, base: "main" },
    [
      comment(`AI-REVIEW: PASS ${SHA} base=main role=reviewer session="Review 1"`),
      comment(`AI-REVIEW: PASS ${SHA} base=main`),
    ],
    [],
    ["dev"],
    { reviewer: "reviewer" },
  );
  assert.equal(review.verdict, "PASS");
  assert.deepEqual(review.passes, [
    { role: "reviewer", session: "Review 1" },
    { role: null, session: null },
  ]);
});

test("REVIEWER_IS_BUILDER: no role, the builder's role, a role outside reviewed_by, the builder's session", () => {
  assert.deepEqual(reviewerProblems(TEAM, SPEC, [{ role: "reviewer", session: "R" }]), []);
  const found = reviewerProblems(TEAM, SPEC, [
    { role: null, session: null },
    { role: "backend", session: null },
    { role: "architect", session: null },
    { role: "reviewer", session: "Backend A" },
  ]).join("\n");
  assert.match(found, /a PASS names no role=/);
  assert.match(found, /signed by `backend`, the role that built it/);
  assert.match(found, /`architect` does not review `backend` \(its reviewed_by: reviewer\)/);
  assert.match(found, /signed by Backend A, the session that built it/);
  assert.deepEqual(reviewerProblems(TEAM, "# no role", [{ role: null, session: null }]), []);
});

test("paths: roster globs; outside the role's paths is a finding; unnamed repositories are not checked", () => {
  assert.ok(globRe("services/**").test("services"));
  assert.ok(globRe("services/**").test("services/a/b.ts"));
  assert.ok(globRe("**/__tests__/**").test("x/y/__tests__/a.test.mjs"));
  assert.ok(globRe("**/__tests__/**").test("__tests__/a.test.mjs"));
  assert.ok(globRe("packages/*-ui/**").test("packages/shop-ui/src/a.tsx"));
  assert.ok(!globRe("packages/*-ui/**").test("packages/a/b-ui/x"));
  assert.ok(!globRe("README.md").test("READMEXmd"));
  assert.deepEqual(
    pathProblems(TEAM, "backend", "acme/app", ["services/a.ts", "apps/console/x.tsx"]),
    ["role `backend` may not change `apps/console/x.tsx` here (its `changes` for acme/app)"],
  );
  assert.deepEqual(pathProblems(TEAM, "backend", "acme/other", ["anything"]), []);
  assert.equal(
    pathProblems(TEAM, "reviewer", "acme/app", ["a.md"]).length,
    1,
    "changes: [] may change nothing",
  );
  assert.deepEqual(pathProblems(TEAM, undefined, "acme/app", ["a.md"]), []);
});

test("owner stops: an owner-kept spec's approvals are the owner's only", () => {
  const spec = (/** @type {string} */ stops, /** @type {string} */ who) =>
    `# X\n\n**Status**: Tasked\n**Owner stops**: ${stops}\n\n## Status history\n\n- 2026-11-01: Draft → Planned — Approved by ${who} 2026-11-01\n- 2026-11-01: Planned → Tasked\n`;
  assert.deepEqual(ownerApprovalProblems(spec("money", "owner")), []);
  assert.deepEqual(ownerApprovalProblems(spec("money", "akouta"), "akouta"), []);
  assert.deepEqual(ownerApprovalProblems(spec("none", "leader")), []);
  assert.deepEqual(ownerApprovalProblems(spec("money", "leader")), [
    "the planned approval is by leader, but the spec touches money: only the owner approves it",
  ]);
});
