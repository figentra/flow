/**
 * Figentra Flow file contract:
 * Purpose: hold `lefthook.yml` and the `mise.toml` pins to STA-1945 AC-8, running each rendered job under `sh` as
 *   lefthook would, with stub `mise`, `pnpm` and `commitlint` on PATH: oxfmt and oxlint run mise first and `pnpm exec`
 *   only without mise; oxfmt's exit 2 passes and any other failure fails; oxlint skips when its config extends
 *   `@stackra/oxlint-config` and no install has it; commitlint skips when not installed; a pre-push job passes on the
 *   registry's 401 alone and a non-401 failure blocks; the configuration's jobs follow the preset's. `pinTools`
 *   changes or adds only the two pins; `catalogPins` reads the catalog's versions. The rendered YAML reads back.
 * Boundary: temporary folders and `sh`; no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945; Stackra STA-1865; os#112.
 */
// @covers sta-1945:FR-7 sta-1945:AC-8 sta-1945:P-011
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FLOW_ASSETS } from "../lib/flow-dir.mjs";
import {
  catalogPins,
  LEFTHOOK_FILE,
  pinTools,
  renderLefthook,
  skipOnRegistry401,
} from "../lib/render-lefthook.mjs";
import { parseYaml, stringifyYaml } from "../lib/yaml.mjs";

const STACKRA = join(FLOW_ASSETS, "presets/stackra");
const NEUTRAL = join(FLOW_ASSETS, "presets/neutral");

/** A stub tool: prints its name and arguments, then `$STUB_OUT`, and exits `$STUB_EXIT`. */
const STUB =
  '#!/bin/sh\necho "$(basename "$0") $*"\n[ -n "$STUB_OUT" ] && echo "$STUB_OUT"\nexit "${STUB_EXIT:-0}"\n';

/**
 * A repository folder and two stub folders: `withMise` holds mise and pnpm, `noMise` pnpm only.
 * @param {{ after: (fn: () => void) => void }} t
 */
function fixture(t) {
  const top = mkdtempSync(join(tmpdir(), "flow-lefthook-"));
  t.after(() => rmSync(top, { recursive: true, force: true }));
  const stubs = (/** @type {string} */ name, /** @type {string[]} */ tools) => {
    const dir = join(top, name);
    mkdirSync(dir);
    for (const tool of tools) {
      writeFileSync(join(dir, tool), STUB);
      chmodSync(join(dir, tool), 0o755);
    }
    return dir;
  };
  const root = join(top, "repo");
  mkdirSync(root);
  return {
    root,
    withMise: stubs("with-mise", ["mise", "pnpm"]),
    noMise: stubs("no-mise", ["pnpm"]),
  };
}

/**
 * The rendered hooks, parsed.
 * @param {Record<string, any>} [config]
 * @param {string} [presetDir]
 */
function hooks(config = {}, presetDir = STACKRA) {
  const text = renderLefthook({ root: "/repo", config, presetDir }).get(LEFTHOOK_FILE) ?? "";
  return parseYaml(text);
}

/**
 * The `run` of the job `name` under `hook`.
 * @param {Record<string, any>} parsed
 * @param {string} hook
 * @param {string} name
 * @returns {string}
 */
const runOf = (parsed, hook, name) =>
  parsed[hook].jobs.find((/** @type {{ name: string }} */ j) => j.name === name).run;

/**
 * Runs a job's command as lefthook does (`sh -c`, placeholders filled) in `cwd` with `bin` first on PATH.
 * @param {string} run
 * @param {string} cwd
 * @param {string} bin
 * @param {Record<string, string>} [env]
 */
function runJob(run, cwd, bin, env = {}) {
  const command = run.replaceAll("{staged_files}", "a.mjs").replaceAll("{1}", "MSG");
  return spawnSync("sh", ["-c", command], {
    cwd,
    encoding: "utf8",
    env: { PATH: `${bin}:/bin:/usr/bin`, ...env },
  });
}

test("oxfmt runs the mise-pinned binary first, pnpm exec only without mise, and exit 2 passes", (t) => {
  const { root, withMise, noMise } = fixture(t);
  const run = runOf(hooks(), "pre-commit", "oxfmt");
  let r = runJob(run, root, withMise);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), "mise exec -- oxfmt --check a.mjs");
  r = runJob(run, root, noMise);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), "pnpm exec oxfmt --check a.mjs");
  assert.equal(runJob(run, root, withMise, { STUB_EXIT: "2" }).status, 0, "all files ignored");
  assert.equal(runJob(run, root, withMise, { STUB_EXIT: "1" }).status, 1, "a finding fails");
});

test("oxlint runs mise first, and skips only when its config extends @stackra/oxlint-config with no install", (t) => {
  const { root, withMise, noMise } = fixture(t);
  const run = runOf(hooks(), "pre-commit", "oxlint");
  assert.equal(runJob(run, root, withMise).stdout.trim(), "mise exec -- oxlint a.mjs");
  assert.equal(runJob(run, root, noMise).stdout.trim(), "pnpm exec oxlint a.mjs");
  assert.equal(runJob(run, root, withMise, { STUB_EXIT: "1" }).status, 1);
  writeFileSync(join(root, ".oxlintrc.json"), '{ "extends": ["@stackra/oxlint-config"] }\n');
  const skipped = runJob(run, root, withMise, { STUB_EXIT: "1" });
  assert.equal(skipped.status, 0);
  assert.match(skipped.stdout, /^oxlint skipped: .*CI lints this commit\n$/);
  mkdirSync(join(root, "node_modules/@stackra/oxlint-config"), { recursive: true });
  assert.equal(runJob(run, root, withMise).stdout.trim(), "mise exec -- oxlint a.mjs");
});

test("commitlint skips without node_modules/.bin/commitlint and fails on its finding with it", (t) => {
  const { root, withMise } = fixture(t);
  const run = runOf(hooks(), "commit-msg", "commitlint");
  const skipped = runJob(run, root, withMise);
  assert.equal(skipped.status, 0);
  assert.match(skipped.stdout, /commitlint not installed/);
  mkdirSync(join(root, "node_modules/.bin"), { recursive: true });
  writeFileSync(join(root, "node_modules/.bin/commitlint"), STUB);
  chmodSync(join(root, "node_modules/.bin/commitlint"), 0o755);
  const r = runJob(run, root, withMise, { STUB_EXIT: "1" });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /commitlint --edit MSG/);
});

test("the config's jobs follow the preset's; every pre-push job passes on the registry's 401 alone", (t) => {
  const { root, withMise } = fixture(t);
  const parsed = hooks({
    lefthook: {
      "pre-commit": [{ name: "shfmt", glob: "*.sh", run: "shfmt -d {staged_files}" }],
      "pre-push": [{ name: "typecheck", run: "pnpm typecheck" }],
    },
  });
  assert.deepEqual(
    parsed["pre-commit"].jobs.map((/** @type {{ name: string }} */ j) => j.name),
    ["oxfmt", "oxlint", "gitleaks", "shfmt"],
  );
  assert.equal(parsed["pre-commit"].parallel, true);
  assert.equal(runOf(parsed, "pre-commit", "shfmt"), "shfmt -d {staged_files}");
  assert.deepEqual(
    parsed["pre-push"].jobs.map((/** @type {{ name: string }} */ j) => j.name),
    ["spec-branch", "typecheck"],
  );
  const run = runOf(parsed, "pre-push", "typecheck");
  assert.equal(run, skipOnRegistry401("pnpm typecheck"));
  assert.equal(runJob(run, root, withMise).status, 0);
  const fetch401 = "ERR_PNPM_META_FETCH_FAIL GET https://registry.test/@x%2Fy: Unauthorized - 401";
  let r = runJob(run, root, withMise, { STUB_EXIT: "1", STUB_OUT: fetch401 });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /ERR_PNPM_META_FETCH_FAIL[^\n]*\npre-push skipped: /);
  r = runJob(run, root, withMise, {
    STUB_EXIT: "1",
    STUB_OUT: "ERR_PNPM_LOCKFILE: Lockfile failed supply-chain policy check (401)",
  });
  assert.equal(r.status, 0);
  r = runJob(run, root, withMise, {
    STUB_EXIT: "1",
    STUB_OUT: "ERR_PNPM_META_FETCH_FAIL GET https://registry.test/x: 500",
  });
  assert.equal(r.status, 1, "a non-401 fetch failure blocks");
  r = runJob(run, root, withMise, {
    STUB_EXIT: "2",
    STUB_OUT: "src/a.ts(1,1): error TS2322 (401)",
  });
  assert.equal(r.status, 2, "a type error blocks, whatever it prints");
  assert.equal(runJob(runOf(parsed, "pre-push", "spec-branch"), root, withMise).status, 0);
});

test("the neutral preset: mise first, the installed binary without mise, no stackra skip", (t) => {
  const { root, withMise } = fixture(t);
  const parsed = hooks({}, NEUTRAL);
  const oxfmt = runOf(parsed, "pre-commit", "oxfmt");
  assert.equal(runJob(oxfmt, root, withMise).stdout.trim(), "mise exec -- oxfmt --check a.mjs");
  assert.match(oxfmt, /else node_modules\/\.bin\/oxfmt --check/);
  assert.doesNotMatch(runOf(parsed, "pre-commit", "oxlint"), /@stackra/);
  assert.equal(
    renderLefthook({ root, config: {}, presetDir: root }).size,
    0,
    "no surface, no file",
  );
});

test("pinTools: rewrites a pin that differs, adds a missing one under [tools], and touches no other line", () => {
  const catalog = { oxfmt: "0.71.0", oxlint: "1.86.0" };
  const toml = [
    "#:schema https://mise.jdx.dev/schema/mise.json",
    "[tools]",
    'node = "24.22.0"',
    '"npm:oxlint" = "1.80.0" # the hooks\' linter',
    "",
    "[env]",
    'A = "1"',
    "",
  ].join("\n");
  assert.equal(
    pinTools(toml, catalog),
    [
      "#:schema https://mise.jdx.dev/schema/mise.json",
      "[tools]",
      '"npm:oxfmt" = "0.71.0"',
      'node = "24.22.0"',
      '"npm:oxlint" = "1.86.0" # the hooks\' linter',
      "",
      "[env]",
      'A = "1"',
      "",
    ].join("\n"),
  );
  const pinned = pinTools(toml, catalog);
  assert.equal(pinTools(pinned, catalog), pinned, "already pinned: unchanged");
  assert.equal(
    pinTools('[env]\nA = "1"\n', catalog),
    '[env]\nA = "1"\n\n[tools]\n"npm:oxfmt" = "0.71.0"\n"npm:oxlint" = "1.86.0"\n',
  );
  assert.equal(pinTools("", catalog), '[tools]\n"npm:oxfmt" = "0.71.0"\n"npm:oxlint" = "1.86.0"\n');
});

test("catalogPins: the catalog's oxfmt and oxlint, never another block's; undefined without both", () => {
  const workspace = [
    "packages:",
    "  - packages/*",
    "overrides:",
    "  oxfmt: 0.1.0",
    "catalogs:",
    "  # the hooks' tools",
    "  quality:",
    "    oxlint: 1.86.0",
    '    "oxfmt": "0.71.0"',
    "allowBuilds:",
    "  oxlint: true",
  ].join("\n");
  assert.deepEqual(catalogPins(workspace), { oxfmt: "0.71.0", oxlint: "1.86.0" });
  assert.equal(catalogPins("catalog:\n  oxlint: 1.86.0\n"), undefined);
  assert.equal(catalogPins("packages:\n  - a\n"), undefined);
});

test("stringifyYaml: plain data reads back unchanged, words a reader would retype quoted", () => {
  const value = {
    "01": "x",
    on: "yes",
    n: 7,
    version: "1.86.0",
    empty: "",
    text: "a\n\nb\n",
    lines: "a\n  b",
    none: [],
    nothing: {},
    jobs: [{ name: "a", glob: ["*.mjs"], run: "x\ny\n" }, "plain", "-y", "$NAME", "k: v"],
  };
  const text = stringifyYaml(value);
  assert.deepEqual(parseYaml(text), value);
  assert.match(text, /^"01": x$/m);
  assert.match(text, /^"on": "yes"$/m);
  assert.match(text, /^text: \|\n {2}a\n\n {2}b\n/m);
});
