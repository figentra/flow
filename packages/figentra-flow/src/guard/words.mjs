/**
 * Figentra Flow file contract:
 * Purpose: shell words for the guard engine: a command split into simple commands of words (quotes honoured, heredoc
 *   bodies that no shell reads dropped), the
 *   variables a simple command sets and the program it runs past `env`, `command` and `exec`, and the arguments it
 *   hands git or gh, directly or through a wrapper script.
 * Boundary: pure; reads nothing.
 * Runtime: node
 * Governing contract: STA-1945 (FR-7, P-012).
 * Secrets: none.
 */

/** A program on a heredoc's operator line that runs the body as a script. */
const SHELL = /(?:^|[\s;&|(])(?:sh|bash|zsh|dash|ksh|eval|source|\.)(?=\s|$)/;

/**
 * `command` without its heredoc bodies, which are text (`cat > notes.md <<EOF`), unless the operator line hands the
 * body to a shell (`bash <<EOF`, `cat <<EOF | sh`, a line ending in `|`); core's scanner strips the same bodies.
 * shortcut: an operator inside quotes or arithmetic (`echo '<<EOF'`, `$((1<<EOF))`) still strips, and a body with no
 *   closing line stays commands; upgrade with the side doors' move onto the shell scanner (`split` below).
 * @param {string} command
 */
export function withoutHeredocs(command) {
  const lines = command.split("\n");
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    out.push(lines[i]);
    if (SHELL.test(lines[i]) || /\|&?\s*$/.test(lines[i])) continue;
    for (const [, dash, , end] of lines[i].matchAll(/(?<!<)<<(?!<)(-?)\s*(['"]?)(\w+)\2/g)) {
      let j = i + 1;
      while (j < lines.length && (dash ? lines[j].replace(/^\t+/, "") : lines[j]) !== end) j += 1;
      // No closing line: the rest stays commands, and no later operator is looked for (linear in the input).
      if (j === lines.length) return [...out, ...lines.slice(i + 1)].join("\n");
      i = j;
    }
  }
  return out.join("\n");
}

/**
 * Splits a shell command into simple commands (on `&&`, `||`, `;`, `|` and newlines) of words, honouring quotes;
 * heredoc bodies are dropped (`withoutHeredocs`).
 * @param {string} raw
 * @returns {string[][]}
 */
export function words(raw) {
  const command = withoutHeredocs(raw);
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
 *   branch's ruleset and the gate still refuse what they would slip past. In a stackra repository core's rules (the
 *   preset's `bash-rules.mjs`, on its shell scanner) read those forms for what they deny themselves (a push to the
 *   default branch, `gh pr merge`); a hook skip or a worktree path behind them is the side doors' alone. Upgrade by
 *   moving the side doors onto that scanner (`inbox.mjs`'s `simpleCommands` and `commandAt`, moved into
 *   `src/guard/`) when a neutral repository needs them read through.
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
