/**
 * Figentra Flow file contract:
 * Purpose: the baseline gate's logic (STA-1942): read one tool's per-task results, compare a PR run with main's
 *   baseline (the PR passes when its failed set is a subset of main's, a failure newly reached behind a repaired
 *   upstream task of its own package excepted, STA-1945 FR-22), find that baseline among the base SHA's
 *   ancestors, and render the job-summary table.
 * Boundary: pure but for `findBaseline`, which reads GitHub through the `api` it is given.
 * Runtime: node
 * Governing contract: STA-1942 FR-1 to FR-4; STA-1945 FR-22.
 * Secrets: none.
 */
import { NAME } from "./product.mjs";

/** @typedef {Record<string, "pass" | "fail" | "skip">} Results task id → outcome ("skip": listed but never ran) */

/** How far back `findBaseline` looks for an ancestor with a baseline. */
export const ANCESTORS = 30;

/** The artifact a push to the default branch leaves at `sha`. */
export const artifactName = (/** @type {string} */ sha) => `${NAME}-baseline-${sha}`;

/**
 * Readers: one tool's output to per-task results. A task passes only when it ran and exited 0; one that never ran is
 * `skip`, so deleting or skipping a task cannot pass for fixing it.
 * @type {Record<string, (summary: any) => Results>}
 */
export const READERS = {
  // `turbo run … --summarize` (.turbo/runs/<id>.json); `<NONEXISTENT>` is a package without that script.
  turbo: (summary) =>
    Object.fromEntries(
      (summary?.tasks ?? [])
        .filter((/** @type {any} */ t) => t.command !== "<NONEXISTENT>")
        .map((/** @type {any} */ t) => [
          t.taskId,
          t.execution === undefined ? "skip" : t.execution.exitCode === 0 ? "pass" : "fail",
        ]),
    ),
};

/**
 * Each task's direct upstream task ids (turbo's `dependencies`), which is how `compare` knows why a task never ran.
 * @type {Record<string, (summary: any) => Record<string, string[]>>}
 */
export const NEEDS = {
  turbo: (summary) =>
    Object.fromEntries(
      (summary?.tasks ?? [])
        .filter((/** @type {any} */ t) => t.command !== "<NONEXISTENT>" && t.dependencies?.length)
        .map((/** @type {any} */ t) => [t.taskId, t.dependencies]),
    ),
};

/** A `mustPass` pattern (`*` is any run of characters) as a test on task ids. */
const glob = (/** @type {string} */ p) =>
  new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")}$`);

/**
 * The PR's results against main's (STA-1942 FR-3). It blocks on any of:
 * - a new failure: a task that passed on main, or a new task, fails;
 * - a missing task: one main ran is absent from the PR or never ran there (the inventory may not shrink), unless
 *   its name (after `#`) was dropped: in main's configured `baseline.tasks` (`configured.base`, saved with main's
 *   baseline) but not in the PR's (`configured.pr`). A dependency task turbo ran but nobody configured (`gen`) is
 *   never dropped, and a main baseline saved without its configured tasks drops nothing (STA-1945);
 * - a must-pass task (`mustPass` patterns: tenancy, authz, secrets, licence tests) that is not green, even if main's
 *   is red;
 * - more failures than main has (the debt may not grow).
 * A task that failed or never ran on main and passes now is a gain. A failure that main never reached (it was `skip`
 * there) is newly reached, not new, when an upstream task of the same package (per `needs`, the PR's) is a gain: it
 * is reported with that task, and is no debt. Anything else, a task that passed on main included, is a new failure.
 * @param {Results} base
 * @param {Results} pr
 * @param {{ mustPass?: string[], needs?: Record<string, string[]>,
 *           configured?: { base?: string[], pr?: string[] } }} [options]
 */
export function compare(base, pr, { mustPass = [], needs = {}, configured = {} } = {}) {
  const sorted = (/** @type {Results} */ r, /** @type {string} */ state) =>
    Object.keys(r)
      .filter((t) => r[t] === state)
      .toSorted();
  const gains = Object.keys(base)
    .filter((t) => base[t] !== "pass" && pr[t] === "pass")
    .toSorted();
  const pkg = (/** @type {string} */ t) => t.split("#")[0];
  const unblocker = (/** @type {string} */ t) =>
    base[t] === "skip"
      ? (needs[t] ?? []).find((u) => pkg(u) === pkg(t) && gains.includes(u))
      : undefined;
  const reached = sorted(pr, "fail").filter((t) => unblocker(t));
  const newlyReached = reached.map((task) => ({ task, unblockedBy: String(unblocker(task)) }));
  const newFailures = sorted(pr, "fail").filter((t) => base[t] !== "fail" && !reached.includes(t));
  const stillFailing = sorted(pr, "fail").filter((t) => base[t] === "fail");
  const { base: was = [], pr: now } = configured;
  const dropped = now ? was.filter((n) => !now.includes(n)) : [];
  const missing = Object.keys(base)
    .filter((t) => base[t] !== "skip" && (pr[t] === undefined || pr[t] === "skip"))
    .filter((t) => !dropped.includes(t.split("#")[1]))
    .toSorted();
  const must = mustPass.map(glob);
  const mustPassFailures = [...new Set([...Object.keys(pr), ...Object.keys(base)])]
    .filter((t) => must.some((m) => m.test(t)) && pr[t] !== "pass")
    .toSorted();
  const debt = {
    base: sorted(base, "fail").length,
    pr: sorted(pr, "fail").length - reached.length,
  };
  const ok =
    !newFailures.length && !missing.length && !mustPassFailures.length && debt.pr <= debt.base;
  return { ok, newFailures, missing, mustPassFailures, gains, newlyReached, stillFailing, debt };
}

/**
 * The job-summary Markdown.
 * @param {ReturnType<typeof compare>} result
 * @param {string} from the baseline's SHA
 */
export function summaryTable(result, from) {
  const { ok, newFailures, missing, mustPassFailures, gains, newlyReached, stillFailing, debt } =
    result;
  const cell = (/** @type {string[]} */ ts) =>
    ts.length ? ts.map((t) => `\`${t}\``).join("<br>") : "none";
  const blocking = newFailures.length + missing.length + mustPassFailures.length;
  return [
    `### Baseline: ${ok ? "no new failures" : `blocked (${blocking} blocking task(s); failures ${debt.base} → ${debt.pr})`}`,
    "",
    `Compared with main's baseline at \`${from}\`. A merge gate, not a release certificate: a release still needs a`,
    "fully green product matrix.",
    "",
    "| New failures | Missing or skipped | Must pass, not green | Gains | Newly reached | Still failing |",
    "| --- | --- | --- | --- | --- | --- |",
    `| ${cell(newFailures)} | ${cell(missing)} | ${cell(mustPassFailures)} | ${cell(gains)} | ${cell(newlyReached.map((r) => `${r.task} (unblocked by ${r.unblockedBy})`))} | ${cell(stillFailing)} |`,
    "",
  ].join("\n");
}

/**
 * The nearest baseline for `base`: its own, or its nearest ancestor's (up to `ANCESTORS`). An artifact counts only
 * when a `push` run on the default branch made it at exactly that SHA, so a PR run cannot plant one.
 * @param {{ api: (method: string, path: string) => Promise<{ ok: boolean, json: any }>, repo: string, base: string }} input
 * @returns {Promise<{ sha: string, runId: number, name: string } | { searched: string[] }>}
 */
export async function findBaseline({ api, repo, base }) {
  const branch = (await api("GET", `/repos/${repo}`)).json?.default_branch;
  const commits = (await api("GET", `/repos/${repo}/commits?sha=${base}&per_page=${ANCESTORS}`))
    .json;
  const shas = Array.isArray(commits) ? commits.map((/** @type {any} */ c) => c.sha) : [base];
  for (const sha of shas) {
    const name = artifactName(sha);
    const list = (await api("GET", `/repos/${repo}/actions/artifacts?name=${name}&per_page=20`))
      .json?.artifacts;
    for (const a of Array.isArray(list) ? list : []) {
      const run = a.workflow_run;
      if (a.expired || run?.head_sha !== sha || run?.head_branch !== branch) continue;
      const event = (await api("GET", `/repos/${repo}/actions/runs/${run.id}`)).json?.event;
      if (event === "push") return { sha, runId: run.id, name };
    }
  }
  return { searched: shas };
}
