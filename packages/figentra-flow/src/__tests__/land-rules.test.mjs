/**
 * Figentra Flow file contract:
 * Purpose: hold `lib/land-rules.mjs` to its contract: every land rule refuses with its reason (state, draft,
 *   conflict, stacked base, no, red or foreign gate, title, approvals and tier, owner-only paths and findings, the
 *   ruleset before phase 6); a renamed gate App (ADR 0523) counts from either configured login, never a third; the AI
 *   review is advisory (ADR 0523 decision 6): a missing or FAIL verdict on a reviewed tier is a warning, never a
 *   refusal, and the squash message records the verdict with one `Refs:` line and each co-author once; `land.mjs`
 *   re-exports the same functions, so every older import keeps working.
 * Boundary: pure: PRs, statuses and specs built here; no git, no network.
 * Runtime: node
 * Governing contract: ADR 0022; Stackra ADR 0503; ADR 0523 (decision 6); STA-1729 phase 3 (AC-031); STA-1856 FR-1.
 */
// @covers sta-1729:FR-6 sta-1729:AC-010 sta-1729:AC-031 sta-1856:FR-1 sta-1856:AC-001
import { test } from "node:test";
import assert from "node:assert/strict";

import * as land from "../commands/land.mjs";
import {
  CONVENTIONAL,
  gateProblems,
  landRules,
  MAX_FILES,
  REVIEW_TIERS,
  reviewWarnings,
  specAt,
  squashMessage,
} from "../lib/land-rules.mjs";

/** The gate App login the configuration names. */
const GATE_APP = "figentra-gate[bot]";
const SHA = "c".repeat(40);
const GREEN = [{ context: "fflow/gate", state: "success", creator: { login: GATE_APP } }];
/** @param {Record<string, unknown>} [over] */
const pr = (over = {}) => ({
  number: 7,
  state: "open",
  draft: false,
  mergeable_state: "clean",
  title: "feat(flow): land",
  base: { ref: "main" },
  head: { sha: SHA, ref: "figentra/sta-5-land" },
  ...over,
});
const PASSED = { verdict: "PASS", ignored: [] };

test("land.mjs re-exports the land rules, so every older import keeps working", () => {
  const moved = {
    CONVENTIONAL,
    gateProblems,
    landRules,
    MAX_FILES,
    REVIEW_TIERS,
    reviewWarnings,
    specAt,
  };
  for (const [name, value] of Object.entries({ ...moved, squashMessage }))
    assert.equal(land[/** @type {keyof typeof land} */ (name)], value, name);
});

test("rules: a green, approved, conventional PR on main may land; each rule names its reason", () => {
  const ok = { pr: pr(), statuses: GREEN, base: "main", required: true, gateApp: GATE_APP };
  assert.deepEqual(landRules(ok), []);
  const cases = [
    [{ pr: pr({ state: "closed" }) }, /is closed/],
    [{ pr: pr({ draft: true }) }, /draft/],
    [{ pr: pr({ mergeable_state: "dirty" }) }, /conflicts with main/],
    [{ pr: pr({ base: { ref: "figentra/sta-4-x" } }) }, /stacked on `figentra\/sta-4-x`.*--stack/],
    [{ statuses: [] }, /no fflow\/gate on the head c{12}/],
    [
      {
        statuses: [
          { context: "fflow/gate", state: "failure", creator: { login: GATE_APP } },
          ...GREEN,
        ],
      },
      /is failure/,
    ],
    [
      {
        statuses: [{ context: "fflow/gate", state: "success", creator: { login: "someone" } }],
      },
      /posted by someone, not figentra-gate\[bot\]/,
    ],
    [{ pr: pr({ title: "Land it" }) }, /conventional commit header/],
    [{ required: false }, /does not require fflow\/gate yet.*--manual-ok/],
  ];
  for (const [over, reason] of cases)
    assert.match(
      landRules({ ...ok, .../** @type {object} */ (over) }).join("\n"),
      /** @type {RegExp} */ (reason),
    );
  assert.deepEqual(landRules({ ...ok, required: false, manualOk: true }), []);
  assert.deepEqual(landRules({ ...ok, pr: pr({ base: { ref: "x" } }), stack: true }), []);
});

test("rules: a renamed gate App (ADR 0523) counts from either login the configuration names, not from a third", () => {
  const by = (/** @type {string} */ login) => [
    { context: "fflow/gate", state: "success", creator: { login } },
  ];
  const ok = {
    pr: pr(),
    base: "main",
    required: true,
    gateApp: [GATE_APP, "figentra-flow[bot]"],
  };
  assert.deepEqual(landRules({ ...ok, statuses: by(GATE_APP) }), []);
  assert.deepEqual(landRules({ ...ok, statuses: by("figentra-flow[bot]") }), []);
  assert.match(
    landRules({ ...ok, statuses: by("figentra-other[bot]") }).join("\n"),
    /posted by figentra-other\[bot\], not figentra-gate\[bot\] or figentra-flow\[bot\]/,
  );
  assert.match(
    landRules({ ...ok, gateApp: [], statuses: by(GATE_APP) }).join("\n"),
    /no gate App is configured/,
  );
  const ghost = [{ context: "fflow/gate", state: "success", creator: null }];
  for (const gateApp of ["", [""]])
    assert.match(
      landRules({ ...ok, gateApp, statuses: ghost }).join("\n"),
      /no gate App is configured/,
    );
});

test("rules: a feature spec needs its approval and Tasked; a spec without a tier passes", () => {
  const ok = {
    pr: pr(),
    statuses: GREEN,
    base: "main",
    required: true,
    gateApp: GATE_APP,
    review: PASSED,
  };
  const feature = (/** @type {string} */ status) =>
    `# Spec\n\n**Status**: ${status}\n\n**Tier**: feature\n\n**Approver**: leader\n\n## Status history\n\n- Draft → Clarified\n`;
  assert.match(
    landRules({ ...ok, spec: feature("Planned") }).join("\n"),
    /lands from Tasked or later; it is planned/,
  );
  // At Tasked without the recorded stop, the approval rule of ADR 0502 refuses.
  assert.match(landRules({ ...ok, spec: feature("Tasked") }).join("\n"), /^spec: /m);
  assert.deepEqual(landRules({ ...ok, spec: "# Spec\n\n**Status**: Draft\n" }), []);
});

test("rules: the AI review is advisory (ADR 0523 decision 6): a missing or FAIL verdict warns, never refuses", () => {
  const base = { pr: pr(), statuses: GREEN, base: "main", required: true, gateApp: GATE_APP };
  const small = "# Spec\n\n**Status**: Tasked\n\n**Tier**: small\n";
  const failed = { verdict: "FAIL", ignored: ["x is not the stackra-reviewer app"] };
  // No verdict, a FAIL, or one for another head: land refuses none of them.
  for (const review of [undefined, { verdict: null, ignored: [] }, failed])
    assert.deepEqual(landRules({ ...base, spec: small, review }), []);
  // The warnings name the reviewed tiers' missing PASS; trivial work, and work with no spec, are exempt.
  assert.deepEqual(reviewWarnings(base), []);
  assert.deepEqual(reviewWarnings({ ...base, spec: "# Spec\n\n**Tier**: trivial\n" }), []);
  assert.match(
    reviewWarnings({ ...base, spec: small, reviewer: "figentra-flow" }).join(),
    /^advisory, not blocking.*no AI review PASS for c{40} \(counted verdict: none\).*AI-REVIEW: PASS c{40} base=main.*figentra-flow app$/,
  );
  assert.match(
    reviewWarnings({ ...base, spec: small, review: failed }).join(),
    /counted verdict: FAIL.*ignored: x is not the stackra-reviewer app/,
  );
  // A spec with no tier counts as small; `review.required` narrows or widens the tiers.
  assert.equal(reviewWarnings({ ...base, spec: "# Spec\n\n**Status**: Draft\n" }).length, 1);
  assert.deepEqual(reviewWarnings({ ...base, spec: small, reviewTiers: ["feature", "big"] }), []);
  assert.equal(
    reviewWarnings({ ...base, spec: "# Spec\n\n**Tier**: trivial\n", reviewTiers: ["trivial"] })
      .length,
    1,
  );
  assert.deepEqual(reviewWarnings({ ...base, spec: small, review: PASSED }), []);
});

test("rules: Flow's own confirmed blocking finding still refuses (STA-1945 AC-40)", () => {
  const ok = { pr: pr(), statuses: GREEN, base: "main", required: true, gateApp: GATE_APP };
  assert.match(
    landRules({ ...ok, blocking: ["r-1 in a.mjs: leaks the token"] }).join(),
    /the review confirmed a blocking finding: r-1 in a\.mjs: leaks the token/,
  );
});

test("squash message: one Refs line, the AI review's verdict and each co-author once", () => {
  const commits = [
    { commit: { message: "feat: a\n\nCo-authored-by: Ann <a@x>" } },
    { commit: { message: "fix: b\n\nCo-Authored-By: Ann <a@x>\nCo-authored-by: Bo <b@x>" } },
  ];
  assert.equal(
    squashMessage("sta-5", commits),
    "Refs: STA-5\nCo-Authored-By: Ann <a@x>\nCo-Authored-By: Bo <b@x>",
  );
  // The AI review's verdict on the landed head is recorded, whatever it is.
  for (const [verdict, line] of [
    ["PASS", `AI-Review: PASS ${SHA}`],
    ["FAIL", `AI-Review: FAIL ${SHA}`],
    [null, "AI-Review: none"],
  ])
    assert.equal(
      squashMessage("sta-5", commits, { verdict, sha: SHA }),
      `Refs: STA-5\n${line}\nCo-Authored-By: Ann <a@x>\nCo-Authored-By: Bo <b@x>`,
    );
  assert.equal(squashMessage(undefined, [], { verdict: null, sha: SHA }), "AI-Review: none");
});
test("rules: with no gate App configured nothing lands", () => {
  const problems = landRules({ pr: pr(), statuses: GREEN, base: "main", required: true });
  assert.match(problems.join(), /no gate App is configured: set apps\.gate\.login/);
});

test("rules: a PR that changes an owner-only path is the owner's to land (STA-1856 FR-1)", () => {
  const ok = { pr: pr(), statuses: GREEN, base: "main", required: true, gateApp: GATE_APP };
  assert.deepEqual(landRules({ ...ok, files: ["src/a.mjs", ".agents/agents/git-steward.md"] }), []);
  assert.match(landRules({ ...ok, files: [".GitHub/Workflows/x.yml"] }).join(), /owner-only paths/);
  assert.match(
    landRules({ ...ok, files: ["deploy/run.sh"], ownerOnly: ["deploy/**"] }).join(),
    /owner-only paths, so the owner lands it: deploy\/run\.sh/,
  );
  assert.match(
    landRules({ ...ok, ownerFindings: ["package.json: the root scripts changed"] }).join(),
    /owner-only change, so the owner lands it: package\.json: the root scripts changed/,
  );
  assert.match(
    landRules({
      ...ok,
      files: ["src/a.mjs", ".github/workflows/ci.yml", "pnpm-workspace.yaml"],
    }).join(),
    /owner-only paths, so the owner lands it: \.github\/workflows\/ci\.yml, pnpm-workspace\.yaml/,
  );
});

test("specAt: reads the branch key's spec at the head through the contents API, as data", async () => {
  /** @type {string[]} */
  const asked = [];
  /** @type {import("../lib/github.mjs").Api} */
  const api = (_method, path) => {
    asked.push(path);
    if (path === `/repos/o/r/contents/.agents/specs?ref=${SHA}`)
      return { ok: true, json: [{ type: "dir", name: "sta-5-land" }], err: "" };
    if (path === `/repos/o/r/contents/.agents/specs/sta-5-land/spec.md?ref=${SHA}`)
      return {
        ok: true,
        json: { content: Buffer.from("**Tier**: small\n").toString("base64") },
        err: "",
      };
    return { ok: false, json: undefined, err: "HTTP 404" };
  };
  assert.equal(await specAt(api, "o/r", SHA, "sta-5"), "**Tier**: small\n");
  assert.equal(await specAt(api, "o/r", SHA, "sta-6"), undefined);
  assert.equal(await specAt(api, "o/r", SHA, undefined), undefined);
  assert.equal(asked.length, 3, "no key reads nothing");
});
