/**
 * Vellum file contract:
 * Purpose: `vellum init [--force]` — install `.specify/` (spec-kit's folder, with the Stackra preset in
 *   `.specify/presets/stackra`) into the current repository from the copy bundled in this package, and start the
 *   repository's constitution from spec-kit's template (the constitution is the repository's own).
 * Boundary: writes only `.specify/`; refuses an existing `.specify/` unless `--force`.
 * Runtime: node
 * Governing contract: ADR 0120; ADR 0121.
 * Secrets: none.
 */
import { chmodSync, copyFileSync, cpSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ASSETS } from "./sync.mjs";

export function init(root, { force = false } = {}) {
  const target = join(root, ".specify");
  if (existsSync(target) && !force) return false;
  cpSync(join(ASSETS, "specify"), target, { recursive: true, force: true });
  const constitution = join(target, "memory/constitution.md");
  if (!existsSync(constitution))
    copyFileSync(join(target, "templates/constitution-template.md"), constitution);
  const bash = join(target, "scripts/bash");
  for (const f of readdirSync(bash)) if (f.endsWith(".sh")) chmodSync(join(bash, f), 0o755);
  return true;
}

export function run(args) {
  if (!init(process.cwd(), { force: args.includes("--force") })) {
    console.error("vellum init: .specify/ already exists (pass --force to overwrite)");
    return 1;
  }
  console.log("vellum init: installed .specify/ with the Stackra preset; next, `vellum sync`");
  return 0;
}
