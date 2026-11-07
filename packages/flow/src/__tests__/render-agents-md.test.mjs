/**
 * Figentra Flow file contract:
 * Purpose: hold AGENTS.md and CLAUDE.md to STA-1945 FR-7: the stackra preset's shared blocks filled with the
 *   repository's facts (`.flow/readme.yml`, the configuration's preset, spec folder, tracker and `agentsMd.facts`);
 *   a fact the repository lacks drops its block; `agentsMd.land` replaces the landing line (STA-2131); CLAUDE.md imports AGENTS.md; the neutral preset's blocks name no
 *   brand; a preset without the surface renders nothing; the rules are an index of paths and descriptions, never
 *   their text, so the stackra preset's file stays under 20 KB.
 * Boundary: temporary folders; no process, no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945.
 */
// @covers sta-1945:FR-7 sta-1945:AC-7 sta-1945:P-010
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { ConfigError } from "../lib/config.mjs";
import { FLOW_ASSETS } from "../lib/flow-dir.mjs";
import { renderAgentsMd, ruleIndex } from "../lib/render-agents-md.mjs";

const STACKRA = join(FLOW_ASSETS, "presets/stackra");
const NEUTRAL = join(FLOW_ASSETS, "presets/neutral");

const temp = (/** @type {{ after: (fn: () => void) => void }} */ t) => {
  const root = mkdtempSync(join(tmpdir(), "flow-agents-md-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
};

test("renderAgentsMd: the shared blocks with the repository's facts, and CLAUDE.md importing AGENTS.md", (t) => {
  const root = temp(t);
  mkdirSync(join(root, ".flow"));
  writeFileSync(
    join(root, ".flow/readme.yml"),
    "name: Example\ntagline: An example product.\nwhat: It does one thing.\narchitecture: |\n  One package.\n",
  );
  const config = {
    preset: "stackra",
    specs: { dir: "docs/specs" },
    tracker: { kind: "linear", team: "STA", branchPrefix: "figentra" },
    agentsMd: { facts: "- `pnpm verify` is the full check.\n- Tests run on the box." },
  };
  const out = renderAgentsMd({ root, config, presetDir: STACKRA });
  assert.deepEqual([...out.keys()], ["AGENTS.md", "CLAUDE.md"]);
  assert.equal(out.get("CLAUDE.md"), "@AGENTS.md\n");
  const text = out.get("AGENTS.md") ?? "";
  assert.match(
    text,
    /^# Example\n\nAn example product\.\n\n## What it is\n\nIt does one thing\.\n\n## Architecture\n\nOne package\.\n\n## This repository\n\n- `pnpm verify` is the full check\.\n- Tests run on the box\.\n\n## How work flows\n/,
  );
  assert.match(text, /the stackra preset\)\. Specs live in `docs\/specs\/`\./);
  assert.match(text, /a linear key \(`STA-<n>`\); branches are\n {2}`figentra\/<key>-<slug>`\./);
  assert.match(text, /fflow sync/);
  assert.doesNotMatch(text, /\{\{|\}\}|\n{3}/);
  assert.ok(text.endsWith(".\n"));
});

test("renderAgentsMd: without readme data, tracker or facts, their blocks go and the folder names the repository", (t) => {
  const root = temp(t);
  const text = renderAgentsMd({ root, config: {}, presetDir: STACKRA }).get("AGENTS.md") ?? "";
  assert.match(text, new RegExp(`^# ${basename(root)}\n\n## How work flows\n`));
  // The preset named is the one rendered, whatever the configuration omits.
  assert.match(text, /the stackra preset\)\. Specs live in `\.agents\/specs\/`\./);
  assert.doesNotMatch(text, /## What it is|## Architecture|## This repository|branches are/);
});

test("renderAgentsMd (STA-2131): agentsMd.land replaces the landing line; without it, fflow land", (t) => {
  const root = temp(t);
  const land =
    "Merge right away with the admin merge and label the issue `needs-testing` (STA-2083).";
  for (const presetDir of [STACKRA, NEUTRAL]) {
    const text =
      renderAgentsMd({ root, config: { agentsMd: { land } }, presetDir }).get("AGENTS.md") ?? "";
    assert.ok(text.includes(`never next to the repository.\n- ${land}\n\n## Rules`), presetDir);
    assert.doesNotMatch(text, /Land with `fflow land <pr>`/);
    assert.match(
      renderAgentsMd({ root, config: {}, presetDir }).get("AGENTS.md") ?? "",
      /\n- Land with `fflow land <pr>`: it waits for the gate/,
    );
  }
  assert.throws(
    () => renderAgentsMd({ root, config: { agentsMd: { land: 1 } }, presetDir: STACKRA }),
    (error) =>
      error instanceof ConfigError &&
      error.message === "flow.config.json: agentsMd.land must be one Markdown string",
  );
});

test("renderAgentsMd: agentsMd.facts that is not one string is a ConfigError", (t) => {
  assert.throws(
    () =>
      renderAgentsMd({
        root: temp(t),
        config: { agentsMd: { facts: ["a fact", "b fact"] } },
        presetDir: STACKRA,
      }),
    (error) =>
      error instanceof ConfigError &&
      error.message === "flow.config.json: agentsMd.facts must be one Markdown string",
  );
});

test("renderAgentsMd: the neutral preset's blocks name no brand and no third-party tool", (t) => {
  const root = temp(t);
  const config = { tracker: { kind: "github-issues", branchPrefix: "work" } };
  const out = renderAgentsMd({ root, config, presetDir: NEUTRAL });
  assert.deepEqual([...out.keys()], ["AGENTS.md", "CLAUDE.md"]);
  const text = out.get("AGENTS.md") ?? "";
  assert.match(text, new RegExp(`^# ${basename(root)}\n\n## How work flows\n`));
  assert.match(text, /the neutral preset\)\. Specs live in `\.agents\/specs\/`\./);
  assert.match(text, /a github-issues key; branches are\n {2}`work\/<key>-<slug>`\./);
  assert.match(text, /^## Rules$/m);
  assert.doesNotMatch(text, /figentra|stackra|STA-|linear|mise|\{\{|\}\}|\n{3}/i);
});

test("renderAgentsMd: a preset without surfaces/agents-md renders nothing", (t) => {
  assert.equal(renderAgentsMd({ root: temp(t), config: {}, presetDir: temp(t) }).size, 0);
});

test("ruleIndex: each rule's path, description and when it applies, the repository's own files too, sorted", (t) => {
  const root = temp(t);
  mkdirSync(join(root, ".agents/rules"), { recursive: true });
  writeFileSync(join(root, ".agents/rules/README.md"), "# Rules\n");
  writeFileSync(
    join(root, ".agents/rules/local.md"),
    '---\ntitle: Local\ndescription: The repository\'s own rule\napplies_to: ["services/**", "apps/**"]\n---\n\nBody.\n',
  );
  writeFileSync(join(root, ".agents/rules/bare.md"), "No front matter.\n");
  const rendered = new Map([
    [
      ".agents/rules/always.md",
      "---\n# Generated by fflow\ntitle: Always\nalways: true\ndescription: Read every time\n---\n\nLong body.\n",
    ],
  ]);
  assert.deepEqual(ruleIndex(root, ".agents/rules", rendered), [
    { path: ".agents/rules/always.md", description: "Read every time", when: "always" },
    { path: ".agents/rules/bare.md", description: "bare" },
    {
      path: ".agents/rules/local.md",
      description: "The repository's own rule",
      when: "for `services/**`, `apps/**`",
    },
  ]);
});

test("renderAgentsMd: the stackra preset's rules as an index under 20 KB, never their text", (t) => {
  const root = temp(t);
  const dir = join(STACKRA, "rules");
  const rendered = new Map(
    readdirSync(dir).map((file) => [
      `.agents/rules/${file}`,
      readFileSync(join(dir, file), "utf8"),
    ]),
  );
  const rules = ruleIndex(root, ".agents/rules", rendered);
  const text =
    renderAgentsMd({ root, config: {}, presetDir: STACKRA, rules }).get("AGENTS.md") ?? "";
  assert.match(text, /\n## Rules index\n\nEach rule is one file\./);
  assert.match(
    text,
    /\n- `\.agents\/rules\/worktrees\.md`: One worktree per active task[^\n]*\(always\)\n/,
  );
  assert.match(
    text,
    /\n- `\.agents\/rules\/service-checklist\.md`: [^\n]*\(for `services\/\*\*`\)\n/,
  );
  assert.equal(text.match(/^- `\.agents\/rules\//gm)?.length, rendered.size);
  assert.doesNotMatch(text, /\{\{|\}\}|\n{3}/);
  assert.ok(Buffer.byteLength(text) < 20 * 1024, `${Buffer.byteLength(text)} bytes`);
});

test("renderAgentsMd: no rules, no index", (t) => {
  const text =
    renderAgentsMd({ root: temp(t), config: {}, presetDir: STACKRA }).get("AGENTS.md") ?? "";
  assert.doesNotMatch(text, /Rules index/);
});
