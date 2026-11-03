/**
 * Figentra Flow file contract:
 * Purpose: hold AGENTS.md and CLAUDE.md to STA-1945 FR-7: the stackra preset's shared blocks filled with the
 *   repository's facts (`.flow/readme.yml`, the configuration's preset, spec folder, tracker and `agentsMd.facts`);
 *   a fact the repository lacks drops its block; CLAUDE.md imports AGENTS.md; a preset without the surface renders
 *   nothing.
 * Boundary: temporary folders; no process, no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945.
 */
// @covers sta-1945:FR-7 sta-1945:AC-7 sta-1945:P-010
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { FLOW_ASSETS } from "../lib/flow-dir.mjs";
import { renderAgentsMd } from "../lib/render-agents-md.mjs";

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
  assert.match(text, /the neutral preset\)\. Specs live in `\.agents\/specs\/`\./);
  assert.doesNotMatch(text, /## What it is|## Architecture|## This repository|branches are/);
});

test("renderAgentsMd: a preset without surfaces/agents-md renders nothing", (t) => {
  assert.equal(renderAgentsMd({ root: temp(t), config: {}, presetDir: NEUTRAL }).size, 0);
});
