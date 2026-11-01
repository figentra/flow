/**
 * Figentra Flow file contract:
 * Purpose: hold Flow's own spec assets (ADR 0510) to their shape: each preset ships `preset.yml`, the three templates
 *   and exactly the eight `flow-*` commands; every command and the checklist and constitution templates carry the
 *   spec-kit attribution line; no asset still names spec-kit's machinery (`.specify`, `SPECIFY_*`, `extensions.yml`,
 *   `speckit`, the bash scripts, `{SCRIPT}`); and the package ships `THIRD_PARTY_NOTICES.md`.
 * Boundary: reads the package's files; no process, no network.
 * Runtime: node
 * Governing contract: ADR 0022; ADR 0510; STA-1729.
 */
// @covers sta-1729:FR-11
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
