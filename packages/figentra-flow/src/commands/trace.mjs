/**
 * Figentra Flow file contract:
 * Purpose: `fflow trace` (core's `spec-trace`, moved unchanged) — FR/SC/P → task → `@covers` test traceability and spec-vs-diff drift for specs in
 *   `.agents/specs/sta-<n>-<slug>/` (owner decision OR12; the plan's §3.6).
 *   trace <dir> [--json]    the matrix: each live FR and P with its tasks and covering tests, each SC with its method,
 *                           and the tasks done (with Flow's record, only those with passing evidence: STA-1945 FR-23)
 *   drift <dir> [--base=r]  members changed in the diff that Impact does not name (in `ci`, that no changed spec's
 *                           Impact names); ticked tasks whose paths are gone;
 *                           for a Done spec, Impact "Docs to update" pages the diff does not touch;
 *                           contract drift: a function the plan (a small spec: its `## Design`) declares that its
 *                           component's files lack or declare with another signature (STA-1945 FR-30, AC-33)
 *   ci [--base=r]           for every spec folder changed since the base: at Implementing or later, drift; at Done,
 *                           contract drift (a spec last clarified before the document gates is exempt), every
 *                           live FR and P covered by a test (an FR may be covered through a P that is) and every
 *                           SC naming its verification method. Wired into `pnpm validate`.
 * A test covers an ID with a tag anywhere in a `__tests__/*.test.*` file: `@covers sta-163:FR-001 sta-163:P-002`.
 * Dependency-free; reads files and git only, never Linear or the network.
 * Boundary: reads specs, tasks, tests and the git diff; writes nothing.
 * Runtime: node
 * Governing contract: ADR 0120 (SDLC spec location, lanes and change risk); STA-348; STA-1945 FR-30 (contracts).
 * Secrets: none.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  clarifiedBefore,
  DOCUMENT_GATES_SINCE,
  historyOf,
  repoScheme,
  SPECS_DIR,
  statusOf,
  testsText,
} from "./gate.mjs";
import {
  coversTags,
  definedIds,
  definedLines,
  memberOf,
  parseTasks,
  properties,
  strip,
} from "../lib/spec-parse.mjs";
import { contractDrift } from "../lib/contract-drift.mjs";
import { passed } from "../lib/evidence.mjs";
import { NAME } from "../lib/product.mjs";
import { readRecord } from "../lib/record.mjs";

/** The repository the command runs in: the working directory. */
const ROOT = process.cwd();
const readIf = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");

/**
 * The trace matrix for one spec folder's texts; `tests` is the concatenated text of the test files. With Flow's
 * `record`, a task counts as done only with passing evidence (FR-23); without one (a spec before FR-23), its `[x]`.
 */
export function trace({
  folder,
  spec,
  plan = "",
  tasks = "",
  tests = "",
  keys = repoScheme(),
  record = undefined,
}) {
  const key = keys.folderKey(folder);
  const covered = new Set(coversTags(tests, key));
  const live = parseTasks(tasks).filter((t) => !t.struck);
  const tasksFor = (id) => live.filter((t) => t.covers.includes(id)).map((t) => t.id);
  const props = properties(plan);
  const ps = [...props.keys()].map((id) => ({ id, tasks: tasksFor(id), tested: covered.has(id) }));
  const frs = [...definedIds(spec, "FR").live].map((id) => {
    const via = ps.filter((p) => p.tested && props.get(p.id).includes(id)).map((p) => p.id);
    return { id, tasks: tasksFor(id), tested: covered.has(id), via };
  });
  const scLines = definedLines(spec, "SC");
  const scs = [...definedIds(spec, "SC").live].map((id) => ({
    id,
    method: scLines
      .get(id)
      .match(/verified by:\s*([a-z0-9/ -]+)/i)?.[1]
      ?.trim(),
  }));
  const acs = [...definedIds(spec, "AC").live].map((id) => ({
    id,
    tasks: tasksFor(id),
    tested: covered.has(id),
  }));
  const done = live.map((t) => ({
    id: t.id,
    ticked: t.done,
    done: t.done && (!record || passed(record.tasks[t.id])),
  }));
  return { key, frs, ps, scs, acs, tasks: done };
}

/** Done rules over a trace: every live FR and P tested, every SC with a method. */
export function traceProblems(t) {
  const problems = [];
  for (const fr of t.frs)
    if (!fr.tested && !fr.via.length)
      problems.push(
        `${fr.id} has no test carrying \`@covers ${t.key}:${fr.id}\` (directly or via a P-###)`,
      );
  for (const p of t.ps)
    if (!p.tested) problems.push(`${p.id} has no test carrying \`@covers ${t.key}:${p.id}\``);
  for (const ac of t.acs ?? [])
    if (!ac.tested)
      problems.push(`${ac.id} has no test carrying \`@covers ${t.key}:${ac.id}\` (ADR 0502)`);
  for (const sc of t.scs)
    if (!sc.method)
      problems.push(`${sc.id} names no verification method ("— verified by: unit|e2e|k6|manual")`);
  for (const task of t.tasks ?? [])
    if (task.ticked && !task.done)
      problems.push(
        `${task.id} is ticked without passing evidence in the record (\`${NAME} task done\`; FR-23)`,
      );
  return problems;
}

/** The text of a spec's `## Impact` section. */
export function impactOf(spec) {
  return strip(spec).match(/^## Impact\b[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m)?.[1] ?? "";
}

/**
 * Drift between a spec and the changed paths. `exists` tells whether a repo path exists; `named` holds the members
 * another spec in the same diff already names (one branch may carry many specs, as the STA-348 build does).
 * @param {{ spec: string, tasks?: string, changed?: string[], exists?: (path: string) => boolean, named?: Set<string> }} options
 */
export function drift({ spec, tasks = "", changed = [], exists = () => true, named = new Set() }) {
  const problems = [];
  const impact = impactOf(spec);
  const members = new Set(changed.map(memberOf).filter(Boolean));
  for (const m of members)
    if (!impact.includes(m) && !named.has(m))
      problems.push(`the diff changes \`${m}\`, which no spec in the diff names in its Impact`);
  for (const t of parseTasks(tasks).filter((x) => x.done && !x.struck))
    for (const p of t.paths)
      if (/\//.test(p) && !/[[\]<>*]/.test(p) && !exists(p))
        problems.push(`${t.id} is ticked, but its path \`${p}\` does not exist`);
  if (statusOf(spec) === "done") {
    const docs = impact.match(/^- \*\*Docs to update\*\*:(.*)$/m)?.[1] ?? "";
    for (const d of docs.match(/apps\/docs\/src\/[^\s`,;)]+/g) ?? [])
      if (!changed.includes(d))
        problems.push(`status done, but Impact's doc \`${d}\` is not touched by this diff`);
  }
  return problems;
}

const git = (...a) => {
  try {
    return execFileSync("git", a, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 << 20 });
  } catch {
    return null;
  }
};

function load(dir) {
  const key = repoScheme().folderKey(basename(dir));
  return {
    folder: basename(dir),
    spec: readIf(join(dir, "spec.md")),
    plan: readIf(join(dir, "plan.md")),
    tasks: readIf(join(dir, "tasks.md")),
    // a record that fails its schema throws: trace fails closed
    record: key ? readRecord(ROOT, key) : undefined,
  };
}

/** Whether the repository-relative path `p` exists. */
const existsInRepo = (p) => existsSync(join(ROOT, p));

/** The repository-relative file `p`'s text, or undefined for a folder or a missing path. */
const readInRepo = (/** @type {string} */ p) => {
  const file = join(ROOT, p);
  return existsSync(file) && statSync(file).isFile() ? readFileSync(file, "utf8") : undefined;
};

/** FR-30's contract drift for a loaded spec folder: its plan, or a small spec's `## Design`. */
const contracts = (/** @type {{ spec: string, plan: string }} */ s) =>
  contractDrift(s.plan.trim() ? s.plan : s.spec, readInRepo);

export function run([mode, ...args]) {
  const base = args.find((a) => a.startsWith("--base="))?.slice(7) ?? "origin/main";
  const dir = args.find((a) => !a.startsWith("--"));
  const changed = () => {
    const out = git("diff", "--name-only", `${base}...HEAD`);
    if (out === null) console.log(`spec-trace: no ${base} to diff against; skipping`);
    return (out ?? "").split("\n").filter(Boolean);
  };
  if (mode === "trace" && dir) {
    const loaded = load(resolve(dir));
    const t = trace({ ...loaded, tests: testsText() });
    if (args.includes("--json")) return (console.log(JSON.stringify(t, null, 2)), 0);
    for (const r of /** @type {{ id: string, tasks: string[], tested: boolean, via?: string[] }[]} */ ([
      ...t.frs,
      ...t.ps,
    ]))
      console.log(
        `${r.id.padEnd(7)} tasks: ${r.tasks.join(", ") || "—"}  tests: ${r.tested ? "yes" : r.via?.length ? `via ${r.via.join(", ")}` : "no"}`,
      );
    for (const sc of t.scs) console.log(`${sc.id.padEnd(7)} verified by: ${sc.method ?? "—"}`);
    console.log(
      `tasks done: ${t.tasks.filter((x) => x.done).length} of ${t.tasks.length}${loaded.record ? "" : " (no record: by marker)"}`,
    );
    return 0;
  }
  if (mode === "drift" && dir) {
    const loaded = load(resolve(dir));
    const problems = [
      ...drift({ ...loaded, changed: changed(), exists: existsInRepo }),
      ...contracts(loaded),
    ];
    for (const p of problems) console.error(`spec-trace: ${p}`);
    return problems.length ? 1 : 0;
  }
  if (mode === "ci") {
    const names = changed();
    const dirs = [
      ...new Set(names.flatMap((n) => n.match(/^\.agents\/specs\/[^/]+(?=\/)/)?.slice(0, 1) ?? [])),
    ]
      .map((d) => join(ROOT, d))
      .filter((d) => existsSync(join(d, "spec.md")));
    const specs = dirs.map(load);
    const members = new Set(names.map(memberOf).filter(Boolean));
    const named = new Set(
      [...members].filter((m) => specs.some((s) => impactOf(s.spec).includes(m))),
    );
    let failures = 0;
    let tests;
    for (const s of specs) {
      const status = statusOf(s.spec);
      if (status !== "implementing" && status !== "done") continue;
      const problems = drift({ ...s, changed: names, exists: existsInRepo, named });
      if (status === "done")
        problems.push(
          // a spec approved before FR-27's interface blocks was not written for this check
          ...(clarifiedBefore(historyOf(s.spec), DOCUMENT_GATES_SINCE) ? [] : contracts(s)),
          ...traceProblems(trace({ ...s, tests: (tests ??= testsText()) })),
        );
      for (const p of problems) console.error(`spec-trace: ${SPECS_DIR}/${s.folder}: ${p}`);
      failures += problems.length;
    }
    return failures ? 1 : 0;
  }
  console.error(
    `usage: ${NAME} trace trace <dir> [--json] | drift <dir> [--base=ref] | ci [--base=ref]`,
  );
  return 2;
}
