/**
 * Figentra Flow file contract:
 * Purpose: core's prompt hint tests, ported (core 220f92c2, `.agents/hooks/__tests__/prompt-hints.test.mjs`): the
 *   hint each prompt pattern of the stackra tables adds, and silence otherwise. Only the harness changed: the hook is
 *   `bin/fflow-guard.mjs UserPromptSubmit`, run in a folder whose configuration names `stackra`; the neutral preset
 *   has no hints.
 * Boundary: test only; runs the hook entry as a child process.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945.
 */
// @covers sta-1945:FR-7 sta-1945:FR-11 sta-1945:AC-9 sta-1945:P-012
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

import { presetRoot, runHook } from "./__fixtures__/guard.mjs";

const root = presetRoot();
const neutral = presetRoot("neutral");
after(() => [root, neutral].forEach((d) => rmSync(d, { recursive: true, force: true })));
/** The hook's run on `input` with the tables of `dir`. */
const hook = (/** @type {Record<string, unknown> | string} */ input, dir = root) =>
  runHook("UserPromptSubmit", input, { ...process.env, CLAUDE_PROJECT_DIR: dir });

/** Run the hook with a prompt; return the additionalContext text ("" when none was emitted). */
const hintsFor = (/** @type {string} */ prompt, dir = root) => {
  const r = hook({ prompt }, dir);
  assert.equal(r.status, 0);
  const out = r.stdout.trim();
  if (!out) return "";
  const payload = JSON.parse(out);
  return payload.hookSpecificOutput?.additionalContext ?? "";
};

const cases = [
  // [prompt fragment, expected hint marker]
  ["add an endpoint for users", "http-conventions.md"],
  ["create a new route handler", "http-conventions.md"],
  ["where do I put this api key", ".agents/rules/secrets.md"],
  ["load the token from .env", ".agents/rules/secrets.md"],
  ["write an adr for this decision", "docs-adr-steward"],
  ["supersede ADR-0005", "docs-adr-steward"],
  ["add a changeset for the release", "runbooks/release.mdx"],
  ["should the changelog mention this", "runbooks/release.mdx"],
  ["write a vitest for this", "__tests__/"],
  ["where does the spec file go", "__tests__/"],
  ["bump the dependency version in package.json", "catalog"],
  ["create a new encore service for billing", "services/"],
  ["is this gateway a separate worker", "not-built-yet.md"],
  ["build a new button component", "@stackra/ui"],
  ["which design token is the brand colour", "@stackra/tokens"],
  ["add a drizzle migration", "MikroORM"],
  ["can we use prisma here", "MikroORM"],
  ["where should this new package live", "workspace-layout.md"],
  ["can a package import from another package's src", "turbo boundaries"],
  ["I want to add support for CSV export", "/speckit.clarify"],
  ["implement the invite flow", "/speckit.clarify"],
];

for (const [prompt, marker] of cases)
  test(`hint: "${prompt}" → contains "${marker}"`, () => {
    const ctx = hintsFor(prompt);
    assert.ok(ctx.startsWith("[STACKRA HINTS]"), `expected a hints block, got: ${ctx || "(none)"}`);
    assert.ok(ctx.includes(marker), `expected hint to mention ${marker}, got: ${ctx}`);
  });

const silent = [
  "hello",
  "fix the typo in the readme",
  "what does this function do",
  "refactor the loop",
];

for (const prompt of silent)
  test(`silent: "${prompt}" → no output`, () => assert.equal(hintsFor(prompt), ""));

test("accepts user_input as an alternate field", () => {
  const r = hook({ user_input: "add an endpoint" });
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes("http-conventions.md"));
});

test("malformed stdin exits 0 with no output (fail-open)", () => {
  const r = hook("not json{");
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), "");
});

test("empty prompt produces no output", () => {
  const r = hook("{}");
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), "");
});

test("the word spec alone does not fire the no-.spec test hint", () => {
  assert.ok(!hintsFor("update the spec for contracts").includes("__tests__/"));
});

test("a /speckit command is not nudged back to clarify", () => {
  assert.ok(!hintsFor("/speckit.plan implement the invite flow").includes("/speckit.clarify"));
});

test("the neutral preset has no prompt hints", () => {
  assert.equal(hintsFor("add an endpoint for users", neutral), "");
});
