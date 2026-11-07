/**
 * Figentra Flow file contract:
 * Purpose: hold the bundled presets' guard files to what a preset package can import (STA-2097, PLAN section 9 P2):
 *   every module specifier in `assets/flow/presets/<preset>/guard/*.mjs` (imports, re-exports and JSDoc
 *   `import("…")` types) is a Node built-in, a file of the same preset folder, or a public export of the package;
 *   and every export's `types` mirrors its `default` under `dist/`.
 * Boundary: reads the package's files; no process, no network.
 * Runtime: node
 * Governing contract: ADR 0510; STA-2097.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { FLOW_ASSETS } from "../lib/flow-dir.mjs";
import { PACKAGE } from "../lib/product.mjs";

const PACKAGE_DIR = fileURLToPath(new URL("../..", import.meta.url));
const EXPORTS = JSON.parse(readFileSync(join(PACKAGE_DIR, "package.json"), "utf8")).exports;
const PRESETS = join(FLOW_ASSETS, "presets");

/**
 * Every module specifier in `code`: `import … from`, `export … from`, a bare `import "…"`, and `import("…")`.
 * @param {string} code
 */
const specifiers = (code) =>
  [
    ...code.matchAll(/^\s*(?:import|export)\b[^'"`;]*?\bfrom\s*["']([^"']+)["']/gm),
    ...code.matchAll(/^\s*import\s*["']([^"']+)["']/gm),
    ...code.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g),
  ].map((m) => m[1]);

/**
 * Why `spec`, imported by `file` of the preset folder `preset`, is not importable from a preset package, or undefined.
 * @param {string} spec
 * @param {string} file
 * @param {string} preset
 */
function refusal(spec, file, preset) {
  if (spec.startsWith("node:")) return undefined;
  if (spec.startsWith(".")) {
    const target = resolve(dirname(file), spec);
    if (/^\.\.(\/|\\|$)/.test(relative(preset, target))) return "leaves the preset folder";
    return existsSync(target) ? undefined : "is missing";
  }
  if (spec === PACKAGE || spec.startsWith(`${PACKAGE}/`)) {
    const key = `.${spec.slice(PACKAGE.length)}`;
    return EXPORTS[key] ? undefined : `is not in ${PACKAGE}'s exports`;
  }
  return "is neither node:*, a file of the preset, nor a public export";
}

test("guard exports: a bundled preset's guard files import only node:*, their preset, or a public export", () => {
  let viaPackage = 0;
  for (const name of readdirSync(PRESETS)) {
    const guard = join(PRESETS, name, "guard");
    if (!existsSync(guard)) continue;
    for (const f of readdirSync(guard).filter((n) => n.endsWith(".mjs"))) {
      const file = join(guard, f);
      for (const spec of specifiers(readFileSync(file, "utf8"))) {
        const why = refusal(spec, file, join(PRESETS, name));
        assert.equal(why, undefined, `${name}/guard/${f} imports ${spec}, which ${why}`);
        if (spec.startsWith(`${PACKAGE}/`)) viaPackage += 1;
      }
    }
  }
  // The scan read something: the bundled presets do import Flow through its exports.
  assert.ok(viaPackage > 0);
});

test("guard exports: the guard entry points exist and every export's types mirror its default under dist/", () => {
  assert.ok(EXPORTS["./guard"] && EXPORTS["./guard/neutral"]);
  for (const [key, value] of Object.entries(EXPORTS)) {
    if (typeof value === "string") continue;
    assert.ok(existsSync(join(PACKAGE_DIR, value.default)), `${key}: ${value.default} is missing`);
    assert.equal(
      value.types,
      value.default.replace(/^\.\//, "./dist/").replace(/\.mjs$/, ".d.mts"),
      key,
    );
  }
});

test("guard exports: the entry points load through the package name", async () => {
  const guard = await import(`${PACKAGE}/guard`);
  assert.equal(typeof guard.collectStrings, "function");
  const neutral = await import(`${PACKAGE}/guard/neutral`);
  assert.ok(Array.isArray(neutral.PATH_RULES) && Array.isArray(neutral.BASH_RULES));
  assert.equal(typeof neutral.isSecretPath, "function");
});
