/**
 * Figentra Flow file contract:
 * Purpose: hold the CLI kit to the brand's glyph spec: the five states verbatim, a 14-column prefix, magenta 162 with
 *   only blocked's `x x` and `|` in red, and plain text under NO_COLOR, TERM=dumb or a non-TTY stream unless
 *   FORCE_COLOR; and the gate status to glyph mapping the status view uses.
 * Boundary: pure functions and a fake stream; no process, no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1729 (the CLI kit); STA-1945 FR-31 (the repository check and the error block).
 */
// @covers sta-1729:FR-7 sta-1729:AC-012
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CommandError } from "@stackra/console";

import { colorFor, gateGlyph, glyph, GLYPH_PAD, GLYPHS, say } from "../lib/cli.mjs";
import { requireRepository } from "../lib/console.mjs";

const BIN = new URL("../../bin/fflow.mjs", import.meta.url).pathname;

/**
 * Runs the binary in `cwd` without colour: stdout and stderr together, the error box's borders dropped and its
 * wrapped lines joined, so a message reads as one line.
 */
const flow = (/** @type {string} */ cwd, /** @type {string[]} */ args) => {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  const text = `${r.stdout}${r.stderr}`.replace(/[│|]/g, " ").replace(/\s+/g, " ");
  return { status: r.status, text };
};

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

// @covers sta-1945:FR-31 sta-1945:AC-35 sta-1945:P-035
test("cli: a command checks for the repository first, in one error block with no raw git output", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "flow-cli-nogit-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.throws(
    () => requireRepository(dir),
    (error) => {
      assert.ok(error instanceof CommandError);
      assert.match(error.why ?? "", /not inside a git work tree/);
      assert.match(error.fix ?? "", /git init/);
      return true;
    },
  );
  const r = flow(dir, ["spec", "paths", "--json"]);
  assert.equal(r.status, 1);
  assert.match(r.text, /not a git repository/);
  assert.match(r.text, /git init/);
  assert.doesNotMatch(r.text, /fatal:/);
  // A passthrough command's --verbose never reaches the engine's globals, so the check shows git's words itself.
  const verbose = flow(dir, ["spec", "paths", "--json", "--verbose"]);
  assert.equal(verbose.status, 1);
  assert.match(verbose.text, /not a git repository/);
  assert.match(verbose.text, /fatal:/);
});

// @covers sta-1945:FR-31 sta-1945:AC-35
test("cli: a configuration refusal is the error block with exit 2", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "flow-cli-config-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  spawnSync("git", ["init", "-q"], { cwd: dir });
  mkdirSync(join(dir, ".flow"));
  writeFileSync(join(dir, ".flow/readme.yml"), "nope: 1\n");
  const r = flow(dir, ["readme"]);
  assert.equal(r.status, 2, r.text);
  assert.match(r.text, /"nope" is not a README field/);
  assert.match(r.text, /fflow doctor/);
});
