/**
 * Figentra Flow file contract:
 * Purpose: hold the spec and task roles to AC-048 and AC-053: an unknown `**Role**` or task role is a finding; a
 *   feature or big spec past Clarified needs `**Role**` and `**Owner stops**`; an Owner stop outside `owner.keeps` is
 *   a finding; `none` with an Impact that names an owner subject is the mismatch; a task with no role is listed for
 *   the lead, not a finding; and `checkStage` applies none of it without a roster.
 * Boundary: pure functions over texts and an in-memory roster.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1729 phase 7.
 */
// @covers sta-1729:FR-12 sta-1729:AC-048 sta-1729:AC-053 sta-1729:P-012
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  checkSpecRoles,
  checkTaskRoles,
  ownerImpact,
  ownerStopsOf,
  roleOf,
} from "../lib/roles.mjs";

/** @type {any} */
const TEAM = {
  roster: { owner: { keeps: ["money", "security", "brand"] } },
  roles: new Map([
    ["backend", {}],
    ["reviewer", {}],
  ]),
  problems: [],
};
const PAST = { tiered: true, pastClarified: true };

const spec = (
  /** @type {string} */ headers,
  /** @type {string} */ impact = "- **Secrets**: none",
) =>
  `# Spec\n\n**Status**: Planned\n${headers}\n\n## Impact\n\n${impact}\n- **Licence tier**: free\n\n## Requirements\n`;

test("roles: headers read; none is no stops; absent is undefined", () => {
  assert.equal(roleOf(spec("**Role**: backend")), "backend");
  assert.equal(roleOf(spec("")), undefined);
  assert.deepEqual(ownerStopsOf(spec("**Owner stops**: Money, security")), ["money", "security"]);
  assert.deepEqual(ownerStopsOf(spec("**Owner stops**: none")), []);
  assert.equal(ownerStopsOf(spec("")), undefined);
  assert.deepEqual(
    ownerStopsOf("<!-- **Owner stops**: money -->"),
    undefined,
    "comments are not headers",
  );
});

test("roles: a complete, known spec has no findings", () => {
  assert.deepEqual(
    checkSpecRoles(
      spec("**Role**: backend\n**Owner stops**: money", "- **Secrets**: the payment key"),
      TEAM,
      PAST,
    ),
    [],
  );
  assert.deepEqual(
    checkSpecRoles(spec("**Role**: backend\n**Owner stops**: none"), TEAM, PAST),
    [],
  );
});

test("roles: unknown role and category; missing headers only past Clarified on a tiered spec", () => {
  const found = checkSpecRoles(spec("**Role**: chef\n**Owner stops**: legal"), TEAM, PAST).join(
    "\n",
  );
  assert.match(found, /`\*\*Role\*\*` `chef` is not a role of the roster/);
  assert.match(found, /names `legal`, not a category the owner keeps \(money, security, brand\)/);
  const missing = checkSpecRoles(spec(""), TEAM, PAST).join("\n");
  assert.match(missing, /names its `\*\*Role\*\*`/);
  assert.match(missing, /names its `\*\*Owner stops\*\*` \(money, security, brand, or none\)/);
  assert.deepEqual(checkSpecRoles(spec(""), TEAM, { tiered: true, pastClarified: false }), []);
  assert.deepEqual(checkSpecRoles(spec(""), TEAM, { tiered: false, pastClarified: true }), []);
});

test("roles: none while the Impact names an owner subject is the mismatch (the leader's addition)", () => {
  assert.deepEqual(
    ownerImpact(spec("", "- **Secrets**: none\n- **Docs to update**: the README")),
    [],
  );
  assert.deepEqual(ownerImpact(spec("", "- **Secrets**: the Stripe key, by name")), [
    "Secrets: the Stripe key, by name",
  ]);
  for (const answer of [
    "- **Packages touched**: the pricing tables",
    "- **Docs to update**: public content on the landing page",
    "- **Tenancy and data**: legal hold on invoices",
    "- **Apps touched**: brand assets",
  ]) {
    const found = checkSpecRoles(
      spec("**Role**: backend\n**Owner stops**: none", answer),
      TEAM,
      PAST,
    );
    assert.equal(found.length, 1, answer);
    assert.match(found[0], /Owner stops\*\*` is none, but the Impact names an owner subject/);
  }
});

test("roles: a task's unknown role is a finding; no role is for the lead", () => {
  const tasks = [
    "## Phase 1",
    "- [ ] T001 One in `a.mjs` — covers: FR-1 — route: spec-task — role: backend",
    "- [ ] T002 Two in `b.mjs` — covers: FR-1 — route: spec-task — role: chef",
    "- [ ] T003 Three in `c.mjs` — covers: FR-1 — route: spec-task",
    "- [ ] ~~T004~~ Gone — covers: FR-1",
  ].join("\n");
  const { problems, unassigned } = checkTaskRoles(tasks, TEAM);
  assert.deepEqual(problems, ["tasks.md:3: T002 role `chef` is not a role of the roster"]);
  assert.deepEqual(unassigned, ["tasks.md:4: T003"]);
});
