/**
 * Figentra Flow file contract:
 * Purpose: context discovery stays offline, bounded and scoped, with explicit gaps and per-checkout revisions.
 * Boundary: temporary Git fixtures; no network or agent client.
 * Runtime: node
 * Secrets: none.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { discoverContext } from "../lib/context.mjs";
import { defaultReaders, handle } from "../commands/mcp.mjs";
import { repo, sh } from "./__fixtures__/repo.mjs";

/** @param {string} root @param {string} path @param {string} text */
function put(root, path, text) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

test("context: task scope retains ancestor instructions, metadata search, revision and dirty state", (t) => {
  const r = repo({ "AGENTS.md": "No workstation tests.\n" });
  t.after(r.dispose);
  put(r.root, "packages/AGENTS.md", "Package rules.\n");
  put(r.root, "packages/widget/AGENTS.override.md", "Widget rules.\n");
  put(
    r.root,
    "packages/widget/package.json",
    JSON.stringify({ name: "@acme/widget", description: "Payment UI" }),
  );
  put(r.root, "packages/widget/README.md", "Example route.\n");
  const state = sh(r.root, "status", "--porcelain");
  const before = readFileSync(join(r.root, "AGENTS.md"), "utf8");
  const found = discoverContext(r.root, { path: "packages/widget", query: "payment", limit: 1 })
    .repositories[0];
  assert.deepEqual(found.instructions, [
    "AGENTS.md",
    "packages/AGENTS.md",
    "packages/widget/AGENTS.override.md",
  ]);
  assert.equal(found.matches[0].name, "@acme/widget");
  assert.equal(found.revision, sh(r.root, "rev-parse", "HEAD"));
  assert.equal(found.dirty, true);
  assert.equal(found.truncated, false);
  assert.equal(discoverContext(r.root, { limit: 1 }).repositories[0].truncated, true);
  assert.equal(sh(r.root, "status", "--porcelain"), state);
  assert.equal(readFileSync(join(r.root, "AGENTS.md"), "utf8"), before);
});

test("context: ignored, deleted and symlinked files are omitted; bad metadata is explicit", (t) => {
  const r = repo({ ".gitignore": "ignored/\n.env\n" });
  t.after(r.dispose);
  put(r.root, "ignored/SKILL.md", "not indexed");
  put(r.root, "node_modules/dep/package.json", "{}");
  put(r.root, "broken/package.json", "{");
  put(r.root, ".agents/skills/local/SKILL.md", "---\nname: local\n---\n");
  symlinkSync(join(r.root, "README.md"), join(r.root, "AGENTS.md"));
  unlinkSync(join(r.root, "README.md"));
  symlinkSync(join(r.root, "broken"), join(r.root, "linked"));
  const found = discoverContext(r.root, { limit: 100 }).repositories[0];
  assert.ok(found.matches.some((e) => e.kind === "skill"));
  assert.ok(!found.matches.some((e) => /ignored|node_modules|AGENTS.md|linked/.test(e.path)));
  assert.equal(found.problemCount, 1);
  assert.ok(!found.matches.some((e) => e.path === "README.md"));
  assert.match(found.problems[0], /broken\/package.json/);
});

test("context: collection uses the registry and exposes missing checkouts without changing single-repo default", (t) => {
  const a = repo();
  const b = repo({ "README.md": "another checkout\n" });
  t.after(a.dispose);
  t.after(b.dispose);
  const registry = join(a.root, "workspace.yaml");
  writeFileSync(
    registry,
    `repos:\n  - path: ${a.root}\n    github: acme/a\n  - path: ${b.root}\n    github: acme/b\n  - path: ${join(a.root, "missing")}\n`,
  );
  const prior = process.env.FFLOW_WORKSPACE;
  process.env.FFLOW_WORKSPACE = registry;
  t.after(() => {
    if (prior === undefined) delete process.env.FFLOW_WORKSPACE;
    else process.env.FFLOW_WORKSPACE = prior;
  });
  assert.equal(discoverContext(a.root).repositories.length, 1);
  const found = discoverContext(a.root, { all: true });
  assert.equal(found.repositories.length, 3);
  assert.equal(found.repositories[0].identity, "acme/a");
  assert.notEqual(found.repositories[0].revision, found.repositories[1].revision);
  assert.match(found.repositories[2].error, /missing/);
});

test("context: invalid scope and limits fail; MCP uses the same reader", async (t) => {
  const r = repo();
  t.after(r.dispose);
  for (const options of [
    { all: true, repo: r.root },
    { path: "../escape" },
    { path: "/tmp" },
    { limit: 0 },
    { limit: 101 },
    { query: "x\ny" },
  ])
    assert.throws(() => discoverContext(r.root, options), /context:/);
  const expected = discoverContext(r.root);
  const actual = defaultReaders().context({ repo: r.root }, {});
  assert.deepEqual(actual, expected);
  const reply = /** @type {any} */ (
    await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "fflow_context",
        arguments: { repo: r.root, limit: 101 },
      },
    })
  );
  assert.equal(reply.result.isError, true);
  assert.match(reply.result.content[0].text, /limit/);
});
