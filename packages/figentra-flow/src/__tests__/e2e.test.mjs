/**
 * Figentra Flow file contract:
 * Purpose: the end-to-end check of ADR 0510 on what is actually published: `npm pack` the package, unpack the tarball,
 *   and drive its own `bin` in a scratch git repository through one spec's path: `init` (`.flow/` and the `flow-*`
 *   skills, with the attribution and the notices shipped), `gate dir` on the issue's branch, `spec paths`, a clarified
 *   spec through `spec setup-plan` (the plan gate, then the plan template), `spec setup-tasks`, and `gate ci` with
 *   its install check; then a hand edit that `gate ci` refuses, and `migrate` on a spec-kit-shaped copy.
 * Boundary: temporary folders; `npm pack` and `git` run locally; no network. The unpacked package uses this
 *   checkout's node_modules, so only the published file list is under test, not dependency resolution.
 * Runtime: node
 * Governing contract: ADR 0022; ADR 0510; STA-1729 (F7).
 */
// @covers sta-1729:FR-11
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PKG = new URL("../..", import.meta.url).pathname;

/**
 * Runs `cmd` in `cwd`; returns its status and output.
 * @param {string} cwd
 * @param {string} cmd
 * @param {string[]} args
 */
const run = (cwd, cmd, args) => {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      NO_COLOR: "1",
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  });
  return { status: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
};

test("e2e: the packed package installs .flow/ and carries one spec from gate dir to tasks; gate ci holds the install", (t) => {
  // The real path: git and the CLI report /private/var on macOS where tmpdir() says /var.
  const top = realpathSync(mkdtempSync(join(tmpdir(), "flow-e2e-")));
  t.after(() => rmSync(top, { recursive: true, force: true }));
  const packed = run(PKG, "npm", ["pack", "--silent", "--pack-destination", top]);
  assert.equal(packed.status, 0, packed.err);
  const tarball = readdirSync(top).find((f) => f.endsWith(".tgz")) ?? "";
  assert.equal(run(top, "tar", ["-xzf", tarball]).status, 0);
  const pkg = join(top, "package");
  for (const f of ["THIRD_PARTY_NOTICES.md", "assets/flow/presets/neutral/commands/flow-plan.md"])
    assert.ok(existsSync(join(pkg, f)), `${f} is published`);
  assert.equal(
    existsSync(join(pkg, "assets/specify")),
    false,
    "spec-kit's folder is not published",
  );
  symlinkSync(join(PKG, "node_modules"), join(pkg, "node_modules"));
  const flow = (/** @type {string} */ cwd, /** @type {string[]} */ args) =>
    run(cwd, process.execPath, [join(pkg, "bin/fflow.mjs"), ...args]);

  const repo = join(top, "repo");
  mkdirSync(repo);
  run(repo, "git", ["init", "-q", "-b", "main"]);
  writeFileSync(join(repo, "README.md"), "x\n");
  run(repo, "git", ["add", "-A"]);
  run(repo, "git", ["commit", "-q", "-m", "init"]);

  const init = flow(repo, ["init"]);
  assert.equal(init.status, 0, init.err);
  const skill = readFileSync(join(repo, ".claude/skills/flow-plan/SKILL.md"), "utf8");
  assert.match(skill, /derived-from: github\/spec-kit 1\.0\.10 \(MIT\)/);
  assert.match(skill, /fflow spec setup-plan --json/);

  run(repo, "git", ["switch", "-q", "-c", "work/sta-1-widget"]);
  const dir = flow(repo, ["gate", "dir", "--slug", "widget"]);
  assert.equal(dir.status, 0, dir.err);
  assert.equal(dir.out.trim(), ".agents/specs/sta-1-widget");
  mkdirSync(join(repo, ".agents/specs/sta-1-widget"), { recursive: true });
  const specFile = join(repo, ".agents/specs/sta-1-widget/spec.md");
  writeFileSync(
    specFile,
    "# Spec\n\n**Status**: Draft\n**Issue**: STA-1\n**Clarifications status**: pending\n",
  );
  const paths = JSON.parse(flow(repo, ["spec", "paths", "--json", "--paths-only"]).out);
  assert.equal(paths.FEATURE_SPEC, specFile);

  const refused = flow(repo, ["spec", "setup-plan", "--json"]);
  assert.equal(refused.status, 1, "the plan gate refuses an unclarified spec");
  assert.equal(existsSync(join(repo, ".agents/specs/sta-1-widget/plan.md")), false);
  writeFileSync(specFile, readFileSync(specFile, "utf8").replace("pending", "complete"));
  const plan = flow(repo, ["spec", "setup-plan", "--json"]);
  assert.equal(plan.status, 0, plan.err);
  assert.equal(JSON.parse(plan.out).IMPL_PLAN, join(repo, ".agents/specs/sta-1-widget/plan.md"));
  const tasks = JSON.parse(flow(repo, ["spec", "setup-tasks", "--json"]).out);
  assert.match(tasks.TASKS_TEMPLATE_CONTENT, /\S/);

  run(repo, "git", ["add", "-A"]);
  run(repo, "git", ["commit", "-q", "-m", "spec"]);
  assert.equal(flow(repo, ["gate", "ci", "--base=HEAD"]).status, 0);
  assert.equal(flow(repo, ["check"]).status, 0, "STA-1945: a synced repository passes check");
  writeFileSync(join(repo, ".opencode/commands/flow-plan.md"), "hand edit\n");
  const ci = flow(repo, ["gate", "ci", "--base=HEAD"]);
  assert.equal(ci.status, 1);
  assert.match(ci.err, /install: \.opencode\/commands\/flow-plan\.md differs/);
  const checked = flow(repo, ["check"]);
  assert.equal(checked.status, 1);
  assert.match(checked.out, /fflow check: \.opencode\/commands\/flow-plan\.md differs/);

  const old = join(top, "old");
  mkdirSync(join(old, ".specify/memory"), { recursive: true });
  run(old, "git", ["init", "-q"]);
  writeFileSync(join(old, ".specify/memory/constitution.md"), "# ours\n");
  const migrated = flow(old, ["migrate"]);
  assert.equal(migrated.status, 0, migrated.err);
  assert.equal(readFileSync(join(old, ".flow/constitution.md"), "utf8"), "# ours\n");
  assert.equal(existsSync(join(old, ".specify")), false);
});
