/**
 * Figentra Flow file contract:
 * Purpose: hold `.mcp.yaml` to STA-1945 FR-7: the stackra preset's servers plus the configuration's, a configured
 *   server replacing the preset's of the same name; an `env` value that is not a `$NAME` reference is refused; the
 *   neutral preset lists only `fflow mcp`; a preset without the surface renders nothing.
 * Boundary: pure functions over the bundled presets; no process, no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945.
 */
// @covers sta-1945:FR-7 sta-1945:AC-7 sta-1945:P-010
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ConfigError } from "../lib/config.mjs";
import { FLOW_ASSETS } from "../lib/flow-dir.mjs";
import { MCP_FILE, renderMcp } from "../lib/render-mcp.mjs";
import { parseYaml } from "../lib/yaml.mjs";

const STACKRA = join(FLOW_ASSETS, "presets/stackra");
const NEUTRAL = join(FLOW_ASSETS, "presets/neutral");
const ctx = (/** @type {Record<string, any>} */ config, presetDir = STACKRA) => ({
  root: "/repo",
  config,
  presetDir,
});

test("renderMcp: the preset's servers plus the config's; a configured server replaces the preset's", () => {
  const out = renderMcp(
    ctx({
      mcp: {
        context7: {
          command: "./tools/scripts/mcp.sh",
          args: ["npx", "-y", "@upstash/context7-mcp@latest"],
          env: { CONTEXT7_API_KEY: "$CONTEXT7_API_KEY", OTHER: "${OTHER_KEY}" },
        },
        linear: { type: "http", url: "https://example.test/mcp" },
      },
    }),
  );
  assert.deepEqual([...out.keys()], [MCP_FILE]);
  const { mcpServers } = parseYaml(out.get(MCP_FILE) ?? "");
  assert.deepEqual(mcpServers.playwright, {
    command: "npx",
    args: ["-y", "@playwright/mcp@latest"],
  });
  assert.equal(mcpServers.posthog.url, "https://mcp.posthog.com/mcp?readonly=true");
  assert.deepEqual(mcpServers.context7, {
    command: "./tools/scripts/mcp.sh",
    args: ["npx", "-y", "@upstash/context7-mcp@latest"],
    env: { CONTEXT7_API_KEY: "$CONTEXT7_API_KEY", OTHER: "${OTHER_KEY}" },
  });
  assert.deepEqual(mcpServers.linear, { type: "http", url: "https://example.test/mcp" });
});

test("renderMcp: an env value that is not a secret's name is refused, naming the server and the key", () => {
  assert.throws(
    () => renderMcp(ctx({ mcp: { tracker: { command: "x", env: { TOKEN: "not-a-reference" } } } })),
    (error) =>
      error instanceof ConfigError &&
      /^flow\.config\.json: mcp server "tracker" sets env TOKEN to a value; name the secret instead \("\$TOKEN"\)$/.test(
        error.message,
      ),
  );
  assert.throws(() => renderMcp(ctx({ mcp: { x: { env: { A: "$A and more" } } } })), ConfigError);
});

/**
 * A preset folder whose `surfaces/mcp.yaml` is `text`.
 * @param {{ after: (fn: () => void) => void }} t
 * @param {string} text
 */
function preset(t, text) {
  const dir = mkdtempSync(join(tmpdir(), "flow-mcp-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "surfaces"));
  writeFileSync(join(dir, "surfaces/mcp.yaml"), text);
  return dir;
}

test("renderMcp: a preset's env value that is not a secret's name is refused, naming the preset's file", (t) => {
  const dir = preset(
    t,
    "mcpServers:\n  tracker:\n    command: x\n    env:\n      TOKEN: not-a-reference\n",
  );
  assert.throws(
    () => renderMcp(ctx({}, dir)),
    (error) =>
      error instanceof ConfigError &&
      error.message ===
        'the preset\'s surfaces/mcp.yaml: mcp server "tracker" sets env TOKEN to a value; name the secret instead ("$TOKEN")',
  );
});

test("renderMcp: invalid YAML in the preset's surface is a ConfigError naming the file", (t) => {
  const dir = preset(t, "mcpServers:\n  a: 1\n  a: 2\n");
  assert.throws(
    () => renderMcp(ctx({}, dir)),
    (error) =>
      error instanceof ConfigError &&
      error.message === `${join(dir, "surfaces/mcp.yaml")}: line 3: \`a\` appears twice`,
  );
});

test("renderMcp: the neutral preset lists only fflow's own server, plus the config's", () => {
  const fflow = { command: "node", args: ["node_modules/@figentra-oss/flow/bin/fflow.mjs", "mcp"] };
  assert.deepEqual(parseYaml(renderMcp(ctx({}, NEUTRAL)).get(MCP_FILE) ?? ""), {
    mcpServers: { fflow },
  });
  assert.deepEqual(
    parseYaml(renderMcp(ctx({ mcp: { x: { command: "x" } } }, NEUTRAL)).get(MCP_FILE) ?? ""),
    { mcpServers: { fflow, x: { command: "x" } } },
  );
});

test("renderMcp: a preset without surfaces/mcp.yaml renders nothing", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "flow-mcp-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(renderMcp(ctx({ mcp: { x: { command: "x" } } }, dir)).size, 0);
});
