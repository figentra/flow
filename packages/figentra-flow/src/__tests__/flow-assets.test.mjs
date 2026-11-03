/**
 * Figentra Flow file contract:
 * Purpose: hold Flow's own spec assets (ADR 0510) to their shape: each preset ships `preset.yml`, the three templates
 *   and exactly the eight `flow-*` commands; every command and the checklist and constitution templates carry the
 *   spec-kit attribution line; no asset still names spec-kit's machinery (`.specify`, `SPECIFY_*`, `extensions.yml`,
 *   `speckit`, the bash scripts, `{SCRIPT}`); and the package ships `THIRD_PARTY_NOTICES.md`.
 *   What `sync` writes from them starts with its provenance header, and `.flow/lock.json` v2 records each digest; a v1
 *   lock still reads (STA-1945). `sync` applies the overrides, each to its target only, skips one that breaks a
 *   mandatory policy, and the header names the override that shaped a file (STA-1945 FR-4).
 * Boundary: reads the package's files and writes temporary folders; no process, no network.
 * Runtime: node
 * Governing contract: ADR 0022; ADR 0510; STA-1729; STA-1945.
 */
// @covers sta-1729:FR-11
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { sync } from "../commands/sync.mjs";
import { LOCK } from "../lib/flow-dir.mjs";
import { digestOf, readLock, treeDigest } from "../lib/lock.mjs";
import { VERSION } from "../lib/product.mjs";
import { commentStyle, headerText } from "../lib/provenance.mjs";
import { installProblems } from "../lib/render.mjs";
import { governed } from "./__fixtures__/governed.mjs";

const PKG = new URL("../..", import.meta.url).pathname;
const FLOW = join(PKG, "assets", "flow");
const VERBS = [
  "analyze",
  "checklist",
  "clarify",
  "converge",
  "implement",
  "plan",
  "specify",
  "tasks",
];
const DERIVED = "derived-from: github/spec-kit 1.0.10 (MIT)";
const LEFTOVERS = [
  ".specify",
  "SPECIFY_",
  "extensions.yml",
  "speckit",
  "scripts/bash",
  "{SCRIPT}",
  "{ARGS}",
];

test("flow assets: each preset has its manifest, its templates and the eight flow-* commands", () => {
  for (const preset of ["neutral", "stackra"]) {
    const dir = join(FLOW, "presets", preset);
    assert.match(
      readFileSync(join(dir, "preset.yml"), "utf8"),
      new RegExp(`^\\s+id: "${preset}"$`, "m"),
    );
    assert.deepEqual(readdirSync(join(dir, "templates")).toSorted(), [
      "plan-template.md",
      // The README layout is Figentra's, so only the stackra preset ships it (STA-1879).
      ...(preset === "stackra" ? ["readme-template.md"] : []),
      "spec-template.md",
      "tasks-template.md",
    ]);
    assert.deepEqual(
      readdirSync(join(dir, "commands")).toSorted(),
      VERBS.map((v) => `flow-${v}.md`),
    );
  }
});

test("flow assets: derived texts carry the attribution; nothing names spec-kit's machinery", () => {
  const derived = [
    ...["neutral", "stackra"].flatMap((p) =>
      VERBS.map((v) => join(FLOW, "presets", p, "commands", `flow-${v}.md`)),
    ),
    join(FLOW, "templates", "checklist-template.md"),
    join(FLOW, "templates", "constitution-template.md"),
  ];
  for (const file of derived) {
    const text = readFileSync(file, "utf8");
    assert.match(text, /^---\n[\s\S]*?\n---\n/, `${file} has front matter`);
    assert.ok(text.split("\n---\n")[0].includes(DERIVED), `${file} carries the attribution`);
    for (const leftover of LEFTOVERS)
      assert.ok(!text.includes(leftover), `${file} names ${leftover}`);
  }
  assert.ok(existsSync(join(PKG, "THIRD_PARTY_NOTICES.md")));
  assert.match(
    readFileSync(join(PKG, "THIRD_PARTY_NOTICES.md"), "utf8"),
    /Copyright GitHub, Inc\./,
  );
  assert.ok(
    JSON.parse(readFileSync(join(PKG, "package.json"), "utf8")).files.includes(
      "THIRD_PARTY_NOTICES.md",
    ),
  );
});

// @covers sta-1945:FR-2 sta-1945:FR-3 sta-1945:AC-2 sta-1945:P-004 sta-1945:P-006
test("writeRendered: every comment-capable file starts with its header, and the lock is v2 with each digest", (t) => {
  const root = governed(t, { config: { apps: { owner: "o" } } });
  const { files } = sync(root, { direct: true, log: () => {} });
  assert.ok(files.includes(".github/CODEOWNERS"));
  assert.ok(files.includes(".github/workflows/fflow-approve.yml"));
  const lock = /** @type {import("../lib/lock.mjs").Lock} */ (readLock(root));
  assert.deepEqual(
    { ...lock, files: undefined },
    {
      lockVersion: 2,
      flow: VERSION,
      preset: {
        name: "neutral",
        version: VERSION,
        digest: treeDigest(join(FLOW, "presets", "neutral")),
      },
      profile: "*",
      overrides: "",
      files: undefined,
      skills: {},
    },
  );
  assert.deepEqual(Object.keys(lock.files), files);
  const words = headerText({ preset: "neutral", version: VERSION });
  for (const path of files) {
    const text = readFileSync(join(root, path), "utf8");
    assert.equal(lock.files[path], digestOf(text), `${path} is locked as written`);
    const style = commentStyle(path);
    if (style === "#") assert.ok(text.startsWith(`# ${words}\n`), path);
    else if (style === "frontmatter")
      assert.ok(
        text.startsWith(`---\n# ${words}\n`) || text.startsWith(`<!-- ${words} -->\n`),
        path,
      );
    else assert.fail(`${path} has no comment style`);
  }
  assert.deepEqual(installProblems(root), []);
});

// @covers sta-1945:FR-2 sta-1945:AC-2
test("installProblems reads a v1 lock; the next sync rewrites it as v2", (t) => {
  const root = governed(t);
  sync(root, { log: () => {} });
  const v2 = /** @type {import("../lib/lock.mjs").Lock} */ (readLock(root));
  const v1 = {
    version: VERSION,
    preset: "neutral",
    files: Object.fromEntries(
      Object.entries(v2.files).map(([p, d]) => [p, d.slice("sha256:".length)]),
    ),
  };
  writeFileSync(join(root, LOCK), JSON.stringify(v1));
  assert.deepEqual(installProblems(root), []);
  writeFileSync(join(root, LOCK), JSON.stringify({ ...v1, version: "0.0.1" }));
  assert.match(
    installProblems(root).join(),
    /written by fflow 0\.0\.1, .* is installed \(run `fflow update`\)/,
  );
  sync(root, { log: () => {} });
  assert.equal(JSON.parse(readFileSync(join(root, LOCK), "utf8")).lockVersion, 2);
  assert.deepEqual(installProblems(root), []);
  const [first] = Object.keys(v1.files);
  writeFileSync(join(root, first), "hand edit\n");
  assert.match(installProblems(root).join(), /differs from what `fflow sync` rendered/);
});

// @covers sta-1945:FR-4 sta-1945:FR-3 sta-1945:AC-4 sta-1945:P-007 sta-1945:P-006
test("sync applies the overrides, each to its target only, and the header names the override that shaped a file", (t) => {
  const root = governed(t, { config: { apps: { owner: "o" } } });
  const governance = "reason: ours\nowner: o\nreview: 2027-01-31\n";
  const own = {
    "rules/worktrees.yml": "kind: extend\ntarget: .agents/rules/worktrees.md\nitems:\n  - Ours.\n",
    "agents/ci.yml": `kind: disable\ntarget: .agents/agents/ci-steward.md\n${governance}`,
    "commands/plan.yml": `kind: replace\ntarget: commands/flow-plan.md\nfile: commands/plan.md\n${governance}`,
    "commands/plan.md": "---\ndescription: Our plan.\n---\n\nOur plan.\n",
    "policies/owner.yml": 'kind: extend\ntarget: owner-only\nitems:\n  - "deploy/**"\n',
    "policies/off.yml": `kind: disable\ntarget: .github/CODEOWNERS\n${governance}`,
  };
  for (const [path, text] of Object.entries(own)) {
    mkdirSync(dirname(join(root, ".flow/overrides", path)), { recursive: true });
    writeFileSync(join(root, ".flow/overrides", path), text);
  }
  const { files } = sync(root, { log: () => {} });
  const read = (/** @type {string} */ path) => readFileSync(join(root, path), "utf8");
  const shaped = (/** @type {string} */ override) =>
    `---\n# ${headerText({ preset: "neutral", version: VERSION, override })}\n`;
  assert.ok(!files.includes(".agents/agents/ci-steward.md"), "disable drops its output");
  assert.ok(files.includes(".agents/agents/git-steward.md"), "and nothing else");
  assert.ok(
    read(".agents/rules/worktrees.md").startsWith(shaped(".flow/overrides/rules/worktrees.yml")),
  );
  assert.ok(read(".agents/rules/worktrees.md").endsWith("\n- Ours.\n"));
  const plan = read(".agents/skills/flow-plan/SKILL.md");
  assert.ok(plan.startsWith(shaped(".flow/overrides/commands/plan.yml")));
  assert.match(plan, /description: "Our plan\."[\s\S]*\nOur plan\.\n$/);
  assert.ok(
    read(".agents/skills/flow-tasks/SKILL.md").startsWith(
      `---\n# ${headerText({ preset: "neutral", version: VERSION })}\n`,
    ),
    "an output no override names keeps the plain header",
  );
  const owners = read(".github/CODEOWNERS");
  assert.ok(
    owners.startsWith(
      `# ${headerText({ preset: "neutral", version: VERSION, override: ".flow/overrides/policies/owner.yml" })}\n`,
    ),
    "a disable of a mandatory policy is not applied; the extend that tightened it is named",
  );
  assert.ok(owners.split("\n").includes("/deploy/** @o"));
  assert.match(read(".github/workflows/fflow-approve.yml"), /deploy\/\*\*/);
  const lock = /** @type {import("../lib/lock.mjs").Lock} */ (readLock(root));
  assert.equal(lock.overrides, treeDigest(join(root, ".flow/overrides")));
});
