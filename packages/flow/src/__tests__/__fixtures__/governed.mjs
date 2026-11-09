/**
 * Figentra Flow file contract:
 * Purpose: fixture repositories for the governance tests (STA-1945 PR 1): a temporary folder with `flow.config.json`,
 *   optionally on its own copy of the neutral preset (so a test can change the preset), and a snapshot of every file
 *   in it, to prove a command wrote nothing.
 * Boundary: test helper; writes only under the OS temp folder, and the test removes it.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945.
 */
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FLOW_ASSETS } from "../../lib/flow-dir.mjs";

/** The repository's own preset folder, a copy of the neutral preset. */
export const OWN_PRESET = "presets/ours";

/**
 * A repository with `flow.config.json`, removed after the test. With `own`, its preset is a copy of the neutral one.
 * @param {{ after: (fn: () => void) => void }} t
 * @param {{ own?: boolean, config?: Record<string, unknown>, at?: string }} [options] `at` makes it under that folder
 */
export function governed(t, { own = false, config = {}, at } = {}) {
  const root = at ?? realpathSync(mkdtempSync(join(tmpdir(), "flow-governed-")));
  mkdirSync(root, { recursive: true });
  if (!at) t.after(() => rmSync(root, { recursive: true, force: true }));
  if (own)
    cpSync(join(FLOW_ASSETS, "presets", "neutral"), join(root, OWN_PRESET), { recursive: true });
  writeFileSync(
    join(root, "flow.config.json"),
    // The opt-in surfaces on, as before they were opt-in; a test of the default sets its own `surfaces`.
    JSON.stringify({
      version: 1,
      preset: own ? OWN_PRESET : "neutral",
      surfaces: { settings: true, lefthook: true, opencode: true },
      ...config,
    }),
  );
  return root;
}

/**
 * Every file under `root`, path to text, to compare before and after a command.
 * @param {string} root
 * @returns {Record<string, string>}
 */
export function snapshot(root) {
  return Object.fromEntries(
    readdirSync(root, { recursive: true, encoding: "utf8" })
      .filter((p) => statSync(join(root, p)).isFile())
      .toSorted()
      .map((p) => [p, readFileSync(join(root, p), "utf8")]),
  );
}

/**
 * Changes one file of the repository's own preset, as a newer Flow's preset would differ.
 * @param {string} root
 */
export function changePreset(root) {
  const file = join(root, OWN_PRESET, "commands", "flow-plan.md");
  writeFileSync(file, `${readFileSync(file, "utf8")}\nA newer step.\n`);
}
