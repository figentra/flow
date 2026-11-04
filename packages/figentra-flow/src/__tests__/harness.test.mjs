/**
 * Figentra Flow file contract:
 * Purpose: hold the harness port to STA-2098 H1 and H2: a capability block's marker lines are the only thing the fallback
 *   fill drops, an unknown capability is left as written, both presets mark the question step of `flow-clarify` and
 *   `flow-specify` with one `ask` block each, and a repository with no harness configured renders, with or without
 *   `direct`, byte for byte the command texts it rendered before the blocks (the files at the same paths). A configured Claude
 *   Code or OpenCode asks through its own question tool, the text table kept as the fallback; `harnesses` is a
 *   non-empty list of known tools, and a lock holding another harness's commands reads as a direct sync.
 * Boundary: reads the package's presets and renders temporary repositories; no process, no network.
 * Runtime: node
 * Governing contract: STA-2098 (PLAN section 10, H1, H2).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CLAUDE_CODE_ASK,
  fallbackFill,
  fillCapabilities,
  HARNESS_IDS,
  OPENCODE_ASK,
} from "../adapters/harness/index.mjs";
import { SCHEMA, validate } from "../lib/config.mjs";
import { FLOW_ASSETS } from "../lib/flow-dir.mjs";
import { render, syncedDirect } from "../lib/render.mjs";
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

test("harness: Claude Code asks with AskUserQuestion, the text table kept as its fallback (H2)", (t) => {
  const root = governed(t, { config: { harnesses: ["claude-code"] } });
  const files = render(root, { direct: true });
  const clarify = String(files.get(".claude/skills/flow-clarify/SKILL.md"));
  assert.ok(
    clarify.includes(`    ${CLAUDE_CODE_ASK}\n    - Present EXACTLY ONE question at a time.`),
  );
  assert.match(CLAUDE_CODE_ASK, /1 to 4 questions per call.*2 to 4 options.*\(Recommended\)/s);
  assert.match(
    clarify,
    /\| Option \| Description \|/,
    "the text table stays, for when the tool is unavailable",
  );
  const specify = String(files.get(".claude/skills/flow-specify/SKILL.md"));
  assert.ok(
    specify.includes(`        ${CLAUDE_CODE_ASK}\n        3. For each clarification needed`),
  );
  // A command with no block is today's text; only the configured harness is rendered.
  const plan = unmarked(bodyOf(readFileSync(join(commands("neutral"), "flow-plan.md"), "utf8")));
  assert.ok(String(files.get(".claude/skills/flow-plan/SKILL.md")).endsWith(`\n\n${plan}`));
  assert.equal([...files.keys()].filter((p) => p.startsWith(".opencode/")).length, 0);
  for (const [path, text] of files) assert.doesNotMatch(text, /<!-- \/?flow:/, path);
});

test("harness: OpenCode asks with its question tool; without --direct, harnesses change nothing (H2)", (t) => {
  const root = governed(t, { config: { harnesses: ["opencode", "claude-code"] } });
  const files = render(root, { direct: true });
  const clarify = String(files.get(".opencode/commands/flow-clarify.md"));
  assert.ok(clarify.startsWith('---\ndescription: "Resolve open questions'));
  assert.ok(clarify.includes(`    ${OPENCODE_ASK}\n    - Present EXACTLY ONE question at a time.`));
  assert.match(OPENCODE_ASK, /the `question` tool/);
  assert.ok(String(files.get(".claude/skills/flow-clarify/SKILL.md")).includes(CLAUDE_CODE_ASK));
  const neutral = render(root, { direct: false });
  assert.deepEqual(neutral, render(governed(t), { direct: false }));
});

test("harness: harnesses must be a non-empty list of known tools", () => {
  const base = { version: 1 };
  assert.deepEqual(validate(SCHEMA, { ...base, harnesses: ["claude-code", "opencode"] }), []);
  assert.match(
    validate(SCHEMA, { ...base, harnesses: ["vim"] }).join(),
    /harnesses\[0\]: must be one of claude-code, opencode/,
  );
  assert.match(
    validate(SCHEMA, { ...base, harnesses: [] }).join(),
    /harnesses: must have at least 1/,
  );
  assert.match(
    validate(SCHEMA, { ...base, harnesses: "claude-code" }).join(),
    /harnesses: must be a array/,
  );
  assert.deepEqual([...SCHEMA.properties.harnesses.items.enum], [...HARNESS_IDS]);
});

test("harness: a lock with only another harness's commands still reads as a direct sync", () => {
  const lock = (/** @type {string[]} */ paths) =>
    /** @type {any} */ ({ files: Object.fromEntries(paths.map((p) => [p, "d"])) });
  assert.equal(syncedDirect(lock([".opencode/commands/flow-clarify.md"])), true);
  assert.equal(syncedDirect(lock([".agents/skills/flow-clarify/SKILL.md"])), false);
  assert.equal(syncedDirect(lock([".opencode/commands/other.md"])), false);
});
