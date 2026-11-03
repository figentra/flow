/**
 * Figentra Flow file contract:
 * Purpose: `fflow gate baseline` (STA-1942), run by the baseline workflow `sync` renders:
 *   save [--summary f] [--reader turbo]   the newest run summary's per-task results → .fflow-gate/baseline.json
 *   check --base <sha> [--json]           those results against main's baseline for the base SHA or its nearest
 *                                         ancestor; fails on a new failure and, closed, when no baseline exists
 *                                         (`--json` then prints `{ ok: false, reason }`)
 * Boundary: reads the run summary and, for `check`, GitHub (artifacts and runs) with the job's GITHUB_TOKEN and
 *   `gh run download`; writes baseline.json and the job summary.
 * Runtime: node (GitHub Actions)
 * Governing contract: STA-1942 FR-2 to FR-4; STA-1945 FR-22 (`needs`, `--json`).
 * Secrets: GITHUB_TOKEN from the environment; never printed.
 */
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { rest } from "../lib/approve-check.mjs";
import { BASELINE_DEFAULTS } from "../lib/baseline-workflow.mjs";
import { compare, findBaseline, NEEDS, READERS, summaryTable } from "../lib/baseline.mjs";
import { loadConfig } from "../lib/config.mjs";
import { GATE_DIR, NAME } from "../lib/product.mjs";

const FILE = "baseline.json";

/** The newest `.turbo/runs/*.json` under `root`, or undefined. */
function newestSummary(/** @type {string} */ root) {
  const dir = join(root, ".turbo", "runs");
  if (!existsSync(dir)) return undefined;
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => join(dir, f))
    .toSorted((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

/**
 * @param {string[]} argv
 * @param {{ root?: string, env?: Record<string, string | undefined>, log?: (s: string) => void,
 *           api?: (method: string, path: string) => Promise<{ ok: boolean, json: any }>,
 *           out?: (s: string) => void,
 *           download?: (repo: string, runId: number, name: string) => string | undefined }} [deps]
 * @returns {Promise<number>}
 */
export async function run([mode, ...args], deps = {}) {
  const root = deps.root ?? process.cwd();
  const env = deps.env ?? process.env;
  const log = deps.log ?? console.error;
  const opt = (/** @type {string} */ n) =>
    args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined;
  const own = join(root, GATE_DIR, FILE);

  if (mode === "save") {
    const reader = opt("reader") ?? "turbo";
    const file = opt("summary") ?? newestSummary(root);
    if (!READERS[reader]) return (log(`${NAME} gate baseline: no reader "${reader}"`), 2);
    if (!file || !existsSync(file))
      return (log(`${NAME} gate baseline: no run summary (turbo --summarize)`), 1);
    const tasks = READERS[reader](JSON.parse(readFileSync(file, "utf8")));
    if (!Object.keys(tasks).length)
      return (log(`${NAME} gate baseline: the run summary holds no task`), 1);
    mkdirSync(join(root, GATE_DIR), { recursive: true });
    const needs = NEEDS[reader]?.(JSON.parse(readFileSync(file, "utf8"))) ?? {};
    writeFileSync(
      own,
      `${JSON.stringify({ version: 1, sha: env.GITHUB_SHA ?? "", reader, tasks, needs }, null, 2)}\n`,
    );
    log(`${NAME} gate baseline: ${Object.keys(tasks).length} task(s) saved to ${GATE_DIR}/${FILE}`);
    return 0;
  }

  if (mode === "check") {
    const base = opt("base") ?? "";
    const repo = String(env.GITHUB_REPOSITORY ?? "");
    if (!/^[0-9a-f]{40}$/.test(base))
      return (log(`${NAME} gate baseline: --base must be a 40-hex SHA`), 2);
    const json = (/** @type {object} */ o) =>
      args.includes("--json") && (deps.out ?? console.log)(JSON.stringify(o, null, 2));
    // a fail-closed path still answers `--json`, so a consumer parsing stdout never reads an empty string
    const closed = (/** @type {string} */ reason) =>
      (json({ ok: false, reason }), 1);
    if (!existsSync(own))
      return (log(`${NAME} gate baseline: run \`save\` first`), closed("not_saved"));
    const api = deps.api ?? rest(String(env.GITHUB_TOKEN), env.GITHUB_API_URL);
    const found = await findBaseline({ api, repo, base });
    /** @param {string} text */
    const summary = (text) =>
      env.GITHUB_STEP_SUMMARY ? appendFileSync(env.GITHUB_STEP_SUMMARY, text) : log(text);
    if ("searched" in found) {
      summary(
        `### Baseline: no baseline\n\nNo push to the default branch left a baseline at \`${base}\` or its ` +
          `${found.searched.length - 1} nearest ancestors, so this fails closed. Re-run the baseline workflow on main.\n`,
      );
      return closed("no_baseline");
    }
    const dir = (deps.download ?? download)(repo, found.runId, found.name);
    const file = dir && join(dir, FILE);
    if (!file || !existsSync(file))
      return (
        log(`${NAME} gate baseline: ${found.name} could not be downloaded`),
        closed("download_failed")
      );
    const mine = JSON.parse(readFileSync(own, "utf8"));
    const configured = loadConfig(root).config.baseline;
    const result = compare(JSON.parse(readFileSync(file, "utf8")).tasks ?? {}, mine.tasks, {
      mustPass: configured?.mustPass,
      needs: mine.needs,
      tasks: configured?.tasks ?? BASELINE_DEFAULTS.tasks,
    });
    json({ ...result, baselineSha: found.sha });
    summary(summaryTable(result, found.sha));
    return result.ok ? 0 : 1;
  }

  log(`usage: ${NAME} gate baseline save [--summary <file>] [--reader turbo] | check --base <sha>`);
  return 2;
}

/** `gh run download` into a fresh folder; the folder, or undefined when it failed. */
function download(
  /** @type {string} */ repo,
  /** @type {number} */ runId,
  /** @type {string} */ name,
) {
  const dir = mkdtempSync(join(tmpdir(), `${NAME}-baseline-`));
  const r = spawnSync("gh", ["run", "download", String(runId), "-R", repo, "-n", name, "-D", dir], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  return r.status === 0 ? dir : undefined;
}
