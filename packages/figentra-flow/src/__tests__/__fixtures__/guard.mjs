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
import { fileURLToPath } from "node:url";

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
 * @returns {import("node:child_process").SpawnSyncReturns<string>}
 */
export const runHook = (event, input, env = process.env) =>
  spawnSync(process.execPath, [ENTRY, event], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    env,
    encoding: "utf8",
  });
