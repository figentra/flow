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
 *   The budget (STA-1871): every run counts the linked worktrees against `clean.budget` (default 10), warns above it
 *   and lists the candidates: trees under `.claude/worktrees/` idle for 24 hours whose head is merged or pushed, not
 *   in use, locked or a tester's. `--budget` removes them after preserving what they hold: uncommitted work and a
 *   detached HEAD on a new local `keep/<repo>-<name>` branch, ignored files outside the caches in a `tar.gz` under
 *   `~/Backups/<NAME>/`. Any failed step keeps that tree. Every run also writes `.claude/worktrees/README.md` when
 *   it is missing.
 * Boundary: `git worktree remove` (never `--force`), `git branch -D` of a removed finished tree's own branch (the
 *   budget deletes no branch), `git switch -c keep/…` and one commit there (hooks run), `tar`, `git worktree move`
 *   with `--adopt`, and one appended `.gitignore` line with `--fix-ignore`. `--dry-run` changes nothing.
 * Runtime: node
 * Governing contract: Stackra ADR 0503 (decision 6); STA-1729 (the leader's revisions of 2026-10-31).
 * Secrets: the Linear token only from the environment the calling wrapper sets; never read or printed.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve, sep } from "node:path";

import { trackerFor } from "../adapters/tracker/index.mjs";
import { matches } from "../lib/artifacts.mjs";
import { loadConfig } from "../lib/config.mjs";
import { LANDED_KEY, NAME } from "../lib/product.mjs";
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

/** Linked worktrees a repository holds before `clean` warns (`clean.budget` overrides it). */
export const BUDGET = 10;

/** How long a worktree must sit untouched before the budget takes it. */
export const BUDGET_IDLE_HOURS = 24;

/** What `.claude/worktrees/README.md` says, for people browsing the folder (it is git-ignored, so local). */
export const WORKTREES_README = `# .claude/worktrees

Agent and developer worktrees for this repository; \`${NAME} clean\` keeps them in check.

- One worktree per active task, only here.
- \`${NAME} land\` removes a worktree after its pull request merges; a session removes its own when it ends.
- Never leave a detached HEAD with commits: put them on a branch.
- Never delete ignored outputs (\`.env\`, builds you cannot rebuild) without a backup.
- Above the budget (\`clean.budget\`, default ${BUDGET}), \`${NAME} clean --budget\` removes trees idle for ${BUDGET_IDLE_HOURS} h whose
  work is merged or pushed. It keeps uncommitted work on a \`keep/\` branch, backs up ignored files under
  \`~/Backups/${NAME}/\`, and never deletes a branch.
`;

/**
 * Writes `.claude/worktrees/README.md` at `root` unless it exists.
 * @param {string} root
 * @returns {boolean} whether it was written
 */
export function writeWorktreesReadme(root) {
  const dir = join(root, ".claude", "worktrees");
  const file = join(dir, "README.md");
  if (existsSync(file)) return false;
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, WORKTREES_README);
  return true;
}

/** The issue states that finish a keyed worktree. */
const FINISHED = new Set(["Done", "Canceled", "Cancelled", "Duplicate"]);

/**
 * The issue tracker `clean` reads: an issue's state name (the tracker port's `state`; tests pass their own).
 * @typedef {{ state: (key: string) => Promise<string | undefined> }} Issues
 */

/**
 * Appends `.claude/worktrees/` to `root`'s `.gitignore` unless it is ignored already (FR-3: `init` and
 * `clean --fix-ignore`).
 * @param {string} root
 * @returns {boolean} whether the line was added
 */
export function ignoreWorktrees(root) {
  if (ignoresWorktrees(root)) return false;
  const file = join(root, ".gitignore");
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  appendFileSync(file, `${text === "" || text.endsWith("\n") ? "" : "\n"}.claude/worktrees/\n`);
  return true;
}

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
 * @typedef {{ limit: number, count: number, candidates: string[], swept: string[], preserved: string[],
 *             kept: Kept[] }} Budget
 * @typedef {{ removed: string[], kept: Kept[], adopted: string[], forTester: string[], freedKb: number,
 *             ignoreFixed: boolean, budget?: Budget }} Report
 */

/**
 * Cleans the repository at `cwd`.
 * @param {{ cwd: string, dry?: boolean, adopt?: boolean, fixIgnore?: boolean, issues?: Issues, now?: number,
 *           busy?: string[], only?: string[], budget?: boolean, backupDir?: string }} options   `only`: act on these
 *   worktree paths alone (`figentra-flow land`); `budget`: sweep the budget candidates; `backupDir`: where ignored
 *   files go (default `~/Backups/<NAME>/`)
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
  const keepNames = loaded.config.clean?.keep ?? [];
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
    if (!dry) ignoreWorktrees(root);
    report.ignoreFixed = true;
  }
  if (!only) {
    if (!dry) writeWorktreesReadme(root);
    report.budget = budget(root, report, {
      apply: Boolean(options.budget) && !dry,
      now,
      busy,
      keepNames,
      base,
      backupDir: options.backupDir ?? join(homedir(), "Backups", NAME),
    });
  }
  return report;
}

/**
 * The budget pass (STA-1871 FR-3, FR-4): count what is left, list the candidates, and with `apply` sweep them.
 * @param {string} root
 * @param {Report} report the main pass's report; a swept tree's space is added to it
 * @param {{ apply: boolean, now: number, busy: string[] | undefined, keepNames: string[], base: string,
 *           backupDir: string }} options
 * @returns {Budget}
 */
function budget(root, report, { apply, now, busy, keepNames, base, backupDir }) {
  const inside = join(resolve(root), ".claude", "worktrees") + sep;
  const left = worktrees(root).filter((t) => !report.removed.includes(t.path));
  /** @type {Budget} */
  const out = {
    limit: loadConfig(root).config.clean?.budget ?? BUDGET,
    count: left.length,
    candidates: [],
    swept: [],
    preserved: [],
    kept: [],
  };
  if (busy === undefined) return out;
  // Path order, so the report and the sweep never depend on git's listing order.
  for (const tree of left.toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    if (
      !resolve(tree.path).startsWith(inside) ||
      keepNames.some((pattern) => matches(basename(tree.path), pattern)) ||
      inUse(tree.path, busy) ||
      tree.locked ||
      !existsSync(tree.path) ||
      idleHours(tree.path, now) < BUDGET_IDLE_HOURS
    )
      continue;
    const landed =
      tree.branch && git(root, ["config", "--get", `branch.${tree.branch}.${LANDED_KEY}`]).out;
    const merged =
      Boolean(landed) && git(root, ["merge-base", "--is-ancestor", landed, `origin/${base}`]).ok;
    if (!merged && !isSaved(tree.path, base)) continue;
    out.candidates.push(tree.path);
    if (!apply) continue;
    const kb = sizeKb(tree.path);
    const why = sweep(root, tree, { now, backupDir, preserved: out.preserved });
    if (why) out.kept.push({ path: tree.path, reason: why });
    else {
      out.swept.push(tree.path);
      report.freedKb += kb;
    }
  }
  return out;
}

/**
 * Preserves what one worktree holds, then removes it; the reason it stays, or undefined when it went.
 * @param {string} root
 * @param {import("../lib/git.mjs").Worktree} tree
 * @param {{ now: number, backupDir: string, preserved: string[] }} options
 */
function sweep(root, tree, { now, backupDir, preserved }) {
  const name = basename(tree.path);
  const stamp = new Date(now).toISOString().replace(/\D/g, "").slice(0, 14);
  const dirty = !isClean(tree.path);
  if (dirty || tree.detached) {
    let keep = `keep/${basename(root)}-${name}`;
    if (git(root, ["show-ref", "--verify", "--quiet", `refs/heads/${keep}`]).ok)
      keep += `-${stamp}`;
    const branched = git(tree.path, ["switch", "-q", "-c", keep]);
    if (!branched.ok) return `could not create ${keep}: ${branched.err}`;
    if (dirty) {
      const added = git(tree.path, ["add", "-A"]);
      const committed = added.ok
        ? git(tree.path, [
            "commit",
            "-q",
            "-m",
            `wip: preserved by ${NAME} clean --budget (uncommitted work, unreviewed)`,
          ])
        : added;
      if (!committed.ok) {
        // Put the tree back as it was (unstaged, on its own head); the branch made a moment ago holds no new commit.
        git(tree.path, ["reset", "-q"]);
        git(
          tree.path,
          tree.detached
            ? ["switch", "-q", "--detach", tree.head]
            : ["switch", "-q", String(tree.branch)],
        );
        git(tree.path, ["branch", "-D", keep]);
        return `the preservation commit on ${keep} failed: ${committed.err}`;
      }
    }
    preserved.push(`${tree.path} → ${keep}`);
  }
  const precious = preciousIgnored(tree.path);
  if (precious.length) {
    mkdirSync(backupDir, { recursive: true });
    const file = join(backupDir, `${basename(root)}__${name}-${stamp}.tgz`);
    const tar = spawnSync("tar", ["-czf", file, "-C", tree.path, "--", ...precious], {
      encoding: "utf8",
    });
    if (tar.status !== 0)
      return `the backup of ignored files failed: ${(tar.stderr ?? "").trim() || tar.error?.message}`;
    preserved.push(`${tree.path} ignored files → ${file}`);
  }
  const removed = git(root, ["worktree", "remove", tree.path]);
  return removed.ok ? undefined : `remove failed: ${removed.err}`;
}

/** A size in kilobytes as megabytes or gigabytes. */
export const human = (kb) =>
  kb >= 1_048_576 ? `${(kb / 1_048_576).toFixed(1)} GB` : `${(kb / 1024).toFixed(0)} MB`;

/** `figentra-flow clean [--dry-run] [--adopt] [--fix-ignore] [--budget] [--all]`. */
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
      budget: args.includes("--budget"),
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
    const b = r.budget;
    if (b) {
      if (b.count > b.limit)
        console.log(
          `  warning: ${b.count} worktrees, over the budget of ${b.limit}${args.includes("--budget") ? "" : ` (\`${NAME} clean --budget\` removes the idle ones)`}`,
        );
      if (!args.includes("--budget") || dry)
        for (const c of b.candidates)
          console.log(
            `  ${args.includes("--budget") ? "would sweep" : "idle"}  ${c} (${BUDGET_IDLE_HOURS} h or more, merged or pushed)`,
          );
      for (const p of b.swept) console.log(`  swept    ${p}`);
      for (const p of b.preserved) console.log(`  kept     ${p}`);
      for (const k of b.kept) console.log(`  kept     ${k.path}: ${k.reason}`);
    }
  }
  console.log(`${NAME} clean: ${dry ? "would free" : "freed"} ${human(freed)}`);
  return 0;
}
