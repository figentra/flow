/**
 * Figentra Flow file contract:
 * Purpose: `fflow guard [--print-settings]` — the agent hook that closes the lifecycle's side doors (FR-13): it reads
 *   a PreToolUse event on stdin and denies a Bash command that runs `git … worktree add <path>` with the path outside
 *   that repository's `.claude/worktrees/` (naming `fflow start`), pushes to the default branch or runs `gh pr merge`
 *   (naming `fflow land`), or skips the hooks: sets `LEFTHOOK=0`, passes `--no-verify` to a commit, push or merge,
 *   `-n` to a commit, or overrides `core.hooksPath` (naming `fflow hooks run`). `--print-settings` prints the
 *   `.claude/settings.json` entry that wires it. The guard engine of STA-1945 PR 4 absorbs these rules.
 * Boundary: reads stdin, writes the hook's JSON answer on a denial and nothing otherwise. It follows `cd <dir> &&`,
 *   `git -C <dir>`, leading `NAME=value` words, `env`, `command` and `exec` prefixes, a git or gh named by its path,
 *   wrapper scripts (`pnpm bot:git -- …`) and quoted words; input it
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

const ASSIGN = /^[A-Za-z_]\w*=/;
/** A program's name without its folder (`/usr/bin/git` → `git`). */
const program = (/** @type {string | undefined} */ x) => x?.split("/").at(-1);
/** `env` options that take a value. */
const ENV_VALUED = new Set(["-u", "--unset", "-C", "--chdir"]);

/**
 * A simple command split into the variables it sets (`NAME=value` words before the program, also after `env`, and
 * `export`'s) and the command it runs, past `env`, `command` and `exec` prefixes.
 * shortcut: not read through: a subshell or group (`( git … )`, `{ git …; }`), `time`, `nohup`, `sudo` and `timeout`
 *   prefixes, `exec -a <name>`, `declare -x`/`typeset -x`/`readonly` (`declare -x LEFTHOOK=0`), `sh -c '…'`, `bash -c`,
 *   `eval`, `xargs`, `pnpm exec git`, `npx`, `env -S`, `GIT_CONFIG_*` variables, git aliases and scripts; the default
 *   branch's ruleset and the gate still refuse what they would slip past. Upgrade to a real shell parser when the
 *   guard engine (STA-1945 PR 4) absorbs these rules.
 * @param {string[]} w
 * @returns {{ sets: string[], cmd: string[] }}
 */
function split(w) {
  /** @type {string[]} */
  const sets = [];
  let i = 0;
  for (;;) {
    while (i < w.length && ASSIGN.test(w[i])) sets.push(w[i++]);
    const p = program(w[i]);
    if (p === "env") {
      for (i += 1; i < w.length && (w[i].startsWith("-") || ASSIGN.test(w[i])); i += 1)
        if (ENV_VALUED.has(w[i])) i += 1;
        else if (ASSIGN.test(w[i])) sets.push(w[i]);
    } else if (p === "command" || p === "exec") {
      i += 1;
      if (w[i] === "-p") i += 1;
    } else break;
  }
  const cmd = w.slice(i);
  if (cmd[0] === "export") sets.push(...cmd.filter((x) => ASSIGN.test(x)));
  return { sets, cmd };
}

/**
 * The arguments a simple command hands `tool` (`git` or `gh`): directly (`git …`, `/usr/bin/git …`), or through a
 * wrapper script named after it (`pnpm bot:git -- …`); undefined when it runs something else.
 * @param {string[]} w
 * @param {"git" | "gh"} tool
 * @returns {string[] | undefined}
 */
export function argsOf(w, tool) {
  const b = split(w).cmd;
  if (program(b[0]) === tool) return b.slice(1);
  const dash = b.indexOf("--");
  if (dash > 1 && new RegExp(`(^|[:/-])${tool}$`).test(b[1])) return b.slice(dash + 1);
  return undefined;
}

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
 * `gh pr merge`, and skipping the hooks (FR-18): `LEFTHOOK=0`, `--no-verify`, `commit -n` or a `core.hooksPath`
 * override.
 * shortcut: a merge through `gh api …/merge` or a push through another remote helper is not read; the default
 *   branch's ruleset still refuses both.
 * @param {string} command
 * @param {string} cwd
 * @returns {string | undefined}
 */
export function decide(command, cwd) {
  const skips = (/** @type {string} */ how) =>
    `${how} skips the hooks, and they are never an exception (FR-18): commit with them running; a checkout that cannot run them proves them on the testbed with \`${NAME} hooks run <stage>\`.`;
  if (words(command).some((w) => split(w).sets.some((x) => /^LEFTHOOK=(0|false|off)$/i.test(x))))
    return skips("`LEFTHOOK=0`");
  for (const { w, here } of steps(command, cwd)) {
    const a = argsOf(w, "git");
    const how = a && hookSkip(gitCall(a, here));
    if (how) return skips(how);
  }
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
