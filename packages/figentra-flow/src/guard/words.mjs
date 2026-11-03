/**
 * Figentra Flow file contract:
 * Purpose: shell words for the guard engine: a command split into simple commands of words (quotes honoured), the
 *   variables a simple command sets and the program it runs past `env`, `command` and `exec`, and the arguments it
 *   hands git or gh, directly or through a wrapper script.
 * Boundary: pure; reads nothing.
 * Runtime: node
 * Governing contract: STA-1945 (FR-7, P-012).
 * Secrets: none.
 */

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
 *   branch's ruleset and the gate still refuse what they would slip past. Upgrade to the ported shell scanner when
 *   the stackra tables land (STA-1945 PR 4, T052).
 * @param {string[]} w
 * @returns {{ sets: string[], cmd: string[] }}
 */
export function split(w) {
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
