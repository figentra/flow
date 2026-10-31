/**
 * Figentra Flow file contract:
 * Purpose: `figentra-flow clean [--dry-run] [--adopt] [--fix-ignore] [--all]` — remove the finished worktrees of the
 *   repository (or of every workspace repository with `--all`), move stray ones inside, and make `.gitignore` ignore
 *   `.claude/worktrees/`. A worktree is removed only when it is
 *   - not a tester's (`g-*`, `*-gate`, `land-*`, `tpl-core`, `c6-lock*`, `template-wt-lean`);
 *   - not in use: no running process (a session, a dev server, a shell) has its working folder inside it;
 *   - clean (no change, untracked files included);
 *   - saved: its head on a remote ref, or every commit landed by patch (`git cherry`), since core lands by cherry-pick,
 *     or the squash commit `figentra-flow land` recorded (`branch.<b>.figentraFlowLanded`) on the default branch;
 *   - finished: its issue Done or Canceled when its name carries a key, else idle for 2 hours or more by its HEAD
 *     reflog (a detached HEAD or a builder sub-agent tree);
 *   - free of ignored files outside the usual caches (`.env`, `ios/`, `android/` keep it).
 *   A stray tree is adopted only when it is not in use and idle for 2 hours. Every kept tree is reported with its reason, and the space freed is reported.
 * Boundary: `git worktree remove` (never `--force`), `git branch -D` of a removed tree's own branch, `git worktree
 *   move` with `--adopt`, and one appended `.gitignore` line with `--fix-ignore`. `--dry-run` changes nothing.
 * Runtime: node
 * Governing contract: Stackra ADR 0503 (decision 6); STA-1729 (the leader's revisions of 2026-10-31).
 * Secrets: the Linear token only from the environment the calling wrapper sets; never read or printed.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";

import { trackerFor } from "../adapters/tracker/index.mjs";
import { matches } from "../lib/artifacts.mjs";
import { loadConfig } from "../lib/config.mjs";
import { CONFIG_FILE, LANDED_KEY, NAME } from "../lib/product.mjs";
import {
  busyFolders,
  defaultBranch,
  git,
  idleHours,
  inUse,
  isClean,
  isSaved,
  mainCheckout,
  preciousIgnored,
  sizeKb,
  worktrees,
} from "../lib/git.mjs";
import { readWorkspace } from "../lib/workspace.mjs";

/** How long a keyless worktree must sit untouched before it is removed. */
export const IDLE_HOURS = 2;

/** The issue states that finish a keyed worktree. */
const FINISHED = new Set(["Done", "Canceled", "Cancelled", "Duplicate"]);

/**
 * The issue tracker `clean` reads: an issue's state name (the tracker port's `state`; tests pass their own).
 * @typedef {{ state: (key: string) => Promise<string | undefined> }} Issues
 */

/**
 * The tester's worktree names that repositories used before `figentra-flow.config.json`'s `clean.keep`, applied for one minor
 * version only where no config file exists.
 */
export const LEGACY_KEEP = ["g-*", "*-gate", "land-*", "tpl-core", "c6-lock*", "template-wt-lean"];

/**
 * Whether `.gitignore` at `root` ignores `.claude/worktrees/`.
 * @param {string} root
 */
export function ignoresWorktrees(root) {
  const file = join(root, ".gitignore");
  if (!existsSync(file)) return false;
  return readFileSync(file, "utf8")
    .split("\n")
    .map((l) =>
      l
        .trim()
        .replace(/^\//, "")
        .replace(/\/\*?$/, ""),
    )
    .some((l) => l === ".claude/worktrees" || l === ".claude");
}

/**
 * @typedef {{ path: string, reason: string }} Kept
 * @typedef {{ removed: string[], kept: Kept[], adopted: string[], forTester: string[], freedKb: number, ignoreFixed: boolean }} Report
 */

/**
 * Cleans the repository at `cwd`.
 * @param {{ cwd: string, dry?: boolean, adopt?: boolean, fixIgnore?: boolean, issues?: Issues, now?: number,
 *           busy?: string[], only?: string[] }} options   `only`: act on these worktree paths alone (`figentra-flow land`)
 * @returns {Promise<Report>}
 */
export async function clean(options) {
  const { dry = false, now = Date.now() } = options;
  const root = mainCheckout(options.cwd);
  /** @type {Report} */
  const report = {
    removed: [],
    kept: [],
    adopted: [],
    forTester: [],
    freedKb: 0,
    ignoreFixed: false,
  };
  if (!root) return report;
  const inside = join(resolve(root), ".claude", "worktrees") + sep;
  const base = defaultBranch(root);
  const { scheme, tracker } = trackerFor(root, { warn: () => {} });
  const issues = options.issues ?? tracker;
  const loaded = loadConfig(root);
  const keepNames =
    loaded.config.clean?.keep ?? (existsSync(join(root, CONFIG_FILE)) ? [] : LEGACY_KEEP);
  /** @type {Map<string, string | undefined>} */
  const states = new Map();
  const stateOf = async (/** @type {string} */ key) => {
    if (!states.has(key)) {
      try {
        if (!issues) throw new Error("no tracker");
        states.set(key, await issues.state(scheme.display(key)));
      } catch {
        states.set(key, undefined);
      }
    }
    return states.get(key);
  };

  const busy = options.busy ?? busyFolders();
  const only = options.only?.map((p) => resolve(p));
  for (const tree of worktrees(root).filter((t) => !only || only.includes(resolve(t.path)))) {
    const name = basename(tree.path);
    const keep = (/** @type {string} */ reason) => report.kept.push({ path: tree.path, reason });
    if (keepNames.some((pattern) => matches(name, pattern))) {
      if (!resolve(tree.path).startsWith(inside)) report.forTester.push(tree.path);
      keep("a tester worktree");
      continue;
    }
    if (busy === undefined) {
      keep("running processes cannot be listed (no lsof or /proc)");
      continue;
    }
    if (inUse(tree.path, busy)) {
      keep("in use: a running process works inside it");
      continue;
    }
    if (tree.locked) {
      keep("locked");
      continue;
    }
    if (!existsSync(tree.path)) {
      keep("missing on disk (git worktree prune removes its record)");
      continue;
    }
    if (!isClean(tree.path)) {
      keep("uncommitted changes");
      continue;
    }
    if (!resolve(tree.path).startsWith(inside)) {
      if (!options.adopt) {
        keep(`outside .claude/worktrees (${NAME} clean --adopt moves it in)`);
        continue;
      }
      const idle = idleHours(tree.path, now);
      if (idle < IDLE_HOURS) {
        keep(
          `outside .claude/worktrees, idle ${idle.toFixed(1)} h (< ${IDLE_HOURS} h) so not adopted yet`,
        );
        continue;
      }
      const target = join(inside, name);
      if (existsSync(target)) {
        keep(`outside .claude/worktrees, and ${target} is taken`);
        continue;
      }
      if (!dry) {
        mkdirSync(inside, { recursive: true }); // older git (2.43) does not create the parent
        const moved = git(root, ["worktree", "move", tree.path, target]);
        if (!moved.ok) {
          keep(`move failed: ${moved.err}`);
          continue;
        }
      }
      report.adopted.push(`${tree.path} → ${target}`);
      continue;
    }
    // AC-029: a squash merge has its own patch id, so `figentra-flow land` records the merge commit on the branch.
    const landed =
      tree.branch && git(root, ["config", "--get", `branch.${tree.branch}.${LANDED_KEY}`]).out;
    const landedOnBase =
      Boolean(landed) && git(root, ["merge-base", "--is-ancestor", landed, `origin/${base}`]).ok;
    if (!landedOnBase && !isSaved(tree.path, base)) {
      keep("unsaved: commits on no remote and not landed");
      continue;
    }
    const key = scheme.parse(tree.branch ?? "") ?? scheme.parse(name);
    if (key !== undefined) {
      const state = await stateOf(key);
      if (state === undefined) {
        keep(`${scheme.display(key)}'s state is unknown (tracker unavailable)`);
        continue;
      }
      if (!FINISHED.has(state)) {
        keep(`${scheme.display(key)} is ${state}`);
        continue;
      }
    } else {
      const idle = idleHours(tree.path, now);
      if (idle < IDLE_HOURS) {
        keep(`no issue key, idle ${idle.toFixed(1)} h (< ${IDLE_HOURS} h)`);
        continue;
      }
    }
    const precious = preciousIgnored(tree.path);
    if (precious.length) {
      keep(
        `ignored files outside the caches: ${precious.slice(0, 5).join(", ")}${precious.length > 5 ? ", …" : ""}`,
      );
      continue;
    }
    const kb = sizeKb(tree.path);
    if (!dry) {
      const removed = git(root, ["worktree", "remove", tree.path]);
      if (!removed.ok) {
        keep(`remove failed: ${removed.err}`);
        continue;
      }
      if (tree.branch) git(root, ["branch", "-D", tree.branch]);
    }
    report.removed.push(tree.path);
    report.freedKb += kb;
  }

  if (options.fixIgnore && !ignoresWorktrees(root)) {
    if (!dry) {
      const file = join(root, ".gitignore");
      const text = existsSync(file) ? readFileSync(file, "utf8") : "";
      appendFileSync(file, `${text === "" || text.endsWith("\n") ? "" : "\n"}.claude/worktrees/\n`);
    }
    report.ignoreFixed = true;
  }
  return report;
}

/** A size in kilobytes as megabytes or gigabytes. */
export const human = (kb) =>
  kb >= 1_048_576 ? `${(kb / 1_048_576).toFixed(1)} GB` : `${(kb / 1024).toFixed(0)} MB`;

/** `figentra-flow clean [--dry-run] [--adopt] [--fix-ignore] [--all]`. */
export async function run(args) {
  const dry = args.includes("--dry-run");
  const roots = args.includes("--all") ? readWorkspace().map((r) => r.path) : [process.cwd()];
  if (roots.length === 0) {
    console.error(`${NAME} clean: the workspace list is empty (${NAME} init --workspace <dir>…)`);
    return 1;
  }
  const verb = dry ? "would remove" : "removed";
  let freed = 0;
  for (const cwd of roots) {
    const r = await clean({
      cwd,
      dry,
      adopt: args.includes("--adopt"),
      fixIgnore: args.includes("--fix-ignore"),
    });
    freed += r.freedKb;
    console.log(
      `${NAME} clean: ${cwd}: ${verb} ${r.removed.length}, kept ${r.kept.length}${r.adopted.length ? `, adopted ${r.adopted.length}` : ""}`,
    );
    for (const p of r.removed) console.log(`  ${verb}  ${p}`);
    for (const a of r.adopted) console.log(`  ${dry ? "would move" : "moved"}  ${a}`);
    for (const k of r.kept) console.log(`  kept     ${k.path}: ${k.reason}`);
    for (const t of r.forTester) console.log(`  for stackra-f4: ${t}`);
    if (r.ignoreFixed)
      console.log(`  ${dry ? "would add" : "added"} .claude/worktrees/ to .gitignore; commit it`);
  }
  console.log(`${NAME} clean: ${dry ? "would free" : "freed"} ${human(freed)}`);
  return 0;
}
