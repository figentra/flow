/**
 * Figentra Flow file contract:
 * Purpose: the tracker port (AC-037): the key scheme a repository's issues use (the key in a branch, a worktree, a spec
 *   folder; the branch and folder names `start` makes) and the adapter that reads and moves issues: `linear` or
 *   `github-issues` (Jira later, same shape). `trackerFor(root)` builds both from `figentra-flow.config.json`'s `tracker`.
 *   A repository with no tracker block (or no config file) gets a scheme that reads any `<letters>-<n>` key and no
 *   adapter, so offline commands work and the ones that move issues refuse naming the key (AC-036, AC-045).
 * Boundary: builds objects; the adapters make the network calls.
 * Runtime: node
 * Governing contract: STA-1729 phase A (A2).
 * Secrets: none here; each adapter reads its token from the environment or the credentials port.
 */
import { ConfigError, loadConfig } from "../../lib/config.mjs";
import { CONFIG_FILE } from "../../lib/product.mjs";
import { githubIssuesTracker } from "./github-issues.mjs";
import { linearTracker } from "./linear.mjs";

/**
 * @typedef {{ prefix: string | undefined, parse: (text: string) => string | undefined, display: (key: string) => string,
 *             branch: (key: string, slug: string) => string, folder: (key: string, slug: string) => string,
 *             pattern: string, keys: (text: string) => string[], folderKey: (folder: string) => string | undefined,
 *             isBranch: (branch: string) => boolean, branchShape: string }} KeyScheme
 * @typedef {{ title: (key: string) => Promise<string | undefined>, state: (key: string) => Promise<string | undefined>,
 *             inProgress: (key: string, branch: string) => Promise<void>, done: (key: string, url: string) => Promise<void>,
 *             comment: (key: string, body: string) => Promise<void> }} Tracker
 */

/** A configuration value as a literal inside a regular expression. */
const escape = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The key scheme of a tracker block: keys are `<prefix>-<n>`, lower-cased (`sta-12`, `gh-7`); a branch is
 * `<branchPrefix>/<key>-<slug>` (or one of `otherBranchPrefixes`, e.g. `delegate`) and a spec folder `<key>-<slug>`.
 * `pattern` is the regular-expression source of one key (matched without regard to case).
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
  const pattern = `${prefix ? escape(prefix) : "[a-z][a-z0-9]*"}-\\d+`;
  const slug = "[a-z0-9]+(?:-[a-z0-9]+)*";
  const folderRe = new RegExp(`^(${pattern})-${slug}$`, "i");
  const prefixes = [block?.branchPrefix, ...(block?.otherBranchPrefixes ?? [])].filter(Boolean);
  const branchRe = new RegExp(
    `^${prefixes.length ? `(?:${prefixes.map(escape).join("|")})/` : ""}${pattern}-${slug}$`,
  );
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
    pattern,
    keys: (text) =>
      [...text.matchAll(new RegExp(`(?<![a-z0-9])(${pattern})(?![0-9])`, "gi"))].map((m) =>
        m[1].toLowerCase(),
      ),
    folderKey: (folder) => folder.match(folderRe)?.[1].toLowerCase(),
    isBranch: (branch) => branchRe.test(branch),
    branchShape: `${prefixes.length ? `${prefixes.join("|")}/` : ""}${prefix ?? "<prefix>"}-<n>-<slug>`,
  };
}

/**
 * The repository's tracker block, or undefined when its configuration names none.
 * @param {string} root
 */
function trackerBlock(root) {
  const loaded = loadConfig(root);
  if (loaded.errors.length) throw new ConfigError(loaded.errors.join("\n"));
  return loaded.config.tracker;
}

/**
 * The repository's key scheme alone (the offline commands: the spec gate, trace).
 * @param {string} root
 */
export const schemeFor = (/** @type {string} */ root) => keyScheme(trackerBlock(root));

/**
 * The repository's key scheme and tracker adapter.
 * @param {string} root
 * @param {{ env?: Record<string, string | undefined>, warn?: (s: string) => void }} [options] `warn` is unused (no fallback left to announce)
 * @returns {{ scheme: KeyScheme, tracker: Tracker | undefined, problem: string | undefined }}
 */
export function trackerFor(root, { env = process.env } = {}) {
  const block = trackerBlock(root);
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
