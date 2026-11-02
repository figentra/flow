/**
 * Figentra Flow file contract:
 * Purpose: `fflow guard [--print-settings]` — the agent hook that keeps worktrees inside their repository: it reads
 *   a PreToolUse event on stdin and denies a Bash command that runs `git … worktree add <path>` with the path outside
 *   that repository's `.claude/worktrees/`, naming `fflow start`. `--print-settings` prints the `.claude/settings.json`
 *   entry that wires it.
 * Boundary: reads stdin, writes the hook's JSON answer on a denial and nothing otherwise. It follows `cd <dir> &&`,
 *   `git -C <dir>` and quoted words; input it cannot parse passes (a hook fails open), a `worktree add` it can read
 *   never does. Wiring it into a repository is guard configuration, which the owner applies.
 * Runtime: node
 * Governing contract: Stackra ADR 0503 (decision 6); STA-1729.
 * Secrets: none.
 */
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

import { mainCheckout } from "../lib/git.mjs";
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
 * The paths a command would add worktrees at, each resolved against the directory it runs in.
 * @param {string} command
 * @param {string} cwd
 * @returns {{ path: string, dir: string }[]}
 */
export function worktreeAdds(command, cwd) {
  /** @type {{ path: string, dir: string }[]} */
  const found = [];
  let here = cwd;
  for (const w of words(command)) {
    if (w[0] === "cd" && w[1] !== undefined) {
      here = resolve(here, w[1]);
      continue;
    }
    if (w[0] !== "git") continue;
    let dir = here;
    let i = 1;
    for (; i < w.length && w[i].startsWith("-"); i += 1) {
      if (w[i] === "-C" && w[i + 1] !== undefined) dir = resolve(dir, w[++i]);
      else if (w[i] === "-c" || w[i] === "--git-dir" || w[i] === "--work-tree") i += 1;
    }
    if (w[i] !== "worktree" || w[i + 1] !== "add") continue;
    for (let j = i + 2; j < w.length; j += 1) {
      if (VALUED.has(w[j])) {
        j += 1;
        continue;
      }
      if (w[j] === "--") continue;
      if (w[j].startsWith("-")) continue;
      found.push({ path: isAbsolute(w[j]) ? w[j] : resolve(dir, w[j]), dir });
      break;
    }
  }
  return found;
}

/**
 * The guard's decision for one Bash command: a denial reason, or undefined to let it run.
 * @param {string} command
 * @param {string} cwd
 * @returns {string | undefined}
 */
export function decide(command, cwd) {
  for (const { path, dir } of worktreeAdds(command, cwd)) {
    let probe = dir;
    while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
    const root = mainCheckout(probe);
    if (!root) continue;
    const inside = join(resolve(root), ".claude", "worktrees") + sep;
    if (!resolve(path).startsWith(inside))
      return `Worktrees live only in ${inside} (ADR 0503): ${path} is outside it. Run \`${NAME} start <STA-n>\`, which makes the branch and the worktree there.`;
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
