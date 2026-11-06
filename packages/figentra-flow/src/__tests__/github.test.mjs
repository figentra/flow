/**
 * Figentra Flow file contract:
 * Purpose: hold the GitHub credentials rule (AC-034): with no credentials named, or a wrapper the repository lacks,
 *   Figentra Flow refuses and never runs the caller's own `gh`; a named wrapper runs `pnpm <script> -- api …`; `gh-user` runs
 *   `gh api …` only because the repository says so; a wrapper's leading output does not hide the JSON body.
 * Boundary: temporary folders and an injected spawn; nothing runs.
 * Runtime: node
 * Governing contract: ADR 0022; Stackra ADR 0503; STA-1729 (AC-034).
 */
// @covers sta-1729:FR-6 sta-1729:AC-034
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bodyOf, CredentialsError, github } from "../lib/github.mjs";
import { CONFIG_FILE } from "../lib/product.mjs";

/** A folder holding `package.json` with `pkg`, and the configuration file when `config` is given. */
function folder(/** @type {object} */ pkg, /** @type {object | undefined} */ config = undefined) {
  const dir = mkdtempSync(join(tmpdir(), "flow-gh-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg));
  if (config) writeFileSync(join(dir, CONFIG_FILE), JSON.stringify({ version: 1, ...config }));
  return dir;
}

/** A spawn stand-in that records each call and answers `{"ok":true}`. */
function recorder() {
  /** @type {{ command: string, args: string[] }[]} */
  const calls = [];
  /** @type {import("../lib/github.mjs").Spawn} */
  const spawn = (command, args) => {
    calls.push({ command, args });
    return { status: 0, stdout: '> pnpm noise\n{"ok":true}\n', stderr: "" };
  };
  return { calls, spawn };
}

test("credentials: none named, or a missing wrapper, is refused before anything runs", (t) => {
  for (const [pkg, config] of [
    [{}, undefined],
    [{}, {}],
    [{ vellum: { credentials: "gh-user" } }, undefined],
    [{}, { credentials: { kind: "wrapper", gh: ["pnpm", "bot:gh", "--"] } }],
    [{}, { credentials: { kind: "token" } }],
  ]) {
    const dir = folder(pkg, config);
    t.after(() => rmSync(dir, { recursive: true }));
    const { calls, spawn } = recorder();
    assert.throws(() => github(dir, { spawn }), CredentialsError);
    assert.deepEqual(calls, []);
  }
});

test("credentials: a named wrapper runs through pnpm, and gh-user runs gh only on purpose", (t) => {
  const wrapped = folder(
    { scripts: { "bot:gh": "node bot.mjs gh" } },
    { credentials: { kind: "wrapper", gh: ["pnpm", "bot:gh", "--"] } },
  );
  const solo = folder({}, { credentials: { kind: "gh-user" } });
  t.after(() => [wrapped, solo].forEach((d) => rmSync(d, { recursive: true })));
  const a = recorder();
  assert.deepEqual(github(wrapped, { spawn: a.spawn })("GET", "/repos/o/r"), {
    ok: true,
    json: { ok: true },
    err: "",
  });
  assert.equal(a.calls[0]?.command, "pnpm");
  assert.deepEqual(a.calls[0]?.args.slice(0, 6), [
    "bot:gh",
    "--",
    "api",
    "-X",
    "GET",
    "/repos/o/r",
  ]);
  const b = recorder();
  github(solo, { spawn: b.spawn })("DELETE", "/repos/o/r/git/refs/heads/x");
  assert.equal(b.calls[0]?.command, "gh");
  assert.deepEqual(b.calls[0]?.args.slice(0, 4), [
    "api",
    "-X",
    "DELETE",
    "/repos/o/r/git/refs/heads/x",
  ]);
});

test("body: the JSON after a wrapper's leading lines", () => {
  assert.deepEqual(bodyOf("> stackra@ bot:gh\nINF injecting\n[1,2]\n"), [1, 2]);
  assert.equal(bodyOf("no json"), undefined);
});

test("credentials: a raw call keeps the body as bytes (an artifact's zip, STA-2137)", (t) => {
  const solo = folder({}, { credentials: { kind: "gh-user" } });
  t.after(() => rmSync(solo, { recursive: true }));
  const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00]);
  /** @type {string[]} */
  const encodings = [];
  /** @type {import("../lib/github.mjs").Spawn} */
  const spawn = (_command, _args, options) => {
    encodings.push(options.encoding);
    return { status: 0, stdout: zip, stderr: Buffer.from("") };
  };
  const r = github(solo, { spawn })("GET", "/repos/o/r/actions/artifacts/9/zip", undefined, {
    raw: true,
  });
  assert.deepEqual(r, { ok: true, json: undefined, err: "", bytes: zip });
  assert.deepEqual(encodings, ["buffer"]);
});
