/**
 * Figentra Flow file contract:
 * Purpose: every Flow record of a repository or the workspace (FR-21, AC-20, AC-42, P-026), for `todo` and `ledger`:
 *   each key's newest record among the checkouts' files (the Stop hook saves it there before any commit), the local
 *   branches, origin's branches and the default branch (where it lands with the change).
 * Boundary: reads git and the record files; writes nothing, fetches nothing (origin's branches as last fetched). An
 *   unreadable record, and a repository that is missing or not one, are returned as their problem, never dropped.
 * Runtime: node
 * Governing contract: STA-1945 (FR-21, AC-20, AC-42, P-026).
 * Secrets: none.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

import { git, worktrees } from "./git.mjs";
import { readRecord, readRecordAt, RECORD_DIR } from "./record.mjs";

/**
 * @typedef {{ repo: string, key: string, from: string, record?: import("./record.mjs").FlowRecord,
 *             problem?: string }} RepoRecord `from` is the checkout or branch it was read from; `key` and `from` are
 *   empty for a repository that could not be read
 */

/** The `<key>.json` names in a folder, none when it cannot be read. */
const jsonIn = (/** @type {string} */ dir) => {
  try {
    return readdirSync(dir).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
};

/**
 * Each key's newest record in each repository (a checkout's file by its time, a branch's by its last commit), and
 * every record that could not be read.
 * shortcut: a stack's branches each hold the key's record and the newest wins; merge their asks if that drops one.
 * @param {string[]} roots each repository's main checkout
 * @returns {RepoRecord[]}
 */
export function allRecords(roots) {
  return roots.flatMap((repo) => {
    /** @type {Map<string, { when: number, entry: RepoRecord }>} */
    const newest = new Map();
    /** @type {RepoRecord[]} */
    const problems = [];
    /**
     * @param {string} key
     * @param {string} from
     * @param {() => number} timeOf
     * @param {() => import("./record.mjs").FlowRecord | undefined} read
     */
    const consider = (key, from, timeOf, read) => {
      try {
        const when = timeOf();
        const record = read();
        const was = newest.get(key);
        if (record && (!was || when > was.when))
          newest.set(key, { when, entry: { repo, key, from, record } });
      } catch (error) {
        problems.push({ repo, key, from, problem: /** @type {Error} */ (error).message });
      }
    };
    const refs = git(repo, [
      "for-each-ref",
      "--format=%(committerdate:unix) %(refname)",
      "refs/heads",
      "refs/remotes/origin",
    ]);
    // A repository that is missing or not one is reported in place, as the snapshot does.
    if (!refs.ok)
      return [
        {
          repo,
          key: "",
          from: "",
          problem: existsSync(repo) ? refs.err || "not a git repository" : "missing",
        },
      ];
    for (const path of [repo, ...worktrees(repo).map((t) => t.path)]) {
      const dir = join(path, RECORD_DIR);
      for (const name of jsonIn(dir)) {
        const key = basename(name, ".json");
        consider(
          key,
          path,
          () => statSync(join(dir, name)).mtimeMs,
          () => readRecord(path, key),
        );
      }
    }
    for (const line of refs.out.split("\n").filter(Boolean)) {
      const [when, ref] = line.split(" ");
      if (ref.endsWith("/HEAD")) continue;
      const branch = ref.replace(/^refs\/(heads|remotes)\//, "");
      const listed = git(repo, ["ls-tree", "--name-only", ref, `${RECORD_DIR}/`]).out;
      for (const path of listed.split("\n").filter((p) => p.endsWith(".json"))) {
        const key = basename(path, ".json");
        consider(
          key,
          branch,
          () => Number(when) * 1000,
          () => readRecordAt(repo, ref, key),
        );
      }
    }
    return [...[...newest.values()].map((n) => n.entry), ...problems];
  });
}
