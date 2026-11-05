/**
 * Figentra Flow file contract:
 * Purpose: hold `fflow`'s routing on the console engine to AC-36: `fflow` alone prints the banner (on a terminal), the
 *   version and every command under its group; `<command> --help` prints its usage and runs nothing; an unknown
 *   command names the closest match and exits 2; and only src/lib/console.mjs (with bin/fflow.mjs) imports
 *   `@stackra/*`, so the governance core stays free of the engine; and the governance commands' `--help` lists their
 *   options (STA-1945 FR-1), and `preset add` its `--dry-run` (STA-2097), and the commands ported for SC-2 and FR-31
 *   theirs, each on its own help row, never matched by an example line; and, every command now ported, the
 *   passthrough list is empty (STA-1945 SC-2); `gate run --help` prints help and dispatches nothing (STA-2128).
 * Boundary: the engine's in-process test harness and the text of src/; no command runs.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945 FR-1, FR-31; STA-1966 FR-031; STA-2097; STA-2128.
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
    "context",
  ])
    assert.match(plain.stdout, new RegExp(`\\b${name}\\b`));
  assert.ok(!plain.stdout.includes(FLOW_THEME.logo[1]), "a pipe gets no banner");
});

test("help: <command> --help prints its usage and runs nothing", async () => {
  // `gate` with no mode is a usage error (exit 2): a 0 here means it never ran.
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
  const context = await runCommandForTest(CONSOLE, ["context", "--help"]);
  assert.equal(context.exitCode, 0);
  for (const option of ["--repo", "--all", "--path", "--query", "--limit"])
    assert.ok(context.stdout.includes(option), option);
});

test("help: gate run --help and gate --help print the usage, exit 0 and dispatch nothing", async (t) => {
  // A spy on the gate command's handle sees any dispatch; the control run proves the spy is on the path.
  const Gate = COMMANDS.find((c) => c.name === "GateCommand");
  assert.ok(Gate, "GateCommand is registered");
  const handle = t.mock.method(Gate.prototype, "handle", async () => 0);
  for (const argv of [
    ["gate", "run", "--help"],
    ["gate", "--help"],
    ["gate", "run", "--box", "nowhere", "--help"],
  ]) {
    const r = await runCommandForTest(CONSOLE, argv);
    assert.equal(r.exitCode, 0, argv.join(" "));
    assert.match(r.stdout, /gate run --shards 4 -- --no-wait/, argv.join(" "));
    assert.equal(handle.mock.callCount(), 0, argv.join(" "));
  }
  assert.equal((await runCommandForTest(CONSOLE, ["gate", "run"])).exitCode, 0);
  assert.equal(handle.mock.callCount(), 1, "a real `gate run` reaches the spy");
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

/**
 * The help's row for `--flag` (render-help: two spaces, then `-s, ` or four spaces): an example line starts with
 * `fflow`, so a flag that only appears in an example does not match.
 * @param {string} flag
 */
const optionRow = (flag) => new RegExp(`^  (?:-\\w, | {4})${flag}(?![\\w-])`, "m");

test("help: the setup, spec and agent commands ported from passthrough declare their options", async () => {
  for (const [name, options] of Object.entries({
    init: ["--force", "--runner", "--workspace"],
    sync: ["--workspace", "--direct"],
    migrate: ["--dry-run"],
    trace: ["--base"],
    adr: ["--issue", "--owner"],
    start: ["--slug", "--role", "--session", "--install", "--dry-run"],
    mcp: [],
  })) {
    const r = await runCommandForTest(CONSOLE, [name, "--help"]);
    assert.equal(r.exitCode, 0, name);
    // The usage line, which no example has: the help is this command's.
    assert.match(r.stdout, new RegExp(`^  fflow ${name} \\[options\\]`, "m"), name);
    for (const option of options) assert.match(r.stdout, optionRow(option), `${name} ${option}`);
  }
  // A mode the command does not have is refused by the engine's choices, before trace.mjs runs.
  const mode = await runCommandForTest(CONSOLE, ["trace", "tracee"]);
  assert.equal(mode.exitCode, 2);
  assert.match(mode.stdout + mode.stderr, /<mode> must be one of trace, drift, ci, got "tracee"/);
});

/**
 * The help's own row for `name`: an Options row (`    --name` or `-n, --name`, two spaces in) or an Arguments row
 * (the bare name, two spaces in). The Usage and Examples lines start `fflow`, so a flag in an example cannot match.
 */
const helpRow = (/** @type {string} */ name) =>
  new RegExp(`^  ${name.startsWith("--") ? "(?:-\\w, |    )" : ""}${name}(?:[ =]|$)`, "m");

test("help: gate, parse, guard and hooks run declare their arguments and options", async () => {
  for (const [words, listed] of Object.entries({
    gate: [
      "mode",
      "operands",
      "--ref",
      "--box",
      "--shards",
      "--base",
      "--key",
      "--slug",
      "--summary",
      "--reader",
    ],
    parse: ["file"],
    guard: ["--print-settings"],
    "hooks run": ["stage", "hook-args"],
  })) {
    const r = await runCommandForTest(CONSOLE, [...words.split(" "), "--help"]);
    assert.equal(r.exitCode, 0, words);
    for (const item of listed) assert.match(r.stdout, helpRow(item), `${words} ${item}`);
  }
  // The variadic positionals, from the Usage line; no example spells `<operands>` or `<hook-args>`.
  const gate = await runCommandForTest(CONSOLE, ["gate", "--help"]);
  assert.match(gate.stdout, /<mode> \[?<operands>\.\.\.\]?/);
  const hooks = await runCommandForTest(CONSOLE, ["hooks", "run", "--help"]);
  assert.match(hooks.stdout, /<stage> \[?<hook-args>\.\.\.\]?/);
});

/**
 * The help's own row for `name`, never an example: an option's row is `--name` behind its short letter or a four-space
 * pad, and an argument's (`<name>`) is its bare name; an example line starts with `fflow`, so it matches neither.
 * @param {string} name
 */
function row(name) {
  const argument = /^<(.+)>$/.exec(name);
  return argument
    ? new RegExp(`^  ${argument[1]}(?: |$)`, "m")
    : new RegExp(`^  (?:-\\w, | {4})${name}(?:[= ]|$)`, "m");
}

// @covers sta-1945:SC-2 sta-1945:FR-31
test("help: readme, team check, land, train, spec, linear, clean, ship, release and app create declare options", async () => {
  for (const [argv, options] of /** @type {[string[], string[]][]} */ ([
    [["readme"], ["--check"]],
    [["team", "check"], ["--tracker"]],
    [["land"], ["<pr>", "--stack", "--dry-run", "--manual-ok", "--wait", "--no-wait"]],
    [
      ["train", "open"],
      ["<version>", "--dry-run"],
    ],
    [
      ["train", "add"],
      ["<pr>", "--dry-run"],
    ],
    [["train", "close"], ["--dry-run"]],
    [["train", "build"], ["--dry-run"]],
    [
      ["train", "eject"],
      ["<pr>", "--dry-run"],
    ],
    [["train", "depart"], ["--dry-run"]],
    [["train", "status"], ["--dry-run"]],
    [
      ["spec", "paths"],
      ["--require-spec", "--require-tasks", "--include-tasks", "--paths-only", "--template"],
    ],
    [["spec", "template"], ["<template>"]],
    [
      ["spec", "ask"],
      ["<key>", "--async"],
    ],
    [["spec", "resume"], ["<key>"]],
    [
      ["linear", "issue"],
      ["<file>", "--dry-run"],
    ],
    [
      ["linear", "tasks"],
      ["<file>", "--dry-run"],
    ],
    [["clean"], ["--dry-run", "--adopt", "--fix-ignore", "--budget", "--all"]],
    [["ship"], ["<environment>", "--workflow", "--dry-run"]],
    [["release"], ["--offline", "--preflight"]],
    [
      ["app", "create"],
      ["<role>", "--org", "--name", "--key-file"],
    ],
  ])) {
    const r = await runCommandForTest(CONSOLE, [...argv, "--help"]);
    assert.equal(r.exitCode, 0, argv.join(" "));
    for (const option of options)
      assert.match(r.stdout, row(option), `${argv.join(" ")} ${option}`);
  }
  // setup-plan and setup-tasks take nothing; their own description shows they are declared, not passthrough.
  const plan = await runCommandForTest(CONSOLE, ["spec", "setup-plan", "--help"]);
  assert.match(plan.stdout, /^ {2}Run the plan gate/m);
  const tasks = await runCommandForTest(CONSOLE, ["help", "spec", "setup-tasks"]);
  assert.match(
    tasks.stdout,
    /^ {2}The spec folder, its documents and the resolved tasks template/m,
  );
});

test("help: an unknown command names the closest match and exits 2", async () => {
  const r = await runCommandForTest(CONSOLE, ["stauts"]);
  assert.equal(r.exitCode, 2);
  assert.match(r.stdout + r.stderr, /status/);
});

test("help: every command is ported, so none is passthrough", () => {
  assert.deepEqual(passthroughCommands(COMMANDS), []);
});

test("help: only the CLI layer imports @stackra/*, so the governance core stays free of the engine", () => {
  const src = join(dirname(fileURLToPath(import.meta.url)), "..");
  const importers = readdirSync(src, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".mjs") && !f.startsWith("__tests__"))
    .filter((f) => /["']@stackra\//.test(readFileSync(join(src, f), "utf8")))
    .map((f) => f.split("\\").join("/"));
  assert.deepEqual(importers, ["lib/console.mjs"]);
});
