/**
 * Figentra Flow file contract:
 * Purpose: the gate fan-out's package shards (FR-15, C14): `workspacePackages` lists a pnpm workspace's packages,
 *   `shard` deals them into at most one group per box, `shardCommand` fills a group into `gate.shard`'s `{filters}`,
 *   and `combine` turns every shard's testbed result into the one `fflow/gate` verdict: green only when each passed.
 * Boundary: `workspacePackages` reads `pnpm-workspace.yaml` and the folders it names; the rest is pure.
 * Runtime: node
 * Governing contract: STA-1945 (FR-15, AC-41, P-021); the testbed contract (STA-2042, core #315 FR-010 to FR-012).
 * Secrets: none.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parseYaml } from "./yaml.mjs";

/** The most shards one gate runs: the testbed's slots across its four regions (4 heavy, 8 light). */
export const MAX_SHARDS = 12;

/** The testbed's own exit codes: no free slot under `--no-wait`, no healthy box (both retried), the 3-hour limit. */
export const NO_SLOT = 73;
export const NO_BOX = 75;
export const TIMED_OUT = 124;

/** A package folder that is safe on a shell line. */
const SAFE = /^[\w@./-]+$/;

/**
 * The workspace's package folders (repo-relative, sorted) from `pnpm-workspace.yaml`'s `packages`; a `!` pattern
 * excludes. Undefined when there is no workspace file.
 * shortcut: a pattern is a folder or `<folder>/*` (`**` reads as `*`); full globs when a repository needs them.
 * @param {string} root
 * @returns {string[] | undefined}
 */
export function workspacePackages(root) {
  const file = join(root, "pnpm-workspace.yaml");
  if (!existsSync(file)) return undefined;
  /** @type {string[]} */
  const patterns = parseYaml(readFileSync(file, "utf8"))?.packages ?? [];
  const expand = (/** @type {string} */ p) => {
    const dir = p.replace(/\/\*\*?$/, "");
    if (dir === p) return [p];
    if (!existsSync(join(root, dir))) return [];
    return readdirSync(join(root, dir), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => `${dir}/${d.name}`);
  };
  const out = new Set(
    patterns.filter((p) => !p.startsWith("!")).flatMap((p) => expand(p.replace(/^\.\//, ""))),
  );
  for (const p of patterns.filter((x) => x.startsWith("!")))
    for (const d of expand(p.slice(1).replace(/^\.\//, ""))) out.delete(d);
  return [...out]
    .filter((d) => SAFE.test(d) && existsSync(join(root, d, "package.json")))
    .toSorted();
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
 * The one verdict of every shard (P-021): `code` 0 only when each exited 0, else the first failure's code; `infra`
 * when a shard still found no slot or no healthy box (never a test failure, so nothing is posted); a line per shard.
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
          : "";
    return `shard ${i + 1}/${results.length} [${r.packages.join(" ")}]: exit ${r.code}${why}${where}`;
  });
  const infra = results.findIndex((r) => r.code === NO_BOX || r.code === NO_SLOT);
  if (infra >= 0)
    return {
      code: results[infra].code,
      infra: `${lines[infra]}; nothing posted, run the gate again`,
      lines,
    };
  return { code: results.find((r) => r.code !== 0)?.code ?? 0, lines };
}
