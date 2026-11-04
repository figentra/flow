/**
 * Figentra Flow file contract:
 * Purpose: hold `status --by role` to AC-050: specs grouped by the roster's roles (and specs with none) with the role
 *   file's and the specs' sessions, and the in-progress, in-review, blocked and waiting-on-the-owner counts; the text
 *   view filters by `--role`; a snapshot without a roster has no `byRole`.
 * Boundary: pure functions over in-memory specs, worktrees, PRs and a roster.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1729 phase 7.
 */
// @covers sta-1729:FR-12 sta-1729:AC-050
import { test } from "node:test";
import assert from "node:assert/strict";

import { renderByRole } from "../commands/status.mjs";
import { rolesOf } from "../lib/snapshot.mjs";

/** @type {any} */
const TEAM = {
  roster: { owner: { keeps: ["money"] } },
  roles: new Map([
    ["backend", { sessions: ["Backend A"] }],
    ["reviewer", { sessions: [] }],
  ]),
  problems: [],
};
const spec = (/** @type {Record<string, any>} */ over) => ({
  key: "sta-1",
  folder: "sta-1-a",
  status: "tasked",
  session: null,
  role: "backend",
  ownerWaiting: false,
  problems: [],
  ...over,
});

test("by role: each role with its sessions and counts; specs with no role in their own row", () => {
  const specs = [
    spec({}),
    spec({ key: "sta-2", folder: "sta-2-b", status: "implementing", session: "Backend B" }),
    spec({
      key: "sta-3",
      folder: "sta-3-c",
      status: "planned",
      problems: ["x"],
      ownerWaiting: true,
    }),
    spec({ key: "sta-4", folder: "sta-4-d", role: null, status: "draft" }),
  ];
  const trees = [
    { key: "sta-1", branch: "figentra/sta-1-a" },
    { key: "sta-2", branch: "figentra/sta-2-b" },
  ];
  const prs = [
    { branch: "figentra/sta-1-a", gate: { state: "success" } },
    { branch: "figentra/sta-2-b", gate: { state: "failure" } },
  ];
  assert.deepEqual(rolesOf(specs, trees, prs, TEAM), [
    {
      role: "backend",
      sessions: ["Backend A", "Backend B"],
      specs: ["sta-1", "sta-2", "sta-3"],
      inProgress: 2,
      inReview: 2,
      blocked: 2,
      ownerWaiting: 1,
    },
    {
      role: "reviewer",
      sessions: [],
      specs: [],
      inProgress: 0,
      inReview: 0,
      blocked: 0,
      ownerWaiting: 0,
    },
    {
      role: null,
      sessions: [],
      specs: ["sta-4"],
      inProgress: 0,
      inReview: 0,
      blocked: 0,
      ownerWaiting: 0,
    },
  ]);
  assert.equal(rolesOf([spec({})], [], [], TEAM).at(-1)?.role, "reviewer", "no empty no-role row");
});

test("by role: the text view, one role with --role, and none without a roster", () => {
  const snap = {
    repos: [
      { path: "/a", github: "acme/a", byRole: rolesOf([spec({})], [], [], TEAM) },
      { path: "/b", github: "acme/b" },
    ],
  };
  const all = renderByRole(snap);
  assert.match(
    all,
    /^acme\/a\n {2}backend: 1 spec\(s\) — 1 in progress, 0 in review, 0 blocked, 0 waiting on the owner\n {4}sessions: Backend A\n {4}specs: sta-1\n {2}reviewer: 0 spec/,
  );
  assert.doesNotMatch(all, /acme\/b/);
  assert.doesNotMatch(renderByRole(snap, "backend"), /reviewer/);
  assert.match(renderByRole({ repos: [{ path: "/b" }] }), /no repository names a roster/);
});
