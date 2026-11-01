/**
 * Figentra Flow file contract:
 * Purpose: `figentra-flow migrate [--dry-run]` (ADR 0510 decision 8): moves a repository that used spec-kit onto
 *   Flow's own files, mechanically and re-runnably: the constitution from `.specify/memory/` to `.flow/`; `.specify/`
 *   and `.agents/speckit/` deleted; a config `preset` that pointed into `.agents/speckit/presets/` set to the bundled
 *   preset of that name; the `speckit:sync` script renamed `spec:sync`; the `pipx:specify-cli` pin and its comment
 *   dropped from `mise.toml`; `.specify/**` skips in `package.json`, `lefthook.yml` and `.oxfmtrc.jsonc` pointed at
 *   `.flow/**`; then `.flow/` written and the skills rendered (`sync`). `--dry-run` lists the steps and writes
 *   nothing. A second run finds nothing left to move.
 * Boundary: writes only the files named above and what `sync` writes. Prose (docs, ADRs, specs, hooks) is never
 *   touched: that is a reviewed commit of its own.
 * Runtime: node
 * Governing contract: ADR 0510; STA-1729 (F5).
 * Secrets: none.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { writeFlowDir } from "./init.mjs";
import { BUNDLED, hasProjector, run as runSync, sync } from "./sync.mjs";
import { CONFIG_FILE, NAME } from "../lib/product.mjs";
import { CONSTITUTION } from "../lib/flow-dir.mjs";
import { git } from "../lib/git.mjs";

/** Files whose `.specify/**` skips now name `.flow/**`. */
const SKIP_FILES = ["package.json", "lefthook.yml", ".oxfmtrc.jsonc"];

/**
 * The migration of `root`: each step's description and its action.
 * @param {string} root
 * @returns {{ what: string, run: () => void }[]}
 */
export function plan(root) {
  const at = (/** @type {string} */ p) => join(root, p);
  const read = (/** @type {string} */ p) =>
    existsSync(at(p)) ? readFileSync(at(p), "utf8") : undefined;
  /** @type {{ what: string, run: () => void }[]} */
  const steps = [];
  const oldConstitution = ".specify/memory/constitution.md";
  if (existsSync(at(oldConstitution)) && !existsSync(at(CONSTITUTION)))
    steps.push({
      what: `move ${oldConstitution} to ${CONSTITUTION}`,
      run: () => {
        mkdirSync(dirname(at(CONSTITUTION)), { recursive: true });
        renameSync(at(oldConstitution), at(CONSTITUTION));
      },
    });
  for (const dir of [".specify", ".agents/speckit"])
    if (existsSync(at(dir)))
      steps.push({
        what: `delete ${dir}/`,
        run: () => rmSync(at(dir), { recursive: true, force: true }),
      });
  const config = read(CONFIG_FILE);
  if (config) {
    const parsed = JSON.parse(config);
    const id = typeof parsed.preset === "string" ? basename(parsed.preset) : "";
    if (parsed.preset?.startsWith(".agents/speckit/presets/") && BUNDLED.includes(id))
      steps.push({
        what: `set "preset" to the bundled "${id}" in ${CONFIG_FILE}`,
        run: () =>
          writeFileSync(at(CONFIG_FILE), `${JSON.stringify({ ...parsed, preset: id }, null, 2)}\n`),
      });
  }
  const manifest = read("package.json");
  if (manifest && JSON.parse(manifest).scripts?.["speckit:sync"] !== undefined)
    steps.push({
      what: "rename the speckit:sync script to spec:sync (`figentra-flow sync`)",
      run: () => {
        const pkg = JSON.parse(readFileSync(at("package.json"), "utf8"));
        pkg.scripts = Object.fromEntries(
          Object.entries(pkg.scripts).map(([k, v]) =>
            k === "speckit:sync" ? ["spec:sync", `${NAME} sync`] : [k, v],
          ),
        );
        writeFileSync(at("package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
      },
    });
  const mise = read("mise.toml");
  if (mise?.includes("pipx:specify-cli"))
    steps.push({
      what: "drop the pipx:specify-cli pin from mise.toml",
      run: () => {
        const lines = readFileSync(at("mise.toml"), "utf8").split("\n");
        const pin = lines.findIndex((l) => l.includes("pipx:specify-cli"));
        let from = pin;
        // the comment lines just above the pin that are about spec-kit go with it
        while (from > 0 && /^\s*#.*(spec-kit|specify|speckit)/i.test(lines[from - 1])) from--;
        lines.splice(from, pin - from + 1);
        writeFileSync(at("mise.toml"), lines.join("\n"));
      },
    });
  for (const file of SKIP_FILES)
    if (read(file)?.includes(".specify/**"))
      steps.push({
        what: `point the .specify/** skip in ${file} at .flow/**`,
        run: () =>
          writeFileSync(
            at(file),
            readFileSync(at(file), "utf8").replaceAll(".specify/**", ".flow/**"),
          ),
      });
  return steps;
}

/**
 * Migrates `root`; returns the steps it took (or would take, `dry`).
 * @param {string} root
 * @param {{ dry?: boolean, log?: (s: string) => void }} [options]
 */
export function migrate(root, { dry = false, log = console.log } = {}) {
  const steps = plan(root);
  for (const step of steps) {
    log(`${NAME} migrate: ${dry ? "would " : ""}${step.what}`);
    if (!dry) step.run();
  }
  if (dry) {
    log(`${NAME} migrate: would write .flow/ and render the flow-* skills (${NAME} sync)`);
    return steps.map((s) => s.what);
  }
  writeFlowDir(root);
  sync(root, { direct: !hasProjector(root), log });
  if (!steps.length) log(`${NAME} migrate: no spec-kit files left; .flow/ is current`);
  return steps.map((s) => s.what);
}

/** `figentra-flow migrate [--dry-run]`. */
export function run(/** @type {string[]} */ args) {
  const top = git(process.cwd(), ["rev-parse", "--show-toplevel"]);
  if (!top.ok) {
    console.error(`${NAME} migrate: not in a git repository`);
    return 2;
  }
  const dry = args.includes("--dry-run");
  migrate(top.out, { dry });
  // the repository's projector renders the neutral skills for its tools, as `sync` does
  if (!dry && hasProjector(top.out) && runSync([])) return 1;
  if (!dry)
    console.log(
      `${NAME} migrate: done. Prose (docs, ADRs, specs, hooks) still names spec-kit; change it in its own reviewed commit.`,
    );
  return 0;
}
