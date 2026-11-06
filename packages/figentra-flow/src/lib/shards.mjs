/**
 * Figentra Flow file contract:
 * Purpose: the gate fan-out's package shards (FR-15, C14): `workspacePackages` lists a pnpm workspace's packages,
 *   `shard` deals them into at most one group per box, `shardCommand` fills a group into `gate.shard`'s `{filters}`,
 *   and `combine` turns every shard's testbed result into the one `fflow/gate` verdict: green only when each passed.
 * Boundary: `workspacePackages` reads `pnpm-workspace.yaml` and the folders it names, and names a pattern or folder
 *   it cannot read rather than skip it; the rest is pure.
 * Runtime: node
 * Governing contract: STA-1945 (FR-15, AC-41, P-021); the testbed contract (STA-2042, core #315 FR-010 to FR-012).
 * Secrets: none.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parseYaml, YamlError } from "./yaml.mjs";

/** The most shards one gate runs: the testbed's slots across its four regions (4 heavy, 8 light). */
export const MAX_SHARDS = 12;

/** The testbed's own exit codes: no free slot under `--no-wait`, no healthy box (both retried), the 3-hour limit. */
export const NO_SLOT = 73;
export const NO_BOX = 75;
export const TIMED_OUT = 124;
/** A run stopped by Ctrl-C or SIGTERM: it decided nothing about the code, so it counts as infrastructure. */
export const INTERRUPTED = 130;

/** A pattern segment or package folder name this reads: plain characters, safe on a shell line. */
const PLAIN = /^[\w@.-]+$/;

/**
 * The workspace's package folders (repo-relative, sorted) from `pnpm-workspace.yaml`'s `packages`; a `!` pattern
 * excludes. Undefined when there is no workspace file. Each segment of a pattern is a folder name or `*` (every
 * folder at that level but dot-folders and `node_modules`, as pnpm reads it); any other glob (`**`, `?`, braces), a
 * `packages` that is not a list, or a package folder whose name a shell line cannot take is a problem, never skipped:
 * a package left out would be green without a test (AC-41).
 * @param {string} root
 * @returns {{ packages: string[] } | { problem: string } | undefined}
 */
export function workspacePackages(root) {
  const file = join(root, "pnpm-workspace.yaml");
  if (!existsSync(file)) return undefined;
  let patterns;
  try {
    patterns = parseYaml(readFileSync(file, "utf8"))?.packages;
  } catch (error) {
    if (!(error instanceof YamlError)) throw error;
    return { problem: `pnpm-workspace.yaml: ${error.message}` };
  }
  if (!Array.isArray(patterns) || !patterns.every((p) => typeof p === "string"))
    return { problem: "pnpm-workspace.yaml's `packages` is not a list of folder patterns" };
  const segments = (/** @type {string} */ p) => p.replace(/^!/, "").replace(/^\.\//, "").split("/");
  const bad = patterns.find(
    (p) => !segments(p).every((s) => s === "*" || (PLAIN.test(s) && !/^\.+$/.test(s))),
  );
  if (bad !== undefined)
    return {
      problem: `pnpm-workspace.yaml: \`${bad}\` is not folder names and \`*\` (no \`**\`, \`?\` or braces): list its folders`,
    };
  const expand = (/** @type {string} */ p) =>
    segments(p).reduce(
      (dirs, s) =>
        s !== "*"
          ? dirs.map((d) => (d ? `${d}/${s}` : s))
          : dirs.flatMap((d) =>
              existsSync(join(root, d))
                ? readdirSync(join(root, d), { withFileTypes: true })
                    .filter(
                      (e) =>
                        e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules",
                    )
                    .map((e) => (d ? `${d}/${e.name}` : e.name))
                : [],
            ),
      [""],
    );
  const out = new Set(patterns.filter((p) => !p.startsWith("!")).flatMap(expand));
  for (const p of patterns.filter((x) => x.startsWith("!")))
    for (const d of expand(p)) out.delete(d);
  const packages = [...out].filter((d) => existsSync(join(root, d, "package.json"))).toSorted();
  const unsafe = packages.find((d) => !d.split("/").every((s) => PLAIN.test(s)));
  if (unsafe !== undefined)
    return {
      problem: `the package folder \`${unsafe}\` has a name a shell line cannot take: rename it`,
    };
  return { packages };
}

/**
 * `packages` dealt round-robin into at most `boxes` groups, none empty.
 * @param {string[]} packages
 * @param {number} boxes
 * @returns {string[][]}
 */
export function shard(packages, boxes) {
  const n = Math.min(Math.max(1, Math.floor(boxes) || 1), packages.length);
  /** @type {string[][]} */
  const groups = Array.from({ length: n }, () => []);
  for (const [i, p] of packages.toSorted().entries()) groups[i % n].push(p);
  return groups;
}

/**
 * A shard's check: `gate.shard` with `{filters}` as one `--filter=./<folder>` per package.
 * @param {string} template
 * @param {string[]} group
 */
export const shardCommand = (template, group) =>
  template.replaceAll("{filters}", group.map((p) => `--filter=./${p}`).join(" "));

/**
 * @typedef {{ region?: string, box?: string, slot?: string, waitSeconds?: number, runSeconds?: number,
 *             exitCode?: number }} ShardReport the testbed's one stdout line under `--json`
 * @typedef {{ packages: string[], code: number, report?: ShardReport }} ShardResult
 */

/**
 * The testbed's JSON line from a shard's stdout (its last non-empty line), or undefined.
 * @param {string} out
 * @returns {ShardReport | undefined}
 */
export function reportOf(out) {
  const line = out.trim().split("\n").at(-1) ?? "";
  try {
    const parsed = JSON.parse(line);
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The one verdict of every shard (P-021): `code` 0 only when each exited 0, else the first failure's code, which is
 * posted red even when another shard found no slot; `infra` when no shard failed but one still found no slot or no
 * healthy box, or was stopped by a signal (never a test failure, so nothing is posted); a line per shard.
 * @param {ShardResult[]} results
 * @returns {{ code: number, infra?: string, lines: string[] }}
 */
export function combine(results) {
  const lines = results.map((r, i) => {
    const where = r.report?.box
      ? ` on ${r.report.region ?? "?"} ${r.report.box} (${r.report.slot ?? "?"}, waited ${r.report.waitSeconds ?? "?"}s, ran ${r.report.runSeconds ?? "?"}s)`
      : "";
    const why =
      r.code === TIMED_OUT
        ? " (the testbed's 3-hour limit)"
        : r.code === NO_BOX || r.code === NO_SLOT
          ? " (no healthy box or free slot: an infrastructure failure)"
          : r.code === INTERRUPTED
            ? " (stopped by a signal: an infrastructure failure)"
            : "";
    return `shard ${i + 1}/${results.length} [${r.packages.join(" ")}]: exit ${r.code}${why}${where}`;
  });
  const infraOnly = (/** @type {number} */ code) =>
    code === NO_BOX || code === NO_SLOT || code === INTERRUPTED;
  const failed = results.find((r) => r.code !== 0 && !infraOnly(r.code));
  const infra = results.findIndex((r) => infraOnly(r.code));
  if (!failed && infra >= 0)
    return {
      code: results[infra].code,
      infra: `${lines[infra]}; nothing posted, run the gate again`,
      lines,
    };
  return { code: failed?.code ?? 0, lines };
}
