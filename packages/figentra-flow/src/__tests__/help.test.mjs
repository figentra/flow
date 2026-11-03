/**
 * Figentra Flow file contract:
 * Purpose: hold `fflow`'s routing on the console engine to AC-36: `fflow` alone prints the banner (on a terminal), the
 *   version and every command under its group; `<command> --help` prints its usage and runs nothing; an unknown
 *   command names the closest match and exits 2; and the passthrough list (commands not yet ported, STA-1966 FR-031)
 *   is pinned, so porting one is a deliberate change here.
 * Boundary: the engine's in-process test harness; no command runs.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945 FR-31; STA-1966 FR-031.
 */
// @covers sta-1945:FR-31 sta-1945:AC-36 sta-1945:P-035
import { test } from "node:test";
import assert from "node:assert/strict";

import { passthroughCommands, runCommandForTest } from "@stackra/console/testing";

import { COMMANDS, CONSOLE, FLOW_THEME, GROUPS } from "../lib/console.mjs";
import { COMMAND_NAMES } from "../lib/plain.mjs";
import { VERSION } from "../lib/product.mjs";

test("help: fflow alone prints the banner, the version and every command under its group", async () => {
  const r = await runCommandForTest(CONSOLE, [], { colour: true });
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, new RegExp(VERSION.replaceAll(".", "\\.")));
  // The banner's logo is coloured column by column, so its letters are split by escapes.
  // eslint-disable-next-line no-control-regex
  const banner = r.stdout.replace(/\u001B\[[0-9;]*m/g, "");
  assert.ok(banner.includes(FLOW_THEME.logo[4]), banner);
  const plain = await runCommandForTest(CONSOLE, []);
  assert.equal(plain.exitCode, 0);
  for (const heading of Object.values(GROUPS)) assert.match(plain.stdout, new RegExp(heading));
  for (const name of ["init", "doctor", "spec", "gate", "status", "land", "release", "guard"])
    assert.match(plain.stdout, new RegExp(`\\b${name}\\b`));
  assert.ok(!plain.stdout.includes(FLOW_THEME.logo[1]), "a pipe gets no banner");
});

test("help: <command> --help prints its usage and runs nothing", async () => {
  // `gate` with no mode prints its own usage and exits 2: a 0 here means it never ran.
  const gate = await runCommandForTest(CONSOLE, ["gate", "--help"]);
  assert.equal(gate.exitCode, 0);
  assert.match(gate.stdout, /gate dir --key STA-12/);
  const status = await runCommandForTest(CONSOLE, ["help", "status"]);
  assert.equal(status.exitCode, 0);
  assert.match(status.stdout, /--offline/);
  assert.match(status.stdout, /--since/);
});

test("help: an unknown command names the closest match and exits 2", async () => {
  const r = await runCommandForTest(CONSOLE, ["stauts"]);
  assert.equal(r.exitCode, 2);
  assert.match(r.stdout + r.stderr, /status/);
});

test("help: the commands not yet ported are passthrough, and only these", () => {
  assert.deepEqual(passthroughCommands(COMMANDS), [
    "app",
    "clean",
    "gate",
    "guard",
    "init",
    "land",
    "linear",
    "mcp",
    "migrate",
    "parse",
    "readme",
    "release",
    "ship",
    "spec",
    "start",
    "sync",
    "team",
    "trace",
    "train",
  ]);
});

test("help: the plain dispatcher, used without the engine, knows every command the engine registers", () => {
  assert.deepEqual(
    [...COMMAND_NAMES].sort(),
    [...passthroughCommands(COMMANDS), "doctor", "status"].sort(),
  );
});
