/**
 * Vellum file contract:
 * Purpose: the tracker port (AC-037): the key scheme a repository's issues use (the key in a branch, a worktree, a spec
 *   folder; the branch and folder names `start` makes) and the adapter that reads and moves issues: `linear` or
 *   `github-issues` (Jira later, same shape). `trackerFor(root)` builds both from `vellum.config.json`'s `tracker`.
 *   A repository with a config file but no tracker gets a scheme that reads any `<letters>-<n>` key and no adapter,
 *   so offline commands work and the ones that move issues refuse naming the key (AC-036). For one minor version a
 *   repository with no config file keeps the Linear `STA` scheme it used before, with a warning.
 * Boundary: builds objects; the adapters make the network calls.
 * Runtime: node
 * Governing contract: STA-1729 phase A (A2).
 * Secrets: none here; each adapter reads its token from the environment or the credentials port.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { ConfigError, loadConfig } from "../../lib/config.mjs";
import { CONFIG_FILE } from "../../lib/product.mjs";
import { githubIssuesTracker } from "./github-issues.mjs";
import { linearTracker } from "./linear.mjs";

/**
 * @typedef {{ prefix: string | undefined, parse: (text: string) => string | undefined, display: (key: string) => string,
 *             branch: (key: string, slug: string) => string, folder: (key: string, slug: string) => string }} KeyScheme
 * @typedef {{ title: (key: string) => Promise<string | undefined>, state: (key: string) => Promise<string | undefined>,
 *             inProgress: (key: string, branch: string) => Promise<void>, done: (key: string, url: string) => Promise<void>,
 *             comment: (key: string, body: string) => Promise<void> }} Tracker
 */

/**
 * The key scheme of a tracker block: keys are `<prefix>-<n>`, lower-cased (`sta-12`, `gh-7`); a branch is
 * `<branchPrefix>/<key>-<slug>` and a spec folder `<key>-<slug>`.
 * @param {any} block the configuration's `tracker`, or undefined for any prefix
 * @returns {KeyScheme}
 */
export function keyScheme(block) {
  const prefix =
    block?.kind === "linear"
      ? String(block.team).toLowerCase()
      : block?.kind === "github-issues"
        ? "gh"
        : block?.kind === "jira"
          ? String(block.project).toLowerCase()
          : undefined;
  const re = new RegExp(`(?:^|[^a-z0-9])(${prefix ?? "[a-z][a-z0-9]*"})-(\\d+)(?![0-9])`, "i");
  return {
    prefix,
    parse(text) {
      const m = re.exec(text);
      if (m) return `${m[1]}-${m[2]}`.toLowerCase();
      // A bare number or `#n` names an issue of the configured prefix.
      const n = prefix && text.match(/^#?(\d+)$/)?.[1];
      return n ? `${prefix}-${n}` : undefined;
    },
    display: (key) => key.toUpperCase(),
    branch: (key, slug) =>
      `${block?.branchPrefix ?? ""}${block?.branchPrefix ? "/" : ""}${key}-${slug}`,
    folder: (key, slug) => `${key}-${slug}`,
  };
}

/** The Linear `STA` scheme repositories used before `vellum.config.json` (read for one minor version). */
export const LEGACY_TRACKER = { kind: "linear", team: "STA", branchPrefix: "figentra" };

/**
 * The repository's key scheme and tracker adapter.
 * @param {string} root
 * @param {{ env?: Record<string, string | undefined>, warn?: (s: string) => void }} [options]
 * @returns {{ scheme: KeyScheme, tracker: Tracker | undefined, problem: string | undefined }}
 */
export function trackerFor(root, { env = process.env, warn = console.error } = {}) {
  const loaded = loadConfig(root);
  if (loaded.errors.length) throw new ConfigError(loaded.errors.join("\n"));
  let block = loaded.config.tracker;
  if (block === undefined && !existsSync(join(root, CONFIG_FILE))) {
    warn(
      `no ${CONFIG_FILE}: using the Linear STA tracker for now (deprecated: set "tracker" in ${CONFIG_FILE})`,
    );
    block = LEGACY_TRACKER;
  }
  const scheme = keyScheme(block);
  if (block === undefined)
    return {
      scheme,
      tracker: undefined,
      problem: `moving issues needs "tracker" in ${CONFIG_FILE}`,
    };
  const tracker =
    block.kind === "linear"
      ? linearTracker(block, { env })
      : block.kind === "github-issues"
        ? githubIssuesTracker(block, { root })
        : undefined;
  return {
    scheme,
    tracker,
    problem: tracker ? undefined : `tracker "${block.kind}" is not available yet`,
  };
}
