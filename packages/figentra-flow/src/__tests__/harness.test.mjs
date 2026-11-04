/**
 * Figentra Flow file contract:
 * Purpose: hold the harness port to STA-2098 H1: a capability block's marker lines are the only thing the fallback
 *   fill drops, an unknown capability is left as written, both presets mark the question step of `flow-clarify` and
 *   `flow-specify` with one `ask` block each, and a repository with no harness configured renders, with or without
 *   `direct`, byte for byte the command texts it rendered before the blocks (the files at the same paths).
 * Boundary: reads the package's presets and renders temporary repositories; no process, no network.
 * Runtime: node
 * Governing contract: STA-2098 (PLAN section 10, H1).
 */
// @covers sta-2098:H1
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { fallbackFill, fillCapabilities } from "../adapters/harness/index.mjs";
import { FLOW_ASSETS } from "../lib/flow-dir.mjs";
import { render } from "../lib/render.mjs";
import { governed } from "./__fixtures__/governed.mjs";

/** A command's text as it was before the blocks: the marker lines removed, nothing else. */
const unmarked = (/** @type {string} */ text) =>
  text.replace(/^[ \t]*<!-- \/?flow:(?:ask|todo|docs|subagent) -->\n/gm, "");
/** A command document's body, as `render` reads it. */
const bodyOf = (/** @type {string} */ text) =>
  text.replace(/^---\n[\s\S]*?\n---\n/, "").replace(/^\n+/, "");
const commands = (/** @type {string} */ preset) => join(FLOW_ASSETS, "presets", preset, "commands");

test("harness: the fallback fill drops only the marker lines; an unknown capability stays as written", () => {
  const text =
    "a\n  <!-- flow:ask -->\n  | A | x |\n  <!-- /flow:ask -->\nb\n<!-- flow:other -->\nc\n";
  assert.equal(fillCapabilities(text, fallbackFill), "a\n  | A | x |\nb\n<!-- flow:other -->\nc\n");
  assert.equal(
    fillCapabilities(
      "<!-- flow:todo -->\nx\n<!-- /flow:todo -->\n",
      (cap, inner) => `${cap}:${inner}`,
    ),
    "todo:x\n",
  );
  // A block closed by another capability's marker is not a block.
  const crossed = "<!-- flow:ask -->\nx\n<!-- /flow:todo -->\n";
  assert.equal(fillCapabilities(crossed, fallbackFill), crossed);
});

test("harness: both presets mark one ask block in flow-clarify and flow-specify, and no other command", () => {
  for (const preset of ["neutral", "stackra"])
    for (const file of readdirSync(commands(preset))) {
      const text = readFileSync(join(commands(preset), file), "utf8");
      const asks = text.match(/^[ \t]*<!-- flow:ask -->$/gm)?.length ?? 0;
      const marked = ["flow-clarify.md", "flow-specify.md"].includes(file);
      assert.equal(asks, marked ? 1 : 0, `${preset}/${file}`);
      assert.equal(text.match(/^[ \t]*<!-- \/flow:ask -->$/gm)?.length ?? 0, asks);
      if (marked)
        assert.match(text, /<!-- flow:ask -->\n[\s\S]*\| Option \|[\s\S]*<!-- \/flow:ask -->/);
    }
});

test("harness: with no harness configured, sync renders today's texts at today's paths, byte for byte", (t) => {
  for (const preset of ["neutral", "stackra"]) {
    const root = governed(t, { config: { preset } });
    for (const direct of [false, true]) {
      const files = render(root, { direct });
      for (const file of readdirSync(commands(preset))) {
        const name = file.slice(0, -3);
        const body = unmarked(bodyOf(readFileSync(join(commands(preset), file), "utf8")));
        const paths = direct
          ? [`.claude/skills/${name}/SKILL.md`, `.opencode/commands/${name}.md`]
          : [`.agents/skills/${name}/SKILL.md`];
        for (const path of paths) {
          const text = files.get(path);
          assert.ok(text, `${preset} ${path}`);
          assert.ok(text.endsWith(`\n\n${body}`), `${preset} ${path} is today's text`);
        }
      }
      const commandPaths = [...files.keys()].filter((p) => /\/flow-[a-z]+(\/SKILL)?\.md$/.test(p));
      assert.equal(commandPaths.length, readdirSync(commands(preset)).length * (direct ? 2 : 1));
      for (const [path, text] of files) assert.doesNotMatch(text, /<!-- \/?flow:/, path);
    }
  }
});
