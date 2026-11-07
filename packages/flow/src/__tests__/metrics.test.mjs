/**
 * Figentra Flow file contract:
 * Purpose: hold `fflow status --metrics` to AC-032 with fixed fixtures and known answers: nearest-rank median
 *   and p90; lead and cycle time; gate runs and their red share; rework after the first gate; review rounds; approval
 *   latency from a merged spec's Status history; only PRs merged inside the window; open-PR age; a repository with no
 *   GitHub slug reported in place.
 * Boundary: a temporary repository and an injected GitHub; no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1729 phase 4.
 */
// @covers sta-1729:FR-7 sta-1729:AC-032
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { renderMetrics } from "../commands/status.mjs";
import { approvalDays, metrics, prRecord, quantile } from "../lib/metrics.mjs";
import { STATUS_CONTEXT } from "../lib/product.mjs";
import { repo } from "./__fixtures__/repo.mjs";

const SPEC = `# Spec

## Status history

- 2026-09-28 · — → Draft · dev · created
- 2026-09-29 · Draft → Clarified · dev · ok
- 2026-09-30 · Clarified → Planned · dev · — Approved by owner 2026-09-30
`;

/** One merged PR with three commits: the first gated red, then two green; two FAIL rounds before the PASS. */
function github() {
  const status = (/** @type {string} */ state) => [{ context: STATUS_CONTEXT, state }];
  /** @type {Record<string, any>} */
  const routes = {
    "/repos/acme/app/pulls?state=closed&sort=updated&direction=desc&per_page=100": [
      {
        number: 1,
        created_at: "2026-10-01T00:00:00Z",
        merged_at: "2026-10-02T00:00:00Z",
        head: { ref: "figentra/sta-5-pay" },
      },
      {
        number: 2,
        created_at: "2026-08-01T00:00:00Z",
        merged_at: "2026-08-02T00:00:00Z",
        head: { ref: "x" },
      },
      { number: 3, created_at: "2026-10-01T00:00:00Z", merged_at: null, head: { ref: "y" } },
    ],
    "/repos/acme/app/pulls?state=open&per_page=100": [
      { number: 9, created_at: "2026-10-07T00:00:00Z" },
    ],
    "/repos/acme/app/pulls/1/commits?per_page=100": [
      { sha: "c1", commit: { author: { date: "2026-09-30T12:00:00Z" } } },
      { sha: "c2", commit: { author: { date: "2026-10-01T06:00:00Z" } } },
      { sha: "c3", commit: { author: { date: "2026-10-01T18:00:00Z" } } },
    ],
    "/repos/acme/app/commits/c1/statuses?per_page=100": [
      ...status("failure"),
      { context: STATUS_CONTEXT, state: "pending" },
    ],
    "/repos/acme/app/commits/c2/statuses?per_page=100": status("success"),
    "/repos/acme/app/commits/c3/statuses?per_page=100": status("success"),
    "/repos/acme/app/issues/1/comments?per_page=100": [
      { body: "AI-REVIEW: FAIL c1 base=main\n\nfix x" },
      { body: "ai-review — failed c2" },
      { body: "AI-REVIEW: PASS c3 base=main" },
    ],
  };
  /** @type {import("../lib/github.mjs").Api} */
  return (_method, path) => ({
    ok: path in routes,
    json: routes[path] ?? null,
    err: path in routes ? "" : "404",
  });
}

test("quantile and approval latency: nearest rank; Draft to the last approval", () => {
  assert.equal(quantile([10, 1, 4, 3, 2], 0.5), 3);
  assert.equal(quantile([10, 1, 4, 3, 2], 0.9), 10);
  assert.equal(quantile([], 0.5), null);
  assert.equal(approvalDays(SPEC), 2);
  assert.equal(approvalDays("# no history\n"), null);
});

test("a PR's record: lead, cycle, gate runs and red ones, rework after the first gate, review rounds, approval", () => {
  const record = prRecord(
    github(),
    "acme/app",
    {
      number: 1,
      created_at: "2026-10-01T00:00:00Z",
      merged_at: "2026-10-02T00:00:00Z",
      head: { ref: "figentra/sta-5-pay" },
    },
    { specText: () => SPEC },
  );
  assert.deepEqual(record, {
    number: 1,
    leadHours: 24,
    cycleHours: 36,
    gateRuns: 3,
    redRuns: 1,
    rework: 2,
    reviewRounds: 2,
    approvalDays: 2,
  });
});

test("metrics: only PRs merged in the window count; totals, open age, the spec read by the branch key", (t) => {
  const r = repo();
  t.after(r.dispose);
  mkdirSync(join(r.root, ".agents/specs/sta-5-pay"), { recursive: true });
  writeFileSync(join(r.root, ".agents/specs/sta-5-pay/spec.md"), SPEC);
  const m = metrics({
    repos: [
      { path: r.root, github: "acme/app" },
      { path: "/nowhere", github: "" },
    ],
    api: () => github(),
    since: Date.parse("2026-09-01T00:00:00Z"),
    now: Date.parse("2026-10-10T00:00:00Z"),
  });
  const [mine, bare] = m.repos;
  assert.equal(bare.error, "no GitHub repository");
  assert.deepEqual(mine, {
    path: r.root,
    github: "acme/app",
    merged: 1,
    leadHours: { median: 24, p90: 24 },
    cycleHours: { median: 36, p90: 36 },
    gateRunsPerPr: 3,
    redShare: 33.3,
    reworkPerPr: 2,
    reviewRoundsPerPr: 2,
    approvalDays: { median: 2, p90: 2 },
    open: 1,
    openAgeDays: { median: 3, p90: 3 },
  });
  assert.equal(m.total.merged, 1);
  assert.match(
    renderMetrics(m),
    /acme\/app: 1 merged; lead 24 h median, 24 h p90; cycle 36 h median/,
  );
  assert.match(renderMetrics(m), /\/nowhere: no GitHub repository/);
});
