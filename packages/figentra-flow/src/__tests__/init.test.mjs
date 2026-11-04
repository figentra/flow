/**
 * Figentra Flow file contract:
 * Purpose: hold `fflow init` and `sync` to ADR 0510: `init` writes `.flow/` (README, a starter constitution from
 *   Flow's template, `.gitignore`) and renders the `flow-*` skills directly when the repository has no projector, or
 *   neutral `.agents/skills/flow-<verb>` documents, the preset's agents, its surfaces and the approval workflow when it has `agents:sync`; an existing `.flow/` is refused unless
 *   forced, and the constitution is never overwritten; `sync` removes spec-kit's rendered skills and commands and
 *   records every file it wrote in `.flow/lock.json`; a repository override wins over the preset's command.
 * Boundary: writes only temp directories; node:test and node:assert.
 * Runtime: node
 * Governing contract: ADR 0022; ADR 0510.
 */
// @covers sta-1729:FR-11
// @covers sta-1871:AC-002
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { spawnSync } from "node:child_process";

import { checks, rowsOf } from "../commands/doctor.mjs";
import { specDir } from "../commands/gate.mjs";
import { init, STARTER_CONFIG } from "../commands/init.mjs";
import { locate } from "../commands/spec.mjs";
import { hasProjector, sync } from "../commands/sync.mjs";
import { loadConfig } from "../lib/config.mjs";
import { FLOW_ASSETS } from "../lib/flow-dir.mjs";
import { CONFIG_FILE } from "../lib/product.mjs";
import { VERBS } from "../lib/render.mjs";
import { repo, sh } from "./__fixtures__/repo.mjs";

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
      ".claude/settings.json",
      "lefthook.yml",
    ]);
    assert.deepEqual(removed.toSorted(), [
      ".claude/skills/speckit-plan",
      ".opencode/commands/speckit.plan.md",
    ]);
    const lock = JSON.parse(readFileSync(join(root, ".flow/lock.json"), "utf8"));
    assert.deepEqual(Object.keys(lock.files), files);
    assert.equal(lock.preset.name, "neutral");
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

// @covers sta-1945:FR-31 sta-1945:AC-37 sta-1945:P-035
test("init writes a starter config, says so, and keeps one; doctor then reports no error", (t) => {
  const root = mkdtempSync(join(tmpdir(), "flow-init-config-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  spawnSync("git", ["init", "-q"], { cwd: root });
  /** @type {string[]} */
  const said = [];
  assert.equal(init(root, { config: true, log: (line) => said.push(line) }), true);
  assert.deepEqual(JSON.parse(readFileSync(join(root, CONFIG_FILE), "utf8")), STARTER_CONFIG);
  assert.deepEqual(loadConfig(root).errors, []);
  assert.match(said.join("\n"), /wrote flow\.config\.json/);
  assert.match(said.join("\n"), /rendered \d+ file/);
  const rows = rowsOf(checks(root, { disk: () => ({ free: 1024 ** 4, total: 2 * 1024 ** 4 }) }));
  assert.deepEqual(
    rows.filter((r) => r.status === "fail"),
    [],
  );
  writeFileSync(join(root, CONFIG_FILE), '{ "version": 1, "preset": "neutral" }\n');
  init(root, { force: true, config: true, log: () => {} });
  assert.match(
    readFileSync(join(root, CONFIG_FILE), "utf8"),
    /neutral/,
    "an existing config is kept",
  );
});

// @covers sta-1945:FR-31 sta-1945:AC-37
test("spec paths and gate dir fall back to the branch slug's folder; neither sends the other back", (t) => {
  const r = repo();
  t.after(r.dispose);
  mkdirSync(join(r.root, ".agents/specs/sta-9-cancel-order"), { recursive: true });
  sh(r.root, "checkout", "-q", "-b", "feature/cancel-order");
  assert.deepEqual(specDir({ root: r.root, branch: "feature/cancel-order" }), {
    dir: ".agents/specs/sta-9-cancel-order",
  });
  assert.equal(locate(r.root).featureDir, join(r.root, ".agents/specs/sta-9-cancel-order"));
  const none = specDir({ root: r.root, branch: "feature/other" });
  assert.equal(none.fix, "--key <key>");
  assert.doesNotMatch(none.error ?? "", /gate dir/);
  sh(r.root, "checkout", "-q", "-b", "feature/other");
  assert.throws(() => locate(r.root), /gate dir --key <key>/);
});

// @covers sta-1945:FR-31 sta-1945:AC-37
test("gate dir's slug fallback matches the whole slug, and refuses several folders with it", (t) => {
  const r = repo();
  t.after(r.dispose);
  mkdirSync(join(r.root, ".agents/specs/sta-9-cancel-order"), { recursive: true });
  // `order` is only the last word of `cancel-order`: never that spec's folder.
  const tail = specDir({ root: r.root, branch: "feature/order" });
  assert.equal(tail.dir, undefined);
  assert.match(tail.error ?? "", /no spec folder named for its slug/);
  mkdirSync(join(r.root, ".agents/specs/sta-10-cancel-order"), { recursive: true });
  const several = specDir({ root: r.root, branch: "feature/cancel-order" });
  assert.equal(several.dir, undefined);
  assert.match(several.error ?? "", /several spec folders named for it: .*sta-9-cancel-order/);
  assert.match(several.error ?? "", /sta-10-cancel-order/);
  assert.equal(several.fix, "--key <key>");
});
