/**
 * Figentra Flow file contract:
 * Purpose: hold `figentra-flow init` to its contract: the bundled `.specify/` lands whole, the constitution starts from the
 *   template, and an existing `.specify/` is kept unless forced.
 * Boundary: writes only temp directories; node:test and node:assert.
 * Runtime: node
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { init } from "../commands/init.mjs";
import { ASSETS } from "../commands/sync.mjs";

test("init installs .specify/ with the preset, a template constitution and runnable scripts", () => {
  const root = mkdtempSync(join(tmpdir(), "flow-init-"));
  try {
    assert.equal(init(root), true);
    for (const p of [
      "presets/stackra/preset.yml",
      "init-options.json",
      "scripts/bash/setup-plan.sh",
    ])
      assert.equal(
        readFileSync(join(root, ".specify", p), "utf8"),
        readFileSync(join(ASSETS, "specify", p), "utf8"),
        p,
      );
    assert.equal(
      readFileSync(join(root, ".specify/memory/constitution.md"), "utf8"),
      readFileSync(join(ASSETS, "specify/templates/constitution-template.md"), "utf8"),
    );
    assert.ok(statSync(join(root, ".specify/scripts/bash/setup-plan.sh")).mode & 0o100);
    writeFileSync(join(root, ".specify/memory/constitution.md"), "ours\n");
    assert.equal(init(root), false);
    assert.equal(init(root, { force: true }), true);
    assert.equal(readFileSync(join(root, ".specify/memory/constitution.md"), "utf8"), "ours\n");
  } finally {
    rmSync(root, { recursive: true });
  }
});
