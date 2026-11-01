/**
 * Figentra Flow file contract:
 * Purpose: `figentra-flow gate` (core's `spec-gate`, moved unchanged) — the stage gates for the specs in `.agents/specs/<key>-<slug>/` (ADR 0120 D1, owner
 *          decision OR12).
 * Boundary: reads the spec folders, git and, through the tracker port, comments on the issue (best-effort); writes no spec
 *           file.
 * Runtime: node
 * Governing contract: ADR 0120 (SDLC spec location, lanes and change risk); ADR 0121; ADR 0065 (rule 7).
 *
 *   run [--ref b] [--box host] [-- flags]  the checks through the runner (or on `--box`); the box posts `figentra-flow/gate`
 *   plan <spec.md>              exit 1 unless the spec may be planned (run by setup-plan.sh)
 *   check <dir>                 the stage rules for the spec's declared `**Status**`
 *   tasks <tasks.md>            tasks lint: ids, covers, routes, deps, coverage, waves
 *   lane [--base=ref]           feat commits need a lite or full spec reached through the branch or `Refs:` keys,
 *                               and the diff's tier floor is not above the branch spec's `**Tier**` (ADR 0502)
 *   branch                      warn, never fail, unless the branch (STACKRA_BRANCH, else git) is Linear-named or
 *                               allow-listed: a `chore-lane` PR may use any branch, and only `linear check-pr`
 *                               sees the PR labels, so check-pr is the enforcing check
 *   ci [--base=ref]             the install check (ADR 0510); `check` for every spec folder changed since the base; bug-lane rules;
 *                               `lane`. SPEC_GATE_REQUIRE_READY=1 (a ready-for-review PR) also requires the PR's
 *                               own spec (the branch key's folder), when changed, to be at Tasked or later; an
 *                               edit to another spec gets only `check`, and changing another spec's `**Status**`
 *                               line needs a commit whose `Refs:` names that spec's key. No branch check: check-pr
 *                               owns it.
 *   dir [--slug s] [--key <key>]   print the spec folder for the branch's issue key and persist .flow/current.json
 *   stage <spec.md> <stage>     best-effort Linear comment for a stage change
 *
 * States: Draft → Clarified → Planned → Tasked → Implementing → Done, or Abandoned / Superseded. A status may lag
 * its artifacts, never lead them (I5):
 *   Draft         folder `<key>-<slug>` (the tracker's key scheme); a `**Linear**` key, when set, equals the folder's
 *   Clarified     clarifications complete, real key, every Impact line answered, no NEEDS CLARIFICATION; a Status
 *                 history line for the current status
 *   Planned       plan.md: Constitution Check rows PASS or N/A with a reason, three deploy-mode rows, every live FR
 *                 validated by a P-### (or marked example-only)
 *   Tasked        tasks.md passes `tasks`
 *   Implementing  at least one task ticked
 *   Done          every live task ticked (spec-trace adds test coverage)
 * Tracker: `plan` and `stage` comment the stage on the spec's issue through the tracker port; a failure warns, never part of
 * the exit code (ADR 0065 rule 7). `ci` never calls it. FIGENTRA_FLOW_TRACKER=off (or STACKRA_LINEAR=off) disables it.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { schemeFor, trackerFor } from "../adapters/tracker/index.mjs";
import { say } from "../lib/cli.mjs";
import {
  checkSpecRoles,
  checkTaskRoles,
  ownerStopsOf,
  pathProblems,
  roleOf,
} from "../lib/roles.mjs";
import { loadTeam } from "../lib/team.mjs";
import { installProblems } from "../lib/render.mjs";
import { BUNDLED } from "./sync.mjs";
import { loadConfig } from "../lib/config.mjs";
import { specsDirs, writeCurrent } from "../lib/flow-dir.mjs";
import { ENV_PREFIX, NAME } from "../lib/product.mjs";

/** The presets this package ships (`stackra`, `neutral`), installed when a repository keeps none of its own. */
import {
  definedIds,
  definedLines,
  parseTasks,
  properties,
  routes,
  strip,
} from "../lib/spec-parse.mjs";

/** The top of `dir`'s git checkout, else `dir` (a test or a script run below the root reads the root's config). */
function topLevel(/** @type {string} */ dir) {
  try {
    return (
      execFileSync("git", ["rev-parse", "--show-toplevel"], {
        cwd: dir,
        encoding: "utf8",
      }).trim() || dir
    );
  } catch {
    return dir;
  }
}

/** The repository the command runs in: the top of the working directory's git checkout, else the directory. */
const ROOT = topLevel(process.cwd());
const IMPACT_FIELDS = [
  "Apps touched",
  "Services touched",
  "Packages touched",
  "Cross-service events",
  "Tenancy and data",
  "Secrets",
  "ADR needed",
  "New dependencies",
  "Deploy modes",
  "Licence tier",
  "Docs to update",
  "Lane",
  "Change risk",
];
export const SPECS_DIR = ".agents/specs";
/** @typedef {import("../adapters/tracker/index.mjs").KeyScheme} KeyScheme */
/** @type {KeyScheme | undefined} */
let scheme;
/**
 * The repository's issue-key scheme (its tracker's; the transitional STA one, unannounced, without a config file).
 * Keys are full and lower-cased: `sta-163`, `gh-7`.
 */
export const repoScheme = () => (scheme ??= schemeFor(ROOT));
/**
 * The preset a repository uses: its configuration's `preset`, else `neutral`.
 * @param {string} [root]
 */
export const presetOf = (root = ROOT) => loadConfig(root).config.preset ?? "neutral";

/**
 * The id a preset declares: a bundled one's name, or the `id:` in a preset folder's `preset.yml` (a repository's own
 * copy of `stackra` keeps Stackra's rules). Undefined when the folder declares none.
 * @param {string} preset
 * @param {string} [root]
 */
export function presetId(preset, root = ROOT) {
  if (BUNDLED.includes(preset)) return preset;
  const yml = readIf(join(resolve(root, preset), "preset.yml"));
  return yml.match(/^\s+id:\s*["']?([\w-]+)["']?\s*$/m)?.[1];
}

/**
 * The rules each preset's templates satisfy. `stackra` adds its Impact questionnaire, Constitution Check, deploy
 * modes, correctness properties, task routes and path floors to what every preset keeps (the issue key, the
 * clarifications marker, statuses, tiers, approvals, EARS criteria and the design sections). A repository's own
 * preset folder is held to the rules of the id it declares, else the neutral ones.
 * @typedef {{ impact: boolean, constitution: boolean, properties: boolean, routes: boolean, floors: boolean }} Rules
 * @type {Record<string, Rules>}
 */
export const RULES = {
  stackra: { impact: true, constitution: true, properties: true, routes: true, floors: true },
  neutral: { impact: false, constitution: false, properties: false, routes: false, floors: false },
};
/** @type {Rules | undefined} */
let rules;
export const repoRules = () =>
  (rules ??= RULES[presetId(presetOf()) ?? "neutral"] ?? RULES.neutral);

/** The `**Linear**:` (or `**Issue**:`) line's key, lower-cased. */
const issueLine = (/** @type {string} */ body, /** @type {KeyScheme} */ keys) =>
  body
    .match(new RegExp(`^\\*\\*(?:Linear|Issue)\\*\\*:\\s*(${keys.pattern})(?![0-9])`, "mi"))?.[1]
    .toLowerCase();
export const STATUSES = [
  "draft",
  "clarified",
  "planned",
  "tasked",
  "implementing",
  "done",
  "abandoned",
  "superseded",
];

/** Problems that stop a spec from being planned; empty means it may be. */
/**
 * @param {string} text
 * @param {KeyScheme} [keys]
 * @param {Rules} [rules]
 */
export function checkSpec(text, keys = repoScheme(), rules = repoRules()) {
  const body = text.replaceAll(/<!--[\s\S]*?-->/g, "");
  const problems = [];
  if (!/^\*\*Clarifications status\*\*:\s*complete\s*$/im.test(body))
    problems.push("`**Clarifications status**` is not `complete` (run /flow-clarify)");
  if (!issueLine(body, keys))
    problems.push(
      `\`**Linear**\` (or \`**Issue**\`) has no issue key (${NAME} linear issue, or the tracker)`,
    );
  if (/\[NEEDS CLARIFICATION/i.test(body)) problems.push("a `[NEEDS CLARIFICATION` marker remains");

  const impact = body.match(/^## Impact\b[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m)?.[1];
  if (!rules.impact) return problems;
  if (impact === undefined) {
    problems.push("the `## Impact` section is missing");
  } else {
    for (const field of IMPACT_FIELDS) {
      const value = impact.match(new RegExp(`^- \\*\\*${field}\\*\\*:[ \\t]*(.*)$`, "m"))?.[1];
      if (value === undefined) problems.push(`Impact: \`${field}\` is missing`);
      else if (value.trim() === "" || /^\[.*\]$/.test(value.trim()))
        problems.push(`Impact: \`${field}\` is unanswered`);
    }
  }
  return problems;
}

export const STAGES = ["clarified", "planned", "tasked", "implementing", "done"];
const atLeast = (status, stage) => STATUSES.indexOf(status) >= STATUSES.indexOf(stage);

/** The declared `**Status**`, lower-cased ("" when absent). */
export const statusOf = (text) =>
  strip(text)
    .match(/^\*\*Status\*\*:\s*([A-Za-z]+)/m)?.[1]
    ?.toLowerCase() ?? "";

/** The table rows of `text`: every `|` line but the first (the header) and the rules, each as its trimmed cells. */
const tableRows = (text) =>
  (text ?? "")
    .split("\n")
    .filter((l) => l.startsWith("|") && !/^\|\s*-/.test(l))
    .slice(1)
    .map((l) =>
      l
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim()),
    );

/** Planned rules for plan.md against its spec. */
export function checkPlan(plan, spec, rules = repoRules()) {
  const problems = [];
  const body = strip(plan);
  if (/\[NEEDS CLARIFICATION/i.test(body))
    problems.push("plan.md: a `[NEEDS CLARIFICATION` marker remains");
  const section = (name) =>
    body.match(new RegExp(`^## ${name}\\b[^\\n]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m"))?.[1];
  const constitution = section("Constitution Check");
  if (!rules.constitution)
    return [...problems, ...(rules.properties ? unvalidated(plan, spec) : [])];
  if (constitution === undefined)
    problems.push("plan.md: the `## Constitution Check` table is missing");
  for (const [law, result, note] of tableRows(constitution)) {
    if (!/^(PASS|N\/A)$/i.test(result ?? ""))
      problems.push(
        `plan.md: Constitution Check \`${law}\` is \`${result ?? ""}\`, not PASS or N/A`,
      );
    else if (/^N\/A$/i.test(result) && !note)
      problems.push(`plan.md: Constitution Check \`${law}\` is N/A without a reason`);
  }
  const modes = new Set(tableRows(section("Deploy modes")).map(([m]) => m.toLowerCase()));
  for (const mode of ["saas", "on-prem", "air-gapped"])
    if (!modes.has(mode)) problems.push(`plan.md: Deploy modes has no \`${mode}\` row`);
  if (rules.properties) problems.push(...unvalidated(plan, spec));
  return problems;
}

/** FRs that no `P-###` property of plan.md validates (and that spec.md does not mark example-only). */
function unvalidated(/** @type {string} */ plan, /** @type {string} */ spec) {
  const validated = new Set([...properties(plan).values()].flat());
  const frLines = definedLines(spec, "FR");
  return [...definedIds(spec, "FR").live]
    .filter((fr) => !validated.has(fr) && !/example-only/i.test(frLines.get(fr) ?? ""))
    .map((fr) => `plan.md: ${fr} is validated by no P-### (or mark it example-only in spec.md)`);
}

/** Tasks lint for tasks.md against its spec and plan; `known` holds the routing.yaml task types. */
export function checkTasks(
  tasksText,
  { spec = "", plan = "", known = new Set(), rules = repoRules() } = {},
) {
  const problems = [];
  const tasks = parseTasks(tasksText);
  if (!tasks.length) return ["tasks.md: no `- [ ] T###` task lines"];
  const ids = new Set(definedIds(spec, "(?:FR|SC|EC|AC)").live);
  for (const p of properties(plan).keys()) ids.add(p);
  const seen = new Map();
  for (const t of tasks) {
    if (seen.has(t.id)) problems.push(`tasks.md:${t.line}: ${t.id} repeats line ${seen.get(t.id)}`);
    seen.set(t.id, t.line);
  }
  const live = tasks.filter((t) => !t.struck);
  for (const t of live) {
    const at = `tasks.md:${t.line}: ${t.id}`;
    if (!t.covers.length) problems.push(`${at} has no \`covers:\``);
    for (const id of t.covers)
      if (!ids.has(id))
        problems.push(`${at} covers ${id}, which spec.md and plan.md do not define`);
    if (!rules.routes) {
      // the neutral preset's tasks name no route
    } else if (!t.route) problems.push(`${at} has no \`route:\``);
    else if (known.size && !known.has(t.route))
      problems.push(`${at} route \`${t.route}\` is not a task type in .agents/routing.yaml`);
    for (const d of t.deps)
      if (!seen.has(d)) problems.push(`${at} depends on ${d}, which does not exist`);
  }
  const deps = new Map(live.map((t) => [t.id, t.deps]));
  const state = new Map();
  const visit = (id, trail) => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "open")
      return problems.push(`tasks.md: dependency cycle ${[...trail, id].join(" → ")}`);
    state.set(id, "open");
    for (const d of deps.get(id) ?? []) visit(d, [...trail, id]);
    state.set(id, "done");
  };
  for (const id of deps.keys()) visit(id, []);
  const covered = new Set(live.flatMap((t) => t.covers));
  for (const fr of definedIds(spec, "FR").live)
    if (!covered.has(fr)) problems.push(`tasks.md: ${fr} is covered by no task`);
  const waves = new Map();
  for (const t of live.filter((x) => x.parallel))
    for (const path of t.paths) {
      const k = `${t.phase}\0${path}`;
      if (waves.has(k))
        problems.push(
          `tasks.md: [P] tasks ${waves.get(k)} and ${t.id} share \`${path}\` in one wave`,
        );
      else waves.set(k, t.id);
    }
  return problems;
}

/**
 * Problems for a spec at its declared `**Status**`; `files` lists the names in its folder.
 * @param {string} folder
 * @param {string} text
 * @param {{ files?: string[], tasks?: string, plan?: string, known?: Set<string>, keys?: KeyScheme,
 *           rules?: Rules, team?: import("../lib/team.mjs").Team }} [options]
 */
export function checkStage(
  folder,
  text,
  {
    files = [],
    tasks = "",
    plan = "",
    known,
    keys = repoScheme(),
    rules = repoRules(),
    team = loadTeam(ROOT),
  } = {},
) {
  const body = strip(text);
  const key = keys.folderKey(folder);
  if (!key) return [`folder \`${folder}\` is not \`<key>-<slug>\` (ADR 0120 D1)`];
  const status = statusOf(text);
  if (!STATUSES.includes(status)) return [`\`**Status**\` is not one of ${STATUSES.join(", ")}`];
  if (status === "abandoned" || status === "superseded") return [];
  const problems = [];
  const linear = issueLine(body, keys);
  if (linear && linear !== key)
    problems.push(
      `the spec's key ${keys.display(linear)} does not match the folder key ${keys.display(key)}`,
    );
  if (status === "draft") return problems;
  problems.push(...checkSpec(text, keys, rules));
  problems.push(...checkApproval(text));
  const tier = tierOf(text);
  if (team)
    problems.push(
      ...checkSpecRoles(text, team, {
        tiered: tier === "feature" || tier === "big",
        pastClarified: atLeast(status, "planned"),
      }),
      ...ownerApprovalProblems(text, loadConfig(ROOT).config.apps?.owner),
    );
  if (tier !== undefined && tier !== "trivial") problems.push(...checkCriteria(text));
  const history =
    body.match(/^## Status history\b[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m)?.[1] ?? "";
  if (!new RegExp(`→\\s*${status}\\b`, "i").test(history))
    problems.push(
      `\`## Status history\` has no "→ ${status[0].toUpperCase()}${status.slice(1)}" line`,
    );
  // ADR 0502: a small spec's design and tasks are sections of spec.md, not files.
  if (tier === "small") {
    /** @param {string} name */
    const part = (name) =>
      body.match(new RegExp(`^## ${name}\\b[^\\n]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m"))?.[1];
    const design = part("Design");
    const steps = part("Tasks");
    if (atLeast(status, "planned")) {
      if (design === undefined)
        problems.push(`status ${status} needs a \`## Design\` section in a small spec`);
      else problems.push(...checkDesign(design, "spec.md ## Design", "###"));
    }
    if (atLeast(status, "tasked")) {
      if (steps === undefined)
        problems.push(`status ${status} needs a \`## Tasks\` section in a small spec`);
      else problems.push(...checkTraceTasks(steps, text, "spec.md ## Tasks"));
    }
    return problems;
  }
  const tiered = tier === "feature" || tier === "big";
  if (tiered && atLeast(status, "planned") && files.includes("plan.md"))
    problems.push(...checkDesign(plan, "plan.md", "##"));
  if (tiered && atLeast(status, "tasked") && files.includes("tasks.md"))
    problems.push(...checkTraceTasks(tasks, text, "tasks.md"));
  if (atLeast(status, "planned")) {
    if (!files.includes("plan.md")) problems.push(`status ${status} needs plan.md`);
    else problems.push(...checkPlan(plan, text, rules));
  }
  if (atLeast(status, "tasked")) {
    if (!files.includes("tasks.md")) problems.push(`status ${status} needs tasks.md`);
    else problems.push(...checkTasks(tasks, { spec: text, plan, known, rules }));
    if (team) problems.push(...checkTaskRoles(tasks, team).problems);
  }
  const live = parseTasks(tasks).filter((t) => !t.struck);
  if (atLeast(status, "implementing") && !live.some((t) => t.done))
    problems.push(`status ${status}, but no task is ticked`);
  if (status === "done" && live.some((t) => !t.done))
    problems.push(
      `status done, but ${live
        .filter((t) => !t.done)
        .map((t) => t.id)
        .join(", ")} are unticked`,
    );
  return problems;
}

/** The spec tiers of ADR 0502, smallest first. */
export const TIERS = ["trivial", "small", "feature", "big"];

/**
 * The tier a spec declares in its `**Tier**:` header, or undefined (an older spec).
 * @param {string} text
 * @returns {string | undefined}
 */
export const tierOf = (text) => {
  const tier = strip(text)
    .match(/^\*\*Tier\*\*:\s*([A-Za-z]+)/m)?.[1]
    ?.toLowerCase();
  return tier !== undefined && TIERS.includes(tier) ? tier : undefined;
};

/** Paths that raise the floor, highest first (ADR 0502). */
const FLOORS = [
  {
    tier: "big",
    why: "a new service or package",
    match: (/** @type {string} */ status, /** @type {string} */ path) =>
      status.startsWith("A") &&
      /^(?:services\/[^/]+|packages\/(?!tooling\/)[^/]+\/[^/]+)\/package\.json$/.test(path),
  },
  {
    tier: "feature",
    why: "a new app or Worker member",
    match: (/** @type {string} */ status, /** @type {string} */ path) =>
      status.startsWith("A") && /^(?:apps|workers)\/[^/]+\/package\.json$/.test(path),
  },
  {
    tier: "feature",
    why: "a migration",
    match: (/** @type {string} */ _status, /** @type {string} */ path) =>
      /\/database\/migrations\/|\.migration\.ts$/.test(path),
  },
  {
    tier: "feature",
    why: "a public contract",
    match: (/** @type {string} */ _status, /** @type {string} */ path) =>
      /\/src\/contracts\/|(?:^|\/)(?:stackra\.manifest|openapi)\.json$/.test(path),
  },
  {
    tier: "feature",
    why: "a permission",
    match: (/** @type {string} */ _status, /** @type {string} */ path) =>
      /\.permissions\.ts$|\/access\//.test(path),
  },
  {
    tier: "feature",
    why: "payment or money code",
    match: (/** @type {string} */ _status, /** @type {string} */ path) =>
      path.startsWith("packages/commerce/") ||
      /(?:^|[/.-])(?:payments?|money|ledgers?|billing|payouts?|refunds?)(?:[/.-]|$)/i.test(path),
  },
];

/** Paths that never raise the floor: specs, docs, tests and changesets. */
const NEUTRAL = /^\.agents\/specs\/|^\.changeset\/|^apps\/docs\/|\.mdx?$|\/__tests__\//;

/**
 * The lowest tier a diff allows, with the paths that set it (ADR 0502).
 * @param {{ status: string, path: string }[]} changes  `git diff --name-status` rows
 * @param {Rules} [rules]
 * @returns {{ tier: string, reasons: string[] }}
 */
export function computedTier(changes, rules = repoRules()) {
  let tier = "trivial";
  // The floors read the Stackra layout (members, migrations, contracts); other presets keep the declared tier.
  if (!rules.floors) return { tier, reasons: [] };
  /** @type {string[]} */
  const reasons = [];
  for (const floor of FLOORS) {
    const hits = changes.filter(
      ({ status, path }) => !NEUTRAL.test(path) && floor.match(status, path),
    );
    if (hits.length === 0) continue;
    if (tier === "trivial") tier = floor.tier;
    if (floor.tier === tier)
      reasons.push(
        `${floor.why}: ${hits
          .map((h) => h.path)
          .slice(0, 3)
          .join(", ")}${hits.length > 3 ? ", …" : ""}`,
      );
  }
  return { tier, reasons };
}

/**
 * A declared tier below the computed one is a problem; a branch with no spec declares trivial (ADR 0502).
 * @param {{ declared?: string, computed: string, reasons?: string[] }} context
 * @returns {string[]}
 */
export function checkTier({ declared, computed, reasons = [] }) {
  const tier = declared ?? "trivial";
  if (TIERS.indexOf(tier) >= TIERS.indexOf(computed)) return [];
  return [
    `tier: the diff needs at least ${computed} (${reasons.join("; ")}), but the ${
      declared === undefined ? "branch has no spec (trivial)" : `spec declares ${tier}`
    } (ADR 0502)`,
  ];
}

/**
 * Who approved a spec at `stage` and when: "Approved by <who> <YYYY-MM-DD>" on the Status line while the spec sits
 * there, or on the Status history line that moved it there.
 * @param {string} text
 * @param {string} stage
 * @returns {{ who: string, date: string } | undefined}
 */
export function approvedAt(text, stage) {
  const lines = statusOf(text) === stage ? [statusLine(text)] : [];
  const history =
    strip(text).match(/^## Status history\b[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m)?.[1] ?? "";
  lines.push(...history.split("\n").filter((l) => new RegExp(`→\\s*${stage}\\b`, "i").test(l)));
  for (const line of lines) {
    const found = line.match(/Approved by ([^\n]+?) (\d{4}-\d{2}-\d{2})\b/);
    if (found) return { who: found[1] ?? "", date: found[2] ?? "" };
  }
  return undefined;
}

/**
 * AC-053: an owner-kept spec's stage approvals come from the owner only: "Approved by owner …" or by the configured
 * owner login. Without `**Owner stops**` (or with none) nothing is checked here.
 * @param {string} text
 * @param {string | undefined} [owner] the configuration's `apps.owner`
 * @returns {string[]}
 */
export function ownerApprovalProblems(text, owner) {
  const stops = ownerStopsOf(text);
  if (!stops?.length) return [];
  /** @type {string[]} */
  const problems = [];
  for (const stage of STAGES) {
    const found = approvedAt(text, stage);
    if (!found) continue;
    const who = found.who.trim();
    if (!/^owner\b/i.test(who) && (!owner || who.toLowerCase() !== owner.toLowerCase()))
      problems.push(
        `the ${stage} approval is by ${who}, but the spec touches ${stops.join(", ")}: only the owner approves it`,
      );
  }
  return problems;
}

/**
 * The approval stops of ADR 0502: feature before Tasked; big before Planned and before Tasked; both name the Approver.
 * @param {string} text
 * @returns {string[]}
 */
export function checkApproval(text) {
  const tier = tierOf(text);
  if (tier !== "feature" && tier !== "big") return [];
  const status = statusOf(text);
  if (status === "abandoned" || status === "superseded") return [];
  const problems = [];
  if (atLeast(status, "planned") && !/^\*\*Approver\*\*:\s*\S/m.test(strip(text)))
    problems.push(
      `a ${tier} spec names its \`**Approver**\` (the owner, or the leader for a technical-only stop; ADR 0502)`,
    );
  for (const stop of tier === "big" ? ["clarified", "planned"] : ["planned"]) {
    const next = stop === "clarified" ? "planned" : "tasked";
    if (atLeast(status, next) && approvedAt(text, stop) === undefined)
      problems.push(
        `status ${status} needs the ${stop[0].toUpperCase()}${stop.slice(1)} approval of a ${tier} spec: "Approved by <who> <YYYY-MM-DD>" on that stage (ADR 0502)`,
      );
  }
  return problems;
}

/** The design's sections, in order (ADR 0502 decision 7). */
export const DESIGN_SECTIONS = [
  "Architecture overview",
  "Components and responsibilities",
  "Files and folders",
  "Data models and migrations",
  "Contracts",
  "Error handling",
  "Security and tenancy",
  "Testing strategy",
  "Rollout",
];

/** The EARS forms of an acceptance criterion. */
const EARS =
  /^(?:WHEN \S.*? THE \S.*? SHALL \S|IF \S.*? THEN THE \S.*? SHALL \S|WHILE \S.*? THE \S.*? SHALL \S|WHERE \S.*? THE \S.*? SHALL \S|THE \S.*? SHALL \S)/;

/**
 * A tiered spec's acceptance criteria: an `## Acceptance criteria` section of `- **AC-###**:` lines in an EARS form.
 * @param {string} text
 * @returns {string[]}
 */
export function checkCriteria(text) {
  if (!/^## Acceptance criteria\b/m.test(strip(text)))
    return [
      "spec.md: a tiered spec has an `## Acceptance criteria` section of EARS criteria (ADR 0502)",
    ];
  const lines = definedLines(text, "AC");
  if (lines.size === 0)
    return ["spec.md: `## Acceptance criteria` has no `- **AC-###**:` criterion (ADR 0502)"];
  const problems = [];
  for (const [id, rest] of lines)
    if (!EARS.test(rest.replace(/^\s*:\s*/, "").trim()))
      problems.push(
        `spec.md: ${id} is not EARS ("WHEN <event> THE <system> SHALL <response>", or the IF ... THEN, WHILE, WHERE or THE ... SHALL form)`,
      );
  return problems;
}

/**
 * A design's sections: each DESIGN_SECTIONS name is a heading of `level` with something under it.
 * @param {string} text
 * @param {string} where
 * @param {"##" | "###"} level
 * @returns {string[]}
 */
export function checkDesign(text, where, level) {
  const body = strip(text);
  const problems = [];
  for (const name of DESIGN_SECTIONS) {
    const section = new RegExp(
      `^${level} ${name}\\b[^\\n]*\\n([\\s\\S]*?)(?=^#{2,3} |(?![\\s\\S]))`,
      "m",
    ).exec(body);
    if (section === null)
      problems.push(`${where}: the design has no \`${level} ${name}\` section (ADR 0502)`);
    else if ((section[1] ?? "").trim() === "")
      problems.push(
        `${where}: \`${level} ${name}\` is empty (write "none" when it does not apply)`,
      );
  }
  return problems;
}

/**
 * Each live task covers an acceptance criterion and names a file; every criterion is covered.
 * @param {string} tasks
 * @param {string} spec
 * @param {string} where
 * @returns {string[]}
 */
export function checkTraceTasks(tasks, spec, where) {
  const criteria = definedIds(spec, "AC").live;
  const live = parseTasks(tasks).filter((t) => !t.struck);
  if (live.length === 0) return [`${where}: no \`- [ ] T###\` task lines`];
  const problems = [];
  for (const t of live) {
    const at = `${where}:${t.line}: ${t.id}`;
    if (!t.covers.some((id) => criteria.has(id)))
      problems.push(`${at} covers no acceptance criterion (AC-###) of spec.md (ADR 0502)`);
    if (t.paths.length === 0) problems.push(`${at} names no file in backticks (ADR 0502)`);
  }
  const covered = new Set(live.flatMap((t) => t.covers));
  for (const ac of criteria)
    if (!covered.has(ac)) problems.push(`${where}: ${ac} is covered by no task`);
  return problems;
}

/** feat commits need a lite or full spec reached through the branch key or their `Refs:` keys (ADR 0120 D4). */
export function checkLane({
  commits = [],
  branch = "",
  specKeys = new Set(),
  taskKeys = new Set(),
  scheme = repoScheme(),
}) {
  const feats = commits.filter((c) => /^feat(\(|!|:)/.test(c));
  if (!feats.length) return [];
  const keys = new Set([branch, ...feats].flatMap(scheme.keys));
  if ([...keys].some((k) => specKeys.has(k) || taskKeys.has(k))) return [];
  return [
    `lane: ${feats.length} feat commit(s), but neither the branch nor their Refs keys (${[...keys].map(scheme.display).join(", ") || "none"}) reach a spec in ${SPECS_DIR} — new behaviour takes the lite or full lane; use chore/fix/docs for the others`,
  ];
}

/** The spec folder is the PR's own (keyed by the branch's issue key); only it must reach Tasked on a ready PR. */
export function isOwnSpec(folder, branch, keys = repoScheme()) {
  const key = keys.keys(branch)[0];
  return Boolean(key) && keys.folderKey(folder) === key;
}

/** The spec's `**Status**:` line, trimmed ("" when absent). */
export const statusLine = (text) =>
  strip(text)
    .match(/^\*\*Status\*\*:.*$/m)?.[0]
    .trim() ?? "";

/** The issue keys named on the `Refs:` trailers of the commit messages, lower-cased. */
export const refsKeys = (commits, keys = repoScheme()) =>
  new Set(
    commits.flatMap((c) => [...c.matchAll(/^Refs:[ \t]*(.*)$/gim)].flatMap((r) => keys.keys(r[1]))),
  );

/**
 * A PR may move another spec's `**Status**` only when one of its commits' `Refs:` names that spec's key, so a
 * spec's stage never changes as a side effect of unrelated work. The own spec and a newly added spec are exempt.
 */
export function checkForeignStatus({
  folder,
  before = "",
  after = "",
  branch = "",
  commits = [],
  keys = repoScheme(),
}) {
  if (isOwnSpec(folder, branch, keys) || !before) return [];
  const [was, now] = [statusLine(before), statusLine(after)];
  if (was === now) return [];
  const key = keys.folderKey(folder);
  if (key && refsKeys(commits, keys).has(key)) return [];
  return [
    `${folder}: this PR changes another spec's Status line (\`${was || "(none)"}\` → \`${now || "(none)"}\`), but no commit has \`Refs: ${key ? keys.display(key) : "<its key>"}\``,
  ];
}

/** The branch has the tracker's shape (ADR 0065 decision 5) or is allow-listed. */
export function checkBranch(branch, keys = repoScheme()) {
  if (!branch || branch === "HEAD" || branch === "main") return [];
  if (/^(renovate\/|changeset-release\/main$)/.test(branch)) return [];
  return keys.isBranch(branch)
    ? []
    : [`branch \`${branch}\` is not \`${keys.branchShape}\` (the tracker's branch name)`];
}

/** Bug lane: `<specs.bugsDir>/<key>-<slug>/` (default `.agents/specs/bugs/`) with a regression test tagged `@covers <key>:BUG`. */
export function checkBug(folder, tests, keys = repoScheme()) {
  const key = keys.folderKey(folder);
  if (!key) return [`${specsDirs(ROOT).bugsDir}/${folder}: folder is not \`<key>-<slug>\``];
  return new RegExp(`@covers[^\\n]*(?<![a-z0-9])${key}:BUG\\b`, "i").test(tests)
    ? []
    : [`${specsDirs(ROOT).bugsDir}/${folder}: no regression test carries \`@covers ${key}:BUG\``];
}

/**
 * The repo-relative spec folder for a key: its existing `<key>-*` folder, else one named from `slug`.
 * @param {{ root?: string, branch?: string, key?: string, slug?: string, keys?: KeyScheme }} [options]
 */
export function specDir({ root = ROOT, branch = "", key, slug, keys = repoScheme() } = {}) {
  const k = key === undefined ? keys.keys(branch)[0] : keys.parse(key);
  if (!k) return { error: `no issue key in ${key ? `--key ${key}` : `branch \`${branch}\``}` };
  const specs = specsDirs(root).dir;
  const base = join(root, specs);
  const existing = existsSync(base) ? readdirSync(base).filter((d) => keys.folderKey(d) === k) : [];
  if (existing.length > 1)
    return { error: `several folders for ${keys.display(k)}: ${existing.join(", ")}` };
  if (existing.length) return { dir: `${specs}/${existing[0]}` };
  const name = keys.folder(k, slug ?? "");
  if (keys.folderKey(name) !== k)
    return { error: `no folder for ${keys.display(k)} yet; pass --slug <kebab-case short name>` };
  return { dir: `${specs}/${name}` };
}

/**
 * Reports a spec's stage to its issue through the tracker port: a comment, and In Progress at `implementing`. A
 * tracker that is missing or fails is a warning on stderr, never swallowed and never the gate's exit code (ADR 0065
 * rule 7). `<PREFIX>TRACKER=off` (or the older `STACKRA_LINEAR=off`) turns it off.
 * @param {string} file the spec.md
 * @param {string} stage
 * @param {{ root?: string, scheme?: import("../adapters/tracker/index.mjs").KeyScheme,
 *           tracker?: import("../adapters/tracker/index.mjs").Tracker, warn?: (s: string) => void }} [options]
 */
export async function trackerStage(file, stage, options = {}) {
  const { root = ROOT, warn = console.error } = options;
  if (process.env[`${ENV_PREFIX}TRACKER`] === "off" || process.env.STACKRA_LINEAR === "off") return;
  let { scheme, tracker } = options;
  let problem;
  if (!scheme) {
    try {
      ({ scheme, tracker, problem } = trackerFor(root, { warn: () => {} }));
    } catch (error) {
      warn(
        `${NAME} gate: warning: the tracker was not told the stage (${/** @type {Error} */ (error).message})`,
      );
      return;
    }
  }
  const raw = readFileSync(file, "utf8").match(/^\*\*(?:Linear|Issue)\*\*:\s*(\S+)/m)?.[1];
  const key = raw && scheme.parse(raw);
  if (!key) return;
  const shown = scheme.display(key);
  try {
    if (!tracker) throw new Error(problem ?? "no tracker");
    await tracker.comment(shown, `Spec stage: ${stage} (${file.replace(`${root}/`, "")})`);
    if (stage === "implementing") await tracker.inProgress(shown, "");
  } catch (error) {
    warn(
      `${NAME} gate: warning: ${shown} was not told the stage ${stage} (${/** @type {Error} */ (error).message})`,
    );
  }
}

export function gate(file) {
  const problems = checkSpec(readFileSync(file, "utf8"));
  for (const p of problems) console.error(`spec-gate: ${file}: ${p}`);
  return problems.length;
}

const readIf = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const knownRoutes = () => routes(readIf(join(ROOT, ".agents/routing.yaml")));

function stageGate(dir, { requireReady = false } = {}) {
  const spec = join(dir, "spec.md");
  const problems = existsSync(spec)
    ? checkStage(basename(dir), readFileSync(spec, "utf8"), {
        files: readdirSync(dir),
        tasks: readIf(join(dir, "tasks.md")),
        plan: readIf(join(dir, "plan.md")),
        known: knownRoutes(),
      })
    : [existsSync(dir) ? "spec.md is missing" : "no such spec folder"];
  const status = statusOf(readIf(spec));
  if (requireReady && !["abandoned", "superseded"].includes(status) && !atLeast(status, "tasked"))
    problems.push(
      `status ${status || "(none)"} on a ready-for-review PR: a spec PR stays a draft until Tasked (SPEC_GATE_REQUIRE_READY)`,
    );
  for (const p of problems) console.error(`spec-gate: ${relative(ROOT, dir)}: ${p}`);
  return problems.length;
}

/** Spec folders under .agents/specs changed since `base`, and any path still under a root `specs/`. */
function changedSpecs(base) {
  let names = "";
  try {
    names = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], {
      cwd: ROOT,
      encoding: "utf8",
    });
  } catch {
    console.log(`spec-gate: no ${base} to diff against; skipping`);
  }
  const lines = names.split("\n");
  const { dir: specs, bugsDir } = specsDirs(ROOT);
  const under = (/** @type {string} */ base, /** @type {string} */ n) =>
    n.startsWith(`${base}/`) ? n.slice(base.length + 1).split("/") : [];
  // A spec folder is `<specs>/<folder>/…`; the bug lane's own folder is not one.
  const features = new Set(
    lines.flatMap((n) => {
      const [folder, ...rest] = under(specs, n);
      return folder && rest.length && `${specs}/${folder}` !== bugsDir
        ? [`${specs}/${folder}`]
        : [];
    }),
  );
  const bugs = new Set(
    lines.flatMap((n) => {
      const [folder, ...rest] = under(bugsDir, n);
      return folder && rest.length ? [`${bugsDir}/${folder}`] : [];
    }),
  );
  return {
    names: lines.filter(Boolean),
    bugs: [...bugs].filter((p) => existsSync(join(ROOT, p))),
    dirs: [...features].map((f) => join(ROOT, f)).filter((p) => existsSync(p)),
    legacy: lines.filter((n) => n.startsWith("specs/") && existsSync(join(ROOT, n))),
  };
}

const git = (...a) => {
  try {
    // stderr is piped: a missing path at the base (a spec new on this branch) is an expected miss, not output
    return execFileSync("git", a, {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 << 20,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return "";
  }
};
const currentBranch = () => process.env.STACKRA_BRANCH || git("branch", "--show-current").trim();

/** Spec keys that exist, and the `[<KEY>]` keys in any tasks.md (phase and task sub-issues). */
function specIndex() {
  const keys = repoScheme();
  const base = join(ROOT, SPECS_DIR);
  const folders = existsSync(base) ? readdirSync(base) : [];
  const specKeys = new Set(folders.flatMap((f) => keys.folderKey(f) ?? []));
  const task = new RegExp(`\\[(${keys.pattern})\\]`, "gi");
  const taskKeys = new Set(
    folders.flatMap((f) =>
      [...readIf(join(base, f, "tasks.md")).matchAll(task)].map((m) => m[1].toLowerCase()),
    ),
  );
  return { specKeys, taskKeys };
}

/** The PR's commit messages since `base`, merges excluded. */
const prCommits = (base) =>
  git("log", "--no-merges", "--format=%B%x00", `${base}..HEAD`)
    .split("\0")
    .map((c) => c.trim())
    .filter(Boolean);

/** AC-052: the diff against what the branch's own spec's role may change here; nothing without a roster. */
function roleGate(base) {
  const team = loadTeam(ROOT);
  if (!team) return [];
  const dir = join(ROOT, SPECS_DIR);
  const own = (existsSync(dir) ? readdirSync(dir) : []).find((f) => isOwnSpec(f, currentBranch()));
  if (own === undefined) return [];
  const slug = git("remote", "get-url", "origin").match(
    /github\.com[:/]+([^/]+\/[^/\s]+?)(?:\.git)?\/?\s*$/,
  )?.[1];
  const files = git("diff", "--name-only", `${base}...HEAD`).split("\n").filter(Boolean);
  return pathProblems(team, roleOf(readIf(join(dir, own, "spec.md"))), slug, files);
}

function laneGate(base) {
  const branch = currentBranch();
  const lane = checkLane({ commits: prCommits(base), branch, ...specIndex() });
  // ADR 0502: the diff's floor against the branch's own spec; none is trivial, a spec without a tier is exempt.
  const dir = join(ROOT, SPECS_DIR);
  const own = (existsSync(dir) ? readdirSync(dir) : []).find((f) => isOwnSpec(f, branch));
  const declared = own === undefined ? undefined : tierOf(readIf(join(dir, own, "spec.md")));
  if (own !== undefined && declared === undefined) return lane;
  const changes = git("diff", "--name-status", `${base}...HEAD`)
    .split("\n")
    .filter(Boolean)
    .map((row) => {
      const [status = "", ...paths] = row.split("\t");
      return { status, path: paths.at(-1) ?? "" };
    });
  const computed = computedTier(changes);
  return [...lane, ...checkTier({ declared, computed: computed.tier, reasons: computed.reasons })];
}

/** checkForeignStatus for every changed spec folder, against its spec.md at the merge base. */
function foreignStatusGate(base, dirs) {
  const mergeBase = git("merge-base", base, "HEAD").trim();
  if (!mergeBase) return [];
  const branch = currentBranch();
  const commits = prCommits(base);
  return dirs.flatMap((dir) =>
    checkForeignStatus({
      folder: basename(dir),
      before: git("show", `${mergeBase}:${relative(ROOT, join(dir, "spec.md"))}`),
      after: readIf(join(dir, "spec.md")),
      branch,
      commits,
    }),
  );
}

/** Text of every test file under a `__tests__/` folder, for `@covers` lookups. */
export function testsText(root = ROOT) {
  const files = git("ls-files", "*__tests__/*")
    .split("\n")
    .filter((f) => /\.test\.[cm]?[jt]sx?$/.test(f));
  return files.map((f) => readIf(join(root, f))).join("\n");
}

function report(problems) {
  for (const p of problems) console.error(`spec-gate: ${p}`);
  return problems.length;
}

export function run([mode, ...args]) {
  // phase 2: the checks on a box, posted as `figentra-flow/gate` (STA-1729)
  if (mode === "run") return import("./gate-run.mjs").then((m) => m.run(args));
  // the check command alone, for a runner that runs it itself (the github-actions workflow's `check` job)
  if (mode === "command")
    return import("./gate-run.mjs").then((m) => (console.log(m.checkCommand(ROOT)), 0));
  const [arg, stage] = args;
  if (mode === "plan" && arg) {
    if (gate(arg)) return 1;
    return trackerStage(arg, "clarified").then(() => 0);
  }
  if (mode === "stage" && arg && STAGES.includes(stage)) {
    return trackerStage(arg, stage).then(() => 0);
  }
  if (mode === "dir") {
    const opt = (name) =>
      args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined;
    let branch = "";
    try {
      branch = execFileSync("git", ["branch", "--show-current"], { cwd: ROOT, encoding: "utf8" });
    } catch {
      // not a git checkout: no branch, so --key and --slug decide
    }
    const { dir, error } = specDir({ branch: branch.trim(), key: opt("key"), slug: opt("slug") });
    if (error) {
      console.error(`spec-gate: ${error}`);
      return 1;
    }
    // Every later `figentra-flow spec` call resolves the spec folder from here (ADR 0510).
    writeCurrent(ROOT, dir ?? "");
    console.log(dir);
    return 0;
  }
  const base = args.find((a) => a.startsWith("--base="))?.slice(7) ?? "origin/main";
  if (mode === "check" && arg) return stageGate(resolve(arg)) ? 1 : 0;
  if (mode === "tasks" && arg) {
    const dir = dirname(resolve(arg));
    const team = loadTeam(ROOT);
    const roles = team ? checkTaskRoles(readFileSync(arg, "utf8"), team) : undefined;
    // AC-048: a task with no role is the lead's to assign, never a guess.
    for (const t of roles?.unassigned ?? [])
      console.warn(`spec-gate: for the lead: ${t} has no role`);
    return report([
      ...(roles?.problems ?? []),
      ...checkTasks(readFileSync(arg, "utf8"), {
        spec: readIf(join(dir, "spec.md")),
        plan: readIf(join(dir, "plan.md")),
        known: knownRoutes(),
      }),
    ])
      ? 1
      : 0;
  }
  if (mode === "lane") return report(laneGate(base)) ? 1 : 0;
  if (mode === "branch") {
    for (const p of checkBranch(currentBranch()))
      console.warn(
        `spec-gate: warning: ${p} (fine for a PR labelled chore-lane; check-pr enforces it)`,
      );
    return 0;
  }
  if (mode === "ci") {
    let failures = 0;
    for (const p of installProblems(ROOT)) {
      console.error(`spec-gate: install: ${p}`);
      failures++;
    }
    const { dirs, legacy, bugs } = changedSpecs(base);
    for (const p of legacy) {
      console.error(`spec-gate: ${p}: specs live in ${SPECS_DIR}/<key>-<slug>/, not specs/`);
      failures++;
    }
    const requireReady = process.env.SPEC_GATE_REQUIRE_READY === "1";
    const branch = currentBranch();
    for (const dir of dirs)
      failures += stageGate(dir, {
        requireReady: requireReady && isOwnSpec(basename(dir), branch),
      });
    failures += report(foreignStatusGate(base, dirs));
    if (bugs.length) {
      const tests = testsText();
      for (const b of bugs) failures += report(checkBug(basename(b), tests));
    }
    failures += report(laneGate(base));
    failures += report(loadTeam(ROOT)?.problems.map((p) => `team: ${p}`) ?? []);
    failures += report(roleGate(base));
    say(
      failures ? "blocked" : "approved",
      failures ? `spec-gate: ${failures} problem(s)` : "spec-gate: the specs pass",
    );
    return failures ? 1 : 0;
  }
  console.error(
    `usage: ${NAME} gate run [--ref <branch>] [--box <host>] [-- <runner flags>] | command | plan <spec.md> | check <dir> | tasks <tasks.md> | lane | branch | ci [--base=ref] | stage <spec.md> <${STAGES.join("|")}> | dir [--slug s] [--key <key>]`,
  );
  return 2;
}
