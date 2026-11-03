/**
 * Figentra Flow file contract:
 * Purpose: the guard tests' harness, standing in for core's `spawnSync("node", [hook])`: the hook entry run as a
 *   child process for one event, and a folder whose configuration names a preset, so the entry loads that preset's
 *   tables (`CLAUDE_PROJECT_DIR`).
 * Boundary: test helper; writes only under the OS temp folder, and the caller removes it.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { FLOW_ASSETS } from "../../lib/flow-dir.mjs";
import { CONFIG_FILE } from "../../lib/product.mjs";
import { CONFIG } from "./repo.mjs";

/** The hook entry, `bin/fflow-guard.mjs`. */
export const ENTRY = fileURLToPath(new URL("../../../bin/fflow-guard.mjs", import.meta.url));

/**
 * A temporary folder whose configuration names `preset` (with the fixture's tracker).
 * @param {string} [preset]
 */
export function presetRoot(preset = "stackra") {
  const root = realpathSync(mkdtempSync(join(tmpdir(), `flow-guard-${preset}-`)));
  writeFileSync(join(root, CONFIG_FILE), JSON.stringify({ ...CONFIG, preset }));
  return root;
}

/**
 * Runs the hook entry for `event` on `input` (a payload, or raw stdin text).
 * @param {string} event
 * @param {Record<string, unknown> | string} input
 * @param {Record<string, string | undefined>} [env] the child's environment
 * @param {string} [cwd] the child's folder
 * @returns {import("node:child_process").SpawnSyncReturns<string>}
 */
export const runHook = (event, input, env = process.env, cwd = undefined) =>
  spawnSync(process.execPath, [ENTRY, event], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    env,
    cwd,
    encoding: "utf8",
  });

/**
 * A module of the stackra preset's `guard/` folder, loaded as the engine loads it (by URL, so the type checker
 * leaves core's moved code alone).
 * @param {string} file e.g. `bash-rules.mjs`
 * @returns {Promise<any>}
 */
export const stackraGuard = (file) =>
  import(pathToFileURL(join(FLOW_ASSETS, "presets", "stackra", "guard", file)).href);
