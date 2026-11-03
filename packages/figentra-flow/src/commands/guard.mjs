/**
 * Figentra Flow file contract:
 * Purpose: `fflow guard [--print-settings]` — the agent hook that closes the lifecycle's side doors (FR-13): it reads
 *   a PreToolUse event on stdin and denies a Bash command that runs `git … worktree add <path>` with the path outside
 *   that repository's `.claude/worktrees/` (naming `fflow start`), pushes to the default branch or runs `gh pr merge`
 *   (naming `fflow land`), or sets `LEFTHOOK=0` (naming `fflow hooks run`). `--print-settings` prints the
 *   `.claude/settings.json` entry that wires it. The guard engine of STA-1945 PR 4 absorbs these rules.
 * Boundary: reads stdin, writes the hook's JSON answer on a denial and nothing otherwise. It follows `cd <dir> &&`,
 *   `git -C <dir>`, leading `NAME=value` words, wrapper scripts (`pnpm bot:git -- …`) and quoted words; input it
 *   cannot parse passes (a hook fails open), a side door it can read never does. Wiring it into a repository is guard
 *   configuration, which the owner applies.
 * Runtime: node
 * Governing contract: Stackra ADR 0503 (decision 6); STA-1729; STA-1945 (FR-13, AC-38, P-018).
 * Secrets: none.
 */
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

import { defaultBranch, git, mainCheckout } from "../lib/git.mjs";
import { NAME } from "../lib/product.mjs";

/** The `.claude/settings.json` entry that runs the guard before every Bash call. */
export const SETTINGS = {
  hooks: {
    PreToolUse: [
      { matcher: "Bash", hooks: [{ type: "command", command: `pnpm exec ${NAME} guard` }] },
    ],
  },
};

/** `git worktree add` options that take a value. */
const VALUED = new Set(["-b", "-B", "--reason"]);

/**
 * Splits a shell command into simple commands (on `&&`, `||`, `;`, `|` and newlines) of words, honouring quotes.
 * @param {string} command
 * @returns {string[][]}
 */
export function words(command) {
  /** @type {string[][]} */
  const out = [[]];
  let word = "";
  let quote = "";
  let has = false;
  const push = () => {
    if (has) out[out.length - 1].push(word);
    word = "";
    has = false;
  };
  for (let i = 0; i < command.length; i += 1) {
    const c = command[i];
    if (quote) {
      if (c === quote) quote = "";
      else if (c === "\\" && quote === '"' && i + 1 < command.length) word += command[++i];
      else word += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      has = true;
    } else if (c === "\\" && i + 1 < command.length) {
      word += command[++i];
      has = true;
    } else if (/\s/.test(c) && c !== "\n") push();
    else if (c === "\n" || c === ";" || c === "|" || c === "&") {
      push();
      if (out[out.length - 1].length) out.push([]);
      if ((c === "&" || c === "|") && command[i + 1] === c) i += 1;
    } else {
      word += c;
      has = true;
    }
  }
  push();
  return out.filter((w) => w.length);
}

/**
 * A simple command's words without its leading `NAME=value` assignments.
 * @param {string[]} w
 */
const bare = (w) =>
  w.slice(
    Math.max(
      0,
      w.findIndex((x) => !/^[A-Za-z_]\w*=/.test(x)),
    ),
  );

/**
 * The arguments a simple command hands `tool` (`git` or `gh`): directly (`git …`), or through a wrapper script named
 * after it (`pnpm bot:git -- …`); undefined when it runs something else.
 * @param {string[]} w
 * @param {"git" | "gh"} tool
 * @returns {string[] | undefined}
 */
export function argsOf(w, tool) {
  const b = bare(w);
  if (b[0] === tool) return b.slice(1);
  const dash = b.indexOf("--");
  if (dash > 1 && new RegExp(`(^|[:/-])${tool}$`).test(b[1])) return b.slice(dash + 1);
  return undefined;
}

/**
 * A git call's folder (after `-C`), subcommand and the words after it.
 * @param {string[]} a the words after `git`
 * @param {string} here
 */
function gitCall(a, here) {
  let dir = here;
  let i = 0;
  for (; i < a.length && a[i].startsWith("-"); i += 1) {
    if (a[i] === "-C" && a[i + 1] !== undefined) dir = resolve(dir, a[++i]);
    else if (a[i] === "-c" || a[i] === "--git-dir" || a[i] === "--work-tree") i += 1;
  }
  return { dir, sub: a[i], rest: a.slice(i + 1) };
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
export function worktreeAdds(command, cwd) {
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
export function pushTargets(command, cwd) {
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

/**
 * The guard's decision for one Bash command: a denial reason naming the Flow command to use instead, or undefined to
 * let it run. The side doors (FR-13): a worktree outside `.claude/worktrees/`, a push to the default branch,
 * `gh pr merge` and `LEFTHOOK=0`.
 * shortcut: a merge through `gh api …/merge` or a push through another remote helper is not read; the default
 *   branch's ruleset still refuses both.
 * @param {string} command
 * @param {string} cwd
 * @returns {string | undefined}
 */
export function decide(command, cwd) {
  if (words(command).some((w) => w.some((x) => /^LEFTHOOK=(0|false|off)$/i.test(x))))
    return `\`LEFTHOOK=0\` skips the hooks, and they are never an exception (FR-18): commit with them running; a checkout that cannot run them proves them on the testbed with \`${NAME} hooks run <stage>\`.`;
  for (const { w } of steps(command, cwd)) {
    const a = argsOf(w, "gh");
    if (a?.some((x, i) => x === "pr" && a[i + 1] === "merge"))
      return `\`gh pr merge\` is a side door: \`${NAME} land <pr>\` merges, after the gate, the review and the approvals.`;
  }
  for (const { path, dir } of worktreeAdds(command, cwd)) {
    const root = mainCheckout(existing(dir));
    if (!root) continue;
    const inside = join(resolve(root), ".claude", "worktrees") + sep;
    if (!resolve(path).startsWith(inside))
      return `Worktrees live only in ${inside} (ADR 0503): ${path} is outside it. Run \`${NAME} start <STA-n>\`, which makes the branch and the worktree there.`;
  }
  for (const { dir, refs } of pushTargets(command, cwd)) {
    const at = existing(dir);
    const root = mainCheckout(at);
    if (!root) continue;
    const base = defaultBranch(root);
    const current = git(at, ["branch", "--show-current"]).out;
    if (refs.some((r) => r === "*" || (r === "" || r === "HEAD" ? current : r) === base))
      return `Pushing to ${base} is a side door: the default branch changes only through a pull request. Push the task's branch and run \`${NAME} land <pr>\`.`;
  }
  return undefined;
}

/** Reads all of stdin. */
async function stdin() {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

/** `fflow guard [--print-settings]`. */
export async function run(args) {
  if (args.includes("--print-settings")) {
    console.log(JSON.stringify(SETTINGS, null, 2));
    return 0;
  }
  let event;
  try {
    event = JSON.parse(await stdin());
  } catch {
    return 0;
  }
  const command = event?.tool_input?.command;
  if (event?.tool_name !== "Bash" || typeof command !== "string") return 0;
  const reason = decide(command, typeof event.cwd === "string" ? event.cwd : process.cwd());
  if (reason !== undefined)
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: reason,
        },
      }),
    );
  return 0;
}
