/**
 * Figentra Flow file contract:
 * Purpose: hold `fflow`'s routing on the console engine to AC-36: `fflow` alone prints the banner (on a terminal), the
 *   version and every command under its group; `<command> --help` prints its usage and runs nothing; an unknown
 *   command names the closest match and exits 2; and the passthrough list (commands not yet ported, STA-1966 FR-031)
 *   is pinned, so porting one is a deliberate change here; and only src/lib/console.mjs (with bin/fflow.mjs) imports
 *   `@stackra/*`, so the governance core stays free of the engine; and the governance commands' `--help` lists their
 *   options (STA-1945 FR-1), and `preset add` its `--dry-run` (STA-2097).
 * Boundary: the engine's in-process test harness and the text of src/; no command runs.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945 FR-1, FR-31; STA-1966 FR-031; STA-2097.
 */
// @covers sta-1945:FR-31 sta-1945:AC-36 sta-1945:P-035
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { passthroughCommands, runCommandForTest } from "@stackra/console/testing";

import { COMMANDS, CONSOLE, FLOW_THEME, GROUPS } from "../lib/console.mjs";
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
  for (const name of [
    "init",
    "doctor",
    "check",
    "spec",
    "gate",
    "status",
    "next",
    "resume",
    "todo",
    "ledger",
    "land",
    "release",
    "guard",
  ])
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
  // The record's commands declare their options too, under the words a hook types.
  const stop = await runCommandForTest(CONSOLE, ["session", "stop", "--help"]);
  assert.equal(stop.exitCode, 0);
  assert.match(stop.stdout, /--save-only/);
  const done = await runCommandForTest(CONSOLE, ["help", "task", "done"]);
  assert.equal(done.exitCode, 0);
  assert.match(done.stdout, /--command/);
  const wave = await runCommandForTest(CONSOLE, ["help", "task", "wave"]);
  assert.equal(wave.exitCode, 0);
  assert.match(wave.stdout, /task wave STA-12/);
  const ledger = await runCommandForTest(CONSOLE, ["ledger", "--help"]);
  assert.equal(ledger.exitCode, 0);
  assert.match(ledger.stdout, /--since/);
  const todo = await runCommandForTest(CONSOLE, ["todo", "--help"]);
  assert.equal(todo.exitCode, 0);
  assert.match(todo.stdout, /--repo/);
  // STA-2097: declared, not passthrough.
  const preset = await runCommandForTest(CONSOLE, ["preset", "add", "--help"]);
  assert.equal(preset.exitCode, 0);
  assert.match(preset.stdout, /--dry-run/);
  assert.match(preset.stdout, /preset add @acme\/flow-preset/);
});

test("help: task refuses an id that is not T###, and done a missing --command, running nothing", async () => {
  const noCommand = await runCommandForTest(CONSOLE, ["task", "done", "STA-12", "T003"]);
  assert.equal(noCommand.exitCode, 2);
  assert.match(noCommand.stdout + noCommand.stderr, /--command/);
  const badId = await runCommandForTest(CONSOLE, ["task", "start", "STA-12", "3"]);
  assert.equal(badId.exitCode, 2);
});

// @covers sta-1945:FR-1 sta-1945:AC-3
test("help: the governance commands declare their options, --workspace among them", async () => {
  for (const [name, options] of Object.entries({
    update: ["--workspace", "--direct", "--preset"],
    check: ["--workspace"],
    diff: ["--workspace", "--direct"],
    validate: ["--workspace"],
  })) {
    const r = await runCommandForTest(CONSOLE, [name, "--help"]);
    assert.equal(r.exitCode, 0, name);
    for (const option of options) assert.match(r.stdout, new RegExp(option), `${name} ${option}`);
  }
});

// @covers sta-1945:FR-15
test("help: the stage commands declare --input and --record", async () => {
  for (const name of ["plan", "review"]) {
    const r = await runCommandForTest(CONSOLE, [name, "--help"]);
    assert.equal(r.exitCode, 0, name);
    for (const option of ["--input", "--record"])
      assert.match(r.stdout, new RegExp(option), `${name} ${option}`);
  }
});

test("help: an unknown command names the closest match and exits 2", async () => {
  const r = await runCommandForTest(CONSOLE, ["stauts"]);
  assert.equal(r.exitCode, 2);
  assert.match(r.stdout + r.stderr, /status/);
});

test("help: the commands not yet ported are passthrough, and only these", () => {
  assert.deepEqual(passthroughCommands(COMMANDS), [
    "adr",
    "app",
    "clean",
    "gate",
    "guard",
    "hooks",
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

test("help: only the CLI layer imports @stackra/*, so the governance core stays free of the engine", () => {
  const src = join(dirname(fileURLToPath(import.meta.url)), "..");
  const importers = readdirSync(src, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".mjs") && !f.startsWith("__tests__"))
    .filter((f) => /["']@stackra\//.test(readFileSync(join(src, f), "utf8")))
    .map((f) => f.split("\\").join("/"));
  assert.deepEqual(importers, ["lib/console.mjs"]);
});
