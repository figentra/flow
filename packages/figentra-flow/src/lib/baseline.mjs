/**
 * Figentra Flow file contract:
 * Purpose: the baseline gate's logic (STA-1942): read one tool's per-task results, compare a PR run with main's
 *   baseline (the PR passes when its failed set is a subset of main's), find that baseline among the base SHA's
 *   ancestors, and render the job-summary table.
 * Boundary: pure but for `findBaseline`, which reads GitHub through the `api` it is given.
 * Runtime: node
 * Governing contract: STA-1942 FR-1 to FR-4.
 * Secrets: none.
 */
import { NAME } from "./product.mjs";

/** @typedef {Record<string, "pass" | "fail">} Results task id → outcome */

/** How far back `findBaseline` looks for an ancestor with a baseline. */
export const ANCESTORS = 30;

/** The artifact a push to the default branch leaves at `sha`. */
export const artifactName = (/** @type {string} */ sha) => `${NAME}-baseline-${sha}`;

/**
 * Readers: one tool's output to per-task results. A task passes only when it ran and exited 0.
 * @type {Record<string, (summary: any) => Results>}
 */
export const READERS = {
  // `turbo run … --summarize` (.turbo/runs/<id>.json); `<NONEXISTENT>` is a package without that script.
  turbo: (summary) =>
    Object.fromEntries(
      (summary?.tasks ?? [])
        .filter((/** @type {any} */ t) => t.command !== "<NONEXISTENT>")
        .map((/** @type {any} */ t) => [t.taskId, t.execution?.exitCode === 0 ? "pass" : "fail"]),
    ),
};

/**
 * The PR's results against main's.
 * @param {Results} base
 * @param {Results} pr
 */
export function compare(base, pr) {
  const failed = (/** @type {Results} */ r) =>
    Object.keys(r)
      .filter((t) => r[t] === "fail")
      .toSorted();
  const newFailures = failed(pr).filter((t) => base[t] !== "fail");
  const stillFailing = failed(pr).filter((t) => base[t] === "fail");
  const fixed = failed(base).filter((t) => pr[t] === "pass");
  return { ok: newFailures.length === 0, newFailures, fixed, stillFailing };
}

/**
 * The job-summary Markdown.
 * @param {ReturnType<typeof compare>} result
 * @param {string} from the baseline's SHA
 */
export function summaryTable({ ok, newFailures, fixed, stillFailing }, from) {
  const cell = (/** @type {string[]} */ ts) =>
    ts.length ? ts.map((t) => `\`${t}\``).join("<br>") : "none";
  return [
    `### Baseline: ${ok ? "no new failures" : `${newFailures.length} new failure(s)`}`,
    "",
    `Compared with main's baseline at \`${from}\`.`,
    "",
    "| New failures | Fixed | Still failing |",
    "| --- | --- | --- |",
    `| ${cell(newFailures)} | ${cell(fixed)} | ${cell(stillFailing)} |`,
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
