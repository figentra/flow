/**
 * Figentra Flow file contract:
 * Purpose: hold the runner port to AC-038 and AC-036: `command` expands `{label}`, `{dir}` and `{command}` in one pass
 *   and `{flags}` into the arguments after `--`, and reports a missing program as 127; `local` runs the command in the
 *   job folder; `ssh` copies the folder to the host and runs it there, refusing a host that is not one; `--box` wins
 *   over the configuration; a config without a runner is refused and a repository with no config file keeps the
 *   testbed with a warning; `github-actions` is built from the block (its behaviour: github-actions.test).
 * Boundary: temporary folders; spawn injected for ssh and command; no network, no box.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1729 phase A (A3).
 */
// @covers sta-1729:FR-11 sta-1729:AC-036 sta-1729:AC-038
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runnerFor, runnerPort } from "../adapters/runner/index.mjs";
import { ConfigError } from "../lib/config.mjs";
import { CONFIG_FILE } from "../lib/product.mjs";

/** A spawn that records its calls and answers with `status`. */
function recorder(status = 0) {
  /** @type {{ program: string, args: string[] }[]} */
  const calls = [];
  /** @type {any} */
  const spawn = (/** @type {string} */ program, /** @type {string[]} */ args) => {
    calls.push({ program, args });
    return { status };
  };
  return { calls, spawn };
}

const JOB = {
  dir: "/tmp/job-1",
  command: "pnpm verify {dir}",
  label: "flow gate x@1",
  flags: ["--no-wait"],
};

test("command: placeholders in one pass, {flags} spread, the exit code passed through, 127 when missing", () => {
  const { calls, spawn } = recorder(3);
  const runner = runnerPort(
    { kind: "command", run: ["tb", "run", "{label}", "--in={dir}", "{command}", "{flags}"] },
    { spawn },
  );
  assert.equal(runner.wraps, false);
  assert.equal(runner.program, "tb");
  assert.equal(runner.run(JOB), 3);
  assert.deepEqual(calls, [
    {
      program: "tb",
      args: ["run", "flow gate x@1", "--in=/tmp/job-1", "pnpm verify {dir}", "--no-wait"],
    },
  ]);
  assert.equal(runnerPort({ kind: "command", run: ["x"] }).posts, "caller");
  assert.equal(runnerPort({ kind: "command", run: ["x"], secrets: true }).wraps, true);
  const missing = runnerPort({ kind: "command", run: ["fflow-no-such-program-42"] });
  assert.equal(missing.run(JOB), 127);
});

test("local: the command runs in the job folder; its exit code passes through", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "flow-local-"));
  t.after(() => rmSync(dir, { recursive: true }));
  const runner = runnerPort({ kind: "local" });
  assert.equal(runner.wraps, true);
  assert.equal(runner.run({ ...JOB, dir, command: "pwd > where.txt; exit 5" }), 5);
  assert.match(readFileSync(join(dir, "where.txt"), "utf8"), /flow-local-/);
});

test("ssh: rsync to the host, then the command there with the folder removed; a bad host is refused", () => {
  const { calls, spawn } = recorder(0);
  const runner = runnerPort({ kind: "ssh", host: "ci@box-1.example" }, { spawn });
  assert.equal(runner.wraps, true);
  assert.equal(runner.run(JOB), 0);
  assert.deepEqual(
    calls.map((c) => c.program),
    ["rsync", "ssh"],
  );
  assert.equal(calls[0].args.at(-1), "ci@box-1.example:/tmp/fflow-gate/job-1/");
  assert.match(
    calls[1].args[1],
    /^cd \/tmp\/fflow-gate\/job-1 && pnpm verify \{dir\}; code=\$\?; .*rm -rf/,
  );
  const failing = recorder(1);
  assert.equal(runnerPort({ kind: "ssh", host: "h" }, { spawn: failing.spawn }).run(JOB), 2);
  assert.equal(failing.calls.length, 1, "no ssh after a failed copy");
  assert.throws(() => runnerPort({ kind: "ssh", host: "h; rm -rf /" }), /not a host/);
});

test("runnerFor: --box wins, then the config; without a runner it refuses, config file or not (AC-045)", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "flow-runner-"));
  t.after(() => rmSync(dir, { recursive: true }));
  assert.equal(runnerFor(dir, {}, { box: "box-1" }).runner?.kind, "ssh");
  assert.match(runnerFor(dir, {}).problem ?? "", /needs "runner"/, "no testbed fallback");
  writeFileSync(join(dir, CONFIG_FILE), "{}");
  assert.match(runnerFor(dir, {}).problem ?? "", /needs "runner"/);
  assert.equal(runnerFor(dir, { runner: { kind: "local" } }).runner?.kind, "local");
  assert.equal(runnerPort({ kind: "github-actions" }).kind, "github-actions");
  assert.throws(() => runnerPort({ kind: "nope" }), ConfigError);
});
