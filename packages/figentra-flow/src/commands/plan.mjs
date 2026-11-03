/**
 * Figentra Flow file contract:
 * Purpose: `fflow plan <key> --input | --record <tasks.md>` (FR-15, C14), the plan stage around its Claude workflow
 *   (D6 Q5: the stage's skill runs the workflow; this command hands it its input and validates and records its
 *   output). `--input` prints, as JSON, the spec's FRs and ACs, the documents to read and the size budget (a task's
 *   file count: the preset's `plan.maxFilesPerTask`, default 10). `--record` accepts the workflow's tasks.md only when
 *   `gate tasks` passes, every FR and AC is covered and each task holds its budget (P-020), then writes it into the
 *   spec folder and records the plan stage done.
 * Boundary: reads the spec folder, the preset and `.agents/routing.yaml`; `--record` writes the spec's tasks.md and
 *   Flow's record only, and nothing when it refuses. A small spec keeps its tasks in spec.md (ADR 0502), so it is
 *   refused.
 * Runtime: node
 * Governing contract: STA-1945 (FR-15, AC-21, P-020).
 * Secrets: none.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { schemeFor } from "../adapters/tracker/index.mjs";
import {
  approvedAt,
  checkTasks,
  presetId,
  presetOf,
  RULES,
  specDir,
  statusOf,
  tierOf,
} from "./gate.mjs";
import { say } from "../lib/cli.mjs";
import { presetDir } from "../lib/flow-dir.mjs";
import { git } from "../lib/git.mjs";
import { NAME } from "../lib/product.mjs";
import { RecordError, updateRecord } from "../lib/record.mjs";
import { definedIds, parseTasks, routes } from "../lib/spec-parse.mjs";
import { parseYaml, YamlError } from "../lib/yaml.mjs";

/** A refusal: no such spec, or one not ready to plan. */
export class PlanError extends Error {}

/** A task's file count when the preset sets none (C14). */
export const DEFAULT_BUDGET = 10;

/** A backticked token naming a file or folder; a command in backticks (it has a space) is not one. */
const PATHLIKE = /^[\w@.{},*/-]*[./][\w@.{},*/-]*$/;

/**
 * The files a task names.
 * @param {import("../lib/spec-parse.mjs").Task} task
 */
export const taskFiles = (task) => task.paths.filter((p) => PATHLIKE.test(p));

/**
 * The preset's `plan.maxFilesPerTask`, else the default.
 * @param {string} root
 */
export function budgetOf(root) {
  const file = join(presetDir(root), "preset.yml");
  try {
    const n = existsSync(file)
      ? parseYaml(readFileSync(file, "utf8"))?.plan?.maxFilesPerTask
      : undefined;
    return Number.isInteger(n) && n > 0 ? n : DEFAULT_BUDGET;
  } catch (error) {
    // A repository's own preset.yml outside the YAML subset keeps the default.
    if (!(error instanceof YamlError)) throw error;
    return DEFAULT_BUDGET;
  }
}

/**
 * The spec folder of `key` and its documents.
 * @param {string} root
 * @param {string} key
 */
function locate(root, key) {
  const keys = schemeFor(root);
  const k = keys.parse(key);
  if (!k) throw new PlanError(`${key} is not an issue key`);
  const found = specDir({ root, key: k, keys });
  if (!found.dir || !existsSync(join(root, found.dir, "spec.md")))
    throw new PlanError(found.error ?? `${found.dir} has no spec.md`);
  const dir = found.dir;
  const read = (/** @type {string} */ name) =>
    existsSync(join(root, dir, name)) ? readFileSync(join(root, dir, name), "utf8") : "";
  return { k, dir, spec: read("spec.md"), plan: read("plan.md") };
}

/**
 * Why `spec` may not take this step: its status is outside `statuses`, it is small, or it lacks an approval its tier
 * needs before `stage` ends (ADR 0502: big at Clarified; feature and big at Planned).
 * @param {string} spec
 * @param {string[]} statuses
 * @param {"clarified" | "planned"} stage
 */
function notReady(spec, statuses, stage) {
  const status = statusOf(spec);
  const tier = tierOf(spec);
  if (tier === "small") return ["a small spec keeps its tasks in spec.md's `## Tasks`"];
  if (!statuses.includes(status))
    return [
      `the spec is ${status || "without a status"}: this step runs at ${statuses.join(" or ")}`,
    ];
  const stops = tier === "big" ? ["clarified", "planned"] : tier === "feature" ? ["planned"] : [];
  return stops
    .slice(0, stops.indexOf(stage) + 1)
    .filter((s) => approvedAt(spec, s) === undefined)
    .map((s) => `a ${tier} spec needs its ${s} approval ("Approved by <who> <YYYY-MM-DD>") first`);
}

/**
 * The plan workflow's input: the live FRs and ACs it must cover, the documents to read and the size budget.
 * @param {string} root
 * @param {string} key
 * @returns {{ frs: string[], acs: string[], files: string[], budget: number }}
 * @throws {PlanError} when there is no spec, or it is not approved for planning
 */
export function planInput(root, key) {
  const { dir, spec, plan } = locate(root, key);
  const problems = notReady(spec, ["clarified", "planned", "tasked"], "clarified");
  if (problems.length) throw new PlanError(problems.join("; "));
  return {
    frs: [...definedIds(spec, "FR").live],
    acs: [...definedIds(spec, "AC").live],
    files: [`${dir}/spec.md`, ...(plan ? [`${dir}/plan.md`] : [])],
    budget: budgetOf(root),
  };
}

/**
 * Validates the workflow's tasks.md (P-020) and, when it passes, writes it into the spec folder and records the plan
 * stage done.
 * @param {string} root
 * @param {string} key
 * @param {string} tasksText
 * @returns {string[]} problems; empty means recorded
 * @throws {PlanError} when there is no spec
 */
export function recordPlan(root, key, tasksText) {
  const { k, dir, spec, plan } = locate(root, key);
  const problems = notReady(spec, ["planned", "tasked"], "planned");
  if (problems.length) return problems;
  const rules = RULES[presetId(presetOf(root), root) ?? "neutral"] ?? RULES.neutral;
  const routing = join(root, ".agents/routing.yaml");
  const known = routes(existsSync(routing) ? readFileSync(routing, "utf8") : "");
  problems.push(...checkTasks(tasksText, { spec, plan, known, rules }));
  const live = parseTasks(tasksText).filter((t) => !t.struck);
  const covered = new Set(live.flatMap((t) => t.covers));
  for (const ac of definedIds(spec, "AC").live)
    if (!covered.has(ac)) problems.push(`tasks.md: ${ac} is covered by no task`);
  const budget = budgetOf(root);
  for (const t of live) {
    const files = taskFiles(t);
    if (files.length > budget)
      problems.push(
        `tasks.md:${t.line}: ${t.id} names ${files.length} files, over the budget of ${budget}: split it`,
      );
  }
  if (problems.length) return problems;
  writeFileSync(join(root, dir, "tasks.md"), tasksText);
  updateRecord(root, k, (r) => ({ ...r, stage: "plan", state: "done" }));
  return [];
}

/** @param {string[]} args */
export function run(args = []) {
  const [key] = args;
  const at = args.indexOf("--record");
  const file = at === -1 ? undefined : args[at + 1];
  if (
    !key ||
    key.startsWith("--") ||
    args.includes("--input") === (at !== -1) ||
    (at !== -1 && !file)
  ) {
    console.error(`usage: ${NAME} plan <key> --input | --record <tasks.md>`);
    return 2;
  }
  const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).out || process.cwd();
  try {
    if (!file) {
      console.log(JSON.stringify(planInput(root, key), null, 2));
      return 0;
    }
    if (!existsSync(file)) throw new PlanError(`${file} does not exist`);
    const problems = recordPlan(root, key, readFileSync(file, "utf8"));
    for (const p of problems) say("blocked", `${NAME} plan: ${p}`);
    if (!problems.length)
      say("approved", `${NAME} plan: tasks.md recorded; set **Status**: Tasked`);
    return problems.length ? 1 : 0;
  } catch (error) {
    if (!(error instanceof PlanError || error instanceof RecordError)) throw error;
    say("blocked", `${NAME} plan: ${error.message}`);
    return 2;
  }
}
