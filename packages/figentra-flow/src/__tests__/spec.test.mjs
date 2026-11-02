/**
 * Figentra Flow file contract:
 * Purpose: hold `fflow spec` to the scripts it replaces (ADR 0510): `paths` prints the same keys as
 *   `check-prerequisites.sh` (`--paths-only`, the validation refusals, `AVAILABLE_DOCS` in order, `--template`);
 *   `setup-plan` runs the plan gate first and copies the plan template only when plan.md is missing; `setup-tasks`
 *   returns the tasks template; templates resolve `.flow/overrides/`, then the preset, then Flow's base; the spec
 *   folder comes from `.flow/current.json`, else the branch, under `specs.dir`.
 * Boundary: temporary repositories; the plan gate is injected; no network.
 * Runtime: node
 * Governing contract: ADR 0022; ADR 0510; STA-1729.
 */
// @covers sta-1729:FR-11
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { schemeFor } from "../adapters/tracker/index.mjs";
import { specDir } from "../commands/gate.mjs";
import { availableDocs, locate, paths, setupPlan, setupTasks } from "../commands/spec.mjs";
import { FLOW_ASSETS, readCurrent, resolveTemplate, writeCurrent } from "../lib/flow-dir.mjs";
import { CONFIG_FILE } from "../lib/product.mjs";
import { CONFIG, repo, sh } from "./__fixtures__/repo.mjs";

const quiet = { log: () => {} };

/** A repository on the neutral preset with one spec folder that `.flow/current.json` points at. */
function world(/** @type {Record<string, unknown>} */ extra = {}) {
  const r = repo({ [CONFIG_FILE]: JSON.stringify({ ...CONFIG, preset: "neutral", ...extra }) });
  const dir = ".agents/specs/sta-5-widget";
  mkdirSync(join(r.root, dir), { recursive: true });
  writeFileSync(join(r.root, dir, "spec.md"), "# Spec\n");
  writeCurrent(r.root, dir);
  return { ...r, dir: join(r.root, dir) };
}

test("spec paths: --paths-only prints every path; validation refuses as the script did", (t) => {
  const w = world();
  t.after(w.dispose);
  const at = locate(w.root);
  assert.deepEqual(paths(at, ["--paths-only"]), {
    REPO_ROOT: w.root,
    BRANCH: "main",
    FEATURE_DIR: w.dir,
    FEATURE_SPEC: join(w.dir, "spec.md"),
    IMPL_PLAN: join(w.dir, "plan.md"),
    TASKS: join(w.dir, "tasks.md"),
  });
  assert.throws(() => paths(at, []), /plan\.md not found .*run \/flow-plan first/);
  writeFileSync(join(w.dir, "plan.md"), "# Plan\n");
  assert.throws(() => paths(at, ["--require-tasks"]), /tasks\.md not found .*\/flow-tasks/);
  for (const f of ["quickstart.md", "research.md", "tasks.md"])
    writeFileSync(join(w.dir, f), "x\n");
  mkdirSync(join(w.dir, "contracts"));
  writeFileSync(join(w.dir, "contracts", "a.md"), "x\n");
  assert.deepEqual(paths(at, ["--require-spec", "--require-tasks", "--include-tasks"]), {
    FEATURE_DIR: w.dir,
    AVAILABLE_DOCS: ["research.md", "contracts/", "quickstart.md", "tasks.md"],
  });
  assert.deepEqual(availableDocs(w.dir, false), ["research.md", "contracts/", "quickstart.md"]);
  const withTemplate = paths(at, ["--template", "checklist-template"]);
  assert.match(String(withTemplate.TEMPLATE_CONTENT), /Checklist: \[FEATURE NAME\]/);
});

test("spec setup-plan: the plan gate first; the template only when plan.md is missing", (t) => {
  const w = world();
  t.after(w.dispose);
  const at = locate(w.root);
  assert.throws(() => setupPlan(at, { planGate: () => 1, ...quiet }), /plan gate refused/);
  assert.equal(existsSync(at.plan), false, "nothing written when the gate refuses");
  /** @type {string[]} */
  const seen = [];
  const out = setupPlan(at, { planGate: (spec) => (seen.push(spec), 0), ...quiet });
  assert.deepEqual(seen, [at.spec]);
  assert.deepEqual(out, {
    FEATURE_SPEC: at.spec,
    IMPL_PLAN: at.plan,
    FEATURE_DIR: w.dir,
    BRANCH: "main",
  });
  assert.equal(
    readFileSync(at.plan, "utf8"),
    readFileSync(join(FLOW_ASSETS, "presets", "neutral", "templates", "plan-template.md"), "utf8"),
  );
  writeFileSync(at.plan, "mine\n");
  setupPlan(at, { planGate: () => 0, ...quiet });
  assert.equal(readFileSync(at.plan, "utf8"), "mine\n", "an existing plan is kept");
  const tasks = setupTasks(at);
  assert.equal(tasks.TASKS_TEMPLATE.endsWith("tasks-template.md"), true);
  assert.match(tasks.TASKS_TEMPLATE_CONTENT, /\S/);
});

test("templates: .flow/overrides, then the preset, then Flow's base", (t) => {
  const w = world();
  t.after(w.dispose);
  assert.equal(
    resolveTemplate(w.root, "plan-template"),
    join(FLOW_ASSETS, "presets", "neutral", "templates", "plan-template.md"),
  );
  assert.equal(
    resolveTemplate(w.root, "constitution-template"),
    join(FLOW_ASSETS, "templates", "constitution-template.md"),
  );
  mkdirSync(join(w.root, ".flow", "overrides"), { recursive: true });
  writeFileSync(join(w.root, ".flow", "overrides", "plan-template.md"), "ours\n");
  assert.equal(
    resolveTemplate(w.root, "plan-template"),
    join(w.root, ".flow", "overrides", "plan-template.md"),
  );
  assert.equal(resolveTemplate(w.root, "nope"), undefined);
});

test("the spec folder: .flow/current.json, else the branch's key under specs.dir", (t) => {
  const w = world({ specs: { dir: "docs/specs" } });
  t.after(w.dispose);
  assert.equal(readCurrent(w.root), ".agents/specs/sta-5-widget");
  assert.deepEqual(
    specDir({
      root: w.root,
      branch: "figentra/sta-9-thing",
      slug: "thing",
      keys: schemeFor(w.root),
    }),
    {
      dir: "docs/specs/sta-9-thing",
    },
  );
  sh(w.root, "switch", "-q", "-c", "figentra/sta-9-thing");
  writeFileSync(join(w.root, ".flow", "current.json"), "not json");
  assert.throws(() => locate(w.root), /no folder for STA-9 yet/);
  mkdirSync(join(w.root, "docs", "specs", "sta-9-thing"), { recursive: true });
  assert.equal(locate(w.root).featureDir, join(w.root, "docs", "specs", "sta-9-thing"));
});
