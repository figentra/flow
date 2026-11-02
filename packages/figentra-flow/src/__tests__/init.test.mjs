/**
 * Figentra Flow file contract:
 * Purpose: hold `fflow init` and `sync` to ADR 0510: `init` writes `.flow/` (README, a starter constitution from
 *   Flow's template, `.gitignore`) and renders the `flow-*` skills directly when the repository has no projector, or
 *   neutral `.agents/skills/flow-<verb>` documents, the preset's agents and the approval workflow when it has `agents:sync`; an existing `.flow/` is refused unless
 *   forced, and the constitution is never overwritten; `sync` removes spec-kit's rendered skills and commands and
 *   records every file it wrote in `.flow/lock.json`; a repository override wins over the preset's command.
 * Boundary: writes only temp directories; node:test and node:assert.
 * Runtime: node
 * Governing contract: ADR 0022; ADR 0510.
 */
// @covers sta-1729:FR-11
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { init } from "../commands/init.mjs";
import { hasProjector, sync } from "../commands/sync.mjs";
import { FLOW_ASSETS } from "../lib/flow-dir.mjs";
import { VERBS } from "../lib/render.mjs";

const quiet = { log: () => {} };

test("init writes .flow/, a starter constitution and the direct skills; it keeps an existing constitution", () => {
  const root = mkdtempSync(join(tmpdir(), "flow-init-"));
  try {
    assert.equal(init(root), true);
    assert.equal(
      readFileSync(join(root, ".flow/constitution.md"), "utf8"),
      readFileSync(join(FLOW_ASSETS, "templates/constitution-template.md"), "utf8"),
    );
    assert.match(readFileSync(join(root, ".flow/README.md"), "utf8"), /ADR 0510/);
    for (const verb of VERBS) {
      assert.ok(existsSync(join(root, `.claude/skills/flow-${verb}/SKILL.md`)), verb);
      assert.ok(existsSync(join(root, `.opencode/commands/flow-${verb}.md`)), verb);
    }
    assert.equal(existsSync(join(root, ".specify")), false, "no spec-kit folder");
    assert.equal(readFileSync(join(root, ".gitignore"), "utf8"), ".claude/worktrees/\n", "FR-3");
    // STA-1871 FR-2: the folder explains itself to people browsing it.
    assert.match(
      readFileSync(join(root, ".claude/worktrees/README.md"), "utf8"),
      /One worktree per active task, only here\./,
    );
    writeFileSync(join(root, ".flow/constitution.md"), "ours\n");
    assert.equal(init(root), false);
    assert.equal(init(root, { force: true }), true);
    assert.equal(readFileSync(join(root, ".flow/constitution.md"), "utf8"), "ours\n");
    assert.equal(
      readFileSync(join(root, ".gitignore"), "utf8"),
      ".claude/worktrees/\n",
      "added once",
    );
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("with a projector, sync writes neutral .agents/skills documents; it removes spec-kit's rendered files", () => {
  const root = mkdtempSync(join(tmpdir(), "flow-sync-"));
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { "agents:sync": "x" } }));
    assert.equal(hasProjector(root), true);
    mkdirSync(join(root, ".claude/skills/speckit-plan"), { recursive: true });
    writeFileSync(join(root, ".claude/skills/speckit-plan/SKILL.md"), "old\n");
    mkdirSync(join(root, ".opencode/commands"), { recursive: true });
    writeFileSync(join(root, ".opencode/commands/speckit.plan.md"), "old\n");
    const { files, removed } = sync(root, quiet);
    assert.deepEqual(files, [
      ...VERBS.map((v) => `.agents/skills/flow-${v}/SKILL.md`),
      ".agents/agents/ci-steward.md",
      ".agents/agents/git-steward.md",
      ".agents/agents/tracker-steward.md",
      ".agents/rules/worktrees.md",
    ]);
    assert.deepEqual(removed.toSorted(), [
      ".claude/skills/speckit-plan",
      ".opencode/commands/speckit.plan.md",
    ]);
    const lock = JSON.parse(readFileSync(join(root, ".flow/lock.json"), "utf8"));
    assert.deepEqual(Object.keys(lock.files), files);
    assert.equal(lock.preset, "neutral");
    assert.deepEqual(sync(root, quiet).files, files, "a second sync is the same");
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("a repository override wins over the preset's command", () => {
  const root = mkdtempSync(join(tmpdir(), "flow-override-"));
  try {
    mkdirSync(join(root, ".flow/overrides/commands"), { recursive: true });
    writeFileSync(
      join(root, ".flow/overrides/commands/flow-plan.md"),
      "---\ndescription: Our plan.\n---\n\nOurs.\n",
    );
    sync(root, { direct: true, ...quiet });
    const skill = readFileSync(join(root, ".claude/skills/flow-plan/SKILL.md"), "utf8");
    assert.match(skill, /description: "Our plan\."/);
    assert.match(skill, /\nOurs\.\n/);
  } finally {
    rmSync(root, { recursive: true });
  }
});
