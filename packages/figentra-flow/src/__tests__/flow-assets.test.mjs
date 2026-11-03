/**
 * Figentra Flow file contract:
 * Purpose: hold Flow's own spec assets (ADR 0510) to their shape: each preset ships `preset.yml`, the three templates
 *   and exactly the eight `flow-*` commands; every command and the checklist and constitution templates carry the
 *   spec-kit attribution line; no asset still names spec-kit's machinery (`.specify`, `SPECIFY_*`, `extensions.yml`,
 *   `speckit`, the bash scripts, `{SCRIPT}`); the package ships `THIRD_PARTY_NOTICES.md`; and the spec and plan
 *   templates carry the sections of STA-1945 A-3 per tier, which `/flow-specify` asks for.
 * Boundary: reads the package's files; no process, no network.
 * Runtime: node
 * Governing contract: ADR 0022; ADR 0502; ADR 0510; STA-1729; STA-1945.
 */
// @covers sta-1729:FR-11
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkDesign, checkSmallDesign, DESIGN_SECTIONS } from "../commands/gate.mjs";
import { strip } from "../lib/spec-parse.mjs";

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
