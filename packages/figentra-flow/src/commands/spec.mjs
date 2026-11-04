/**
 * Figentra Flow file contract:
 * Purpose: `fflow spec paths|setup-plan|setup-tasks|template` (ADR 0510): the work spec-kit's bash scripts
 *   did, as subcommands that print the same JSON keys, so the `flow-*` commands read one source.
 *   - `paths [--json] [--require-spec] [--require-tasks] [--include-tasks] [--paths-only] [--template <name>]`
 *     (was `check-prerequisites.sh`): `FEATURE_DIR` and `AVAILABLE_DOCS`, or with `--paths-only` `REPO_ROOT`,
 *     `BRANCH`, `FEATURE_DIR`, `FEATURE_SPEC`, `IMPL_PLAN`, `TASKS`; `--template` adds `TEMPLATE_CONTENT`.
 *   - `setup-plan [--json]` (was `setup-plan.sh`): runs the plan gate first, then copies the plan template into the
 *     spec folder when it has no plan.md; prints `FEATURE_SPEC`, `IMPL_PLAN`, `FEATURE_DIR`, `BRANCH`.
 *   - `setup-tasks [--json]` (was `setup-tasks.sh`): `FEATURE_DIR`, `AVAILABLE_DOCS`, `TASKS_TEMPLATE`,
 *     `TASKS_TEMPLATE_CONTENT`.
 *   - `template <name>`: the resolved template's text.
 *   The spec folder is `.flow/current.json` (written by `gate dir`), else the branch's issue key, else the one
 *   folder named for the branch's slug (FR-31).
 * Boundary: reads the repository; `setup-plan` writes only plan.md, and only when it is missing.
 * Runtime: node
 * Governing contract: ADR 0510; STA-1729 (F2).
 * Secrets: none.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { schemeFor } from "../adapters/tracker/index.mjs";
import { gate, specDir } from "./gate.mjs";
import { readCurrent, resolveTemplate } from "../lib/flow-dir.mjs";
import { git } from "../lib/git.mjs";
import { NAME } from "../lib/product.mjs";

/** A refusal: printed to stderr, exit 1. */
class SpecError extends Error {}

/**
 * The repository, its branch and the current spec folder with its files.
 * @param {string} cwd
 */
export function locate(cwd) {
  const top = git(cwd, ["rev-parse", "--show-toplevel"]);
  const root = top.ok ? top.out : cwd;
  const branch = git(root, ["branch", "--show-current"]).out;
  let dir = readCurrent(root);
  if (!dir) {
    const found = specDir({ root, branch, keys: schemeFor(root) });
    if (found.error)
      throw new SpecError(
        `${found.error}${found.fix ? ` (run \`${NAME} gate dir ${found.fix}\`)` : ""}`,
      );
    dir = found.dir ?? "";
  }
  const featureDir = join(root, dir);
  return {
    root,
    branch,
    featureDir,
    spec: join(featureDir, "spec.md"),
    plan: join(featureDir, "plan.md"),
    tasks: join(featureDir, "tasks.md"),
  };
}

/**
 * The optional documents present in a spec folder, in the scripts' order.
 * @param {string} featureDir
 * @param {boolean} includeTasks
 */
export function availableDocs(featureDir, includeTasks) {
  const has = (/** @type {string} */ f) => existsSync(join(featureDir, f));
  const contracts = join(featureDir, "contracts");
  return [
    ...(has("research.md") ? ["research.md"] : []),
    ...(has("data-model.md") ? ["data-model.md"] : []),
    ...(existsSync(contracts) && readdirSync(contracts).length ? ["contracts/"] : []),
    ...(has("quickstart.md") ? ["quickstart.md"] : []),
    ...(includeTasks && has("tasks.md") ? ["tasks.md"] : []),
  ];
}

/**
 * A template's text, or a refusal naming where it was looked for.
 * @param {string} root
 * @param {string} name
 */
function templateText(root, name) {
  const file = resolveTemplate(root, name);
  if (!file)
    throw new SpecError(`no ${name} in .flow/overrides/, the preset or ${NAME}'s templates`);
  return { file, text: readFileSync(file, "utf8") };
}

/**
 * `spec paths`.
 * @param {ReturnType<typeof locate>} at
 * @param {string[]} args
 */
export function paths(at, args) {
  if (args.includes("--paths-only"))
    return {
      REPO_ROOT: at.root,
      BRANCH: at.branch,
      FEATURE_DIR: at.featureDir,
      FEATURE_SPEC: at.spec,
      IMPL_PLAN: at.plan,
      TASKS: at.tasks,
    };
  if (!existsSync(at.featureDir))
    throw new SpecError(`spec folder not found: ${at.featureDir} (run /flow-specify first)`);
  if (!existsSync(at.plan))
    throw new SpecError(`plan.md not found in ${at.featureDir} (run /flow-plan first)`);
  if (args.includes("--require-spec") && !existsSync(at.spec))
    throw new SpecError(`spec.md not found in ${at.featureDir} (run /flow-specify first)`);
  if (args.includes("--require-tasks") && !existsSync(at.tasks))
    throw new SpecError(`tasks.md not found in ${at.featureDir} (run /flow-plan first)`);
  const out = {
    FEATURE_DIR: at.featureDir,
    AVAILABLE_DOCS: availableDocs(at.featureDir, args.includes("--include-tasks")),
  };
  const name = args.includes("--template") ? args[args.indexOf("--template") + 1] : undefined;
  if (args.includes("--template") && !name) throw new SpecError("--template takes a template name");
  return name ? { ...out, TEMPLATE_CONTENT: templateText(at.root, name).text } : out;
}

/**
 * `spec setup-plan`: the plan gate, then the plan template when plan.md is missing.
 * @param {ReturnType<typeof locate>} at
 * @param {{ planGate?: (spec: string) => number, log?: (s: string) => void }} [options]
 */
export function setupPlan(at, { planGate = gate, log = (s) => console.error(s) } = {}) {
  if (planGate(at.spec)) throw new SpecError("the plan gate refused the spec (run /flow-clarify)");
  mkdirSync(at.featureDir, { recursive: true });
  if (existsSync(at.plan)) log(`Plan already exists at ${at.plan}, skipping template copy`);
  else {
    copyFileSync(templateText(at.root, "plan-template").file, at.plan);
    log(`Copied plan template to ${at.plan}`);
  }
  return {
    FEATURE_SPEC: at.spec,
    IMPL_PLAN: at.plan,
    FEATURE_DIR: at.featureDir,
    BRANCH: at.branch,
  };
}

/**
 * `spec setup-tasks`.
 * @param {ReturnType<typeof locate>} at
 */
export function setupTasks(at) {
  if (!existsSync(at.plan))
    throw new SpecError(`plan.md not found in ${at.featureDir} (run /flow-plan first)`);
  const { file, text } = templateText(at.root, "tasks-template");
  return {
    FEATURE_DIR: at.featureDir,
    AVAILABLE_DOCS: availableDocs(at.featureDir, false),
    TASKS_TEMPLATE: relative(at.root, file).startsWith("..") ? file : relative(at.root, file),
    TASKS_TEMPLATE_CONTENT: text,
  };
}

/** `fflow spec …`. */
export function run(/** @type {string[]} */ [mode, ...args]) {
  const print = (/** @type {Record<string, unknown>} */ out) =>
    console.log(
      args.includes("--json")
        ? JSON.stringify(out)
        : Object.entries(out)
            .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
            .join("\n"),
    );
  try {
    if (mode === "template" && args[0]) {
      process.stdout.write(templateText(locateRoot(), args[0]).text);
      return 0;
    }
    if (mode === "paths") return (print(paths(locate(process.cwd()), args)), 0);
    if (mode === "setup-plan") return (print(setupPlan(locate(process.cwd()))), 0);
    if (mode === "setup-tasks") return (print(setupTasks(locate(process.cwd()))), 0);
  } catch (error) {
    if (!(error instanceof SpecError)) throw error;
    console.error(`${NAME} spec: ${error.message}`);
    return 1;
  }
  console.error(
    `usage: ${NAME} spec paths [--json] [--require-spec] [--require-tasks] [--include-tasks] [--paths-only] [--template <name>] | setup-plan [--json] | setup-tasks [--json] | template <name>`,
  );
  return 2;
}

/** The repository root alone (a template needs no spec folder). */
function locateRoot() {
  const top = git(process.cwd(), ["rev-parse", "--show-toplevel"]);
  return top.ok ? top.out : process.cwd();
}
