/**
 * Figentra Flow file contract:
 * Purpose: hold preset packages to STA-2097 (PLAN section 9, P1): a `preset` shaped like a package name resolves to the
 *   installed package's `flow.preset` folder, the lock and the provenance header record the package's version, a
 *   package that is not installed or names no folder is a ConfigError naming the fix, a folder that leaves the package
 *   is refused, a bare folder name and a path keep working; the semver range check; the doctor's preset row and
 *   `sync` refuse a Flow outside the package's `peerDependencies` or `preset.yml` `requires.flow`; `fflow preset add`
 *   runs the lockfile's package manager and writes the config, or only prints both with `--dry-run`.
 * Boundary: temporary folders with a fake package under `node_modules/`; an injected spawn, so nothing is installed;
 *   no network.
 * Runtime: node
 * Governing contract: ADR 0022; ADR 0510; STA-2097.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendFileSync,
  cpSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { presetRow, rowsOf } from "../commands/doctor.mjs";
import { presetId } from "../commands/gate.mjs";
import { add, installCommand } from "../commands/preset.mjs";
import { sync } from "../commands/sync.mjs";
import { ConfigError } from "../lib/config.mjs";
import { FLOW_ASSETS, presetDir, presetSource } from "../lib/flow-dir.mjs";
import { readLock, treeDigest } from "../lib/lock.mjs";
import { isPackageName, satisfies } from "../lib/preset-package.mjs";
import { CONFIG_FILE, PACKAGE, VERSION } from "../lib/product.mjs";
import { governed } from "./__fixtures__/governed.mjs";

const PKG = "@x/flow-preset";
const quiet = { log: () => {} };

/**
 * Installs a fake preset package `PKG` into `root`'s node_modules: a copy of the neutral preset under `preset/`.
 * @param {string} root
 * @param {Record<string, unknown>} [manifest] merged into its package.json
 */
function installFake(root, manifest = {}) {
  const dir = join(root, "node_modules", PKG);
  cpSync(join(FLOW_ASSETS, "presets", "neutral"), join(dir, "preset"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: PKG, version: "1.4.0", flow: { preset: "./preset" }, ...manifest }),
  );
  return dir;
}

test("preset package: a package name resolves to its flow.preset folder at the package's version", (t) => {
  const root = governed(t, { config: { preset: PKG } });
  const dir = installFake(root);
  assert.equal(presetDir(root), join(dir, "preset"));
  assert.deepEqual(presetSource(root), {
    name: PKG,
    dir: join(dir, "preset"),
    version: "1.4.0",
  });
  // The gate's rules come from the package's preset.yml id.
  assert.equal(presetId(PKG, root), "neutral");
});

test("preset package: sync records the package's name, version and digest; the header names them", (t) => {
  const root = governed(t, { config: { preset: PKG } });
  const dir = installFake(root, { peerDependencies: { [PACKAGE]: `>=0.1.0 <99` } });
  sync(root, quiet);
  const lock = readLock(root);
  assert.equal(lock?.flow, VERSION);
  assert.deepEqual(lock?.preset, {
    name: PKG,
    version: "1.4.0",
    digest: treeDigest(join(dir, "preset")),
  });
  const plan = readFileSync(join(root, ".agents/skills/flow-plan/SKILL.md"), "utf8");
  assert.match(plan, /from the @x\/flow-preset preset 1\.4\.0/);
});

test("preset package: not installed, or no flow.preset, is a ConfigError naming the fix", (t) => {
  const root = governed(t, { config: { preset: "@x/missing" } });
  assert.throws(
    () => presetDir(root),
    (e) =>
      e instanceof ConfigError &&
      /@x\/missing is not installed .*run `fflow preset add @x\/missing`/.test(e.message),
  );
  writeFileSync(join(root, CONFIG_FILE), JSON.stringify({ version: 1, preset: PKG }));
  installFake(root, { flow: undefined });
  assert.throws(() => presetDir(root), /has no "flow": \{ "preset": "\.\/preset" \}/);
});

test("preset package: a preset folder outside the package is refused, by .. or by a link", (t) => {
  const root = governed(t, { config: { preset: PKG } });
  mkdirSync(join(root, "elsewhere"));
  installFake(root, { flow: { preset: "../../../elsewhere" } });
  assert.throws(() => presetDir(root), /outside the package/);
  const dir = installFake(root, { flow: { preset: "./linked" } });
  symlinkSync(join(root, "elsewhere"), join(dir, "linked"));
  assert.throws(() => presetDir(root), /outside the package/);
});

test("preset package: a bare folder name and a path keep resolving as folders", (t) => {
  const root = governed(t, { config: { preset: "ours" } });
  mkdirSync(join(root, "ours"));
  assert.equal(presetDir(root), join(root, "ours"));
  writeFileSync(join(root, CONFIG_FILE), JSON.stringify({ version: 1, preset: "./presets/x" }));
  assert.equal(presetDir(root), join(root, "presets/x"));
  assert.equal(isPackageName("./presets/x"), false);
  assert.equal(isPackageName("@x/../y"), false);
  assert.equal(isPackageName("../evil"), false);
  assert.equal(isPackageName("@acme/flow-preset"), true);
});

test("preset package: the semver range check", () => {
  /** @type {[string, string, boolean][]} */
  const cases = [
    ["1.2.3", "*", true],
    ["1.2.3", "", true],
    ["1.2.3", "1.2.3", true],
    ["1.2.4", "1.2.3", false],
    ["1.2.4", "=1.2.4", true],
    ["1.9.0", "^1.2.3", true],
    ["2.0.0", "^1.2.3", false],
    ["1.2.2", "^1.2.3", false],
    ["0.3.5", "^0.3.0", true],
    ["0.4.0", "^0.3.0", false],
    ["0.0.3", "^0.0.3", true],
    ["0.0.4", "^0.0.3", false],
    ["0.9.0", "^0", true],
    ["1.2.9", "~1.2.3", true],
    ["1.3.0", "~1.2.3", false],
    ["1.9.9", "~1", true],
    ["2.0.0", "~1", false],
    ["0.3.9", ">=0.3.0 <0.4.0", true],
    ["0.4.0", ">=0.3.0 <0.4.0", false],
    ["0.3.0", ">= 0.3.0", true],
    ["1.2.9", "<=1.2", true],
    ["1.3.0", "<=1.2", false],
    ["1.2.9", ">1.2", false],
    ["1.3.0", ">1.2", true],
    ["1.2.4", ">1.2.3", true],
    ["1.2.3", ">1.2.3", false],
    ["1.2.3", "<=1.2.3", true],
    ["0.9.9", "<1", true],
    ["1.5.0", "1.x", true],
    ["2.0.0", "1.x", false],
    ["2.1.0", "^1 || ^2", true],
    ["3.0.0", "^1 || ^2", false],
    ["v1.0.0", ">=1", true],
    ["0.4.0-rc.1", "^0.4.0", false],
    ["0.4.0-rc.1", ">=0.4.0-rc.0", true],
    ["0.4.0", ">=0.4.0-rc.0", true],
    ["1.0.0", "latest", false],
    ["nope", "*", false],
  ];
  for (const [version, range, want] of cases)
    assert.equal(satisfies(version, range), want, `${version} in "${range}"`);
});

test("preset package: doctor's preset row passes, then fails with the fix outside either range", (t) => {
  const root = governed(t, { config: { preset: PKG } });
  installFake(root, { peerDependencies: { [PACKAGE]: "*" } });
  const ok = presetRow(root);
  assert.deepEqual(ok, { id: "preset", ok: true, detail: `${PKG} 1.4.0` });
  assert.equal(rowsOf([ok])[0].group, "Flow");

  installFake(root, { peerDependencies: { [PACKAGE]: ">=99" } });
  const peer = presetRow(root);
  assert.equal(peer.ok, false);
  assert.match(peer.detail, /needs @figentra-oss\/flow >=99 \(its peerDependencies/);
  assert.match(peer.fix ?? "", /install a @x\/flow-preset that supports/);

  const dir = installFake(root);
  appendFileSync(join(dir, "preset", "preset.yml"), '\nrequires:\n  flow: ">=99.0.0"\n');
  const requires = presetRow(root);
  assert.equal(requires.ok, false);
  assert.match(
    requires.detail,
    /needs @figentra-oss\/flow >=99\.0\.0 \(its preset\.yml requires\.flow\)/,
  );

  writeFileSync(join(root, CONFIG_FILE), JSON.stringify({ version: 1, preset: "@x/missing" }));
  const missing = presetRow(root);
  assert.equal(missing.ok, false);
  assert.match(missing.fix ?? "", /fflow preset add @x\/missing/);
});

test("preset package: sync refuses a preset outside its Flow range, writing no lock", (t) => {
  const root = governed(t, { config: { preset: PKG } });
  installFake(root, { peerDependencies: { [PACKAGE]: "^99.0.0" } });
  assert.throws(
    () => sync(root, quiet),
    (e) => e instanceof ConfigError && /needs @figentra-oss\/flow \^99\.0\.0/.test(e.message),
  );
  assert.equal(readLock(root), undefined);
});

/** A console Io that keeps its lines. */
function io() {
  /** @type {string[]} */
  const lines = [];
  const keep = (/** @type {string} */ s) => void lines.push(s);
  return {
    lines,
    io: /** @type {any} */ ({ output: { line: keep, success: keep, info: keep, error: keep } }),
  };
}

/** A spawn that records its calls and exits `status`. */
function spawner(status = 0) {
  /** @type {{ bin: string, args: string[], cwd: string }[]} */
  const calls = [];
  return {
    calls,
    spawn: (/** @type {string} */ bin, /** @type {string[]} */ args, /** @type {any} */ o) => {
      calls.push({ bin, args, cwd: o.cwd });
      return { status };
    },
  };
}

test("preset add: each lockfile's package manager, then the config line, keeping the rest", (t) => {
  /** @type {[string, string, string[]][]} */
  const managers = [
    ["pnpm-lock.yaml", "pnpm", ["add", "-D", PKG]],
    ["package-lock.json", "npm", ["install", "-D", PKG]],
    ["yarn.lock", "yarn", ["add", "-D", PKG]],
  ];
  for (const [lockfile, bin, args] of managers) {
    const root = governed(t, { config: { specs: { dir: "docs/specs" }, surfaces: undefined } });
    writeFileSync(join(root, lockfile), "");
    const s = spawner();
    const out = io();
    assert.equal(add(out.io, root, { pkg: PKG }, s.spawn), 0, lockfile);
    assert.deepEqual(s.calls, [{ bin, args, cwd: root }], lockfile);
    assert.deepEqual(JSON.parse(readFileSync(join(root, CONFIG_FILE), "utf8")), {
      version: 1,
      preset: PKG,
      specs: { dir: "docs/specs" },
    });
    assert.match(out.lines.join("\n"), /run `fflow sync`/);
  }
});

test("preset add: pnpm without a lockfile, -w at a pnpm workspace root, a starter config when none", (t) => {
  const root = governed(t);
  assert.deepEqual(installCommand(root, PKG), { bin: "pnpm", args: ["add", "-D", PKG] });
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");
  assert.deepEqual(installCommand(root, PKG), { bin: "pnpm", args: ["add", "-D", "-w", PKG] });

  // A repository without a config gets the starter config plus the preset.
  const fresh = join(root, "fresh");
  mkdirSync(fresh);
  assert.equal(add(io().io, fresh, { pkg: PKG }, spawner().spawn), 0);
  const written = JSON.parse(readFileSync(join(fresh, CONFIG_FILE), "utf8"));
  assert.equal(written.version, 1);
  assert.equal(written.preset, PKG);
});

test("preset add: --dry-run prints the command and the change and runs nothing", (t) => {
  const root = governed(t);
  writeFileSync(join(root, "package-lock.json"), "");
  const before = readFileSync(join(root, CONFIG_FILE), "utf8");
  const s = spawner();
  const out = io();
  assert.equal(add(out.io, root, { pkg: PKG, dryRun: true }, s.spawn), 0);
  assert.deepEqual(s.calls, []);
  assert.equal(readFileSync(join(root, CONFIG_FILE), "utf8"), before);
  assert.match(out.lines.join("\n"), /would run: npm install -D @x\/flow-preset/);
  assert.match(out.lines.join("\n"), /would set "preset": "@x\/flow-preset"/);
});

test("preset add: refuses a name that is not a package, and keeps the config when the install fails", (t) => {
  const root = governed(t);
  const before = readFileSync(join(root, CONFIG_FILE), "utf8");
  for (const pkg of ["../evil", "--registry=x", "a b", "@x/../y"]) {
    const s = spawner();
    assert.throws(() => add(io().io, root, { pkg }, s.spawn), ConfigError, pkg);
    assert.deepEqual(s.calls, [], pkg);
  }
  const out = io();
  assert.equal(add(out.io, root, { pkg: PKG }, spawner(1).spawn), 1);
  assert.equal(readFileSync(join(root, CONFIG_FILE), "utf8"), before);
  assert.match(out.lines.join("\n"), /exited 1; flow\.config\.json is unchanged/);
});
