/**
 * Figentra Flow file contract:
 * Purpose: the guard engine's Bash decision: a command against a preset's rule table, then the engine's own rules
 *   (any deny wins over any ask; a rule that throws asks for that call). The engine's rules are the lifecycle's side
 *   doors (FR-13), checked for every preset whatever its table holds (FR-5: the guard itself is mandatory), after the
 *   table so a preset's own reason wins for a command both deny: a `git … worktree add <path>` outside that
 *   repository's `.claude/worktrees/` (naming `fflow start`), a
 *   push to the default branch or `gh pr merge` (naming `fflow land`), and skipping the hooks (FR-18): `LEFTHOOK=0`
 *   set as a variable, `--no-verify` on a commit, push or merge, `-n` on a commit, or a `core.hooksPath` override
 *   (naming `fflow hooks run`).
 * Boundary: decides only; the side doors read git state (the main checkout, the default and current branch).
 *   They follow `cd <dir> &&`, `git -C <dir>`, leading `NAME=value` words, `env`, `command` and `exec` prefixes, a
 *   git or gh named by its path, wrapper scripts (`pnpm bot:git -- …`) and quoted words.
 * Runtime: node
 * Governing contract: Stackra ADR 0503 (decision 6); STA-1729; STA-1945 (FR-7, FR-13, AC-38, P-012, P-018).
 * Secrets: none.
 */
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

import { defaultBranch, git, mainCheckout } from "../lib/git.mjs";
import { NAME } from "../lib/product.mjs";
import { argsOf, split, words } from "./words.mjs";

/**
 * A Bash rule of a preset's table. `match` returns true for a hit, or a string that replaces `reason`; it is handed
 * the hook's whole payload (the agent type, the session), the same object for every rule of one decision.
 * @typedef {{ payload?: Record<string, any> }} BashHow
 * @typedef {{ id: string, match: (command: string, cwd: string, how: BashHow) => boolean | string | undefined,
 *   decision: "deny" | "ask", reason: string }} BashRule
 */
/** @typedef {{ decision: "allow" | "deny" | "ask", reason?: string, context?: string }} Decision */

/** @type {Decision} */
export const ALLOW = { decision: "allow" };

/**
 * The decision for one Bash command against `rules` followed by the side doors (each rule once): the first deny,
 * else the first ask, else allow. A rule that throws makes the call an ask: a broken rule neither lets a command
 * through silently nor blocks every agent.
 * @param {string} command
 * @param {string} cwd
 * @param {BashRule[]} rules the preset's table
 * @param {BashHow} [how]
 * @returns {Decision}
 */
export function decideBash(command, cwd, rules, how = {}) {
  /** @type {string | undefined} */
  let asked;
  for (const rule of new Set([...rules, ...SIDE_DOORS])) {
    let hit;
    try {
      hit = rule.match(command, cwd, how);
    } catch (error) {
      asked ??= `The guard rule ${rule.id} failed on this command (${/** @type {Error} */ (error)?.message}); confirm it by hand.`;
      continue;
    }
    if (!hit) continue;
    const reason = typeof hit === "string" ? hit : rule.reason;
    if (rule.decision === "deny") return { decision: "deny", reason };
    asked ??= reason;
  }
  return asked === undefined ? ALLOW : { decision: "ask", reason: asked };
}

/** `git worktree add` options that take a value. */
const VALUED = new Set(["-b", "-B", "--reason"]);

/**
 * A git call's folder (after `-C`), the configuration it overrides (`-c` and `--config-env` values), subcommand and
 * the words after it.
 * @param {string[]} a the words after `git`
 * @param {string} here
 */
function gitCall(a, here) {
  let dir = here;
  /** @type {string[]} */
  const configs = [];
  let i = 0;
  for (; i < a.length && a[i].startsWith("-"); i += 1) {
    if (a[i] === "-C" && a[i + 1] !== undefined) dir = resolve(dir, a[++i]);
    else if ((a[i] === "-c" || a[i] === "--config-env") && a[i + 1] !== undefined)
      configs.push(a[++i]);
    else if (a[i].startsWith("--config-env=")) configs.push(a[i].slice("--config-env=".length));
    else if (a[i] === "--git-dir" || a[i] === "--work-tree") i += 1;
  }
  return { dir, configs, sub: a[i], rest: a.slice(i + 1) };
}

/** `git commit` options whose value is the next word. */
const COMMIT_VALUED = new Set(["-m", "-F", "-C", "-c", "-t", "--message", "--file", "--author"]);

/**
 * How a git call skips the hooks, or undefined: a `core.hooksPath` override (`-c`, `--config-env` or set with
 * `git config`), or `--no-verify` (any abbreviation) on a commit, push or merge, or `-n` on a commit, also inside a
 * cluster (`-anm x`).
 * @param {{ configs: string[], sub: string | undefined, rest: string[] }} call
 * @returns {string | undefined}
 */
function hookSkip({ configs, sub, rest }) {
  const hooksPath = /^core\.hookspath(=|$)/i;
  if (configs.some((c) => hooksPath.test(c))) return "overriding `core.hooksPath`";
  if (sub === "config") {
    const named = rest.filter((x) => !x.startsWith("-"));
    const at = named.findIndex((x) => hooksPath.test(x));
    if (at >= 0 && named[at + 1] !== undefined) return "setting `core.hooksPath`";
  }
  if (sub !== "commit" && sub !== "push" && sub !== "merge") return undefined;
  for (let j = 0; j < rest.length && rest[j] !== "--"; j += 1) {
    const x = rest[j];
    if (x.length > 8 && "--no-verify".startsWith(x)) return `\`${sub} --no-verify\``;
    if (sub !== "commit") continue;
    if (COMMIT_VALUED.has(x)) j += 1;
    else if (/^-[^-]/.test(x))
      for (const c of x.slice(1)) {
        if (c === "n") return "`commit -n`";
        // The rest of the cluster is this option's value.
        if ("mFCctSu".includes(c)) break;
      }
  }
  return undefined;
}

/**
 * Each simple command's words with the folder it runs in, following `cd <dir>`.
 * @param {string} command
 * @param {string} cwd
 */
function steps(command, cwd) {
  let here = cwd;
  /** @type {{ w: string[], here: string }[]} */
  const out = [];
  for (const w of words(command)) {
    if (w[0] === "cd" && w[1] !== undefined) here = resolve(here, w[1]);
    else out.push({ w, here });
  }
  return out;
}

/**
 * The paths a command would add worktrees at, each resolved against the directory it runs in.
 * @param {string} command
 * @param {string} cwd
 * @returns {{ path: string, dir: string }[]}
 */
function worktreeAdds(command, cwd) {
  /** @type {{ path: string, dir: string }[]} */
  const found = [];
  for (const { w, here } of steps(command, cwd)) {
    const a = argsOf(w, "git");
    if (!a) continue;
    const { dir, sub, rest } = gitCall(a, here);
    if (sub !== "worktree" || rest[0] !== "add") continue;
    for (let j = 1; j < rest.length; j += 1) {
      if (VALUED.has(rest[j])) {
        j += 1;
        continue;
      }
      if (rest[j] === "--" || rest[j].startsWith("-")) continue;
      found.push({ path: isAbsolute(rest[j]) ? rest[j] : resolve(dir, rest[j]), dir });
      break;
    }
  }
  return found;
}

/** `git push` options that take a value. */
const PUSH_VALUED = new Set(["-o", "--push-option", "--repo", "--receive-pack", "--exec"]);

/**
 * The branches each `git push` in a command writes: a refspec's destination, `HEAD` or "" for the current branch,
 * `*` for `--all` and `--mirror`.
 * @param {string} command
 * @param {string} cwd
 * @returns {{ dir: string, refs: string[] }[]}
 */
function pushTargets(command, cwd) {
  /** @type {{ dir: string, refs: string[] }[]} */
  const found = [];
  for (const { w, here } of steps(command, cwd)) {
    const a = argsOf(w, "git");
    if (!a) continue;
    const { dir, sub, rest } = gitCall(a, here);
    if (sub !== "push") continue;
    /** @type {string[]} */
    const positional = [];
    let all = false;
    for (let j = 0; j < rest.length; j += 1) {
      if (PUSH_VALUED.has(rest[j])) j += 1;
      else if (rest[j] === "--all" || rest[j] === "--mirror") all = true;
      else if (!rest[j].startsWith("-")) positional.push(rest[j]);
    }
    const specs = positional.slice(1);
    const refs = all
      ? ["*"]
      : specs.length
        ? specs.map((s) => {
            const spec = s.replace(/^\+/, "");
            const dst = spec.includes(":") ? spec.slice(spec.lastIndexOf(":") + 1) : spec;
            return dst.replace(/^refs\/heads\//, "");
          })
        : [""];
    found.push({ dir, refs });
  }
  return found;
}

/** The nearest existing folder at or above `dir`. */
function existing(/** @type {string} */ dir) {
  let probe = dir;
  while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
  return probe;
}

const skips = (/** @type {string} */ how) =>
  `${how} skips the hooks, and they are never an exception (FR-18): commit with them running; a checkout that cannot run them proves them on the testbed with \`${NAME} hooks run <stage>\`.`;

/**
 * The lifecycle's side doors (FR-13, FR-18), each naming the Flow command to use instead.
 * shortcut: a merge through `gh api …/merge` or a push through another remote helper is not read; the default
 *   branch's ruleset still refuses both.
 * @type {BashRule[]}
 */
export const SIDE_DOORS = [
  {
    id: "hooks-skip",
    decision: "deny",
    reason: skips("Skipping the hooks"),
    match: (command, cwd) => {
      if (
        words(command).some((w) => split(w).sets.some((x) => /^LEFTHOOK=(0|false|off)$/i.test(x)))
      )
        return skips("`LEFTHOOK=0`");
      for (const { w, here } of steps(command, cwd)) {
        const a = argsOf(w, "git");
        const how = a && hookSkip(gitCall(a, here));
        if (how) return skips(how);
      }
      return false;
    },
  },
  {
    id: "gh-pr-merge",
    decision: "deny",
    reason: `\`gh pr merge\` is a side door: \`${NAME} land <pr>\` merges, after the gate, the review and the approvals.`,
    match: (command, cwd) =>
      steps(command, cwd).some(({ w }) =>
        argsOf(w, "gh")?.some((x, i, a) => x === "pr" && a[i + 1] === "merge"),
      ),
  },
  {
    id: "worktree-outside",
    decision: "deny",
    reason: `Worktrees live only in .claude/worktrees/ (ADR 0503). Run \`${NAME} start <STA-n>\`.`,
    match: (command, cwd) => {
      for (const { path, dir } of worktreeAdds(command, cwd)) {
        const root = mainCheckout(existing(dir));
        if (!root) continue;
        const inside = join(resolve(root), ".claude", "worktrees") + sep;
        if (!resolve(path).startsWith(inside))
          return `Worktrees live only in ${inside} (ADR 0503): ${path} is outside it. Run \`${NAME} start <STA-n>\`, which makes the branch and the worktree there.`;
      }
      return false;
    },
  },
  {
    id: "push-default-branch",
    decision: "deny",
    reason: `Pushing to the default branch is a side door. Push the task's branch and run \`${NAME} land <pr>\`.`,
    match: (command, cwd) => {
      for (const { dir, refs } of pushTargets(command, cwd)) {
        const at = existing(dir);
        const root = mainCheckout(at);
        if (!root) continue;
        const base = defaultBranch(root);
        const current = git(at, ["branch", "--show-current"]).out;
        if (refs.some((r) => r === "*" || (r === "" || r === "HEAD" ? current : r) === base))
          return `Pushing to ${base} is a side door: the default branch changes only through a pull request. Push the task's branch and run \`${NAME} land <pr>\`.`;
      }
      return false;
    },
  },
];
