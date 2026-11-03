/**
 * Figentra Flow file contract:
 * Purpose: `fflow init [--force]` — install `.flow/` (ADR 0510: README, a starter `constitution.md`,
 *   `.gitignore`) into the current repository, write a starter `flow.config.json` when it has none (FR-31), and
 *   render the `flow-*` skills with `sync`, naming what it rendered (the constitution and the configuration are the
 *   repository's own and are never overwritten).
 *   `fflow init --workspace <dir>…` writes the workspace list instead: every git repository in or directly under
 *   those folders, with its GitHub slug (STA-1729).
 * Boundary: writes only `.flow/`, a missing config file, what `sync` renders and `.claude/worktrees/README.md`
 *   (STA-1871); refuses an existing
 *   `.flow/` unless `--force`. `--workspace` writes only the
 *   workspace file (`~/.config/fflow/workspace.yaml`, or `FFLOW_WORKSPACE`).
 *   `fflow init --runner github-actions [--force]` writes only the gate workflow
 *   (`.github/workflows/fflow-gate.yml`) and, when the repository has no config file, a starter one naming
 *   that runner; it refuses an existing workflow unless `--force` and never edits an existing config file.
 * Runtime: node
 * Governing contract: ADR 0120; ADR 0121.
 * Secrets: none.
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { GATE_WORKFLOW } from "../adapters/runner/github-actions.mjs";
import { loadConfig } from "../lib/config.mjs";
import { gateWorkflow } from "../lib/gate-workflow.mjs";
import { ignoreWorktrees, writeWorktreesReadme } from "./clean.mjs";
import { hasProjector, sync } from "./sync.mjs";
import { CONSTITUTION, FLOW_DIR, resolveTemplate } from "../lib/flow-dir.mjs";
import { git } from "../lib/git.mjs";
import { findRepos, workspaceFile, writeWorkspace } from "../lib/workspace.mjs";
import { CONFIG_FILE, ENV_PREFIX, NAME, PACKAGE, VERSION } from "../lib/product.mjs";

/** What `.flow/README.md` says. */
const README = `# .flow

This folder belongs to Figentra Flow (\`${NAME}\`, ADR 0510). Do not hand-edit what it generates.

- \`constitution.md\`: the repository's principles; the \`flow-*\` commands read it.
- \`overrides/\`: optional and owner-only. \`<surface>/<id>.yml\` overrides what \`${NAME} sync\` renders (\`extend\`,
  \`configure\`, \`replace\` or \`disable\`; \`${NAME} validate\` checks them). A template (\`overrides/<name>.md\`) or a
  command (\`overrides/commands/flow-<verb>.md\`) here still wins over the preset until it gets its \`.yml\`.
- \`lock.json\`: what \`${NAME} sync\` rendered; \`${NAME} gate ci\` fails when a rendered file is edited by hand.
- \`current.json\`: the spec folder \`${NAME} gate dir\` chose (git-ignored).
`;

/**
 * Installs `.flow/` into `root` (README, a starter constitution from the template, `.gitignore`), makes the
 * repository's `.gitignore` ignore `.claude/worktrees/` (FR-3), and renders the
 * \`flow-*\` skills: through the repository's projector when its package.json has \`agents:sync\`, else directly.
 * Refuses an installed `.flow/` (its README) unless `force`; an existing constitution is always kept. With `config`,
 * a repository with no config file first gets the starter one (FR-31), so `sync` and `doctor` read it.
 * @param {string} root
 * @param {{ force?: boolean, config?: boolean, log?: (s: string) => void }} [options]
 */
export function init(root, { force = false, config = false, log = () => {} } = {}) {
  // `.flow/readme.yml` alone is not an install (STA-1879): `init` writes `.flow/README.md`.
  if (existsSync(join(root, FLOW_DIR, "README.md")) && !force) return false;
  if (config && writeStarterConfig(root))
    log(`${NAME} init: wrote ${CONFIG_FILE}; the defaults apply`);
  writeFlowDir(root);
  ignoreWorktrees(root);
  writeWorktreesReadme(root);
  sync(root, { direct: !hasProjector(root), log });
  return true;
}

/**
 * Writes `.flow/`'s README and `.gitignore`, and a starter constitution when the repository has none.
 * @param {string} root
 */
export function writeFlowDir(root) {
  const target = join(root, FLOW_DIR);
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "README.md"), README);
  writeFileSync(join(target, ".gitignore"), "current.json\n");
  const constitution = join(root, CONSTITUTION);
  const template = resolveTemplate(root, "constitution-template");
  if (!existsSync(constitution) && template) copyFileSync(template, constitution);
}

/** The configuration `init` starts a repository with: the schema and the version, so every default applies. */
export const STARTER_CONFIG = {
  $schema: `./node_modules/${PACKAGE}/schema/${CONFIG_FILE.replace(".json", ".schema.json")}`,
  version: 1,
};

/**
 * Writes the starter configuration when `root` has no config file.
 * @param {string} root
 * @returns {boolean} whether it wrote one
 */
export function writeStarterConfig(root) {
  if (existsSync(join(root, CONFIG_FILE))) return false;
  writeFileSync(join(root, CONFIG_FILE), `${JSON.stringify(STARTER_CONFIG, null, 2)}\n`);
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
    const starter = { ...STARTER_CONFIG, runner: { kind: "github-actions" } };
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
  const top = git(process.cwd(), ["rev-parse", "--show-toplevel"]);
  const force = args.includes("--force");
  if (!init(top.ok ? top.out : process.cwd(), { force, config: true, log: console.log })) {
    console.error(`${NAME} init: .flow/ already exists (pass --force to re-render it)`);
    return 1;
  }
  console.log(
    `${NAME} init: installed .flow/; specs go in .agents/specs/ (start with /flow-specify)`,
  );
  return 0;
}
