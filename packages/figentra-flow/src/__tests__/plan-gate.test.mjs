/**
 * Figentra Flow file contract:
 * Purpose: core's plan gate tests, ported (core 220f92c2, `.agents/hooks/__tests__/plan-gate.test.mjs`): a Write or
 *   Edit to a source path of the stackra tables needs the branch's spec answered and a plan, or the owner's hotfix
 *   marker. Only the harness changed: the gate takes the preset's `PLAN_GATED`, each fixture root's configuration
 *   names `stackra` (its Impact questionnaire), and the hook is `bin/fflow-guard.mjs PreToolUse`.
 * Boundary: test only; temporary repositories, no network.
 * Runtime: node
 * Governing contract: Stackra ADR 0362; ADR 0022; STA-1945.
 */
// @covers sta-614:FR-001 sta-614:FR-002 sta-614:FR-003 sta-614:FR-004
// @covers sta-1945:FR-7 sta-1945:FR-11 sta-1945:AC-9 sta-1945:P-012
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { decidePaths } from "../guard/paths.mjs";
import { decidePlanGate, hotfixApproved } from "../guard/plan-gate.mjs";
import { loadTables } from "../guard/tables.mjs";
import { presetRoot, runHook } from "./__fixtures__/guard.mjs";

const tables = await loadTables(presetRoot());
const GATED = /** @type {RegExp} */ (tables.planGated);

const IMPACT = [
  "Apps touched",
  "Services touched",
  "Packages touched",
  "Cross-service events",
  "Tenancy and data",
  "Secrets",
  "ADR needed",
  "New dependencies",
  "Deploy modes",
  "Licence tier",
  "Docs to update",
  "Lane",
  "Change risk",
];
const SPEC = [
  "**Status**: Clarified",
  "**Linear**: STA-7",
  "**Clarifications status**: complete",
  "",
  "## Impact",
  "",
  ...IMPACT.map((f) => `- **${f}**: none`),
  "",
].join("\n");
const HOTFIX = "**Approved by**: owner\n**Approved on**: 2026-10-25\n**Reason**: checkout down\n";

/**
 * A stackra repository root with `.agents/specs/<folder>/` holding `files`.
 * @param {string | null} folder
 * @param {Record<string, string>} [files]
 */
function repo(folder, files = {}) {
  const root = presetRoot();
  if (folder) {
    const dir = join(root, ".agents/specs", folder);
    mkdirSync(dir, { recursive: true });
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  }
  return root;
}
const decide = (
  /** @type {string} */ root,
  /** @type {string} */ rel,
  branch = "figentra/sta-7-thing",
) => decidePlanGate(join(root, rel), GATED, { root, branch }).then((d) => d.decision);

test("allow: a source path with an answered spec and a plan", async () => {
  const root = repo("sta-7-thing", { "spec.md": SPEC, "plan.md": "# Plan\n" });
  for (const rel of [
    "packages/data/x/src/a.ts",
    "services/billing/src/main.ts",
    "apps/console/src/x.tsx",
    "workers/static/src/main.ts",
    "tools/scripts/x.mjs",
  ])
    assert.equal(await decide(root, rel), "allow", rel);
});

test("allow: paths outside source need no spec", async () => {
  const root = repo(null);
  for (const rel of [
    ".agents/specs/sta-7-thing/spec.md",
    "apps/docs/src/docs/adr/0362-x.mdx",
    "tools/scaffold/templates/apps/docs/index.mdx",
    "README.md",
    ".agents/hooks/_rules.mjs",
    "notes/handover/x.md",
    "packages/a/README.md",
    "services/a/docs/guide.mdx",
  ])
    assert.equal(await decide(root, rel, "main"), "allow", rel);
});

test("deny: a source path on a branch with no STA key", async () => {
  const root = repo("sta-7-thing", { "spec.md": SPEC, "plan.md": "# Plan\n" });
  assert.equal(await decide(root, "packages/a/src/a.ts", "main"), "deny");
  assert.equal(await decide(root, "packages/a/src/a.ts", ""), "deny");
});

test("deny: no spec folder, two spec folders, or no spec.md", async () => {
  assert.equal(await decide(repo(null), "packages/a/src/a.ts"), "deny");
  const two = repo("sta-7-thing", { "spec.md": SPEC, "plan.md": "x" });
  mkdirSync(join(two, ".agents/specs/sta-7-other"));
  assert.equal(await decide(two, "packages/a/src/a.ts"), "deny");
  assert.equal(await decide(repo("sta-7-thing", { "plan.md": "x" }), "apps/x/a.ts"), "deny");
});

test("deny: a spec with an unanswered question", async () => {
  for (const spec of [
    SPEC.replace("complete", "pending"),
    SPEC.replace("- **Lane**: none", "- **Lane**:"),
    `${SPEC}\n[NEEDS CLARIFICATION: which region?]\n`,
  ]) {
    const root = repo("sta-7-thing", { "spec.md": spec, "plan.md": "# Plan\n" });
    assert.equal(await decide(root, "services/a/src/a.ts"), "deny");
  }
});

test("deny: an answered spec without a plan", async () => {
  assert.equal(await decide(repo("sta-7-thing", { "spec.md": SPEC }), "workers/a/x.ts"), "deny");
  const blank = repo("sta-7-thing", { "spec.md": SPEC, "plan.md": "  \n" });
  assert.equal(await decide(blank, "workers/a/x.ts"), "deny");
});

test("allow: an owner-approved hotfix goes before its questionnaire", async () => {
  assert.equal(
    await decide(repo("sta-7-thing", { "hotfix.md": HOTFIX }), "services/a/x.ts"),
    "allow",
  );
  const half = repo("sta-7-thing", { "hotfix.md": "**Approved by**: owner\n**Reason**:\n" });
  assert.equal(await decide(half, "services/a/x.ts"), "deny");
  assert.equal(hotfixApproved(HOTFIX), true);
  assert.equal(hotfixApproved(""), false);
  assert.equal(hotfixApproved(HOTFIX.replace("2026-10-25", "soon")), false);
});

test("deny: an agent never writes the hotfix marker", () => {
  const write = (/** @type {string} */ file_path) =>
    decidePaths("Write", { file_path }, "/", tables.paths).decision;
  assert.equal(write("/r/.agents/specs/sta-7-thing/hotfix.md"), "deny");
  assert.equal(write("/r/.agents/specs/sta-7-thing/spec.md"), "allow");
});

/** The hook denies a Write of `file_path`, with the stackra tables of `root`. */
const hookDenies = (/** @type {string} */ root, /** @type {string} */ file_path) =>
  runHook(
    "PreToolUse",
    { tool_name: "Write", tool_input: { file_path, content: "x" } },
    { ...process.env, CLAUDE_PROJECT_DIR: root },
  ).stdout.includes('"permissionDecision":"deny"');

test("hook: reads the branch from the file's git checkout; outside git it allows", () => {
  const root = repo(null);
  spawnSync("git", ["init", "-q", "-b", "figentra/sta-7-thing", root]);
  const run = (/** @type {string} */ file_path) => hookDenies(root, file_path);
  assert.equal(run(join(root, "packages/a/src/new/a.ts")), true); // no spec yet; the folder need not exist
  assert.equal(run(join(root, "apps/docs/src/a.mdx")), false);
  const dir = join(root, ".agents/specs/sta-7-thing");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "spec.md"), SPEC);
  writeFileSync(join(dir, "plan.md"), "# Plan\n");
  assert.equal(run(join(root, "packages/a/src/new/a.ts")), false);
  assert.equal(run(join(repo(null), "packages/a/src/a.ts")), false); // not a git checkout
});

test("hook: a rebase leaves HEAD detached, and the gate still reads the branch", () => {
  const root = repo(null);
  const git = (/** @type {string[]} */ ...a) =>
    spawnSync("git", ["-C", root, ...a], { encoding: "utf8" });
  git("init", "-q", "-b", "figentra/sta-7-thing");
  const gitDir = join(root, ".git/rebase-merge");
  mkdirSync(gitDir, { recursive: true });
  writeFileSync(join(gitDir, "head-name"), "refs/heads/figentra/sta-7-thing\n");
  git("checkout", "-q", "--detach");
  const dir = join(root, ".agents/specs/sta-7-thing");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "spec.md"), SPEC);
  writeFileSync(join(dir, "plan.md"), "# Plan\n");
  assert.equal(hookDenies(root, join(root, "packages/a/a.ts")), false);
});
