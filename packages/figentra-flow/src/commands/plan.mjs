/**
 * Figentra Flow file contract:
 * Purpose: `fflow plan <key> --input | --record <tasks.md>` (FR-15, C14), the plan stage around its Claude workflow
 *   (D6 Q5: the stage's skill runs the workflow; this command hands it its input and validates and records its
 *   output). `--input` prints, as JSON, the spec's FRs and ACs, the documents to read and the size budget (a task's
 *   file count: the preset's `plan.maxFilesPerTask`, default 10). `--record` accepts the workflow's tasks.md only when
 *   `gate tasks` passes, every FR and AC is covered and each task holds its budget (P-020), then writes it into the
 *   spec folder and records the plan stage done, with the spec's approvals bound to the documents' content (A-3).
 *   Readiness is the gate's own `checkSpec` and `checkApproval`.
 * Boundary: reads the spec folder, the preset and `.agents/routing.yaml`; `--record` writes the spec's tasks.md and
 *   Flow's record only, and nothing when it refuses (an unreadable record refuses before tasks.md is written). A small
 *   spec keeps its tasks in spec.md (ADR 0502), and a tasks.md that already carries issue keys or progress markers is
 *   not replaced, so both are refused.
 * Runtime: node
 * Governing contract: STA-1945 (FR-15, FR-30, AC-21, AC-34, P-020, P-034).
 * Secrets: none.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { schemeFor } from "../adapters/tracker/index.mjs";
import {
  checkApproval,
  checkSpec,
  checkTasks,
  checkTaskTrees,
  presetId,
  presetOf,
  RULES,
  specDir,
  STATUSES,
  statusOf,
  tierOf,
} from "./gate.mjs";
import { say } from "../lib/cli.mjs";
import { presetDir } from "../lib/flow-dir.mjs";
import { git } from "../lib/git.mjs";
import { NAME } from "../lib/product.mjs";
import { bindApprovals, docsIn, readRecord, RecordError, updateRecord } from "../lib/record.mjs";
import { checkTaskRoles } from "../lib/roles.mjs";
import { definedIds, parseTasks, routes } from "../lib/spec-parse.mjs";
import { loadTeam } from "../lib/team.mjs";
import { parseYaml, YamlError } from "../lib/yaml.mjs";

/** A refusal: no such spec, or one not ready to plan. */
export class PlanError extends Error {}

/** A task's file count when the preset sets none (C14). */
export const DEFAULT_BUDGET = 10;

/**
 * Whether a backticked token names a file: no space (a command has one), and an extension that starts with a letter,
 * of at most four characters unless the token has a folder too. So `src/a.mjs`, `b.md` and `x/.gitignore` count, and
 * `fflow/gate`, `gate.shard` and `0.3.0` do not.
 * shortcut: reads the token's shape; a task field that lists its files when this miscounts a real plan.
 * @param {string} p
 */
const isFile = (p) =>
  /^[\w@.*/-]+$/.test(p) &&
  (/\.[A-Za-z][A-Za-z0-9]{0,3}$/.test(p) || (p.includes("/") && /\.[A-Za-z][\w-]*$/.test(p)));

/**
 * A token with its `{a,b}` groups expanded: `x/{a,b}.md` names `x/a.md` and `x/b.md`.
 * @param {string} p
 * @returns {string[]}
 */
const braces = (p) => {
  const m = p.match(/\{([^{}]*)\}/);
  return m ? m[1].split(",").flatMap((alt) => braces(p.replace(m[0], () => alt))) : [p];
};

/**
 * The files a task names.
 * @param {import("../lib/spec-parse.mjs").Task} task
 */
export const taskFiles = (task) => task.paths.flatMap(braces).filter(isFile);

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
  const rules = RULES[presetId(presetOf(root), root) ?? "neutral"] ?? RULES.neutral;
  return { k, keys, rules, dir, spec: read("spec.md"), plan: read("plan.md") };
}

/**
 * Why the spec may not take this step, through the gate's own checks so the two cannot drift: it is small, its status
 * is outside `statuses`, `checkSpec` fails (clarified, keyed, its Impact), or `checkApproval` fails for the status the
 * step moves it to, `next` (ADR 0502: big needs its Clarified approval to plan; feature and big their Planned one to
 * task). A spec with no tier needs no approval, as at the gate.
 * @param {ReturnType<typeof locate>} at
 * @param {string[]} statuses
 * @param {"planned" | "tasked"} next
 */
function notReady({ spec, keys, rules }, statuses, next) {
  const status = statusOf(spec);
  if (tierOf(spec) === "small") return ["a small spec keeps its tasks in spec.md's `## Tasks`"];
  if (!statuses.includes(status))
    return [
      `the spec is ${status || "without a status"}: this step runs at ${statuses.join(" or ")}`,
    ];
  const target = STATUSES.indexOf(status) > STATUSES.indexOf(next) ? status : next;
  return [...checkSpec(spec, keys, rules), ...checkApproval(spec, target)];
}

/**
 * The plan workflow's input: the live FRs and ACs it must cover, the documents to read and the size budget.
 * @param {string} root
 * @param {string} key
 * @returns {{ frs: string[], acs: string[], files: string[], budget: number }}
 * @throws {PlanError} when there is no spec, or it is not approved for planning
 */
export function planInput(root, key) {
  const at = locate(root, key);
  const { dir, spec, plan } = at;
  const problems = notReady(at, ["clarified", "planned", "tasked"], "planned");
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
 * @throws {RecordError} when Flow's record cannot be read, before anything is written
 */
export function recordPlan(root, key, tasksText) {
  const at = locate(root, key);
  const { k, rules, dir, spec, plan } = at;
  const problems = notReady(at, ["planned", "tasked"], "tasked");
  if (problems.length) return problems;
  // `spec:linear tasks` appends ` [STA-m]` keys after Tasked, and `task` sets markers: a new plan would drop them.
  const current = join(root, dir, "tasks.md");
  const kept = existsSync(current)
    ? parseTasks(readFileSync(current, "utf8")).filter((t) => t.key || t.marker !== " ")
    : [];
  if (kept.length)
    return [
      `tasks.md already carries issue keys or progress (${kept.map((t) => t.id).join(", ")}): a new plan would drop them, so edit tasks.md instead`,
    ];
  const routing = join(root, ".agents/routing.yaml");
  const known = routes(existsSync(routing) ? readFileSync(routing, "utf8") : "");
  // `gate tasks`' own checks: the tasks, the roster's roles (when there is a team) and the plan's folder trees (FR-30).
  const team = loadTeam(root);
  problems.push(
    ...checkTasks(tasksText, { spec, plan, known, rules }),
    ...(team ? checkTaskRoles(tasksText, team).problems : []),
    ...checkTaskTrees(spec, plan, tasksText, basename(dir)).problems,
  );
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
  readRecord(root, k); // throws on a record it could not update, before tasks.md is written
  writeFileSync(current, tasksText);
  updateRecord(root, k, (r) =>
    bindApprovals({ ...r, stage: "plan", state: "done" }, docsIn(join(root, dir))),
  );
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
