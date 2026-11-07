/**
 * Figentra Flow file contract:
 * Purpose: hold `fflow hooks run` to its refusals and its order: a bad mode (the engine's unknown command) or stage,
 *   a folder outside git, and an invalid configuration or a broken `runner` block without the workspace install each
 *   exit 2; with the install the configuration is never read, so a broken `runner` block still lets the hooks run
 *   here, through the workspace's own lefthook and without `LEFTHOOK` or `LEFTHOOK_EXCLUDE`.
 * Boundary: the `fflow` binary in temporary repositories; lefthook faked in `node_modules/.bin`; no box, no network.
 * Runtime: node
 * Governing contract: STA-1945 (C13, PR 13).
 */
// @covers sta-1945:FR-18 sta-1945:AC-16
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CONFIG_FILE } from "../lib/product.mjs";
import { CONFIG, repo } from "./__fixtures__/repo.mjs";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "../../bin/fflow.mjs");

/** Runs `fflow …args` in `cwd`. */
const fflow = (
  /** @type {string} */ cwd,
  /** @type {string[]} */ args,
  /** @type {NodeJS.ProcessEnv} */ env = process.env,
) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8", env });

/** A `runner` block the schema takes and the runner port refuses. */
const BROKEN = { ...CONFIG, runner: { kind: "ssh", host: "not a host" } };

test("hooks command: a bad mode is an unknown command and a bad stage the usage, each exit 2", (t) => {
  const r = repo();
  t.after(r.dispose);
  // Only `hooks run` is declared, so the engine refuses `hooks` and `hooks <other mode>` before Flow runs.
  for (const args of [["hooks"], ["hooks", "start", "pre-commit"]]) {
    const out = fflow(r.root, args);
    assert.equal(out.status, 2, args.join(" "));
    assert.match(out.stdout + out.stderr, /The command "hooks" does not exist/, args.join(" "));
  }
  const stage = fflow(r.root, ["hooks", "run", "pre-rebase"]);
  assert.equal(stage.status, 2);
  assert.match(stage.stderr, /usage: fflow hooks run <pre-commit\|commit-msg\|pre-push>/);
});

test("hooks command: outside a git repository, exit 2", (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "flow-nogit-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const out = fflow(dir, ["hooks", "run", "pre-commit"], {
    ...process.env,
    GIT_CEILING_DIRECTORIES: dirname(dir),
  });
  assert.equal(out.status, 2);
  assert.match(out.stderr, /is not in a git repository/);
});

test("hooks command: without the install, an invalid configuration or runner block is exit 2", (t) => {
  const r = repo();
  t.after(r.dispose);
  writeFileSync(join(r.root, CONFIG_FILE), "{");
  const invalid = fflow(r.root, ["hooks", "run", "pre-commit"]);
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /not valid JSON/);
  writeFileSync(join(r.root, CONFIG_FILE), JSON.stringify(BROKEN));
  const broken = fflow(r.root, ["hooks", "run", "pre-commit"]);
  assert.equal(broken.status, 2);
  assert.match(broken.stderr, /host is not a host/);
});

test("hooks command: with the install, a broken runner block never stops the hooks running here", (t) => {
  const r = repo();
  t.after(r.dispose);
  writeFileSync(join(r.root, CONFIG_FILE), JSON.stringify(BROKEN));
  mkdirSync(join(r.root, "node_modules", ".bin"), { recursive: true });
  writeFileSync(join(r.root, "node_modules", ".modules.yaml"), "");
  const seen = join(r.root, "..", "seen");
  writeFileSync(
    join(r.root, "node_modules", ".bin", "lefthook"),
    `#!/bin/sh\nprintf '%s|%s|%s\\n' "\${LEFTHOOK-unset}" "\${LEFTHOOK_EXCLUDE-unset}" "$*" > "$HOOKS_OUT"\n`,
    { mode: 0o755 },
  );
  const out = fflow(r.root, ["hooks", "run", "pre-commit"], {
    ...process.env,
    LEFTHOOK: "0",
    LEFTHOOK_EXCLUDE: "lint",
    HOOKS_OUT: seen,
  });
  assert.equal(out.status, 0, out.stderr);
  assert.equal(readFileSync(seen, "utf8"), "unset|unset|run pre-commit\n");
  assert.equal(readFileSync(join(r.root, ".git", "fflow-hooks-run"), "utf8"), "Hooks-Run: local\n");
});
