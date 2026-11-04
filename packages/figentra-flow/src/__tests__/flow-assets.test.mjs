/**
 * Figentra Flow file contract:
 * Purpose: hold Flow's own spec assets (ADR 0510) to their shape: each preset ships `preset.yml`, the three templates
 *   and exactly the ten `flow-*` commands (STA-1945 FR-15: no `tasks`; `build`, `gate` and `review` are Flow's own);
 *   every command derived from spec-kit's and the checklist and constitution templates carry the spec-kit attribution
 *   line; no asset still names spec-kit's machinery (`.specify`, `SPECIFY_*`, `extensions.yml`, `speckit`, the bash
 *   scripts, `{SCRIPT}`); the package ships `THIRD_PARTY_NOTICES.md`; and the spec and plan templates carry the
 *   sections of STA-1945 A-3 per tier, which `/flow-specify` asks for. What `sync` writes from them starts with its
 *   provenance header, and `.flow/lock.json` v2 records each digest; a v1 lock still reads (STA-1945). `sync` applies
 *   the overrides, each to its target only, skips (and names) one that breaks a mandatory policy, and the header names
 *   the override that shaped a file (STA-1945 FR-4).
 * Boundary: reads the package's files and writes temporary folders; no process, no network.
 * Runtime: node
 * Governing contract: ADR 0022; ADR 0502; ADR 0510; STA-1729; STA-1945.
 */
// @covers sta-1729:FR-11
// @covers sta-1945:FR-24
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { checkDesign, checkSmallDesign, DESIGN_SECTIONS } from "../commands/gate.mjs";
import { sync } from "../commands/sync.mjs";
import { LOCK } from "../lib/flow-dir.mjs";
import { digestOf, readLock, treeDigest } from "../lib/lock.mjs";
import { VERSION } from "../lib/product.mjs";
import { commentStyle, headerText } from "../lib/provenance.mjs";
import { installProblems } from "../lib/render.mjs";
import { strip } from "../lib/spec-parse.mjs";
import { governed } from "./__fixtures__/governed.mjs";

const PKG = new URL("../..", import.meta.url).pathname;
const FLOW = join(PKG, "assets", "flow");
/** The commands with front matter and no spec-kit machinery; `plan` writes tasks.md, so no `tasks` (STA-1945 FR-15). */
const DERIVED_VERBS = [
  "analyze",
  "build",
  "checklist",
  "clarify",
  "converge",
  "implement",
  "plan",
  "specify",
];
/** Flow's own stage workflows (FR-15). */
const VERBS = [...DERIVED_VERBS, "gate", "review"].toSorted();
/** Commands Flow wrote itself, with no spec-kit text (STA-1945 FR-24). */
const OWN = ["build"];
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

test("flow assets: each preset has its manifest, its templates and the ten flow-* commands", () => {
  for (const preset of ["neutral", "stackra"]) {
    const dir = join(FLOW, "presets", preset);
    assert.match(
      readFileSync(join(dir, "preset.yml"), "utf8"),
      new RegExp(`^\\s+id: "${preset}"$`, "m"),
    );
    assert.deepEqual(readdirSync(join(dir, "templates")).toSorted(), [
      "plan-template.md",
      // Each preset ships a README layout (STA-1879): stackra's is Figentra's, neutral's names no brand.
      "readme-template.md",
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
      DERIVED_VERBS.map((v) => join(FLOW, "presets", p, "commands", `flow-${v}.md`)),
    ),
    join(FLOW, "templates", "checklist-template.md"),
    join(FLOW, "templates", "constitution-template.md"),
  ];
  for (const file of derived) {
    const text = readFileSync(file, "utf8");
    assert.match(text, /^---\n[\s\S]*?\n---\n/, `${file} has front matter`);
    if (!OWN.some((v) => file.endsWith(`flow-${v}.md`)))
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
      profile: "default",
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
    // Strict JSON carries no header; the lock's digest identifies it (FR-3).
    else if (path.endsWith(".json")) JSON.parse(text);
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
  /** @type {string[]} */
  const logged = [];
  const { files } = sync(root, { log: (l) => logged.push(l) });
  assert.match(
    logged.join("\n"),
    /^fflow sync: skipped \.flow\/overrides\/policies\/off\.yml: disable \.github\/CODEOWNERS is refused: the mandatory policy owner-only cannot be disabled/m,
    "sync names the override it skips",
  );
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
    read(".agents/skills/flow-specify/SKILL.md").startsWith(
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

// STA-1945 A-3: the spec and plan templates carry the sections FR-26 and FR-27 name, per tier; worked examples sit in
// comments, which the gate strips.
// @covers sta-1945:FR-26 sta-1945:FR-27 sta-1945:P-031 sta-1945:AC-43
const template = (/** @type {string} */ preset, /** @type {string} */ name) =>
  readFileSync(join(FLOW, "presets", preset, "templates", `${name}-template.md`), "utf8");
/** The offsets of DESIGN_SECTIONS as `level` headings in `body`, which must rise. */
const designOrder = (/** @type {string} */ body, /** @type {string} */ level) =>
  DESIGN_SECTIONS.map((name) => body.search(new RegExp(`^${level} ${name}\\b`, "m")));

test("templates: a spec states Discovery and Sources before its requirements, NFRs, measurable success and a small tier's design", () => {
  for (const preset of ["neutral", "stackra"]) {
    const raw = template(preset, "spec");
    const body = strip(raw);
    const at = (/** @type {string} */ heading) => body.search(new RegExp(`^${heading}\\b`, "m"));
    assert.ok(at("## Discovery") > 0 && at("## Discovery") < at("## Requirements"), preset);
    for (const field of [
      "Current behaviour",
      "Topology",
      "Dependencies",
      "Ownership",
      "Constraints already decided",
    ])
      assert.match(body, new RegExp(`^- \\*\\*${field}\\*\\*: \\S`, "m"), `${preset}: ${field}`);
    assert.match(body, /^### Sources\n\s*- \*\*SRC-001\*\*: \S/m, `${preset}: Sources`);
    assert.ok(
      at("## Discovery") < at("### Sources") && at("### Sources") < at("## Requirements"),
      `${preset}: Sources sit between Discovery and Requirements`,
    );
    assert.match(
      body,
      /^- \*\*FR-001\*\*: WHEN .* SHALL .* Sources: SRC-001$/m,
      `${preset}: FR cites`,
    );
    assert.match(
      body,
      /^### Non-functional Requirements\n\s*- \*\*NFR-001\*\*: THE .* SHALL /m,
      `${preset}: NFR`,
    );
    assert.match(body, /^- \*\*SC-001\*\*: \[measurable outcome: a number, a threshold/m);
    for (const example of ['"fast" →', "**SRC-002**:", "SHALL finish within", "Not measurable:"]) {
      assert.ok(raw.includes(example), `${preset}: worked example ${example}`);
      assert.ok(!body.includes(example), `${preset}: ${example} sits in a comment`);
    }
    // Small tier: the one-page design in spec.md, with its folder tree and interfaces.
    const design = body.match(/^## Design\b[^\n]*\n([\s\S]*?)(?=^## )/m)?.[1] ?? "";
    assert.deepEqual(checkDesign(design, "spec.md ## Design", "###"), [], preset);
    assert.deepEqual(checkSmallDesign(design), [], `${preset}: the gate's tree and interfaces`);
    const order = designOrder(design, "###");
    assert.deepEqual(
      order,
      order.toSorted((a, b) => a - b),
      `${preset}: design order`,
    );
    assert.match(design, /^### Files and folders\n\s*```text\n/m, `${preset}: folder tree`);
    assert.match(
      design,
      /^### Contracts\n\s*```\w+\n[^`]*export function/m,
      `${preset}: interfaces`,
    );
  }
});

test("templates: a feature or big plan has the trade-off, standards, diagrams, full components, failure ordering and open questions", () => {
  for (const preset of ["neutral", "stackra"]) {
    const raw = template(preset, "plan");
    const body = strip(raw);
    assert.deepEqual(checkDesign(raw, "plan.md", "##"), [], preset);
    const order = designOrder(body, "##");
    assert.deepEqual(
      order,
      order.toSorted((a, b) => a - b),
      `${preset}: design order`,
    );
    for (const heading of [
      "Key trade-off and research",
      "Applicable standards",
      "Partial-failure ordering",
      "Open questions",
    ])
      assert.match(body, new RegExp(`^## ${heading}\\n`, "m"), `${preset}: ${heading}`);
    assert.match(body, /^- \*\*Trade-off\*\*: \S/m);
    assert.match(body, /^- \*\*Research\*\*: \S/m);
    assert.match(body, /^\| Rule +\| How it is enforced +\|$/m, `${preset}: standards table`);
    const architecture = body.match(/^## Architecture overview\n([\s\S]*?)(?=^## )/m)?.[1] ?? "";
    assert.match(architecture, /```mermaid\nflowchart/, `${preset}: architecture diagram`);
    assert.match(architecture, /```mermaid\nsequenceDiagram/, `${preset}: sequence diagram`);
    const component = body.match(/^### C1 [^\n]*\n([\s\S]*?)(?=^#{2,3} )/m)?.[1] ?? "";
    for (const part of [
      /\*\*Responsibility\*\*: \S/,
      /\*\*Location\*\*: \S/,
      /```text\n[^`]*\(new\)/,
      /```\w+\n[^`]*export function/,
      /\*\*Behaviour\*\*: \S/,
      /\*\*Failure modes\*\*: \S/,
    ])
      assert.match(component, part, `${preset}: component ${part}`);
    // The worked examples, the example component among them, stay in comments: C1 is the only real component.
    assert.ok(raw.includes("Worked example"), `${preset}: worked examples`);
    assert.ok(!body.includes("Worked example"), `${preset}: worked examples sit in comments`);
    assert.deepEqual(
      body.match(/^### C\d+ /gm),
      ["### C1 "],
      `${preset}: one component outside comments`,
    );
  }
});

test("/flow-specify asks for Discovery and Sources", () => {
  for (const preset of ["neutral", "stackra"]) {
    const text = readFileSync(join(FLOW, "presets", preset, "commands", "flow-specify.md"), "utf8");
    for (const s of ["`## Discovery`", "`### Sources`", "Sources: SRC-###", "NFR-###"])
      assert.ok(text.includes(s), `${preset}: ${s}`);
  }
});
