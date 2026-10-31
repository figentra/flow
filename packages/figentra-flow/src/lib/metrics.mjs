/**
 * Figentra Flow file contract:
 * Purpose: delivery metrics for `figentra-flow status --metrics` (AC-032), computed on demand from GitHub and the specs
 *   with nothing stored: for the PRs merged in the window, per repository and in total, lead time (opened → merged)
 *   and cycle time (first commit → merged) as median and p90 hours, `figentra-flow/gate` runs per PR and their red
 *   share, rework (heads pushed after the first gate), review rounds (`AI-REVIEW: FAIL` verdicts before the merge) and
 *   approval latency (days from a merged spec's Draft line to its last approval in its Status history); and the age of
 *   the open PRs.
 * Boundary: reads GitHub through each repository's credentials and the spec files of its checkout; writes nothing.
 * Runtime: node
 * Governing contract: STA-1729 phase 4 (the leader's plan stop of 2026-10-31, decision 1).
 * Secrets: none.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { schemeFor } from "../adapters/tracker/index.mjs";
import { SPECS_DIR } from "../commands/gate.mjs";
import { STATUS_CONTEXT } from "./product.mjs";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A verdict comment's first line: `AI-REVIEW: FAIL …` (any spacing or case). */
const FAIL_LINE = /^\W*AI-REVIEW\W*FAIL/i;

/**
 * The value at quantile `q` (0..1) of `values` by the nearest-rank method, or null for none.
 * @param {number[]} values
 * @param {number} q
 */
export function quantile(values, q) {
  if (!values.length) return null;
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)];
}

const round1 = (/** @type {number | null} */ n) => (n === null ? null : Math.round(n * 10) / 10);
const spread = (/** @type {number[]} */ values) => ({
  median: round1(quantile(values, 0.5)),
  p90: round1(quantile(values, 0.9)),
});

/**
 * Days from a spec's Draft line to its last approval, from its `## Status history` (dates `YYYY-MM-DD`), or null.
 * @param {string} spec
 */
export function approvalDays(spec) {
  const history =
    spec.match(/^## Status history\b[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m)?.[1] ?? "";
  const lines = history.split("\n").filter((l) => /^\s*-\s*\d{4}-\d{2}-\d{2}/.test(l));
  const dateOf = (/** @type {string} */ l) => Date.parse(l.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "");
  const draft = lines.find((l) => /→\s*Draft\b/i.test(l));
  const approved = lines.filter((l) => /Approved by/i.test(l)).at(-1);
  if (!draft || !approved) return null;
  return Math.max(0, (dateOf(approved) - dateOf(draft)) / DAY);
}

/**
 * One merged PR's numbers.
 * @param {import("./github.mjs").Api} api
 * @param {string} slug
 * @param {any} pr a closed, merged PR from the REST list
 * @param {{ specText?: (branch: string) => string | undefined }} [options]
 */
export function prRecord(api, slug, pr, { specText } = {}) {
  const merged = Date.parse(pr.merged_at);
  const commits = api("GET", `/repos/${slug}/pulls/${pr.number}/commits?per_page=100`).json ?? [];
  const first = Date.parse(commits[0]?.commit?.author?.date ?? pr.created_at);
  // Each commit's own gate statuses: a run is a finished status (success, failure or error) of figentra-flow/gate.
  let runs = 0;
  let red = 0;
  let firstGated = -1;
  commits.forEach((/** @type {any} */ c, /** @type {number} */ i) => {
    const statuses = (
      api("GET", `/repos/${slug}/commits/${c.sha}/statuses?per_page=100`).json ?? []
    ).filter((/** @type {any} */ s) => s.context === STATUS_CONTEXT && s.state !== "pending");
    if (statuses.length && firstGated < 0) firstGated = i;
    runs += statuses.length;
    red += statuses.filter((/** @type {any} */ s) => s.state !== "success").length;
  });
  const comments =
    api("GET", `/repos/${slug}/issues/${pr.number}/comments?per_page=100`).json ?? [];
  const text = specText?.(pr.head?.ref ?? "");
  return {
    number: pr.number,
    leadHours: (merged - Date.parse(pr.created_at)) / HOUR,
    cycleHours: (merged - first) / HOUR,
    gateRuns: runs,
    redRuns: red,
    rework: firstGated < 0 ? 0 : commits.length - 1 - firstGated,
    reviewRounds: comments.filter((/** @type {any} */ c) =>
      FAIL_LINE.test(String(c.body ?? "").trim()),
    ).length,
    approvalDays: text === undefined ? null : approvalDays(text),
  };
}

/**
 * The numbers over a set of PR records and open-PR ages.
 * @param {ReturnType<typeof prRecord>[]} records
 * @param {number[]} openAgeDays
 */
export function summarize(records, openAgeDays) {
  const runs = records.reduce((n, r) => n + r.gateRuns, 0);
  const red = records.reduce((n, r) => n + r.redRuns, 0);
  const sum = (/** @type {"rework" | "reviewRounds"} */ k) => records.reduce((n, r) => n + r[k], 0);
  const per = (/** @type {number} */ n) => (records.length ? round1(n / records.length) : null);
  return {
    merged: records.length,
    leadHours: spread(records.map((r) => r.leadHours)),
    cycleHours: spread(records.map((r) => r.cycleHours)),
    gateRunsPerPr: per(runs),
    redShare: runs ? round1((red / runs) * 100) : null,
    reworkPerPr: per(sum("rework")),
    reviewRoundsPerPr: per(sum("reviewRounds")),
    approvalDays: spread(records.map((r) => r.approvalDays).filter((d) => d !== null)),
    open: openAgeDays.length,
    openAgeDays: spread(openAgeDays),
  };
}

/**
 * The spec text for a branch's issue key in `root`'s checkout, or undefined.
 * @param {string} root
 */
function specReader(root) {
  const keys = schemeFor(root);
  const base = join(root, SPECS_DIR);
  const folders = existsSync(base) ? readdirSync(base) : [];
  return (/** @type {string} */ branch) => {
    const key = keys.keys(branch)[0];
    const folder = key && folders.find((f) => keys.folderKey(f) === key);
    const file = folder && join(base, folder, "spec.md");
    return file && existsSync(file) ? readFileSync(file, "utf8") : undefined;
  };
}

/**
 * Metrics for each repository and in total, over the PRs merged since `since`.
 * @param {{ repos: { path: string, github?: string }[], api: (root: string) => import("./github.mjs").Api,
 *           since: number, now?: number }} options
 */
export function metrics({ repos, api, since, now = Date.now() }) {
  /** @type {ReturnType<typeof prRecord>[]} */
  const all = [];
  /** @type {number[]} */
  const allOpen = [];
  const entries = repos.map((repo) => {
    if (!repo.github) return { path: repo.path, error: "no GitHub repository" };
    try {
      const call = api(repo.path);
      const closed = call(
        "GET",
        `/repos/${repo.github}/pulls?state=closed&sort=updated&direction=desc&per_page=100`,
      );
      if (!closed.ok) throw new Error(closed.err || "listing pull requests failed");
      const specText = specReader(repo.path);
      const records = (closed.json ?? [])
        .filter((/** @type {any} */ p) => p.merged_at && Date.parse(p.merged_at) >= since)
        .map((/** @type {any} */ p) => prRecord(call, repo.github ?? "", p, { specText }));
      const open = (
        call("GET", `/repos/${repo.github}/pulls?state=open&per_page=100`).json ?? []
      ).map((/** @type {any} */ p) => (now - Date.parse(p.created_at)) / DAY);
      all.push(...records);
      allOpen.push(...open);
      return { path: repo.path, github: repo.github, ...summarize(records, open) };
    } catch (error) {
      return { path: repo.path, github: repo.github, error: /** @type {Error} */ (error).message };
    }
  });
  return { since: new Date(since).toISOString(), repos: entries, total: summarize(all, allOpen) };
}
