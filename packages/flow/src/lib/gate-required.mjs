/**
 * Figentra Flow file contract:
 * Purpose: `requiredChecks`, the fixed check list a repository's preset makes every gate run (`gate.required` in
 *   `preset.yml`): the stackra preset's format, lint, typecheck, unit and int tests, strict gen, validate and the
 *   secret and dependency scans. A repository's own `gate.check` runs after it, so a repository can add a step but
 *   never remove one (owner, 2026-11-08: the gate becomes the required merge check).
 * Boundary: reads the preset's `preset.yml`; a folder with no configuration or a preset with no list gives none, and a
 *   list that is not strings is refused, never skipped.
 * Runtime: node
 * Governing contract: owner decision 2026-11-08 (the Testbed gate, stackra-notes testbed-gate-2026-11-08 FR-2).
 * Secrets: none.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ConfigError } from "./config.mjs";
import { presetDir } from "./flow-dir.mjs";
import { parseYaml } from "./yaml.mjs";

/**
 * The commands every gate of `root` runs first, in order; none when its preset lists none.
 * @param {string} root
 * @returns {string[]}
 * @throws {ConfigError} when the list is not a list of commands
 */
export function requiredChecks(root) {
  let dir;
  try {
    dir = presetDir(root);
  } catch {
    // no configuration or no preset here: nothing is required, as before
    return [];
  }
  const file = join(dir, "preset.yml");
  if (!existsSync(file)) return [];
  const required = parseYaml(readFileSync(file, "utf8"))?.gate?.required;
  if (required === undefined) return [];
  if (
    !Array.isArray(required) ||
    !required.every((step) => typeof step === "string" && step.trim() !== "")
  )
    throw new ConfigError(`${file}: gate.required must be a list of commands`);
  return required;
}
