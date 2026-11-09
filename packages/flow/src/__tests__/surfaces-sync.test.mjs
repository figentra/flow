/**
 * Figentra Flow file contract:
 * Purpose: hold `sync` to STA-1945 FR-7 and AC-7 for the surfaces: the stackra preset renders every one
 *   (`.claude/settings.json`, the OpenCode projection, `.mcp.yaml`, AGENTS.md, CLAUDE.md, `lefthook.yml`), each with
 *   its provenance header where the format allows and in the lock, and leaves `.agents/specs/` as it was; a preset
 *   without `surfaces/` renders byte for byte what it rendered before; a narrower profile or a preset that drops a
 *   surface removes the unedited owned files (an agent, a surface, the hooks it deselects) and keeps, and `check`
 *   names, an edited one; with `lefthook.yml` rendered, `mise.toml` pins oxfmt and oxlint at the catalog's versions
 *   (AC-8); the config's `mcp`, `lefthook` and `agentsMd` reach their surfaces.
 * Boundary: temporary folders; no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945.
 */
// @covers sta-1945:FR-6 sta-1945:FR-7 sta-1945:FR-19 sta-1945:AC-6 sta-1945:AC-7 sta-1945:AC-8 sta-1945:P-009 sta-1945:P-010 sta-1945:P-011
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { check } from "../commands/check.mjs";
import { sync, SyncRefusal } from "../commands/sync.mjs";
import { SCHEMA, validate } from "../lib/config.mjs";
import { readLock } from "../lib/lock.mjs";
import { headerText } from "../lib/provenance.mjs";
import { VERSION } from "../lib/product.mjs";
import { installProblems, render } from "../lib/render.mjs";
import { governed, OWN_PRESET, snapshot } from "./__fixtures__/governed.mjs";

const quiet = { log: () => {} };
/** What the surfaces render, by path (the OpenCode folder by its prefix). */
const SURFACE = [
  ".claude/settings.json",
  "opencode.jsonc",
  ".mcp.yaml",
  "AGENTS.md",
  "CLAUDE.md",
  "lefthook.yml",
];
const isSurface = (/** @type {string} */ p) =>
  SURFACE.includes(p) ||
  p.startsWith(".opencode/plugins/") ||
  p === ".agents/hooks/fflow-guard.mjs";

/** @param {string} root @param {Record<string, unknown>} config */
const configure = (root, config) =>
  writeFileSync(join(root, "flow.config.json"), JSON.stringify({ version: 1, ...config }));

test("sync: the stackra preset renders every surface, headed where the format allows and locked; specs stay", (t) => {
  const root = governed(t, { config: { preset: "stackra" } });
  mkdirSync(join(root, ".agents/specs/sta-1-x"), { recursive: true });
  writeFileSync(join(root, ".agents/specs/sta-1-x/spec.md"), "# Spec\n");
  const specs = () =>
    Object.entries(snapshot(root)).filter(([p]) => p.startsWith(".agents/specs/"));
  const before = specs();
  const { files } = sync(root, { direct: true, ...quiet });
  for (const path of [
    ...SURFACE,
    ".opencode/plugins/fflow-guard.mjs",
    ".agents/hooks/fflow-guard.mjs",
  ])
    assert.ok(files.includes(path), path);
  const words = headerText({ preset: "stackra", version: VERSION });
  const read = (/** @type {string} */ p) => readFileSync(join(root, p), "utf8");
  for (const path of [
    "opencode.jsonc",
    ".opencode/plugins/fflow-guard.mjs",
    ".agents/hooks/fflow-guard.mjs",
  ])
    assert.ok(read(path).startsWith(`// ${words}\n`), path);
  for (const path of [".mcp.yaml", "lefthook.yml"])
    assert.ok(read(path).startsWith(`# ${words}\n`), path);
  for (const path of ["AGENTS.md", "CLAUDE.md"])
    assert.ok(read(path).startsWith(`<!-- ${words} -->\n`), path);
  assert.match(read("CLAUDE.md"), /\n@AGENTS\.md\n$/);
  const settings = JSON.parse(read(".claude/settings.json"));
  assert.equal(settings.hooks.Stop, undefined, "STA-2131: no uncommitted record by default");
  assert.equal(settings.hooks.SessionEnd, undefined, "STA-2131: no push at session end by default");
  const lock = readLock(root);
  for (const path of files.filter(isSurface)) assert.ok(lock?.files[path], `${path} is locked`);
  assert.deepEqual(installProblems(root), []);
  assert.deepEqual(specs(), before, "sync never touches .agents/specs/");
});

test("sync: a preset without surfaces/ renders byte for byte what it rendered before", (t) => {
  const withSurfaces = governed(t, { own: true });
  const without = governed(t, { own: true });
  rmSync(join(without, OWN_PRESET, "surfaces"), { recursive: true });
  const full = render(withSurfaces, { direct: true });
  const bare = render(without, { direct: true });
  assert.ok([...full.keys()].some(isSurface), "the neutral preset has surfaces");
  assert.deepEqual(bare, new Map([...full].filter(([p]) => !isSurface(p))));
});

test("sync: a narrower profile or preset removes the unedited owned files it drops; an edited one stays and check names it", (t) => {
  const root = governed(t, { own: true });
  const presetYml = join(root, OWN_PRESET, "preset.yml");
  writeFileSync(
    presetYml,
    `${readFileSync(presetYml, "utf8").replace(/\ndefault:[^]*$/, "\n")}default: full
profiles:
  full:
    agents: ["*"]
    skills: ["*"]
    hooks: ["*"]
  lean:
    agents: [git-steward]
    skills: ["*"]
    hooks: [session-stop]
`,
  );
  sync(root, { direct: true, ...quiet, adopt: true });
  assert.ok(existsSync(join(root, "lefthook.yml")));
  assert.ok(existsSync(join(root, ".agents/agents/ci-steward.md")));
  const edited = join(root, ".agents/agents/tracker-steward.md");
  writeFileSync(edited, `${readFileSync(edited, "utf8")}\nOurs.\n`);
  rmSync(join(root, OWN_PRESET, "surfaces/lefthook.yml"));
  configure(root, { preset: OWN_PRESET, profile: "lean", session: { pushAtEnd: true } });
  const { removed } = sync(root, { direct: true, ...quiet, adopt: true });
  assert.deepEqual(removed.toSorted(), [".agents/agents/ci-steward.md", "lefthook.yml"]);
  assert.ok(existsSync(edited), "an edited owned file is never deleted");
  const settings = JSON.parse(readFileSync(join(root, ".claude/settings.json"), "utf8"));
  assert.deepEqual(Object.keys(settings.hooks), ["PreToolUse", "SessionEnd"]);
  assert.match(check(root).problems.join("\n"), /\.agents\/agents\/tracker-steward\.md differs/);
});

test("sync: with lefthook.yml rendered, mise.toml pins oxfmt and oxlint at the catalog's versions", (t) => {
  const root = governed(t);
  writeFileSync(
    join(root, "pnpm-workspace.yaml"),
    "packages:\n  - packages/*\ncatalog:\n  oxfmt: 0.71.0\n  oxlint: 1.86.0\n",
  );
  writeFileSync(join(root, "mise.toml"), '[tools]\nnode = "24"\n');
  /** @type {string[]} */
  const lines = [];
  sync(root, { log: (l) => lines.push(l) });
  assert.equal(
    readFileSync(join(root, "mise.toml"), "utf8"),
    '[tools]\n"npm:oxfmt" = "0.71.0"\n"npm:oxlint" = "1.86.0"\nnode = "24"\n',
  );
  assert.ok(lines.some((l) => /pinned npm:oxfmt and npm:oxlint/.test(l)));
  lines.length = 0;
  sync(root, { log: (l) => lines.push(l) });
  assert.ok(!lines.some((l) => /pinned/.test(l)), "already pinned: nothing to say");
});

test("sync: the config's mcp, lefthook and agentsMd reach their surfaces; the schema refuses a wrong shape", (t) => {
  const config = {
    preset: "stackra",
    mcp: { ours: { command: "ours-mcp", env: { OURS_TOKEN: "$OURS_TOKEN" } } },
    lefthook: { "pre-commit": [{ name: "ours", run: "true" }] },
    agentsMd: { facts: "Our own note." },
  };
  assert.deepEqual(validate(SCHEMA, { version: 1, ...config }), []);
  const root = governed(t, { config });
  sync(root, { direct: true, ...quiet });
  const read = (/** @type {string} */ p) => readFileSync(join(root, p), "utf8");
  assert.match(read(".mcp.yaml"), /ours-mcp/);
  assert.match(read("lefthook.yml"), /name: ours/);
  assert.match(read("AGENTS.md"), /Our own note\./);
  assert.deepEqual(validate(SCHEMA, { version: 1, agentsMd: { facts: 1 } }), [
    "agentsMd.facts: must be a string",
  ]);
  assert.deepEqual(validate(SCHEMA, { version: 1, lefthook: { "pre-commit": "x" } }), [
    "lefthook.pre-commit: must be a array",
  ]);
});

test("sync: settings.json and lefthook.yml are opt-in; unset, a repository keeps only what its lock already has", (t) => {
  // A product's update must not start allowing commands and hooking every tool call, or replace its hook jobs.
  const root = governed(t, { config: { preset: "stackra", surfaces: undefined } });
  const files = () => sync(root, { direct: true, ...quiet }).files;
  const fresh = files();
  assert.equal(fresh.includes(".claude/settings.json"), false);
  assert.equal(fresh.includes("lefthook.yml"), false);
  configure(root, { preset: "stackra", surfaces: { settings: true, lefthook: true } });
  assert.ok(files().includes(".claude/settings.json"));
  configure(root, { preset: "stackra" });
  const kept = files();
  assert.ok(kept.includes(".claude/settings.json"), "the lock has it");
  assert.ok(kept.includes("lefthook.yml"), "the lock has it");
  configure(root, { preset: "stackra", surfaces: { settings: false } });
  assert.equal(files().includes(".claude/settings.json"), false);
  assert.equal(existsSync(join(root, ".claude/settings.json")), false, "an unedited render goes");
});

test("sync refuses to replace an AGENTS.md the repository wrote; once Flow owns it, sync renders it", (t) => {
  const root = governed(t, { config: { preset: "stackra" } });
  writeFileSync(join(root, "AGENTS.md"), "# Our product\n\n800 lines of our own rules.\n");
  assert.throws(
    () => sync(root, { direct: true, ...quiet }),
    (error) =>
      error instanceof SyncRefusal &&
      /AGENTS\.md/.test(error.message) &&
      /agentsMd\.facts/.test(error.message),
  );
  assert.match(
    readFileSync(join(root, "AGENTS.md"), "utf8"),
    /800 lines of our own rules/,
    "untouched",
  );
  rmSync(join(root, "AGENTS.md"));
  sync(root, { direct: true, ...quiet });
  assert.match(readFileSync(join(root, "AGENTS.md"), "utf8"), /Generated by fflow/);
  // The lock owns it now: a later sync renders over it without asking.
  writeFileSync(join(root, "AGENTS.md"), "edited\n");
  sync(root, { direct: true, ...quiet });
  assert.match(readFileSync(join(root, "AGENTS.md"), "utf8"), /Generated by fflow/);
});
