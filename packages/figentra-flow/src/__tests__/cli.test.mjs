/**
 * Figentra Flow file contract:
 * Purpose: hold the CLI kit to the brand's glyph spec: the five states verbatim, a 14-column prefix, magenta 162 with
 *   only blocked's `x x` and `|` in red, and plain text under NO_COLOR, TERM=dumb or a non-TTY stream unless
 *   FORCE_COLOR; and the gate status to glyph mapping the status view uses. The dispatcher knows the governance
 *   commands (`update`, `check`, `diff`, `validate`) and runs them with `--workspace` (STA-1945).
 * Boundary: pure functions and a fake stream; the dispatcher tests run `bin/fflow.mjs` on temporary folders; no
 *   network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1729 (the CLI kit); STA-1945.
 */
// @covers sta-1729:FR-7 sta-1729:AC-012
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { colorFor, gateGlyph, glyph, GLYPH_PAD, GLYPHS, say } from "../lib/cli.mjs";
import { governed } from "./__fixtures__/governed.mjs";
import { sh } from "./__fixtures__/repo.mjs";

const BIN = new URL("../../bin/fflow.mjs", import.meta.url).pathname;
const fflow = (/** @type {string} */ cwd, /** @type {string[]} */ args) =>
  spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8" });

// @covers sta-1945:FR-1 sta-1945:AC-1 sta-1945:AC-3 sta-1945:P-001
test("dispatcher: the usage names the governance commands; each runs over a workspace", (t) => {
  const usage = fflow(tmpdir(), []);
  assert.equal(usage.status, 0);
  for (const command of ["update", "check", "diff", "validate"])
    assert.match(usage.stderr, new RegExp(`[<|]${command}[|>]`));
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "flow-cli-ws-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const name of ["one", "two"]) {
    mkdirSync(join(dir, name));
    sh(join(dir, name), "init", "-q");
    governed(t, { at: join(dir, name) });
  }
  const check = fflow(dir, ["check", "--workspace", dir]);
  assert.equal(check.status, 0, check.stderr);
  assert.equal(check.stdout, "one: ok\ntwo: ok\n");
  assert.equal(fflow(dir, ["validate", "--workspace", dir]).stdout, "one: valid\ntwo: valid\n");
  const diff = fflow(dir, ["diff", "--workspace", dir]);
  assert.match(diff.stdout, /^one: \d+ change\(s\): add /m);
  assert.equal(fflow(dir, ["update", "--workspace", dir]).status, 0);
  assert.equal(
    fflow(dir, ["diff", "--workspace", dir]).stdout,
    "one: nothing to change\ntwo: nothing to change\n",
  );
  assert.equal(fflow(dir, ["update", "--workspace"]).status, 2);
});

// eslint-disable-next-line no-control-regex
const strip = (/** @type {string} */ s) => s.replace(/\u001B\[[0-9;]*m/g, "");

test("cli kit: the brand's five states, each a 14-column prefix", () => {
  assert.deepEqual(GLYPHS, {
    waiting: ". . (- -)",
    checking: "* . (o o)",
    approved: "* * (^ ^)",
    blocked: "* . (x x)|",
    shipped: "* * * (^ ^)=>",
  });
  for (const state of /** @type {(keyof typeof GLYPHS)[]} */ (Object.keys(GLYPHS))) {
    assert.equal(glyph(state).length, GLYPH_PAD);
    assert.equal(strip(glyph(state, true)), glyph(state), "colour adds codes, never columns");
  }
});

test("cli kit: magenta 162, and only blocked's eyes and bar in red", () => {
  assert.ok(glyph("approved", true).startsWith("\u001B[38;5;162m* * (^ ^)\u001B[0m"));
  assert.equal(
    glyph("blocked", true).trimEnd(),
    "\u001B[38;5;162m* . (\u001B[31mx x\u001B[38;5;162m)\u001B[31m|\u001B[0m",
  );
});

test("cli kit: plain under NO_COLOR, TERM=dumb or no TTY; FORCE_COLOR wins over no TTY", () => {
  const tty = { isTTY: true };
  assert.equal(colorFor(tty, {}), true);
  assert.equal(colorFor(tty, { NO_COLOR: "1" }), false);
  assert.equal(colorFor(tty, { TERM: "dumb" }), false);
  assert.equal(colorFor({}, {}), false);
  assert.equal(colorFor({}, { FORCE_COLOR: "1" }), true);
  assert.equal(colorFor({}, { FORCE_COLOR: "0" }), false);
  assert.equal(colorFor(tty, { NO_COLOR: "1", FORCE_COLOR: "1" }), false);
  let out = "";
  say("shipped", "landed", { write: (s) => (out += s) }, {});
  assert.equal(out, "* * * (^ ^)=> landed\n");
});

test("cli kit: a gate status maps to its glyph", () => {
  assert.equal(gateGlyph("success"), "approved");
  assert.equal(gateGlyph("pending"), "checking");
  assert.equal(gateGlyph("failure"), "blocked");
  assert.equal(gateGlyph("error"), "blocked");
  assert.equal(gateGlyph(undefined), "waiting");
});
