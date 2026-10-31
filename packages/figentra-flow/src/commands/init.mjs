/**
 * Figentra Flow file contract:
 * Purpose: `figentra-flow init [--force]` — install `.specify/` (spec-kit's folder, with the Stackra preset in
 *   `.specify/presets/stackra`) into the current repository from the copy bundled in this package, and start the
 *   repository's constitution from spec-kit's template (the constitution is the repository's own).
 *   `figentra-flow init --workspace <dir>…` writes the workspace list instead: every git repository in or directly under
 *   those folders, with its GitHub slug (STA-1729).
 * Boundary: writes only `.specify/`; refuses an existing `.specify/` unless `--force`. `--workspace` writes only the
 *   workspace file (`~/.config/figentra-flow/workspace.yaml`, or `FIGENTRA_FLOW_WORKSPACE`).
 * Runtime: node
 * Governing contract: ADR 0120; ADR 0121.
 * Secrets: none.
 */
import { chmodSync, copyFileSync, cpSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { ASSETS } from "./sync.mjs";
import { findRepos, workspaceFile, writeWorkspace } from "../lib/workspace.mjs";
import { NAME } from "../lib/product.mjs";

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
  const at = args.indexOf("--workspace");
  if (at >= 0) {
    const dirs = args.slice(at + 1).filter((a) => !a.startsWith("--"));
    if (dirs.length === 0) {
      console.error(`usage: ${NAME} init --workspace <dir>…`);
      return 2;
    }
    const repos = findRepos(dirs.map((d) => resolve(d)));
    writeWorkspace(repos);
    console.log(`${NAME} init: wrote ${repos.length} repositories to ${workspaceFile()}`);
    return 0;
  }
  if (!init(process.cwd(), { force: args.includes("--force") })) {
    console.error(`${NAME} init: .specify/ already exists (pass --force to overwrite)`);
    return 1;
  }
  console.log(`${NAME} init: installed .specify/ with the Stackra preset; next, \`${NAME} sync\``);
  return 0;
}
