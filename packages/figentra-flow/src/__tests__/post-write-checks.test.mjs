/**
 * Figentra Flow file contract:
 * Purpose: core's post-write check tests, ported (core 220f92c2, `.agents/hooks/__tests__/post-write-checks.test.mjs`):
 *   the PostToolUse hook reports a file oxfmt would reformat and never blocks or rewrites it. Only the harness
 *   changed: the hook is `bin/fflow-guard.mjs PostToolUse`.
 * Boundary: test only; runs the hook entry as a child process on temporary folders with a fake oxfmt.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945.
 */
// @covers sta-1945:FR-7 sta-1945:FR-11 sta-1945:AC-9 sta-1945:P-012
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runHook } from "./__fixtures__/guard.mjs";

// A fake oxfmt that "fails" the check for files containing BAD.
const root = mkdtempSync(join(tmpdir(), "post-write-"));
after(() => rmSync(root, { recursive: true, force: true }));
mkdirSync(join(root, "node_modules/.bin"), { recursive: true });
const bin = join(root, "node_modules/.bin/oxfmt");
writeFileSync(
  bin,
  `#!/usr/bin/env node\nimport { readFileSync } from "node:fs";\nprocess.exit(readFileSync(process.argv.at(-1), "utf8").includes("BAD") ? 1 : 0);\n`,
);
chmodSync(bin, 0o755);

const run = (/** @type {string} */ name, /** @type {string} */ body, dir = root) => {
  const file = join(dir, name);
  writeFileSync(file, body);
  const r = runHook(
    "PostToolUse",
    { tool_input: { file_path: file } },
    { ...process.env, CLAUDE_PROJECT_DIR: dir },
  );
  assert.equal(r.status, 0);
  assert.equal(readFileSync(file, "utf8"), body, "file must never be rewritten");
  return r.stdout;
};

test("reports an unformatted file, without rewriting it", () => {
  assert.match(run("a.ts", "BAD"), /not oxfmt-formatted/);
});
test("silent for a formatted file", () => assert.equal(run("b.ts", "ok"), ""));
test("silent for an unchecked extension", () => assert.equal(run("c.txt", "BAD"), ""));
test("silent when oxfmt is not installed", () => {
  const bare = mkdtempSync(join(tmpdir(), "post-write-bare-"));
  try {
    assert.equal(run("d.ts", "BAD", bare), "");
  } finally {
    rmSync(bare, { recursive: true, force: true });
  }
});
test("never fails on a missing file", () => {
  const r = runHook("PostToolUse", { tool_input: { file_path: join(root, "nope.ts") } });
  assert.equal(r.status, 0);
});
