/**
 * Figentra Flow file contract:
 * Purpose: `figentra-flow init [--force]` — install `.specify/` (spec-kit's folder, with the Stackra preset in
 *   `.specify/presets/stackra`) into the current repository from the copy bundled in this package, and start the
 *   repository's constitution from spec-kit's template (the constitution is the repository's own).
 *   `figentra-flow init --workspace <dir>…` writes the workspace list instead: every git repository in or directly under
 *   those folders, with its GitHub slug (STA-1729).
 * Boundary: writes only `.specify/`; refuses an existing `.specify/` unless `--force`. `--workspace` writes only the
 *   workspace file (`~/.config/figentra-flow/workspace.yaml`, or `FIGENTRA_FLOW_WORKSPACE`).
 *   `figentra-flow init --runner github-actions [--force]` writes only the gate workflow
 *   (`.github/workflows/figentra-flow-gate.yml`) and, when the repository has no config file, a starter one naming
 *   that runner; it refuses an existing workflow unless `--force` and never edits an existing config file.
 * Runtime: node
 * Governing contract: ADR 0120; ADR 0121.
 * Secrets: none.
 */
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { GATE_WORKFLOW } from "../adapters/runner/github-actions.mjs";
import { loadConfig } from "../lib/config.mjs";
import { gateWorkflow } from "../lib/gate-workflow.mjs";
import { ASSETS } from "./sync.mjs";
import { findRepos, workspaceFile, writeWorkspace } from "../lib/workspace.mjs";
import { CONFIG_FILE, ENV_PREFIX, NAME, PACKAGE, VERSION } from "../lib/product.mjs";

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

/**
 * Writes the gate workflow for the `github-actions` runner, and a starter config when there is none.
 * @param {string} root
 * @param {{ force?: boolean, version?: string }} [options]
 * @returns {{ problem?: string, lines: string[] }}
 */
export function initGithubActions(root, { force = false, version = VERSION } = {}) {
  const file = join(root, ".github/workflows", GATE_WORKFLOW);
  if (existsSync(file) && !force)
    return {
      problem: `.github/workflows/${GATE_WORKFLOW} already exists (pass --force to overwrite)`,
      lines: [],
    };
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  writeFileSync(file, gateWorkflow({ version }));
  const lines = [`wrote .github/workflows/${GATE_WORKFLOW}`];
  if (!existsSync(join(root, CONFIG_FILE))) {
    const starter = {
      $schema: `./node_modules/${PACKAGE}/schema/${CONFIG_FILE.replace(".json", ".schema.json")}`,
      version: 1,
      runner: { kind: "github-actions" },
    };
    writeFileSync(join(root, CONFIG_FILE), `${JSON.stringify(starter, null, 2)}\n`);
    lines.push(`wrote ${CONFIG_FILE} with the github-actions runner`);
  } else if (loadConfig(root).config.runner?.kind !== "github-actions") {
    lines.push(`set "runner": { "kind": "github-actions" } in ${CONFIG_FILE}`);
  }
  lines.push(
    `set the repository secrets ${ENV_PREFIX}GATE_APP_ID and ${ENV_PREFIX}GATE_PRIVATE_KEY (the gate App), and "apps.gate" in ${CONFIG_FILE}`,
  );
  return { lines };
}

export function run(args) {
  const runner = args.indexOf("--runner");
  if (runner >= 0) {
    if (args[runner + 1] !== "github-actions") {
      console.error(
        `usage: ${NAME} init --runner github-actions [--force] (the other runners need no files)`,
      );
      return 2;
    }
    const result = initGithubActions(process.cwd(), { force: args.includes("--force") });
    if (result.problem) {
      console.error(`${NAME} init: ${result.problem}`);
      return 1;
    }
    for (const line of result.lines) console.log(`${NAME} init: ${line}`);
    return 0;
  }
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
