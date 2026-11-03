/**
 * Figentra Flow file contract:
 * Purpose: hold the README render to STA-1879: `fill` handles variables, sections and inverted sections; the data
 *   file is checked (required, unknown and status); the licence comes from `LICENSE`; the stackra preset renders the
 *   layout with its badges and footer; the neutral preset refuses; `sync` renders `README.md` and locks it.
 * Boundary: writes only temp directories; node:test and node:assert.
 * Runtime: node
 * Governing contract: STA-1879.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sync } from "../commands/sync.mjs";
import { ConfigError } from "../lib/config.mjs";
import { detectLicence, fill, readmeProblems, renderReadme } from "../lib/readme.mjs";

const DATA = `name: Example
repo: figentra/example
tagline: An example product.
status: Planned
what: It does one thing.
quickstart: |
  Run it.
architecture: |
  One package.
`;

/** A temp repository with the given config preset and README data. */
function repo(preset, data = DATA) {
  const root = mkdtempSync(join(tmpdir(), "flow-readme-"));
  writeFileSync(join(root, "flow.config.json"), JSON.stringify({ version: 1, preset }));
  mkdirSync(join(root, ".flow"));
  writeFileSync(join(root, ".flow/readme.yml"), data);
  return root;
}

test("fill: variables, sections over arrays, objects and scalars, and inverted sections", () => {
  assert.equal(fill("{{a}}-{{missing}}", { a: "x" }), "x-");
  assert.equal(fill("{{#xs}}[{{v}}]{{/xs}}", { xs: [{ v: 1 }, { v: 2 }] }), "[1][2]");
  assert.equal(fill("{{#o}}{{k}}{{/o}}", { o: { k: "in" } }), "in");
  assert.equal(fill("{{#s}}yes {{s}}{{/s}}{{^s}}no{{/s}}", { s: "v" }), "yes v");
  assert.equal(fill("{{#s}}yes{{/s}}{{^s}}no{{/s}}", { s: "" }), "no");
  assert.equal(fill("{{^xs}}none{{/xs}}", { xs: [] }), "none");
  assert.equal(fill("{{#t}}\nline\n{{/t}}\nafter", { t: true }), "line\nafter");
  // An inline section keeps the line break after it, filled or empty.
  assert.equal(fill("**S**{{#n}}: {{n}}{{/n}}\n\nnext", {}), "**S**\n\nnext");
  assert.equal(fill("**S**{{#n}}: {{n}}{{/n}}\n\nnext", { n: "x" }), "**S**: x\n\nnext");
});

test("readmeProblems: required keys, unknown keys, the status values and the banner shape", () => {
  assert.deepEqual(
    readmeProblems({
      name: "n",
      repo: "r",
      tagline: "t",
      status: "Live",
      what: "w",
      quickstart: "q",
      architecture: "a",
    }),
    [],
  );
  const problems = readmeProblems({
    name: "n",
    status: "Done",
    statusNote: "x".repeat(81),
    extra: 1,
    banner: { light: "l" },
  });
  assert.ok(problems.some((p) => p.includes('"repo" is required')));
  assert.ok(problems.some((p) => p.includes('"extra" is not a README field')));
  assert.ok(problems.some((p) => p.includes('"status" is one of')));
  assert.ok(problems.some((p) => p.includes('"banner"')));
  assert.ok(problems.some((p) => p.includes('"statusNote" is one short line')));
});

test("detectLicence: MIT from the MIT text, Proprietary otherwise or without a LICENSE", () => {
  const root = mkdtempSync(join(tmpdir(), "flow-licence-"));
  try {
    assert.deepEqual(detectLicence(root), { licence: "Proprietary", file: false });
    writeFileSync(join(root, "LICENSE"), "MIT License\n\nCopyright (c) 2026\n");
    assert.deepEqual(detectLicence(root), { licence: "MIT", file: true });
    writeFileSync(join(root, "LICENSE"), "Copyright (c) 2026 Figentra Technologies L.L.C\n");
    assert.deepEqual(detectLicence(root), { licence: "Proprietary", file: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("renderReadme: the stackra layout with its sections, badges and footer; nothing without data", () => {
  const root = repo("stackra");
  try {
    const text = renderReadme(root) ?? "";
    for (const heading of [
      "## What it is",
      "## Status",
      "## Quick start",
      "## Architecture at a glance",
      "## Development",
      "## Docs and playground",
      "## Release and changelog",
      "## Security",
      "## Licence",
    ])
      assert.ok(text.includes(`\n${heading}\n`), heading);
    assert.match(text, /<h1 align="center">Example<\/h1>/);
    assert.match(text, /actions\/workflows\/ci\.yml\/badge\.svg/);
    assert.match(text, /badge\/status-Planned-lightgrey/);
    assert.match(text, /Proprietary\. Copyright © Figentra Technologies L\.L\.C/);
    assert.match(text, /There is no docs site or playground yet/);
    assert.doesNotMatch(text, /<picture>/, "no banner without one");
    assert.doesNotMatch(text, /\{\{|\n{3}/);
    rmSync(join(root, ".flow/readme.yml"));
    assert.equal(renderReadme(root), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("renderReadme: an invalid data file and a preset without the template are ConfigErrors", () => {
  const bad = repo("stackra", "name: Example\n");
  const neutral = repo("neutral");
  try {
    assert.throws(() => renderReadme(bad), ConfigError);
    assert.throws(() => renderReadme(neutral), /has no readme-template/);
  } finally {
    rmSync(bad, { recursive: true, force: true });
    rmSync(neutral, { recursive: true, force: true });
  }
});

test("sync renders README.md and records it in .flow/lock.json", () => {
  const root = repo("stackra");
  try {
    sync(root, { direct: true, log: () => {} });
    const written = readFileSync(join(root, "README.md"), "utf8");
    assert.match(written, /^<!-- Generated by fflow from the stackra preset /);
    assert.ok(written.endsWith(`-->\n${renderReadme(root)}`));
    const lock = JSON.parse(readFileSync(join(root, ".flow/lock.json"), "utf8"));
    assert.ok(lock.files["README.md"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
