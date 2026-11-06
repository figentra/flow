/**
 * Stackra preset: the guard engine's Bash rules, moved unchanged from the bash part of core's
 * `.agents/hooks/_rules.mjs` and the payload reading of `guard-bash.mjs` (core 220f92c2; STA-1945 T052). Only the
 * imports changed (`./inbox.mjs`, `./reviewer-agents.mjs`, and `isSecretPath` from `./path-rules.mjs`, where the
 * paths part moved) and `BASH_RULES` was added at the end: core's decision as the engine's rules. The engine's side
 * doors run after these rules for this preset too (FR-5). Change it together with core's copy until core's
 * migration PR removes that one. STA-2136 brought it level with core 2ea3f21e: the deploy hardening and the gate
 * rule of STA-2099.
 * Stackra file contract:
 * Purpose: The agent permission rules (ADR 0293), one module for `guard-bash.mjs`, `guard-paths.mjs` and the OpenCode
 *          guard (`.opencode/plugins/guard/decide.ts`), so the two tools never drift. Three tiers: allow, ask (a human
 *          confirms; only the deletes and deploys in `HUMAN_ASKS` reach the owner, and the asks for a command the guard
 *          cannot read are a deny through `unattended`, STA-400; OpenCode denies every ask) and deny. Settings deny and
 *          ask rules are the floor; these rules add only what a prefix pattern cannot see: runner wrappers (`pnpm
 *          exec`, `npx`, `mise exec --`), which checkout a git command targets, `agent_type`, and quoted prose.
 *          Secrets model (ADR 0173, ADR 0257): nobody reads a value. Developer, agent and CI tokens live in Infisical
 *          and reach a process through the pnpm script that needs them; there are no `.env` files in this repository.
 *          Accident guard, not a boundary: hooks run as the same macOS user and fail open, and text rules miss `node
 *          -e`, child_process and wrappers they do not know.  Rules are scoped to the operand of a command, never a
 *          bare keyword. Prose is not a command: quoted text is blanked (`runs`), heredoc bodies are stripped, and `-m`
 *          / `--title` / `--body` values are dropped (`dropMessages`). Substitution bodies, `sh -c` / `eval` strings
 *          and function bodies are commands.
 * Boundary: decides only; reads git state and the repository layout, writes nothing, fails open.
 * Runtime: node (agent hook)
 * Governing contract: ADR 0293; ADR 0173; ADR 0257; STA-400.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import {
  cached,
  clearCaches,
  memoTable,
  WRAPPERS,
  WRAPPER_VALUE,
  XARGS_VALUE,
  commandAt,
  commandReachesInbox,
  gitRunsProgram,
  rawSubstitutions,
  scanShell,
  scriptStrings,
  simpleCommands,
  runsOpaque,
  stripHeredocs,
} from "./inbox.mjs";
import { decideExecutor } from "./executor.mjs";
import { isExecutor, isSecretPath } from "./path-rules.mjs";
import { REVIEWER_AGENTS } from "./reviewer-agents.mjs";

/** The home directory, read once: `homedir()` is a system call, and every word is checked against it. */
const HOME_DIR = homedir();

/** The only `-c` keys an agent may set: display, identity and rerere; none runs a command or redirects a remote. */
const ALLOWED_C =
  /^(?:color\.ui|color\.diff|color\.status|color\.branch|core\.quotepath|core\.abbrev|core\.precomposeunicode|user\.name|user\.email|advice\.detachedhead|diff\.renames|diff\.algorithm|diff\.context|diff\.noprefix|log\.abbrevcommit|log\.decorate|log\.date|merge\.ff|merge\.conflictstyle|pull\.rebase|pull\.ff|push\.default|rebase\.autosquash|init\.defaultbranch|column\.ui|status\.short|status\.branch|status\.showuntrackedfiles|rerere\.enabled)$/i;
/** `-c key=value` pairs that are safe only with this value: a no-op editor, signing off. */
const SAFE_C_VALUE =
  /^(?:(?:core|sequence)\.editor=(?:true|:|cat)|(?:commit|tag)\.gpgsign=false)$/i;
const allowedC = (kv) => ALLOWED_C.test(kv.split("=")[0]) || SAFE_C_VALUE.test(kv);
/** `git config` modes that only read; the first option after the scope must be one of them. */
const CONFIG_READ = new Set([
  "--get",
  "--get-all",
  "--get-regexp",
  "--get-urlmatch",
  "--list",
  "-l",
  "get",
  "list",
]);
const CONFIG_WRITE = new Set([
  "--add",
  "--replace-all",
  "--unset",
  "--unset-all",
  "-e",
  "--edit",
  "--rename-section",
  "--remove-section",
  "set",
  "unset",
  "edit",
]);
/** Words of a `git config` command line: stops at an unquoted separator or `#` comment; a quoted word is never a flag. */
function configWords(rest) {
  const out = [];
  let cur = null;
  let quoted = false;
  const end = () => {
    if (cur !== null) out.push(quoted ? "\0" + cur : cur);
    cur = null;
    quoted = false;
  };
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i];
    if (ch === "'" || ch === '"') {
      const close = rest.indexOf(ch, i + 1);
      const stop = close === -1 ? rest.length : close;
      cur = (cur ?? "") + rest.slice(i + 1, stop);
      quoted = true;
      i = stop;
    } else if (/\s/.test(ch) && ch !== "\n") end();
    else if (/[|;&\n]/.test(ch) || (ch === "#" && cur === null)) break;
    else cur = (cur ?? "") + ch;
  }
  end();
  return out;
}
/** `git config` options before the mode that only pick a scope or an output format; `-f` / `--file` take a value. */
const CONFIG_SCOPE =
  /^(?:--(?:local|global|system|worktree|show-origin|show-scope|includes|no-includes|null|name-only|bool|int|path|(?:file|blob|type|default)=\S*)|-z)$/;
const CONFIG_SCOPE_VALUE = new Set(["-f", "--file", "--blob", "--type", "--default"]);
/**
 * What `git config` words do: "" for a read (past the scope options: a read mode, or one key alone,
 * `git config --global user.name`; no write flag anywhere) or a `--worktree` write of one allowed key; "ask" for a
 * write of one allowed key to the repository's config, which every linked worktree shares
 * (`git config rerere.enabled true`; allowed since STA-400, no rule reads "ask"); "deny" for anything else. With linked worktrees git refuses `--worktree`
 * unless `extensions.worktreeConfig` is on, so that write never reaches the shared file.
 */
function configWrites(words) {
  let i = 0;
  let shared = false; // a scope outside the repository: --global, --system, a file
  let worktree = false;
  for (; i < words.length; i++) {
    const w = words[i];
    if (CONFIG_SCOPE_VALUE.has(w)) shared ||= ["-f", "--file", "--blob"].includes(words[i++]);
    else if (CONFIG_SCOPE.test(w)) {
      shared ||= /^--(?:global|system|file=|blob=)/.test(w);
      worktree ||= w === "--worktree";
    } else break;
  }
  const rest = words.slice(i);
  if (rest.some((w) => CONFIG_WRITE.has(w))) return "deny";
  if (CONFIG_READ.has(rest[0]) || (rest.length === 1 && !rest[0].startsWith("-"))) return "";
  if (rest.length === 2 && ALLOWED_C.test(rest[0]) && !shared) return worktree ? "" : "ask";
  return "deny";
}
/**
 * The strictest `configWrites` level of every `git … config …` in `d`; "deny" for a `git -c <key>` that could
 * write config or run a command (STA-216).
 */
function gitConfigLevel(d) {
  const re = new RegExp(String.raw`\bgit\s+(?:--\s+)?(${GIT_OPTS})`, "g");
  const opt = new RegExp(
    String.raw`-c\s+(?<v>${Q})|-C\s+(?:${Q})|--(?:git-dir|work-tree|namespace)(?:=(?:${Q})|\s+(?:${Q}))|--\S+|-[pP]`,
    "g",
  );
  let level = "";
  for (const m of d.matchAll(re)) {
    for (const t of m[1].matchAll(opt))
      if (t.groups.v !== undefined && !allowedC(unquote(t.groups.v))) return "deny";
    const rest = d.slice(m.index + m[0].length);
    const writes = /^config\b/.test(rest) ? configWrites(configWords(rest.slice(6))) : "";
    if (writes === "deny") return "deny";
    level ||= writes;
  }
  return level;
}
/** An option value: one word, quoted parts allowed (`"a b"c`); one parse only, so a failed match never backtracks. */
const Q = String.raw`(?:"[^"]*"|'[^']*'|[^\s"'])\S*`;
/** git's global options before the subcommand (STA-216: quoted values, the boolean options). */
const GIT_OPTS = String.raw`(?:(?:-[Cc]\s+(?:${Q})|--(?:git-dir|work-tree|namespace)(?:=(?:${Q})|\s+(?:${Q}))|--exec-path(?:=\S+)?|--(?:no-pager|paginate|bare|literal-pathspecs|no-replace-objects|glob-pathspecs|noglob-pathspecs|icase-pathspecs|no-optional-locks)|-[pP])\s+)*`;
/** `git` (or `pnpm bot:git --`) followed by any global options before the subcommand. */
const GIT = String.raw`\bgit\s+(?:--\s+)?` + GIT_OPTS;

/** Words that run the command after them, and the shell keywords that open a command. */
const LEAD_WORDS = new Set([...WRAPPERS, "xargs", "caffeinate", "watch", "script", "arch"]);
const KEYWORDS = new Set([
  "if",
  "elif",
  "while",
  "until",
  "then",
  "do",
  "else",
  "!",
  "{",
  "coproc",
]);
/** Wrapper options whose value is the next word (`sudo -u x`, `nice -n 5`, `xargs -I {}`, `arch -arch x`). */
const VALUE_FLAGS = new Set([...WRAPPER_VALUE, ...XARGS_VALUE, "-arch"]);
/**
 * Indexes of the words of a simple command that may be its command name, by one linear walk (STA-330 review: the
 * old nested regex backtracked exponentially): past assignments, keywords and wrappers with their options,
 * durations and option values (`timeout 5`, `nice -n 5`, `sudo -u x`, `env -i A=1`, `script -q <file>`). A word a
 * wrapper option may have taken as its value is tried as the name too (`sudo -s gh` runs gh), so no reading of
 * the words is missed. `command -v x` only looks a name up.
 */
function nameIndexes(words) {
  const out = [];
  let wrapped = false;
  let value = false; // the word may be the value of the option before it
  let file = false; // `script`'s file operand, before its command
  for (let k = 0; k < words.length; k++) {
    const w = words[k];
    const b = w.split("/").pop();
    out.push(k);
    if (b === "command" && /^-[a-zA-Z]*[vV]/.test(words[k + 1] ?? "")) break;
    if (KEYWORDS.has(w) || /^\w+=/.test(w)) continue;
    if (LEAD_WORDS.has(b)) {
      [wrapped, value, file] = [true, false, b === "script"];
    } else if (wrapped && w.startsWith("-")) value = VALUE_FLAGS.has(w);
    else if (wrapped && /^\d+(?:\.\d+)?[smhd]?$/.test(w)) value = false;
    else if (wrapped && value) value = false;
    else if (wrapped && file) file = false;
    else break;
  }
  return out;
}
const namesCache = memoTable();
/** Offsets in `t` where a command name may start, over every simple command (`nameIndexes`); memoised. */
const nameOffsets = (t) =>
  cached(namesCache, t, () =>
    simpleCommands(t).flatMap((s) => nameIndexes(s.words).map((k) => s.at[k])),
  );
/**
 * A test that a command of a text, from its name on, matches `tail` (a path before the name allowed). Wrappers
 * and keywords are walked by `nameIndexes`; runners (`pnpm exec`, `npx`) are dropped by `lookThroughRunners`.
 */
const atName = (tail) => {
  const rx = new RegExp(String.raw`(?:[^\s;&|()<>]*/)?(?:${tail})`, "y");
  return (t) =>
    nameOffsets(t).some((i) => {
      rx.lastIndex = i;
      return rx.test(t);
    });
};
/** The end of a command name: a space, an operator or the end. */
const END = String.raw`(?=[\s;&|()<>]|$)`;

/**
 * Owner-login guard (STA-208, ADR 0230 rule 5): `gh` and `git` as a command name run with the owner's `gh auth`
 * login and git credential helper. Agents use the bot wrappers instead, which fail closed when no token can be
 * minted.
 */
const BARE_GH = atName("gh" + END);
/**
 * Every git subcommand that talks to a remote. All of them go through `pnpm bot:git`, public repos included.
 * `submodule status` and `submodule summary` read only the local checkout.
 */
const NETWORK_GIT = atName(
  String.raw`git\s+${GIT_OPTS}(?:push|fetch|pull|clone|ls-remote|submodule(?!\s+(?:status|summary)\b)|subtree|remote\s+(?:update|show|prune)|archive\s+[^|;&\n]*--remote)\b`,
);

/** A character of a word that is not a separator, redirection, group or backtick. */
const W = String.raw`[^\s|;&()<>\x60]`;
/**
 * Runners that run the command after them, like `sudo` or `env`: `pnpm [global options] [exec|dlx] <bin>` (pnpm
 * runs any binary on PATH when no script has the name), `npm exec`, `yarn`, `npx`, `pnpx`, `bunx` and
 * `mise exec … --`. `lookThroughRunners` drops them at command position, so `pnpm gh pr merge` is checked as
 * `gh pr merge`. shortcut: options that take a value are known only for pnpm (`-C`, `-F`, `--filter`, `--dir`);
 * `npx -p pkg cmd` is read as `pkg cmd` (an OpenCode executor denies `npx` itself; for Claude, `npx` is allowed and
 * the rules run on `pkg cmd`). Upgrade when a runner option hides a command.
 * `mise exec` ends at its own first `--`, never at the command's (`mise exec -- rm -rf -- /`, STA-330 review).
 */
const RUNNER = String.raw`(?:(?:${W}*\/)?(?:pnpm|npm|yarn)\s+(?:(?:-[CF]|--(?:filter|dir|prefix|workspace|cwd))(?:=|\s+)${W}+\s+|--?[\w-]+(?:=${W}+)?\s+)*(?:(?:exec|dlx|x)\s+(?:-${W}+\s+)*)?|(?:${W}*\/)?(?:npx|pnpx|bunx)\s+(?:-${W}+\s+)*|(?:${W}*\/)?mise\s+(?:exec|x)\s+(?=\S)(?:(?!--\s)[^|;&\n]*?\s)?--\s+)`;
/**
 * A runner at command position: a lookbehind, so a match starts only at a command's first word, and words that stop
 * at a separator (`W`, a `$(…)` or a backtick in an assignment), so no match scans past its own command: a run of
 * separators or blank lines stays linear (STA-330 review).
 */
const RUNNERS = new RegExp(
  String.raw`(?=[\w./])(?<=(?:^|[|;&(\n\x60])\s*)((?:\w+=(?:${W}|\$\([^()]*\)|\x60[^\x60]*\x60)*\s+)*)(?:${RUNNER})+`,
  "g",
);
/** `c` with every runner prefix at command position removed (`pnpm exec infisical run` → `infisical run`). */
export const lookThroughRunners = (c) => c.replace(RUNNERS, "$1");

/** The text of every `$(…)` / backtick body at any depth (single quotes stay literal) and `sh -c` / `eval` string. */
const nestedCache = memoTable();
const nestedRaw = (c) =>
  cached(nestedCache, c, () =>
    nesting(() => {
      const out = scanShell(c).bodies.flatMap((b) => [b, ...nestedRaw(b)]);
      for (const s of scriptStrings(c)) out.push(s, ...nestedRaw(s));
      return out;
    }),
  );
/**
 * Script strings nest at most this deep (`sh -c "eval '…'"`): each level is a new text to scan, and a chain like
 * `eval x eval x …` peels one level per two words, which made a decision quadratic (STA-330 review).
 */
const MAX_SCRIPTS = 8;
let scriptDepth = 0;
let tooDeep = false;
/** `f()` one script level deeper; past `MAX_SCRIPTS` it reads nothing and the decision denies (`TOO_DEEP`). */
function nesting(f) {
  if (scriptDepth >= MAX_SCRIPTS) {
    tooDeep = true;
    return [];
  }
  scriptDepth++;
  try {
    return f();
  } finally {
    scriptDepth--;
  }
}
/** The command with prose dropped, and every nested command in full. */
const proseFree = (c) => [dropMessages(c), ...nestedRaw(c).map(dropMessages)];
/**
 * Every command line passed as one quoted word in `c` or a nested command (`commandLines`), and what each line runs
 * in turn (`nestedRaw`): its substitutions and script strings, so `ssh h 'echo "rm -rf ~" | sh'` reads `rm -rf ~`
 * (STA-351). Memoised.
 */
const lineCache = memoTable();
const lineTexts = (c) =>
  cached(lineCache, c, () =>
    proseFree(c).flatMap((t) => commandLines(t).flatMap((l) => [l, ...nestedRaw(l)])),
  );
/**
 * Texts a rule that needs the quoted values scans: the command with prose dropped, every nested command in full,
 * and every command line passed as one quoted word (`commandLines`). Memoised.
 */
const scanTextCache = memoTable();
const scanTexts = (c) => cached(scanTextCache, c, () => [...proseFree(c), ...lineTexts(c)]);
/** SQL clients: their quoted, piped and heredoc text is read for a drop (`runsSqlClient`). */
const SQL_CLIENTS = new Set([
  "psql",
  "pgcli",
  "usql",
  "mysql",
  "mariadb",
  "mycli",
  "sqlite3",
  "litecli",
  "duckdb",
]);
/** Commands whose operands are text, patterns or programs in another language, never shell commands. */
const TEXT_COMMANDS = new Set([
  "echo",
  "printf",
  "rg",
  "grep",
  "egrep",
  "fgrep",
  "ag",
  "jq",
  "sed",
  "awk",
  "gawk",
]);
/** A simple command whose words are prose, search patterns or history: `TEXT_COMMANDS`, `git log|grep`. */
function readerCommand(words) {
  const i = commandAt(words);
  const name = baseName(words[i] ?? "");
  if (TEXT_COMMANDS.has(name)) return true;
  const sub = words.slice(i + 1).find((w) => !w.startsWith("-")) ?? "";
  return name === "git" && (sub === "log" || sub === "grep");
}
/**
 * A word that holds a guarded command name as a command word: `rm`, `find`, `git` (`bot:git` too) and the names
 * the secret, deploy and release rules read. After a quote too, so a line quoted inside a line is found and read in
 * turn (`ssh h "tmux new -d 'rm -rf ~'"`), and SQL clients for the drop rule (STA-330 review).
 */
const LINE_WORD = new RegExp(
  String.raw`(?:^|[\s;&|(\x60:'"])(?:[^\s;&|()<>\x60]*\/)?(?:rm|find|git|infisical|encore|npx|pnpx|bunx|(?:wrangler|eas(?:-cli)?|npm|pnpm|yarn|changeset)(?:@[^\s;&|()<>\x60'"]*)?|drizzle-kit|mikro-orm|security|${[...SQL_CLIENTS].join("|")})(?=[\s:])`,
);
/**
 * `w` without its `$(…)`, `<(…)`, `>(…)` and backtick bodies (`scanShell` reads those as their own texts). A paren
 * that is quoted or escaped never opens or closes one (`$(git log --format="%an (%ae)")`, `$(find . \( … \))`).
 */
function outsideSubstitutions(w) {
  const { spans, source } = scanShell(w);
  const escaped = source.replaceAll(/\\[\s\S]/g, "__");
  let mask = "";
  let at = 0;
  for (const [a, b] of spans) {
    mask += escaped.slice(at, a) + "_".repeat(b - a); // spans are in order and never overlap
    at = b;
  }
  mask += escaped.slice(at);
  for (let was = ""; was !== mask;)
    [was, mask] = [mask, mask.replaceAll(/[$<>]\([^()]*\)|`[^`]*`/g, (m) => "\0".repeat(m.length))];
  return source.replaceAll(/[\s\S]/g, (ch, i) => (mask[i] === "\0" ? "" : ch));
}
let lineDepth = 0;
/**
 * Command lines passed as one quoted word or here-string to a wrapper the guard does not know (`tmux new -d '…'`,
 * `watch '…'`, `ssh h '…'`, `su -c '…'`, `trap '…' EXIT`, `at now <<< '…'`, a crontab line): a word with a space
 * that holds a guarded command name (`LINE_WORD`) outside its substitutions, in a command that is not prose or a
 * search (`readerCommand`), and not a program (`withoutPrograms`), its own messages dropped. A line is read again
 * for the lines inside it, never when it is the text being read, and only up to `MAX_SCRIPTS` deep: past that it is
 * not read, and this heuristic never denies by itself (STA-330 review). The delete, discard, push and stash rules read them, and the rules for the
 * guarded names (`runsQuoted`); other rules keep quoted text as prose.
 */
function commandLines(t) {
  if (lineDepth >= MAX_SCRIPTS) return [];
  lineDepth++;
  try {
    const out = [];
    for (const s of simpleCommands(t)) {
      if (readerCommand(s.words)) continue;
      const strings = s.redirects.filter((r) => r.op === "<<<").map((r) => r.target);
      for (const w of [...withoutPrograms(s.words), ...strings]) {
        if (!/\s/.test(w)) continue;
        const plain = outsideSubstitutions(w);
        if (!/\s/.test(plain) || !LINE_WORD.test(plain)) continue;
        const line = dropMessages(w);
        out.push(line, ...(line === t ? [] : commandLines(line)));
      }
    }
    return out;
  } finally {
    lineDepth--;
  }
}
/**
 * `scanTexts` paired with the directory each text starts in: the command starts in `cwd`; a nested text (a `$(…)`
 * body, an `sh -c` string) starts unknown once the command has a `cd`, because the order is lost.
 */
const scanBases = (c, cwd) => {
  const [outer, ...nested] = scanTexts(c);
  const base = /(?:^|[\s;&|(`'"])(?:cd|pushd)(?:\s|$)/.test(outer) ? null : cwd;
  return [[outer, cwd], ...nested.map((t) => [t, base])];
};
const runnableCache = memoTable();
/**
 * The text a shell runs: the quote-blanked command (prose in `--body "…"` is ignored), plus every `$(…)` and
 * backtick body at any depth, inside double quotes too (`scanShell`, STA-254), and every `sh -c` / `eval` string.
 * Single-quoted text stays literal. Function, alias and piped or written-then-run script text come from
 * `scriptStrings` (STA-291); deliberate workarounds stay open. Memoised: every rule reads the same texts.
 */
const runnable = (c) =>
  cached(runnableCache, c, () =>
    nesting(() => {
      const { blanked, bodies } = scanShell(c);
      const out = [blanked, ...bodies.flatMap(runnable)];
      for (const s of scriptStrings(c)) out.push(...runnable(s));
      return out;
    }),
  );
/** True when any runnable text has a segment matching `rx`, or passes `rx` when it is a test (`atName`). */
const runs = (c, rx) =>
  runnable(c).some((t) => (typeof rx === "function" ? rx(t) : segments(t).some((s) => rx.test(s))));
/**
 * `runs` over the command and every command line passed as one quoted word (`watch 'infisical export'`), each line
 * also with its runners dropped (`ssh h 'npx wrangler@3 deploy'`, STA-400 review).
 */
const runsQuoted = (c, rx) =>
  [c, ...lineTexts(c).flatMap((l) => [l, lookThroughRunners(l)])].some((t) => runs(t, rx));

/**
 * At most this many git processes run for one decision (about 20 ms each; the hook is killed, and fails open, at
 * 5 s). Past it `git` answers "" (an unknown checkout, which every rule reads deny-leaning) and the decision denies
 * (`TOO_MANY_GIT`; STA-330 review).
 */
const MAX_GIT = 48;
let gitRuns = 0;
/**
 * One decision works at most this long (ms); past it git answers "" and the decision denies (`TOO_SLOW`): the hook
 * is killed, and fails open, at 5 s, and a git spawn can cost far more than its usual 20 ms (STA-330 review).
 */
const DEADLINE_MS = 2000;
let deadline = Infinity;
let gitLate = false; // a git lookup was skipped at the deadline
const late = () => performance.now() > deadline;
/** `git` output in `cwd`, or "" when git fails; memoised for one decision. */
const gitCache = memoTable();
const git = (cwd, ...args) =>
  cached(gitCache, JSON.stringify([cwd, args]), () => {
    // A spawn into a missing directory fails, and slows the next spawn by about 140 ms (STA-330 review).
    if (++gitRuns > MAX_GIT || (gitLate ||= late()) || !existsSync(cwd)) return "";
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    return r.status === 0 ? r.stdout.trim() : "";
  });

/** Quoted strings blanked, so a word inside `node -e '...'` or `--body "..."` is not mistaken for a command. */
const blank = (c) => scanShell(c).blanked;

/** Command segments: split on separators outside quotes (a `;` inside `-c "a;b"` does not hide a push). */
const segmentCache = memoTable();
const segments = (c) => cached(segmentCache, c, () => splitSegments(c));
function splitSegments(c) {
  const out = [];
  let cur = "";
  let quote = "";
  for (let i = 0; i < c.length; i++) {
    const ch = c[i];
    if (quote) {
      if (ch === "\\" && quote === '"') cur += ch + (c[++i] ?? "");
      else {
        cur += ch;
        if (ch === quote) quote = "";
      }
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      cur += ch;
    } else if (/[|;\n]/.test(ch) || (ch === "&" && !/[<>]/.test(c[i - 1]) && c[i + 1] !== ">")) {
      out.push(cur);
      cur = "";
    } else cur += ch; // `2>&1`, `>&2` and `&>f` are redirections, not separators
  }
  out.push(cur);
  return out;
}
const unquote = (w) => w.replaceAll(/^['"]+|['"]+$/g, "");
/**
 * Prose is not a command: blank the quoted `-m` / `--message` / `--title` / `--body` / `--description` value and the
 * text of `pnpm linear comment <KEY> "…"` (STA-216), so a PR body or a comment may mention `pr merge` or
 * `push origin main`. A short-flag cluster ending in `m` (`commit -am`, `-sm`) is `-m`, unless it holds `c`: the
 * value of `sh -cm` is a command (STA-330 review). A dequoted value that starts `x=` is requoted after it
 * (`x="$HOME …"`), so the span may follow a `name=` (STA-351).
 */
const PROSE_BEFORE =
  /(?:\s(?:-[abd-zA-Z]*m|--message|--title|--body|--description)(?:\s+|=)|\blinear\s+comment\s+\S+\s+)(?:\w+=)?$/;
const messageCache = memoTable();
const dropMessages = (c) =>
  cached(messageCache, c, () => {
    const { spans, source } = scanShell(c);
    return spans
      .filter(([start]) => PROSE_BEFORE.test(source.slice(Math.max(0, start - 300), start)))
      .reduceRight((t, [start, end]) => t.slice(0, start) + "MSG" + t.slice(end), source);
  });

/** The `infisical secrets` subcommand a runnable segment uses: "get", "set", "delete", "folders", or "" (bare). */
const INFISICAL_SUBCOMMANDS = new Set(["get", "set", "delete", "folders", "generate-example-env"]);
function infisicalSecrets(c) {
  return infisicalCommands(c)
    .filter((x) => x.sub === "secrets")
    .map((x) => x.rest.find((w) => INFISICAL_SUBCOMMANDS.has(w)) ?? "");
}
/** Infisical global options whose value is the next word (`--domain https://…`, `--log-level debug`). */
const INFISICAL_VALUED = new Set(
  "--domain --log-level --token --projectId --project-id --env --path --config --type --tags --format --output --output-file --file".split(
    " ",
  ),
);
/** Infisical commands: the first of these after `infisical` and its options is its subcommand. */
const INFISICAL_COMMANDS = new Set(
  "run secrets export login init user token scan vault bootstrap dynamic-secrets ssh agent gateway reset kms pki service-token folders help completion update".split(
    " ",
  ),
);
/**
 * Every `infisical` command in `c` as `{ sub, rest }`: any path, `@infisical/cli`, a version, through runners and
 * quoted lines. Global options and their values are skipped, and a word that is no known command is read as an
 * unknown option's value, so `infisical --domain <url> secrets get X` is `secrets` (STA-400 review). Deny-leaning,
 * like the token rule: any word named `infisical` starts one.
 */
const INFISICAL_NAME = /(?:^|\/)(?:infisical|@infisical\/cli)(?:@[^/]*)?$/;
const infisicalCache = memoTable();
function infisicalCommands(c) {
  return cached(infisicalCache, c, () => readInfisical(c));
}
function readInfisical(c) {
  const out = [];
  const texts = [c, lookThroughRunners(c)];
  for (const l of lineTexts(c)) texts.push(l, lookThroughRunners(l));
  for (const t of texts.flatMap(runnable))
    for (const s of simpleCommands(t))
      s.words.forEach((w, k) => {
        if (!INFISICAL_NAME.test(unquote(w))) return;
        let j = k + 1;
        for (; j < s.words.length; j++) {
          const x = unquote(s.words[j]);
          if (INFISICAL_NAME.test(x)) break; // the next one reads on from here: linear, not quadratic
          if (INFISICAL_VALUED.has(x)) j++;
          else if (!x.startsWith("-") && INFISICAL_COMMANDS.has(x)) break;
        }
        if (j < s.words.length && !INFISICAL_NAME.test(unquote(s.words[j])))
          out.push({ sub: unquote(s.words[j]), rest: s.words.slice(j + 1).map(unquote) });
      });
  return out;
}

/** The branch a push refspec writes to: `+src:refs/heads/dst` (or `heads/dst`) → `dst`. */
const refspecDest = (r) =>
  r
    .replace(/^\+/, "")
    .split(":")
    .pop()
    .replace(/^(?:refs\/)?heads\//, "");

/** `~` and `$HOME` expanded; any other `$` or backtick, or an empty (blanked) word, makes the path unknown (null). */
const expandHome = (p) => {
  const e = unquote(p).replace(/^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/, HOME_DIR);
  return e === "" || /[$`]/.test(e) ? null : e;
};

/**
 * `p` with its existing ancestors resolved through symlinks (`/tmp` → `/private/tmp`); the rest kept as written.
 * Memoised, the result as its own key too, so a deep path walked one segment at a time (`physical`) stays linear.
 */
const realCache = memoTable();
function realDir(p) {
  return cached(realCache, p, () => {
    let out;
    try {
      out = realpathSync(p);
    } catch {
      const up = dirname(p);
      out = up === p ? p : join(realDir(up), basename(p));
    }
    realCache.set(out, out);
    return out;
  });
}

/** The directory a `cd` / `pushd` operand moves `dir` to; null when unknown (`$X`, `-`, an unknown base). */
function moveTo(dir, to) {
  if (to === undefined) return HOME_DIR;
  if (to === "-") return null;
  const e = expandHome(to);
  if (e === null) return null;
  if (e.startsWith("/")) return e;
  return dir === null ? null : resolve(dir, e);
}
/** A `cd` buried in a word (`$(cd x)`, `sh -c "cd x"`, `then cd x`): the directory after it is unknown. */
const NESTED_CD = /(?:^|[\s;&|(`'"])(?:cd|pushd)\s/;
/** At most this many possible directories are followed; past it the directory is unknown. */
const MAX_DIRS = 16;
const union = (a, b) => {
  const u = [...new Set([...a, ...b])];
  return u.length > MAX_DIRS ? [null] : u;
};
/**
 * The simple commands of `text` in order (`simpleCommands`), each with its own text (`src`) and every directory it
 * may run in (`dirs`, null when unknown; STA-330 review). `cd` / `pushd` are followed: a command right after
 * `cd x &&` runs in x; after `cd x;` or `cd x ||` in x, or where it was when the `cd` failed. A `( … )` subshell's
 * `cd` ends at its `)`. A `cd` in a pipeline or in the background, `popd`, `env -C` / `--chdir`, and a `cd` nested
 * in a word make the directory unknown.
 */
function walk(text, cwd) {
  const out = [];
  const saved = [];
  let dirs = [cwd];
  let back = null; // the directories if a `cd` earlier in this `&&` chain failed
  let prev = "";
  let start = 0;
  for (const s of simpleCommands(text, { all: true })) {
    const src = text.slice(start, s.end - s.op.length);
    const from = start;
    start = s.end;
    const words = s.words[0] === "{" ? s.words.slice(1) : s.words;
    if (words[0] === "cd" || words[0] === "pushd") {
      const to = words.slice(1).find((w) => w !== "--" && !/^-[LPe@]+$/.test(w));
      const forked = prev === "|" || s.op === "|" || s.op === "&";
      const moved = forked ? [null] : dirs.map((d) => moveTo(d, to));
      if (s.op === "&&" && !forked && prev !== "||") {
        back ??= dirs;
        dirs = moved;
      } else dirs = union(dirs, moved);
    } else if (words[0] === "popd") dirs = [null];
    else if (words.length) {
      if (NESTED_CD.test(src)) dirs = [null];
      const env = words.some((w) => ["env", "sudo"].includes(w.split("/").pop()));
      const chdir = words.some((w) => /^--chdir\b/.test(w) || (env && /^-[a-zA-Z]*[CD]/.test(w)));
      const at = s.at.map((i) => i - from); // word offsets in `src`
      out.push({ src, words: s.words, at, dirs: chdir ? [null] : dirs });
    }
    if (s.op === "(") {
      saved.push([dirs, back]);
      back = null;
    } else if (s.op === ")") [dirs, back] = saved.pop() ?? [[null], null];
    else if (s.op !== "&&" && back) {
      dirs = union(dirs, back);
      back = null;
    }
    prev = s.op;
  }
  return out;
}
/**
 * The arguments that follow a command word, as the shell passes them: quotes removed, redirections dropped
 * (`--hard>/dev/null`, `<<<x`, `2>&1`, `&>f`), stopping at a separator, a `)` / `}` that closes a group or the
 * backtick that closes a body (`` echo `git push origin HEAD` ``).
 */
const argWords = (tail) =>
  simpleCommands(tail.split("`")[0])[0]?.words.filter((w) => w !== "}") ?? [];
/** Segments whose words are search patterns or history, never a git action (`grep "git push origin main"`). */
const READER_SEGMENT =
  /^\s*(?:\S*\/)?(?:rg|grep|egrep|fgrep|ag)\b|^\s*(?:\S*\/)?git\s+(?:-\S+\s+)*(?:log|grep)\b/;
/**
 * A git invocation: its global options (1) and subcommand (2, in a lookahead so `x/.git git reset` yields both
 * `git git` and `git reset`); `pnpm bot:git --` included.
 */
const GIT_WORD = new RegExp(String.raw`\bgit\s+(?:--\s+)?(${GIT_OPTS})(?=([\w-]+))`, "g");
/** Global options that move the checkout; a `-c` value is consumed and never read as an option (STA-216). */
const TARGET_TOKENS = new RegExp(
  String.raw`(?<bare>--bare)|(?<opt>-C|--git-dir|--work-tree)(?:=|\s+)(?<value>${Q})|-c\s+(?:${Q})|--namespace(?:=(?:${Q})|\s+(?:${Q}))|--[a-z-]+(?:=\S+)?|-[pP]`,
  "g",
);

/**
 * Every git command in `text` (`walk`: separators, groups and `cd` followed) with the checkout it runs in, once per
 * directory it may run in: `args` (`argWords`), and `run(...args)`, which runs git with the location options
 * replayed (`-C`, `--git-dir`, `--work-tree`, `--bare`, and `GIT_DIR=` / `GIT_WORK_TREE=` anywhere) and returns ""
 * when it fails or the checkout is unknown.
 */
const gitCommands = (text, cwd) =>
  cached(gitCommandCache, `${cwd}\0${text}`, () => readGitCommands(text, cwd));
/** Seven rules read the same git commands. */
const gitCommandCache = memoTable();
function readGitCommands(text, cwd) {
  const out = [];
  const env = [...text.matchAll(new RegExp(String.raw`\bGIT_(DIR|WORK_TREE)=(${Q})`, "g"))].map(
    ([, k, v]) => [k === "DIR" ? "--git-dir" : "--work-tree", expandHome(v)],
  );
  for (const { src, words, at, dirs } of walk(text, cwd)) {
    if (READER_SEGMENT.test(src)) continue;
    let next = 0; // the word the next match's subcommand starts, when it is a word of this command
    // Every `git` word outside quotes (a path like `GIT_DIR=x/.git git …` holds two); quoted text is prose here,
    // and the commands nested in it are scanned as their own texts.
    const quoted = scanShell(src).spans; // in order, never overlapping
    let q = 0;
    let seen = 0;
    for (const m of src.matchAll(GIT_WORD)) {
      while (q < quoted.length && quoted[q][1] <= m.index) q++;
      if (q < quoted.length && quoted[q][0] <= m.index) continue;
      // More git words than a command holds (`echo git git …`) are not read, which was quadratic: the decision
      // denies as past the git cap.
      if (++seen > MAX_DELETERS) {
        gitRuns = MAX_GIT + 1;
        break;
      }
      let where = [];
      for (const [opt, v] of env)
        where = v === null || where === null ? null : [...where, `${opt}=${v}`];
      for (const { groups: g } of m[1].matchAll(TARGET_TOKENS)) {
        if (where === null) break;
        if (g.bare) where.push("--bare");
        if (!g.opt) continue;
        const v = expandHome(g.value);
        if (v === null) where = null;
        else where.push(...(g.opt === "-C" ? ["-C", v] : [`${g.opt}=${v}`]));
      }
      const target = where;
      const subAt = m.index + m[0].length;
      while (next < at.length && at[next] < subAt) next++;
      // A subcommand that is a word of this command takes the words after it; one inside a substitution or a
      // quoted script is tokenised from its own text.
      const args =
        at[next] === subAt && words[next].startsWith(m[2])
          ? words.slice(next + 1)
          : argWords(src.slice(subAt + m[2].length));
      const bot =
        /\bbot:git\b|\bbot-gh\.mjs\s+git\b|(?:\bfigentra(?:\.mjs)?|@figentra\/cli(?:@\S*)?)\s+(?:--\s+)?bot\s+git\b/.test(
          src,
        );
      const gitDir = target === null || target.some((w) => /^--(?:git-dir|bare)\b/.test(w));
      for (const dir of dirs)
        out.push({
          sub: m[2],
          args,
          bot,
          gitDir,
          run: (...a) => (dir === null || target === null ? "" : git(dir, ...target, ...a)),
        });
    }
  }
  return out;
}

/**
 * The checkout a session owns: the toplevel of its cwd, whether that is the main checkout (git-dir equals
 * git-common-dir) rather than a linked worktree, and the linked worktrees nested inside it (`.claude/worktrees/*`).
 */
function ownCheckout(cwd) {
  const [top, ...dirs] = git(cwd, "rev-parse", "--show-toplevel", "--git-dir", "--git-common-dir")
    .split("\n")
    .filter(Boolean);
  if (!top || dirs.length !== 2) return { root: "", main: true, nested: [] };
  const root = realDir(top);
  const [dir, common] = dirs.map((p) => realDir(resolve(cwd, p)));
  const nested = git(cwd, "worktree", "list", "--porcelain")
    .split("\n")
    .filter((l) => l.startsWith("worktree "))
    .map((l) => realDir(l.slice(9)))
    .filter((w) => w.startsWith(root + sep));
  return { root, main: dir === common, nested };
}

/** A long option `f` names `name`, GNU unique prefixes included (`--recu` for `--recursive`). */
const longFlag = (f, name) => f.length >= 3 && name.startsWith(f.split("=")[0]);
/** True when `rm` is given both recursive and force, in any flag spelling (`-rf`, `-r -f`, `--recursive --force`). */
const isRecursiveForce = (flags) =>
  flags.some((f) => /^-[a-zA-Z]*[rR]/.test(f) || longFlag(f, "--recursive")) &&
  flags.some((f) => /^-[a-zA-Z]*f/.test(f) || longFlag(f, "--force"));
/**
 * The session's scratchpad directory (STA-351): the hook input's `scratchpad_dir` when the harness sends one, else
 * `/tmp/claude-<uid>/<project>/<session id>/scratchpad`, for one of `sessionIds` (`session_id`, then
 * `CLAUDE_CODE_SESSION_ID`) and one of `projectDirs` (`CLAUDE_PROJECT_DIR`, then `cwd`; the harness names the
 * project folder after its path, every character outside `[A-Za-z0-9]` a `-`). Either one counts only when its real
 * path is exactly such a path under the real root, so a symlink, another project's folder or another session's
 * never stands in for it; "" when none does. Only this directory is a scratch place for `rm -rf`.
 */
export function sessionScratchpad({ scratchpadDir = "", sessionIds = [], projectDirs = [] } = {}) {
  const root = `/tmp/claude-${process.getuid?.() ?? 0}`;
  let real;
  try {
    real = realpathSync(root);
  } catch {
    return "";
  }
  const ids = sessionIds.filter((x) => /^[\w-]+$/.test(x ?? ""));
  const tails = projectDirs
    .filter(Boolean)
    .flatMap((p) => ids.map((id) => [p.replaceAll(/[^A-Za-z0-9]/g, "-"), id, "scratchpad"]));
  const expected = new Set(tails.map((t) => join(real, ...t)));
  for (const dir of scratchpadDir ? [scratchpadDir] : tails.map((t) => join(root, ...t))) {
    try {
      if (expected.has(realpathSync(dir))) return dir;
    } catch {
      // not there: try the next
    }
  }
  return "";
}
const FIND_EXEC = new Set(["-exec", "-execdir", "-ok", "-okdir"]);
const FIND_NAMES = /^-i?(?:name|path|wholename|regex)$/;
/** `.git` and paths inside it that git always or usually holds: a find that may select one reaches the history. */
const GIT_PATHS = [".git", ".git/HEAD", ".git/index", ".git/config", ".git/packed-refs"];
GIT_PATHS.push(".git/refs/heads/main", ".git/objects/pack/x.pack", ".git/objects/pack/x.idx");
/**
 * True when a find expression from `start` may select `.git` or a path inside it (`GIT_PATHS`, STA-330 review): an
 * `-o`, a negation or a `,` (deny-leaning), or every name test (`-name`, `-path`, `-regex` and their `-i` forms)
 * matches one of them; with no name test it selects everything.
 */
function findsGit(start, expr) {
  if (expr.some((w) => ["!", "-not", "-o", "-or", ","].includes(w))) return true;
  const root = start.replace(/\/+$/, "");
  return GIT_PATHS.some((p) =>
    expr.every((w, i) => {
      if (!FIND_NAMES.test(w)) return true;
      const v = expr[i + 1] ?? "";
      const flags = w.startsWith("-i") ? "i" : "";
      if (w.endsWith("name") && !w.endsWith("wholename"))
        return new RegExp(globRx(v).source, flags).test(basename(p));
      if (!w.endsWith("regex")) return new RegExp(globRx(v).source, flags).test(`${root}/${p}`);
      try {
        return new RegExp(`^(?:${v})$`, flags).test(`${root}/${p}`);
      } catch {
        return true;
      }
    }),
  );
}
const baseName = (w) => w.split("/").pop();
/** At most this many `rm` and `find` words of one simple command are read; past it the command denies. */
const MAX_DELETERS = 32;
/**
 * What a simple command deletes. Deny-leaning, like a text rule: every word named `rm` with recursive and force, or
 * `find`, is read as a command, so no wrapper hides one, known or not (`sudo`, `setsid`, `flock f`,
 * `direnv exec .`, `op run --`; STA-330 review). The operands of `rm` (or `git rm`) with recursive and force (after
 * `--`, every word), and the start paths of `find … -delete` or `find … -exec rm` (as `{ under }`: find deletes
 * what is below them); null for operands the guard cannot read (`xargs` and `parallel` take them from their input;
 * `git -C x rm` pathspecs are not from here). STA-400: an `rm` at command position (or fed by `xargs`) without
 * force counts too: recursive (`-r`, `-R`, `--recursive`) like `-rf`, a plain one as `{ plain }` (null: unread).
 */
function deletedPaths(words) {
  const out = [];
  const at = [];
  words.forEach((w, k) => ["rm", "find"].includes(baseName(w)) && at.push(k));
  if (at.length > MAX_DELETERS) return [null];
  for (const k of at) {
    const head = words.slice(0, k);
    if (baseName(words[k]) === "rm") {
      const rest = words.slice(k + 1);
      const dash = rest.indexOf("--");
      const before = dash < 0 ? rest : rest.slice(0, dash);
      const flags = before.filter((x) => x.startsWith("-"));
      const fed = head.some((x) => ["xargs", "parallel"].includes(baseName(x)));
      const force = isRecursiveForce(flags);
      if (!force && !fed && !nameIndexes(words).includes(k)) continue;
      const recursive =
        force || flags.some((f) => /^-[a-zA-Z]*[rR]/.test(f) || longFlag(f, "--recursive"));
      const operands = [
        ...before.filter((x) => !x.startsWith("-")),
        ...(dash < 0 ? [] : rest.slice(dash + 1)),
      ];
      if (!recursive) {
        out.push(...(fed ? [{ plain: null }] : []), ...operands.map((x) => ({ plain: x })));
        continue;
      }
      const moved = head.some((x) => /^-C$|^--(?:git-dir|work-tree)/.test(x));
      if (fed || (moved && head.some((x) => baseName(x) === "git"))) out.push(null);
      out.push(...operands);
    } else {
      let j = k + 1;
      while (/^-(?:[HLP]|O\d*|D)$/.test(words[j] ?? "")) j += words[j] === "-D" ? 2 : 1;
      const from = j;
      while (j < words.length && !/^[-(!)]/.test(words[j])) j++;
      const rest = words.slice(j);
      const rm = (x, i) => FIND_EXEC.has(x) && baseName(rest[i + 1] ?? "") === "rm";
      if (rest.includes("-delete") || rest.some(rm))
        out.push(
          ...(j > from ? words.slice(from, j) : ["."]).map((under) => ({
            under,
            git: findsGit(under, rest),
          })),
        );
    }
  }
  return out;
}

/**
 * Where each delete (`deletedPaths`) lands (`rmPlace`), memoised per command. `walk` follows `cd`; a relative
 * operand where the directory is unknown denies. A plain `rm` (no recursion) never denies: where a recursive one
 * would, it is "own" (the owner confirms it).
 */
const rmPlaces = (c, ctx) => ctx.memo(`rm\0${c}`, () => rmScan(c, ctx));
function rmScan(c, ctx) {
  const out = [];
  for (const [text, start] of scanBases(c, ctx.cwd))
    for (const { words, dirs } of walk(text, start))
      for (const t of deletedPaths(words))
        for (const dir of dirs)
          out.push(
            t === null
              ? "deny"
              : t.plain !== undefined
                ? t.plain === null || rmPlace(t.plain, dir, ctx) === "deny"
                  ? "own"
                  : rmPlace(t.plain, dir, ctx)
                : t.under
                  ? rmPlace(t.under, dir, ctx, t)
                  : rmPlace(t, dir, ctx),
          );
  return out;
}
/** Build output and caches, regenerated by a build or `pnpm install`: removable in any worktree. */
const REGENERABLE = /^(?:node_modules|dist|\.turbo|\.stackra|coverage|\.cache)$/;
/** `w` with its brace expansions (`{a,b}`, nested too), or null past 64 words or 16 braces (a recursion each). */
function braces(w) {
  if (w.split("{").length > 17) return null;
  const m = /\{([^{}]*,[^{}]*)\}/.exec(w);
  if (!m) return [w];
  const out = [];
  for (const alt of m[1].split(",")) {
    const more = braces(w.slice(0, m.index) + alt + w.slice(m.index + m[0].length));
    if (more === null || out.push(...more) > 64) return null;
  }
  return out;
}
/**
 * A glob segment as a regex: `*`, `?` and `[…]`. A wildcard matches a leading dot too (deny-leaning for `rm`),
 * which the shell's own globbing does not.
 */
function globRx(seg) {
  const body = seg
    .replaceAll("[^", "[!")
    .replaceAll(/[.+^${}()|\\]/g, "\\$&")
    .replaceAll(/\*+/g, ".*")
    .replaceAll("?", ".")
    .replaceAll("[!", "[^");
  try {
    return new RegExp(`^${body}$`);
  } catch {
    return new RegExp(`^${seg.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`); // an unclosed `[` is literal
  }
}
/**
 * The paths a word's glob expands to from `dir`, one segment at a time with `readdirSync` (symlinks followed, as
 * the shell does); null past 1000. shortcut: zsh `**` is read as `*`, one level; deeper zsh matches never follow a
 * symlink and stay under a checked one.
 */
function expandGlob(dir, t) {
  if (!/[*?[]/.test(t)) return [t];
  let found = [""];
  const segs = t.split("/");
  for (let k = 0; k < segs.length; k++) {
    const slash = k === 0 ? "" : "/";
    if (!/[*?[]/.test(segs[k])) {
      found = found.map((p) => p + slash + segs[k]);
      continue;
    }
    const rx = globRx(segs[k]);
    // A wildcard with a literal tail (`*/node_modules`) never matches `.git`, as in the shell (STA-330 review).
    const tail = k < segs.length - 1 && !segs.slice(k + 1).some((s) => /[*?[]/.test(s));
    const skip = (n) => tail && n === ".git" && !segs[k].startsWith(".");
    const next = [];
    for (const p of found) {
      let names = [];
      try {
        names = readdirSync(physical(dir, p ? `${p}/` : t.startsWith("/") ? "/" : "./"));
      } catch {
        // an unreadable directory matches nothing, as in the shell
      }
      next.push(...names.filter((n) => rx.test(n) && !skip(n)).map((n) => p + slash + n));
    }
    if (next.length > 1000) return null;
    found = next;
  }
  return found;
}
/**
 * Where path `t` lands from `dir` as the kernel walks it: every symlink before the last segment followed (`l/..`
 * is the parent of l's target, not `.`), and the last one too when `t` ends in `/`, `/.` or `/..`; rm removes a
 * final symlink itself.
 */
function physical(dir, t) {
  let cur = t.startsWith("/") ? "/" : dir;
  for (const seg of t.split("/")) {
    if (seg === "" || seg === ".") continue;
    cur = seg === ".." ? dirname(realDir(cur)) : join(realDir(cur), seg);
  }
  return /(?:^|\/)(?:\.\.?)?$/.test(t) ? realDir(cur) : join(realDir(dirname(cur)), basename(cur));
}
/** A path longer than this fails in the kernel (Linux PATH_MAX; macOS has 1024); walking one costs quadratic time. */
const PATH_MAX = 4096;
/**
 * Where `rm -rf <t>`, run in `dir` (null when unknown), lands: "ok" in the scratchpad or build output
 * (`REGENERABLE`, any segment) strictly inside this session's own checkout; "own" elsewhere strictly inside that
 * checkout (STA-400: a delete the owner confirms); "nested" strictly inside a linked worktree nested in that checkout (another agent's, or this
 * session's reached by `cd` from the main checkout), unless it is build output; "deny" anywhere else, a nested
 * worktree itself, or a path that contains one. Braces and globs are expanded first; `~`, `$`, a bare `*` and a path
 * past `PATH_MAX` deny. `under` (a find: `{ git }`): only what is below `t` goes (`find t -delete`), so `t` may be
 * the checkout or scratchpad root itself, unless the find may select the checkout's `.git` (`findsGit`).
 */
function rmPlace(t, dir, ctx, under = null) {
  if (/^[~$]/.test(t) || /[$`]/.test(t) || /^(\.\/)?\.?\*$/.test(t) || t.length > PATH_MAX)
    return "deny";
  if (!t.startsWith("/") && dir === null) return "deny";
  const paths = [];
  for (const w of braces(t) ?? [null]) {
    const found = w === null ? null : expandGlob(dir ?? "/", w);
    if (found === null) return "deny";
    paths.push(...(found.length ? found : [w])); // an unmatched glob stays literal, as in bash
  }
  const places = new Set(paths.map((p) => landing(physical(dir ?? "/", p), ctx, under)));
  for (const p of ["deny", "nested", "own"]) if (places.has(p)) return p;
  return "ok";
}
/** The place (`rmPlace`) of one physical path. */
function landing(real, ctx, under) {
  const own = ctx.own();
  const inside = (r) => r && (real.startsWith(r + sep) || (under && real === r));
  const scratch = ctx.scratch();
  // The scratchpad directory itself may go too (`rm -rf <scratchpad>`), as before STA-351.
  const inScratch = scratch && (real === scratch || real.startsWith(scratch + sep));
  if (!inScratch && !inside(own.root)) return "deny";
  // A find from the checkout root reaches its `.git` (a linked worktree's `.git` file links it).
  if (under?.git && real === own.root) return "deny";
  // `.git` holds the history and every linked worktree's admin directory (a worktree's `.git` file links it).
  if (real.split(sep).includes(".git")) return "deny";
  if (own.nested.some((w) => w === real || w.startsWith(real + sep))) return "deny";
  if (inScratch) return "ok";
  if (!own.nested.some((w) => real.startsWith(w + sep)))
    return real
      .slice(own.root.length + 1)
      .split(sep)
      .some((x) => REGENERABLE.test(x))
      ? "ok"
      : "own";
  return REGENERABLE.test(basename(real)) ? "ok" : "nested";
}

/**
 * `git push` whose destination is main: an explicit refspec (`main`, `HEAD:main`, `+main`, `refs/heads/main`,
 * `:main`), `--all` / `--mirror`, or no refspec (or `HEAD`) while main is checked out in the push's checkout (the
 * hook's cwd, moved by `cd`, `-C`, `--git-dir`, `--work-tree`, `GIT_DIR=`; STA-214). An unknown target counts as
 * main. A branch that merely contains "main" is fine. Search and history segments (`grep`, `rg`, `git log`,
 * `git grep`) are skipped: their words are patterns.
 */
function pushesMain(c, ctx) {
  return scanBases(c, ctx.cwd).some(([t, base]) =>
    gitCommands(t, base).some((g) => {
      if (g.sub !== "push") return false;
      if (g.args.some((a) => /^--(?:all|branches|mirror)$/.test(a))) return true;
      const refs = pushRefs(g.args);
      if (refs.some((r) => refspecDest(r) === "main")) return true;
      const implicit = refs.length <= 1 || refs.slice(1).every((r) => r === "HEAD");
      if (!implicit) return false;
      const branch = g.run("symbolic-ref", "--short", "HEAD");
      return branch === "" || branch === "main";
    }),
  );
}
/** Push options whose value is the next word. */
const PUSH_VALUE = new Set(["-o", "--push-option", "--repo", "--receive-pack", "--exec"]);
/** The remote and refspecs of a push: its words that are neither options nor option values. */
function pushRefs(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (PUSH_VALUE.has(args[i])) i++;
    else if (!args[i].startsWith("-")) out.push(args[i]);
  }
  return out;
}
/** A tag refspec: `refs/tags/…`, or a release tag `<package>@<version>`. */
const isTagRef = (r) => /^\+?(?:refs\/tags\/|[^:]*@\d)/.test(r);

/**
 * Why a push rewrites, deletes or writes another branch, or null: `--force` without a lease (`--force-if-includes`
 * is fine), `-f` (bundled too), `--delete` / `-d`, `--mirror`, `--prune`, a `+refspec` or a `:branch`
 * delete; and for `pnpm bot:git` a refspec other than `HEAD` or the current branch (feature branches, other
 * agents' PR branches included, have no ruleset). Tag refspecs are left to the ask rule.
 */
function pushRefusal(c, ctx) {
  const forced = scanBases(c, ctx.cwd).some(([t, base]) =>
    gitCommands(t, base).some(
      (g) =>
        g.sub === "push" &&
        g.args.some(
          (f) =>
            /^--force(?!-with-lease|-if-includes)/.test(f) ||
            /^-[a-zA-Z]*[fd][a-zA-Z]*$/.test(f) ||
            /^--(?:delete|mirror|prune)$/.test(f),
        ),
    ),
  );
  if (forced)
    return "Push guard: `--force` without a lease, `-f`, `--delete` / `-d`, `--mirror` and `--prune` rewrite or delete remote branches. Use `pnpm bot:git -- push --force-with-lease origin HEAD`, and only on your own branch.";
  for (const [t, base] of scanBases(c, ctx.cwd))
    for (const g of gitCommands(t, base)) {
      if (g.sub !== "push") continue;
      const refs = pushRefs(g.args).slice(1);
      if (refs.some((r) => /^[+:]/.test(r)))
        return "Push guard: a `+refspec` force-pushes and a `:branch` refspec deletes a remote branch. Push `HEAD` with `--force-with-lease` instead.";
      if (!g.bot) continue;
      const branch = g.run("symbolic-ref", "--short", "HEAD");
      const own = new Set(branch ? [branch, `refs/heads/${branch}`] : []);
      for (const r of refs.filter((x) => !isTagRef(x))) {
        const [src, dst, ...more] = r.split(":");
        const ok =
          (src === "HEAD" || src === "@" || own.has(src)) &&
          (dst === undefined || own.has(dst.replace(/^heads\//, ""))) &&
          !more.length;
        if (!ok)
          return `Push guard: \`pnpm bot:git\` pushes only \`HEAD\` or the current branch (${branch || "detached"}), never another branch. Use \`pnpm bot:git -- push origin HEAD\`.`;
      }
    }
  return null;
}

/**
 * A git command that discards uncommitted work: `reset --hard|--merge|--keep`, `checkout` / `restore` of the whole
 * tree (`.`, `./`, `:/`; `restore --staged` alone only unstages), `checkout -f`, `switch -f|--discard-changes`, and
 * `clean` unless `-n` / `--dry-run`.
 */
function discards({ sub, args }) {
  const has = (re) => args.some((a) => re.test(a));
  const tree = has(/^(?:\.\/?|:\/)$/);
  if (sub === "reset") return has(/^--(?:hard|merge|keep)$/);
  if (sub === "checkout") return tree || has(/^(?:-[a-zA-Z]*f[a-zA-Z]*|--force)$/);
  if (sub === "restore")
    return (
      tree &&
      (!has(/^(?:--staged|-[a-zA-Z]*S[a-zA-Z]*)$/) || has(/^(?:--worktree|-[a-zA-Z]*W[a-zA-Z]*)$/))
    );
  if (sub === "switch") return has(/^(?:-[a-zA-Z]*f[a-zA-Z]*|--force|--discard-changes)$/);
  if (sub === "clean") return !has(/^(?:-[a-zA-Z]*n[a-zA-Z]*|--dry-run)$/);
  return false;
}
/**
 * Where a checkout (`top`, its toplevel) sits for this session: "own" (the session's own linked worktree),
 * "nested" (a linked worktree nested in the session's checkout, reached by `cd` or `-C` from the main checkout:
 * an orchestrated subagent's shell starts there) or "other". A command that names a git directory (`--git-dir`,
 * `GIT_DIR=`, `--bare`) is "other": git then uses the cwd as the worktree of another repository's index.
 */
function placeOf(top, ctx, g) {
  if (!top || g.gitDir) return "other";
  const own = ctx.own();
  const real = realDir(top);
  if (!own.main && real === own.root) return "own";
  return own.nested.includes(real) ? "nested" : "other";
}
/**
 * The place (`placeOf`) of every git command that discards work: a discarding command (`discards`) and
 * `git worktree remove --force|-f` (its path's checkout). Memoised per command: two rules read it.
 */
const discardPlaces = (c, ctx) =>
  ctx.memo(`discard\0${c}`, () =>
    scanBases(c, ctx.cwd).flatMap(([t, base]) =>
      gitCommands(t, base).flatMap((g) => {
        if (discards(g)) return [placeOf(g.run("rev-parse", "--show-toplevel"), ctx, g)];
        if (g.sub !== "worktree" || g.args[0] !== "remove") return [];
        if (!g.args.some((a) => /^(?:--force|-[a-zA-Z]*f[a-zA-Z]*)$/.test(a))) return [];
        const path = g.args.slice(1).find((a) => !a.startsWith("-"));
        return [
          path ? placeOf(g.run("-C", path, "rev-parse", "--show-toplevel"), ctx, g) : "other",
        ];
      }),
    ),
  );
/**
 * `git branch -D` (or `-d --force`) of a branch whose commits exist only here: no remote-tracking ref holds its
 * tip and its upstream is not gone (a squash-merged PR branch deleted on GitHub is gone after a fetch).
 */
const deletesUnpushedBranch = (c, ctx) =>
  scanBases(c, ctx.cwd).some(([t, base]) =>
    gitCommands(t, base).some((g) => {
      if (g.sub !== "branch") return false;
      const flag = (re) => g.args.some((a) => re.test(a));
      const force =
        flag(/^-[a-zA-Z]*D/) ||
        (flag(/^(?:-[a-zA-Z]*d[a-zA-Z]*|--delete)$/) && flag(/^(?:-[a-zA-Z]*f[a-zA-Z]*|--force)$/));
      if (!force || flag(/^(?:-[a-zA-Z]*r[a-zA-Z]*|--remotes)$/)) return false;
      return g.args
        .filter((a) => !a.startsWith("-"))
        .some((name) => {
          const tip = g.run("rev-parse", "--verify", "--quiet", `refs/heads/${name}`);
          if (!tip) return !g.run("rev-parse", "--git-dir"); // an unknown checkout asks; git refuses a missing branch
          if (g.run("branch", "-r", "--contains", tip)) return false;
          return (
            g.run("for-each-ref", "--format=%(upstream:track)", `refs/heads/${name}`) !== "[gone]"
          );
        });
    }),
  );
/** Why a `git stash` touches the stack every worktree shares, or null. */
function stashRefusal(c, ctx) {
  for (const t of scanTexts(c))
    for (const g of gitCommands(t, ctx.cwd)) {
      if (g.sub !== "stash") continue;
      const [verb, ...rest] = g.args;
      if (["pop", "clear", "branch"].includes(verb))
        return `Stash guard: \`git stash ${verb}\` acts on \`refs/stash\`, which every worktree shares, so it can take another agent's work. Use a WIP commit (\`git commit -m "wip"\`, later \`git reset --soft HEAD~1\`).`;
      if (["apply", "drop"].includes(verb) && !rest.some((a) => !a.startsWith("-")))
        return `Stash guard: \`git stash ${verb}\` without a ref picks the top of a stack every worktree shares. Name the entry (\`git stash ${verb} stash@{1}\` or its sha from \`git stash list\`), or use a WIP commit.`;
    }
  return null;
}

/**
 * The bot's gh wrapper: `pnpm bot:gh`, or the private CLI's `figentra bot gh` (ADR 0500), bare or after a runner
 * (`pnpm exec`, `npx`, `npx @figentra/cli`, `mise exec --`). Every `bot:gh` rule below reads both.
 */
const BOT_GH = String.raw`(?:\bbot:gh|(?:\bfigentra(?:\.mjs)?|@figentra\/cli(?:@\S*)?)\s+(?:--\s+)?bot\s+gh)\b`;
const BOT_GH_WORD = new RegExp(BOT_GH);
/**
 * `pnpm bot:gh` merging or moving a branch outside `pr:merge`: `pr merge`, `api …/pulls/<n>/merge` (any method),
 * `api repos/<o>/<r>/merges`, and the GraphQL merge, enqueue, commit-on-branch and ref mutations.
 */
const MERGE =
  /\bpr\s+(?:(?:-R|--repo)(?:=|\s+)\S+\s+)?merge\b|\bpulls(?:\/|%2F)+\d+(?:\/|%2F)+merge\b|\brepos(?:\/|%2F)+[^/\s%]+(?:\/|%2F)+[^/\s%]+(?:\/|%2F)+merges\b|\b(?:mergePullRequest|enablePullRequestAutoMerge|enqueuePullRequest|mergeBranch|createCommitOnBranch|updateRefs?|deleteRef)\b/i;
/** A word percent-decoded (up to three layers), then slashes collapsed and `.` / `..` segments resolved (STA-216). */
function normalizeWord(w) {
  let d = w;
  for (let i = 0; i < 3; i++) {
    try {
      const n = decodeURIComponent(d);
      if (n === d) break;
      d = n;
    } catch {
      break;
    }
  }
  const out = [];
  for (const seg of d.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}
const botMerges = (c) =>
  [dropMessages(c), ...runnable(c)].some((t) =>
    segments(t).some(
      (s) =>
        BOT_GH_WORD.test(blank(s)) &&
        (MERGE.test(s) || MERGE.test(s.replaceAll(/\S+/g, normalizeWord))),
    ),
  );

/** gh flags whose value is prose (a title, a body, a description), and the label flags (`-l`, `--add-label`). */
const GH_PROSE = /^(?:-t|--title|-b|--body|-d|--description)$/;
const GH_PROSE_JOINED = /^--(?:title|body|description)=/;
const GH_LABEL = /^(?:-l|--label|--add-label)$/;
const GH_LABEL_JOINED = /^(?:--label=|--add-label=|-l.)/;
/** An `api` path, field or GraphQL document that writes labels. */
const API_LABELS =
  /(?:^|\/|%2F)labels\b|\blabels(?:\[\])?=|\blabelIds\b|Labels?\w*Labelable\b|\b(?:create|update)Label\b/i;
const OWNER_LABEL = /owner-approv/i;
/** The method of a `gh api` call: `-X x`, `-Xx`, `--method x`, `--method=x`; GET when a field-less call names none. */
function apiWrites(args) {
  let method = "";
  args.forEach((w, k) => {
    const m = /^(?:-X|--method=?)(.*)$/.exec(w);
    if (m) method = (m[1] || args[k + 1] || "").toUpperCase();
  });
  const fields = args.some((w) => /^-[a-zA-Z]*[fF]|^--(?:field|raw-field|input)\b/.test(w));
  return method ? method !== "GET" : fields;
}
/**
 * ADR 0230 rule 4 tripwire (STA-330 review): a gh command that writes labels (`pr|issue create|edit`, `label
 * create|edit|clone`, an `api` label write) and names `owner-approved` anywhere but in a title, body or
 * description (`-l`, `--label`, `--add-label`, `=` joined, comma lists, quoted, `labels[]=`, a GraphQL document),
 * or whose label value is computed (`$(…)`, backticks, a variable). pr-merge checks who added the label.
 */
function writesOwnerLabel(c) {
  for (const t of [dropMessages(c), ...nestedRaw(c).map(dropMessages)])
    for (const { words, dyn } of simpleCommands(t)) {
      const g = words.findIndex((w) => baseName(w) === "gh" || /^bot:(?:gh|review)$/.test(w));
      if (g < 0) continue;
      let j = g + 1;
      while (j < words.length && /^(?:--|-R|--repo(?:=.*)?)$/.test(words[j]))
        j += /^(?:-R|--repo)$/.test(words[j]) ? 2 : 1;
      const [sub, verb] = words.slice(j, j + 2);
      const args = words.slice(j + 2);
      const adyn = dyn.slice(j + 2);
      const edits =
        (["pr", "issue"].includes(sub) && ["create", "edit"].includes(verb)) ||
        (sub === "label" && ["create", "edit", "clone"].includes(verb));
      if (sub === "api") {
        const all = words.slice(j + 1);
        if (apiWrites(all) && all.some((w) => API_LABELS.test(w)))
          if (all.some((w, k) => OWNER_LABEL.test(w) || dyn[j + 1 + k])) return true;
        continue;
      }
      if (!edits) continue;
      for (let k = 0; k < args.length; k++) {
        const w = args[k];
        if (GH_PROSE.test(w)) k++;
        else if (GH_PROSE_JOINED.test(w)) continue;
        else if (OWNER_LABEL.test(w)) return true;
        else if (GH_LABEL.test(w) && adyn[k + 1]) return true;
        else if ((GH_LABEL_JOINED.test(w) || sub === "label") && adyn[k]) return true;
      }
    }
  return false;
}
/** A `-b` / `--body` value that ends in the owner's approval token. */
const APPROVE_BODY =
  /(?:^|\s)(?:-b|--body)(?:=|\s+)(?:"[^"]*owner-approval\s*"|'[^']*owner-approval\s*'|\S*owner-approval)(?=\s|$)/i;
/**
 * ADR 0230 rule 4 tripwire: a gh command that writes the owner's label (`writesOwnerLabel`), or an approving
 * `pr review` whose body ends in `owner-approval`. Titles and bodies that only mention the words are prose.
 */
const writesOwnerApproval = (c) =>
  writesOwnerLabel(c) ||
  [c, ...nestedRaw(c)].some((t) =>
    segments(t).some(
      (s) =>
        /\bgh\b/.test(s) &&
        /\bpr\s+review\b/.test(s) &&
        /(?:^|\s)(?:--approve|-a)(?:\s|$)/.test(s) &&
        APPROVE_BODY.test(s),
    ),
  );

/** A GraphQL label mutation: it takes label ids, so the label it writes cannot be read from the command. */
const LABEL_MUTATION =
  /\b(?:add|remove|replace|clear)Labels\w*Labelable\b|\b(?:create|update|delete)Label\b/;
const botLabelMutation = (c) =>
  [dropMessages(c), ...runnable(c)].some((t) =>
    segments(t).some((s) => BOT_GH_WORD.test(blank(s)) && LABEL_MUTATION.test(s)),
  );
/**
 * A `pnpm bot:gh` release or delete: `release create|edit|delete|upload`, `<noun> delete` (`repo`, `variable`,
 * `secret`, `issue`, `label`, `run`, `cache`), and `api` with a `DELETE` method in any spelling (`-X DELETE`,
 * `-X=DELETE`, `-vX DELETE`, `--method=DELETE`). Workflow dispatches are the deploy rules' (`deployTarget`).
 */
const BOT_GH_RELEASE_DELETE = new RegExp(
  String.raw`${BOT_GH}\s+(?:--\s+)?(?:(?:-R|--repo)(?:=|\s+)\S+\s+)?(?:release\s+(?:create|edit|delete|upload)\b|[\w-]+\s+delete\b|api\b[^|;&\n]*(?:\s-[a-zA-Z]*X(?:=|\s*)DELETE\b|\s--method(?:=|\s+)DELETE\b))`,
  "i",
);
/** A GraphQL `delete…` mutation through `pnpm bot:gh` (the query is a quoted value, so the raw text is read). */
const botGraphqlDelete = (c) =>
  [dropMessages(c), ...runnable(c)].some((t) =>
    segments(t).some(
      (s) => BOT_GH_WORD.test(blank(s)) && /\bmutation\b[^]*\bdelete[A-Z]\w*/.test(s),
    ),
  );
/**
 * A `pnpm bot:git` command that runs a program in the bot's environment, which holds every /agents value:
 * `--upload-pack`, `--receive-pack`, `--exec`, `clone -u`, `rebase -x`, `bisect run`, `submodule foreach`,
 * `difftool`, `mergetool`, `filter-branch`, `grep -O` (`gitRunsProgram`).
 */
const botGitRunsProgram = (c) =>
  scanTexts(c).some((t) =>
    gitCommands(t, null).some((g) => g.bot && gitRunsProgram([g.sub, ...g.args])),
  );
/**
 * A simple command whose name is computed (`$x pr merge`, `$(echo gh) …`, `env -S`): no text rule can read it.
 * Script strings (`eval "$(mise activate zsh)"`) are `runsOpaque`'s, which trusts the toolchain's setup.
 */
const substitutionTexts = (c) => scanShell(c).bodies.flatMap((b) => [b, ...substitutionTexts(b)]);
const computedName = (c) =>
  [c, ...substitutionTexts(c)].some((t) =>
    simpleCommands(t).some((s) => {
      const i = commandAt(s.words);
      // `$HOME/.local/bin/mise` is a path the text rules still read (`(?:\S*/)?gh`).
      const name = (s.words[i] ?? "").replace(/^(?:\$HOME|\$\{HOME\})(?=\/)/, "");
      return i < 0 || (i < s.words.length && s.dyn[i] && /[$`]/.test(name));
    }),
  );

/** Package-manager options whose value is the next word (`pnpm -C dir`, `pnpm --filter x`). */
const PM_VALUE = /^(?:-C|-F|--filter|--dir|--prefix|-w|--workspace|--cwd)$/;
/**
 * Running the reviewer wrapper: `bot:review` as the script a package manager runs (`pnpm [options] [run]
 * bot:review`) wherever the package manager stands, so no wrapper hides it, known or not (`setsid`, `mise exec --`,
 * `$(…)`; STA-330 review), or `bot-gh.mjs review` directly. One pass over the words.
 */
const runsBotReview = (t) =>
  /\bbot-gh\.mjs\s+review\b|(?:\bfigentra(?:\.mjs)?|@figentra\/cli(?:@\S*)?)\s+(?:--\s+)?bot\s+review\b/.test(
    t,
  ) ||
  simpleCommands(t).some(({ words }) => {
    let script = false; // the word may be the script a package manager before it runs
    for (let k = 0; k < words.length; k++) {
      const w = words[k];
      if (["pnpm", "npm", "yarn"].includes(baseName(w))) script = true;
      else if (script && w === "bot:review") return true;
      else if (script && PM_VALUE.test(w)) k++;
      else script &&= w.startsWith("-") || ["run", "run-script"].includes(w);
    }
    return false;
  });

/** A command that prints the whole environment: `printenv`, `env`, `export -p`, `declare -x`, bare `set`. */
const PRINTS_ENV = atName(
  String.raw`(?:printenv|env(?:\s+-[0v]+|\s+-u\s+\S+)*|set|(?:export|declare|typeset)(?:\s+-[a-zA-Z]*[xp][a-zA-Z]*)?)\s*(?:$|[|;&)\n<>]|\d+>|&>)`,
);
/** `ps` options whose value is the next word. */
const PS_VALUE = /^-[a-zA-Z]*[oOpUuGgtMNc]$/;
/** `ps` listing process environments (`-E`, or a BSD option cluster with `e`: `ps eww`, `ps -p 1 e`), `launchctl procinfo`. */
const listsProcessEnv = (c) =>
  runnable(c).some((t) =>
    simpleCommands(t).some((s) =>
      nameIndexes(s.words).some((k) => {
        const b = s.words[k].split("/").pop();
        if (b === "launchctl") return s.words[k + 1] === "procinfo";
        if (b !== "ps") return false;
        const args = s.words.slice(k + 1); // one `ps` per command: copying the words per name was quadratic
        // A BSD cluster with `e` anywhere (`ps -p 1 eww`, STA-303), not the value of an option (`-o user`).
        return args.some(
          (a, i) =>
            /^-[a-zA-Z]*E/.test(a) ||
            (/^[a-zA-Z]*e[a-zA-Z]*$/.test(a) && !PS_VALUE.test(args[i - 1] ?? "")),
        );
      }),
    ),
  );
/** `/proc/<pid>/environ`: another process's environment, read by any command (STA-303). */
const PROC_ENVIRON = /\/proc\/[^\s;&|()<>]*\/environ\b/;
/** The private CLI (`@figentra/cli`, ADR 0500) running a command whose alias injects /agents values. */
const FIGENTRA_SECRET_COMMAND = new RegExp(
  String.raw`(?:\bfigentra(?:\.mjs)?|@figentra\/cli(?:@\S*)?)\s+(?:--\s+)?(?:bot|pr\s+merge|linear|secrets)\b`,
);
/** The scripts that run their program inside `infisical run` with every /agents value (package.json). */
const SECRET_SCRIPT = /^(?:linear|spec:linear|pr:merge|bot:\S+|secrets:\S+)$/;
/**
 * A text that injects secrets into a child: `infisical run`, `mcp.sh`, or a package manager running a script of
 * `SECRET_SCRIPT` (`pnpm [options] [run] linear`), the walk `runsBotReview` makes, or the private CLI's form of
 * those scripts (`figentra bot|pr merge|linear|secrets …`), bare or through a runner.
 */
const injectsSecrets = (t) =>
  infisicalCommands(t).some((x) => x.sub === "run") ||
  /(?:^|[\s/;&|(])mcp\.sh\b/.test(t) ||
  FIGENTRA_SECRET_COMMAND.test(t) ||
  simpleCommands(t).some(({ words }) => {
    let script = false;
    for (let k = 0; k < words.length; k++) {
      const w = words[k];
      if (["pnpm", "npm", "yarn"].includes(baseName(w))) script = true;
      else if (script && SECRET_SCRIPT.test(w)) return true;
      else if (script && PM_VALUE.test(w)) k++;
      else script &&= w.startsWith("-") || ["run", "run-script"].includes(w);
    }
    return false;
  });
/**
 * A process listing that shows another process's arguments or environment: any `ps` (it prints full arguments by
 * default on macOS), `pgrep -a|-l` (`--list-full`, `--list-name`), `procs`, `top`, `htop`, `btop`, `lsof`, or a
 * `/proc/` path. shortcut: every `ps` form counts, harmless columns (`-o pid`) too; narrow it if that gets in the way.
 */
const PROCESS_VIEWERS = new Set(["ps", "procs", "top", "htop", "btop", "lsof"]);
const listsProcesses = (t) =>
  /(?:^|[\s<'"=])\/proc\//.test(t) ||
  simpleCommands(t).some((s) =>
    nameIndexes(s.words).some((k) => {
      const b = baseName(s.words[k]);
      if (PROCESS_VIEWERS.has(b)) return true;
      return (
        b === "pgrep" &&
        s.words
          .slice(k + 1)
          .some((a) => /^-[a-zA-Z]*[al]/.test(a) || a === "--list-full" || a === "--list-name")
      );
    }),
  );

const DROP_DB = /\bDROP\s+(?:DATABASE|SCHEMA)\b/i;
/**
 * A SQL client runs: a word (or the first word of a quoted command line or here-string, `ssh h 'psql …'`,
 * `at now <<< 'psql …'`) named like one, wherever it stands (`docker exec pg psql`, `kubectl exec … -- mysql`), or
 * `encore db shell`. Search commands are skipped.
 */
const runsSqlClient = (c) =>
  scanTexts(c).some((t) =>
    simpleCommands(t).some(
      ({ words, redirects }) =>
        !readerCommand(words) &&
        [...words, ...redirects.filter((r) => r.op === "<<<").map((r) => r.target)].some(
          (w, k) =>
            SQL_CLIENTS.has(baseName(w.trim().split(/\s+/)[0])) ||
            /^encore\s+db\s+shell\b/.test(w.trim()) ||
            (baseName(w) === "encore" && words[k + 1] === "db" && words[k + 2] === "shell"),
        ),
    ),
  );

/**
 * The only asks that reach the owner (ADR 0293, owner decision 2026-10-23, STA-400): deletes, deploys and releases,
 * from the main thread and a subagent alike. Every other command is allowed, except the denies and the few asks the
 * guard raises because it cannot read the command (a computed name, text piped into a shell, a GraphQL label
 * mutation by id): those are a deny with `UNATTENDED_HINT` (`unattended`), so the agent rewrites instead of waiting.
 */
export const HUMAN_ASKS = new Set([
  "infisical-secrets-delete",
  "encore-db-reset",
  "encore-env-delete",
  "wrangler-deploy",
  "wrangler-d1-remote-delete",
  "eas-deploy",
  "production-deploy",
  "publish",
  "rm-delete",
  "git-clean",
  "rm-nested-worktree",
  "discard-nested-worktree",
  "branch-delete-unpushed",
  "tag-push",
  "bot-gh-release-delete",
  "bot-gh-graphql-delete",
  "secrets-import-write",
]);
/** What an agent does instead of waiting for an answer to an ask outside `HUMAN_ASKS`. */
export const UNATTENDED_HINT =
  "The guard cannot read this command and only deletes and deploys ask the owner, so it is denied (ADR 0293, STA-400). Rewrite the command so the guard can read it: write a loop or probe directly, not through `bash -c`, `sh -c` or `eval`; spell the command name out (no `$cmd …` or `$(…) …`); run commands instead of piping text into a shell. If the step needs the owner, a subagent hands it to the lead and the lead asks the owner in chat.";
/** An ask outside `HUMAN_ASKS` (or any ask, for OpenCode): a deny with `UNATTENDED_HINT`. */
export const unattended = (d) =>
  d.decision === "ask" ? { decision: "deny", reason: `${d.reason}\n${UNATTENDED_HINT}` } : d;

/** For an OpenCode executor: `rx` in any prose-free text of `c`, quotes kept (deny-leaning; prose is dropped). */
const executorRuns = (c, rx) => [...proseFree(c), ...lineTexts(c)].some((t) => rx.test(t));
/** For an OpenCode executor: `test` (an `atName`) on every runnable text of `executorRuns`, runners kept and dropped. */
const executorRunsAt = (c, test) =>
  [...proseFree(c), ...lineTexts(c)]
    .flatMap((t) => [t, lookThroughRunners(t)])
    .flatMap(runnable)
    .some(test);
/** A CLI name as a runner leaves it: any path, an `@<version>` (`npx wrangler@3 deploy`, `pnpm dlx eas-cli@latest`). */
const CLI = (name) => String.raw`${name}(?:@${W}+)?\s+(?:[^|;&\n]*\s)?`;
/**
 * `wrangler deploy`, `rollback`, `delete` (`kv key delete`, `secret delete`), `preview` and `pages deployment create`,
 * by any path or version.
 */
const WRANGLER_DEPLOY = atName(
  CLI("wrangler") +
    String.raw`(?:(?:deploy|rollback|delete|preview)\b|pages\s+deployment\s+create\b)`,
);
/** `wrangler d1 execute|migrations apply … --remote`, read with quotes kept: the SQL is a quoted value. */
const WRANGLER_D1_REMOTE = new RegExp(
  String.raw`(?:^|[\s;&|(])(?:${W}*\/)?wrangler(?:@${W}+)?\s[^|;&\n]*\bd1\s+(?:execute|migrations\s+apply)\b[^|&\n]*--remote`,
);
/**
 * `eas`/`eas-cli` `submit`, `deploy`, `update` (an over-the-air release), `<x>:delete`, `workflow:run`,
 * `channel:edit|rollout` (points a channel at a release), the update rollbacks and republish
 * (`update:republish|rollback|roll-back-to-embedded|revert-update-rollout`), or `--auto-submit*`; `update:list` and
 * `update:view` stay reads.
 */
const EAS_DEPLOY = atName(
  CLI("eas(?:-cli)?") +
    String.raw`(?:(?:submit|deploy|update)(?=[\s;&|()<>]|$)|--auto-submit\S*|[\w-]+:delete\b|workflow:run\b|channel:(?:edit|rollout)\b|update:(?:republish|rollback|roll-back-to-embedded|revert-update-rollout)\b)`,
);
/**
 * A publish to a registry: `npm|pnpm|yarn|changeset … publish` with any options before it (`pnpm --silent`,
 * `-C x`, `--filter=x`, `-r`), by any path or version; runners (`npx`, `mise exec --`, `pnpm exec`) are looked
 * through by `forms`, which reads `npm` and `pnpm` as runners too, so a bare `publish` left at command position is
 * one.
 */
const PUBLISH = atName(String.raw`(?:${CLI("(?:npm|pnpm|yarn|changeset)")})?publish` + END);
/** `pnpm runway deploy|promote`, the `runway` binary or its `runway.mjs` build (STA-268) without `--dry-run`; `plan` is a read. */
// STA-2099: also `node …/runway.ts`, tsx, the secrets sync, and a script that calls the runner directly.
const RUNWAY_DEPLOY =
  /\brunway(?:\.m?[jt]s)?\s+(?:--\s+)?(?:deploy|promote|secrets\s+sync)\b(?![^|;&\n]*--dry-run)|\brunRunway\b/;
/** `pnpm secrets:import`, its script run directly, or the private CLI's `figentra secrets import` (ADR 0500). */
const SECRETS_IMPORT = String.raw`\bsecrets(?::import|-import(?:\.mjs)?|\s+import)\b`;
/** An import that writes: not `--list`, not `--dry-run` (the owner's keeper rule of 2026-10-31). */
const SECRETS_IMPORT_WRITE = new RegExp(
  String.raw`${SECRETS_IMPORT}(?![^|;&\n]*\s--(?:list|dry-run)\b)`,
);
/**
 * An import an agent never runs: a production value (`--confirm`, `--env prod`) or a gate or release key (a path
 * under /ci/gate or /ci/registry). The script refuses the same targets from an inbox sidecar the guard cannot see.
 */
const SECRETS_IMPORT_FORBIDDEN = new RegExp(
  String.raw`${SECRETS_IMPORT}[^|;&\n]*\s(?:--confirm\b|--env(?:=|\s+)prod(?:uction)?\b|--path(?:=|\s+)/ci/(?:gate|registry)(?:/|(?![\w-])))`,
  "i",
);
/**
 * `stackra deploy …` (a product deploy, `--env <environment>`) or `stackra promote …` (wraps runway's promote),
 * without `--dry-run`.
 */
const STACKRA_DEPLOY = /\bstackra\s+(?:--\s+)?(?:deploy|promote)\b(?![^|;&\n]*--dry-run)/;
/**
 * `gh` or `pnpm bot:gh` dispatching a workflow: `workflow run <file>` or `api … /dispatches` (raw text: the fields are
 * quoted values).
 */
const WORKFLOW_DISPATCH = new RegExp(
  String.raw`(?:${BOT_GH}\s+(?:--\s+)?|(?:^|[\s;&|(])gh\s+)(?:(?:-R|--repo)(?:=|\s+)\S+\s+)?(?:workflow\s+run\b|api\b[^|;&\n]*\/dispatches\b)`,
);
/** The only role that may start a deploy (owner decision 2026-10-31); its session's settings set `STACKRA_ROLE`. */
export const DEPLOY_ROLE = "qa-release";
/** Environments a deploy reaches without asking the owner (owner decision 2026-10-31); any other one is production. */
export const NONPRODUCTION_ENVIRONMENTS = new Set(["dev", "development", "preview", "staging"]);
/** A field or flag that names the environment: `-f environment=x`, `--field env=x`, `--env x`, `--env=x`. */
const ENVIRONMENT_FIELD =
  /(?:(?:-f|-F|--field|--raw-field)\s+['"]?(?:environment|env)=|--env(?:=|\s+))['"]?([\w.-]+)/;
/**
 * The deploy one segment of a command starts, or null: what it runs (`runway promote`, `stackra deploy`, the workflow
 * file, or the dispatches API), its ref or sha and its environment, and whether that is production. A workflow run is
 * a deploy when its file names deploy, promote, release or apply, or when it carries an environment or `sha` field.
 * Production: a promote, the registry deploy, a `sha` field, the dispatches API (its body is not read), an environment
 * outside `NONPRODUCTION_ENVIRONMENTS`, or none at all.
 * @param {string} segment one command of a pipeline or list, quotes kept
 * @returns {{ what: string, ref: string, environment: string, production: boolean } | null}
 */
export function deployTarget(segment) {
  const environment = ENVIRONMENT_FIELD.exec(segment)?.[1] ?? "";
  const sha = /(?:-f|-F|--field|--raw-field)\s+['"]?sha=['"]?([\w.-]+)/.exec(segment)?.[1] ?? "";
  const ref = sha || /--ref(?:=|\s+)['"]?([\w./-]+)/.exec(segment)?.[1] || "";
  const nonproduction = NONPRODUCTION_ENVIRONMENTS.has(environment.toLowerCase());
  if (RUNWAY_DEPLOY.test(segment) || STACKRA_DEPLOY.test(segment)) {
    const promote = /\bpromote\b/.test(segment);
    const tool = /\bstackra\s/.test(segment) ? "stackra" : "runway";
    const what = `${tool} ${promote ? "promote" : "deploy"}`;
    return { what, ref, environment, production: promote || !nonproduction };
  }
  if (!WORKFLOW_DISPATCH.test(segment)) return null;
  if (/\/dispatches\b/.test(segment))
    return { what: "the dispatches API", ref, environment, production: true };
  const file = /workflow\s+run\s+['"]?([\w./-]+)/.exec(segment)?.[1] ?? "";
  if (!/deploy|promote|release|apply/i.test(file) && !environment && !sha) return null;
  const production = /promote|deploy-registry/i.test(file) || Boolean(sha) || !nonproduction;
  return { what: file, ref, environment, production };
}
/** Every deploy the command starts, read per segment with quotes kept (messages and heredoc prose dropped). */
const deploys = (c) =>
  [dropMessages(c), ...runnable(c)]
    .flatMap((t) => segments(t))
    .map(deployTarget)
    .filter(Boolean);
/** The owner's view of a production deploy: what runs, its ref or sha, its environment. */
const describeDeploy = (d) =>
  `${d.what}, ref ${d.ref || "(default branch)"}, environment ${d.environment || "production"}`;
/**
 * Never, whoever asks and whatever the owner approves in a prompt (owner decision 2026-10-31): deleting production
 * data (an R2 bucket or object, a D1 database, a KV namespace or key on the remote, SQL `DROP`, `DELETE` or
 * `TRUNCATE` against a remote D1), reading or rotating a production secret (`wrangler secret`, `gh secret set|delete`)
 * and changing DNS (Cloudflare `dns_records`, `flarectl dns`).
 */
const PRODUCTION_FORBIDDEN = [
  atName(
    CLI("wrangler") +
      String.raw`(?:r2\s+bucket\s+delete|d1\s+delete|kv\s+namespace\s+delete|secret\s+(?:put|delete|bulk))\b`,
  ),
  // An object or key delete is production data unless it names the local store.
  atName(
    CLI("wrangler") + String.raw`(?:r2\s+object|kv\s+(?:key|bulk))\s+delete\b(?![^|;&\n]*--local)`,
  ),
  /\bdns_records\b|\bflarectl\s+dns\b/,
  new RegExp(
    String.raw`(?:${BOT_GH}\s+(?:--\s+)?|(?:^|[\s;&|(])gh\s+)(?:(?:-R|--repo)(?:=|\s+)\S+\s+)?secret\s+(?:set|delete)\b`,
  ),
];
/** A write flag of `gh api`: a POST, PUT, PATCH or DELETE method, a field or a body file. */
const GH_API_WRITE = String.raw`(?:-X\s*|--method(?:=|\s+))(?:POST|PUT|PATCH|DELETE)\b|\s-[fF]\s|--(?:raw-)?field\b|--input\b`;
/**
 * Approving a waiting deployment (REST `pending_deployments`, GraphQL `approveDeployments`, a custom protection
 * rule's callback) or writing the environment, ruleset or branch protection that gates it (STA-2099).
 */
const GATE_CHANGE = [
  new RegExp(
    String.raw`\bpending_deployments\b[^|;&\n]*(?:${GH_API_WRITE})|(?:${GH_API_WRITE})[^|;&\n]*\bpending_deployments\b`,
    "i",
  ),
  /\b(?:approveDeployments|deployment_protection_rule)\b/,
  new RegExp(
    String.raw`\bapi\b[^|;&\n]*(?:-X\s*|--method(?:=|\s+))(?:PUT|PATCH|POST|DELETE)\b[^|;&\n]*\/(?:environments|rulesets|protection)\b|\bapi\b[^|;&\n]*\/(?:environments|rulesets|protection)\b[^|;&\n]*(?:-X\s*|--method(?:=|\s+))(?:PUT|PATCH|POST|DELETE)\b`,
    "i",
  ),
];
/**
 * The rules, in order. A rule denies unless it says `decision: "ask"`; any deny wins over any ask. `rx` is a regex
 * or a function of (text, ctx) that returns true, or a string that replaces `why`. `scan: "bare"` rules see the
 * text with quoted strings blanked. Only an ask whose `id` is in `HUMAN_ASKS` reaches a human (STA-400).
 */
const RULES = [
  // --- Secrets: never print a value, never create a .env file (ADR 0173, ADR 0257) ------------
  {
    rx: (c) => infisicalCommands(c).some((x) => x.sub === "export"),
    why: "Secrets guard: `infisical export` decrypts and prints every secret value. Agents never read a value; a secret reaches a process only through the pnpm script that needs it.",
  },
  {
    rx: (c) => infisicalSecrets(c).some((v) => v === "get" || v === "set"),
    why: "Secrets guard: `infisical secrets get` prints the value in every form (`--silent` too) and `infisical secrets set` writes one from the transcript. Nobody reads a value: the owner sets it, or drops it in the inbox for `pnpm secrets:import` (ADR 0257). `infisical secrets folders get` lists folders.",
  },
  {
    rx: (c) => infisicalSecrets(c).includes(""),
    why: "Secrets guard: `infisical secrets` with no subcommand prints every secret value. Agents never read a value; `infisical secrets folders get` lists folders, and the owner sets values (ADR 0257).",
  },
  {
    rx: (c) =>
      infisicalSecrets(c).includes("delete") ||
      infisicalCommands(c).some(
        (x) =>
          (x.sub === "dynamic-secrets" || (x.sub === "secrets" && x.rest.includes("folders"))) &&
          x.rest.includes("delete"),
      ),
    decision: "ask",
    id: "infisical-secrets-delete",
    why: "`infisical secrets delete`, `secrets folders delete` and `dynamic-secrets delete` remove what nobody can restore from git; the owner confirms it.",
  },
  {
    // The owner's keeper rule of 2026-10-31: never a production value or a gate or release key from an agent.
    rx: (c) => runsQuoted(c, SECRETS_IMPORT_FORBIDDEN),
    why: "Secrets guard: `secrets:import` with `--confirm`, `--env prod` or a path under /ci/gate or /ci/registry imports a production value or a gate or release key; agents never run it, the owner runs it in their own terminal (ADR 0257). Dev and staging under /agents or /ci ask the owner per run.",
  },
  {
    // The owner's keeper rule of 2026-10-31: a dev or staging import asks the owner every run.
    rx: (c) => runsQuoted(c, SECRETS_IMPORT_WRITE),
    decision: "ask",
    id: "secrets-import-write",
    why: "`pnpm secrets:import` moves a secret from the inbox into Infisical (dev or staging; never printed; the inbox file is deleted after a verified write); the owner approves each run. `--list` and `--dry-run` write nothing.",
  },
  {
    // STA-400: a deny, not an ask. The /agents set holds the bot and reviewer App keys (ADR 0230).
    rx: (c) => infisicalCommands(c).some((x) => x.sub === "run"),
    why: "Raw `infisical run` hands every /agents value to the program it starts, which could print one (`node -e` on `process.env`) or mint the bot or reviewer token and forge an AI-REVIEW verdict (ADR 0230, ADR 0257). Use the pnpm script that wraps it: `pnpm bot:gh`, `pnpm bot:git`, `pnpm linear`, `pnpm secrets:import`.",
  },
  {
    // STA-400 review: MCP servers launch mcp.sh from `.mcp.yaml`, never through the Bash tool.
    rx: (c) =>
      runsQuoted(
        c,
        atName(
          String.raw`(?:(?:bash|sh|zsh|dash|ksh|source|\.)\s+(?:-\S+\s+)*)?(?:[^\s;&|()<>]*\/)?mcp\.sh` +
            END,
        ),
      ),
    why: "`tools/scripts/mcp.sh` runs its arguments inside `infisical run` with every /agents value, so from the Bash tool it can print one (`mcp.sh echo $X`). MCP servers launch it from `.mcp.yaml`; agents never run it.",
  },
  {
    rx: (c) =>
      runsQuoted(
        c,
        /\binfisical\s+run\b[^|;&\n]*\s--\s+(?:\w+=\S*\s+)*(?:printenv\b|env\s*(?:$|-|\)))/,
      ),
    why: "Secrets guard: `infisical run -- env|printenv` prints the injected secret values. Run the command that needs them instead.",
  },
  {
    rx: (c) =>
      runsQuoted(c, (t) =>
        simpleCommands(t).some((s) => {
          const k = s.words.findIndex((w) => w.split("/").pop() === "infisical");
          const rest = s.words.slice(k + 1);
          const line = ` ${rest.join(" ")} `;
          return (
            k >= 0 &&
            (/ user get token | token renew /.test(line) ||
              (rest.includes("login") && rest.some((w) => /^--plain(?:=|$)/.test(w))))
          );
        }),
      ),
    why: "Secrets guard: `infisical user get token`, `infisical token renew` and `infisical login --plain` print an Infisical access token, which reads every secret. Nobody reads a token; the pnpm scripts that need one run under `infisical run` themselves.",
  },
  {
    rx: (c) =>
      runsQuoted(
        c,
        atName(
          String.raw`security\s+(?:find-(?:generic|internet)-password|dump-keychain|export)\b`,
        ),
      ),
    why: "Secrets guard: `security find-generic-password`, `find-internet-password`, `dump-keychain` and `export` read the owner's keychain, in any form (`/usr/bin/security`, `timeout`, `pnpm exec`). Agents never read a credential.",
  },
  {
    // The secrets inbox holds values a human dropped for `pnpm secrets:import` (ADR 0257). No command
    // may name it: not cat/head/grep/cp/mv/ls/find, not a `cd` into it. The importer takes file NAMES
    // (`pnpm secrets:import --list` lists them) and never prints a value, so it is safe for every caller.
    // Only path-like tokens count (grep/sed/perl/awk patterns, --title/--body/-m values and URLs are not paths);
    // globs only when rooted at home (or relative while the shell sits in home). Accident guard only.
    rx: (c, ctx) => commandReachesInbox(c, { cwd: ctx.cwd }),
    why: "Secrets guard: ~/Secrets-inbox/ (and the import confirm key) are never read, listed, copied or moved by a command. Use `pnpm secrets:import --list` for names and `pnpm secrets:import [--dry-run] [NAME]` to import; it never prints a value.",
  },
  {
    rx: (c) => runsQuoted(c, /\bencore\s+secret\s+(set|get|list\s+--values?)\b/),
    why: 'Secrets guard: `encore secret set/get` are a human\'s to run. Declare the secret with `secret("NAME")` in code and name it in your report; a human sets the value per environment (synced from Infisical).',
  },
  {
    rx: (c) => runsQuoted(c, /\bwrangler\s+secret\s+(put|bulk)\b/),
    why: "Secrets guard: `wrangler secret put/bulk` are a human's to run, same as `encore secret set`. Declare the secret and name it in your report; a human sets the value per environment.",
  },
  {
    // Any word of the text the shell runs that names a secret file (`namesSecret`): `cat x/.env`, `base64 .env`,
    // `< .env cat`, `source .env`, `cp a .env`, `cat key.pem`, `cat ~/.git-credentials`, `cat .env*`. A quoted
    // argument is checked whole (`cat "$HOME/.npmrc"`), so a grep pattern `"no .env files"` is no path; only
    // message values (`-m`, `--title`, `--body`, a `linear comment`) and heredoc bodies are prose (STA-330 review).
    // A command line in one quoted word names files by its own words (`watch 'cat .env'`), outside prose and
    // search commands. A program (`jq '.data.key'`, `node -e '…'`, `awk '…'`) names none (`withoutPrograms`), and
    // only a path-shaped word is a path (`namesSecret`). `.env.example` and `*.example` are templates.
    rx: (c) => {
      const words = proseFree(c).flatMap((t) =>
        simpleCommands(t).flatMap((s) => {
          const all = [...withoutPrograms(s.words), ...s.redirects.map((r) => r.target)];
          // A substitution is read as its own text (`x=$(grep -rn "a.key" src)`), never split here (STA-351).
          const split = all.flatMap((w) => outsideSubstitutions(w).split(/\s+/));
          return readerCommand(s.words) ? all : [...all, ...split];
        }),
      );
      const hit = [...new Set(words.flatMap((w) => [w, ...w.split("=").slice(1)]))].find(
        namesSecret,
      );
      return hit
        ? `Secrets guard: \`${hit}\` holds secret values; a command never reads, copies, writes or prints it, and never creates a .env file. Secrets come from Infisical (ADR 0173); application secrets use Encore secret().`
        : false;
    },
    why: "",
  },
  {
    // A redirection ends it too: `printenv > f` writes every value where a later `cat` reads it.
    rx: (c) => runs(c, PRINTS_ENV),
    why: "Printing the whole environment (`printenv`, `env`, `export -p`, `declare -x`, bare `set`) can leak an injected token into the transcript. Echo the single variable you need, without its value if it is a secret.",
  },
  {
    rx: listsProcessEnv,
    why: "Secrets guard: `ps -E`, `ps eww` (any BSD cluster with `e`) and `launchctl procinfo` print other processes' environments, MCP tokens included. Use `ps -o pid,command` or `pgrep -fl <name>`.",
  },
  {
    rx: (c) => runsQuoted(c, (t) => PROC_ENVIRON.test(t)),
    why: "Secrets guard: `/proc/<pid>/environ` holds a process's whole environment, injected tokens included (STA-303). Echo the single variable you need, without its value if it is a secret.",
  },
  {
    // STA-303 incident: a `ps` beside `pnpm linear` printed the injected TURBO_TOKEN into the transcript.
    rx: (c) => runnable(c).some(injectsSecrets) && runsQuoted(c, listsProcesses),
    why: "Secrets guard: a process listing (`ps`, `pgrep -a|-l`, `procs`, `top`, `lsof`, `/proc/…`) in the same command as `infisical run`, `pnpm linear`, `pnpm bot:*`, `pnpm secrets:*`, `figentra bot|pr merge|linear|secrets` or `mcp.sh` can print the arguments or environment of the child that holds the injected secrets (STA-303). Run the listing as its own command, after the wrapper has exited.",
  },

  // --- Encore and deploys: the environment-touching subcommands ---------------------------------
  {
    rx: (c) => runsQuoted(c, /\bencore\s+db\s+reset\b/),
    decision: "ask",
    id: "encore-db-reset",
    why: "`encore db reset` destroys the local database and re-migrates; the owner confirms it.",
  },
  {
    rx: (c) => runsQuoted(c, /\bencore\s+deploy\b/),
    why: "`encore deploy` ships to a shared environment; no agent runs it. Deploys belong to the release path.",
  },
  {
    rx: (c) => runsQuoted(c, /\bencore\s+env\s+delete\b/),
    decision: "ask",
    id: "encore-env-delete",
    why: "`encore env delete` removes a shared environment; the owner confirms it.",
  },
  {
    rx: (c) => runsQuoted(c, WRANGLER_DEPLOY),
    decision: "ask",
    id: "wrangler-deploy",
    why: "`wrangler deploy`, `rollback` and `delete` ship to or remove from Cloudflare with the owner's login; the owner confirms it.",
  },
  {
    rx: (c) =>
      PRODUCTION_FORBIDDEN.some((rx) => runsQuoted(c, rx)) ||
      (WRANGLER_D1_REMOTE.test(c) && /\b(?:DROP|DELETE|TRUNCATE)\b/i.test(c)),
    id: "production-forbidden",
    why: "Never, even with the owner's approval in a prompt (owner decision 2026-10-31): deleting production data (R2, D1, KV, or SQL `DROP`, `DELETE`, `TRUNCATE` on a remote D1), reading or rotating a production secret, or changing DNS. The owner does these by hand.",
  },
  {
    // A GraphQL approval is a quoted query value, so it is read in the raw segments (as botGraphqlDelete).
    rx: (c) =>
      GATE_CHANGE.some((rx) => runsQuoted(c, rx)) ||
      [dropMessages(c), ...runnable(c)].some((t) =>
        segments(t).some((s) => GATE_CHANGE[1].test(s)),
      ),
    id: "gate-change",
    why: "Agents log in as an environment reviewer (STA-2099), so approving a waiting deployment, or changing an environment, ruleset or branch protection, is the owner's by hand, even with approval in a prompt. Reading them is fine.",
  },
  {
    rx: (c) =>
      WRANGLER_D1_REMOTE.test(c) &&
      /\b(?:DROP|DELETE|TRUNCATE)\b|migrations\s+apply|--file\b/i.test(c),
    decision: "ask",
    id: "wrangler-d1-remote-delete",
    why: "`wrangler d1 execute --remote` with `DROP`, `DELETE` or `TRUNCATE`, or `d1 migrations apply --remote`, or a SQL `--file` the guard does not read, changes the production database; the owner confirms it.",
  },
  {
    rx: (c) => runsQuoted(c, EAS_DEPLOY),
    decision: "ask",
    id: "eas-deploy",
    why: "`eas submit`, `--auto-submit`, `eas deploy`, `eas update` and `eas <x>:delete` ship to the stores or users, or delete, on the owner's Expo login; the owner confirms it.",
  },
  // Deploys (owner decision 2026-10-31): only the QA/release session (`STACKRA_ROLE=qa-release` in its settings) starts
  // one. Development, preview and staging run without a prompt; production asks the owner per run; OpenCode passes no
  // role, so it is denied. `runway plan` and `--dry-run` deploy nothing.
  {
    rx: (c, ctx) => ctx.role !== DEPLOY_ROLE && deploys(c).length > 0,
    id: "deploy-role",
    why: "Only the QA/release session starts a deploy (owner decision 2026-10-31). Hand the deploy to stackra-f4, or ask the owner to run it.",
  },
  {
    rx: (c, ctx) => {
      const production = deploys(c).filter((d) => d.production);
      return ctx.role === DEPLOY_ROLE && production.length > 0
        ? `Production deploy (owner decision 2026-10-31): the owner approves each run. ${production.map(describeDeploy).join("; ")}.`
        : false;
    },
    decision: "ask",
    id: "production-deploy",
    why: "A production deploy asks the owner on every run (owner decision 2026-10-31).",
  },
  {
    rx: (c) => runsQuoted(c, PUBLISH),
    decision: "ask",
    id: "publish",
    why: "A registry publish (`npm`, `pnpm`, `yarn` or `changeset publish`, through any runner) releases a package version nobody can unpublish cleanly; the owner confirms it.",
  },
  // OpenCode executors only (`executor`): the shared rules allow these since STA-400, an unattended executor does not.
  // `executorRunsAt` reads `eas` at command position (`ls node_modules/.bin/eas` reads it, it does not run it) in every
  // prose-free text, quoted line and piped script; `executorRuns` reads the rest raw (deny-leaning).
  {
    executor: true,
    // Raw, not at a name: the runner look-through drops `npx` itself (`mise exec -- npx tsc` reads as `tsc`).
    rx: (c) =>
      executorRuns(
        c,
        /(?:^|[\s;&|(])(?:\S*\/)?(?:npx|pnpx|bunx)(?=[\s;&|)]|$)|\bpnpm\s+(?:-\S+\s+)*dlx(?=\s|$)|\bnpm\s+(?:-\S+\s+)*(?:exec|x)(?=\s|$)/,
      ),
    why: "`npx`, `pnpx`, `pnpm dlx` and `npm exec` run unreviewed registry code; executors never run them. Use a catalog dependency with `pnpm exec <bin>`.",
  },
  {
    executor: true,
    rx: (c) =>
      executorRunsAt(c, atName(String.raw`eas(?:-cli)?(?:@${W}+)?` + END)) ||
      executorRuns(
        c,
        /\bwrangler(?:@\S*)?\s[^|;&\n]*(?:\bsecret\b|--remote\b)|\bencore\s+env\s+(?:set|create)\b/,
      ),
    why: "`eas`, `wrangler secret`, `wrangler --remote` and `encore env set|create` use the owner's login on a shared account; executors never run them, the lead does.",
  },
  {
    executor: true,
    rx: (c) =>
      executorRuns(c, /\bsecrets(?::import|-import(?:\.mjs)?|\s+import)\b[^|;&\n]*\s--confirm\b/),
    why: "`secrets:import … --confirm` writes a production secret; executors never run it (ADR 0257).",
  },

  // --- History, worktrees and shared local state ------------------------------------------------
  {
    rx: (c, ctx) => rmPlaces(c, ctx).includes("deny"),
    why: "A recursive `rm` is allowed only in build output strictly inside this session's own checkout (elsewhere in it the owner confirms it) or this session's scratchpad directory (`/tmp/claude-<uid>/<project>/<session>/scratchpad`, not the `/tmp/claude-<uid>` root), and inside a nested linked worktree with the owner's yes. Never /, ~, $HOME, a `$` expansion, `*`, `.git`, a worktree itself, a path outside those roots, or a relative path after an unknown `cd`.",
  },
  {
    rx: (c, ctx) => rmPlaces(c, ctx).includes("own"),
    decision: "ask",
    id: "rm-delete",
    why: "`rm` or `find -delete` outside the session's scratchpad and build output (`node_modules`, `dist`, `.turbo`, `.stackra`, `coverage`, `.cache`) deletes files; the owner confirms it.",
  },
  {
    rx: (c, ctx) =>
      scanBases(c, ctx.cwd).some(([t, base]) =>
        gitCommands(t, base).some((g) => g.sub === "clean" && discards(g)),
      ),
    decision: "ask",
    id: "git-clean",
    why: "`git clean -f` deletes untracked files git cannot restore; the owner confirms it. `git clean -n` previews.",
  },
  {
    rx: (c, ctx) => rmPlaces(c, ctx).includes("nested"),
    decision: "ask",
    id: "rm-nested-worktree",
    why: "`rm -rf` inside a linked worktree nested in this checkout: it may be another agent's. The owner confirms it; build output (`node_modules`, `dist`, `.turbo`, `.stackra`, `coverage`, `.cache`) needs no yes. Run from inside your own worktree instead.",
  },
  {
    rx: pushesMain,
    why: "Never push to main. Push your branch and open a PR; main changes only through a merged PR.",
  },
  { rx: pushRefusal, why: "" },
  {
    rx: (c, ctx) =>
      scanBases(c, ctx.cwd).some(([t, start]) =>
        gitCommands(t, start).some(
          (g) =>
            g.bot &&
            g.sub === "push" &&
            (g.args.some((a) => /^--(?:tags|follow-tags)$/.test(a)) ||
              pushRefs(g.args).slice(1).some(isTagRef)),
        ),
      ),
    decision: "ask",
    id: "tag-push",
    why: "A bot push of tags (`--tags`, `--follow-tags`, `refs/tags/*`, `<package>@x`) publishes a release marker no ruleset protects; the owner confirms it.",
  },
  {
    rx: (c, ctx) => discardPlaces(c, ctx).includes("other"),
    why: "This discards uncommitted work (`reset --hard`, `checkout`/`restore .`, `checkout -f`, `switch --discard-changes`, `clean -f`, `worktree remove --force`). It runs only in this session's own worktree (a worktree nested in this checkout with the owner's yes), never in the main checkout or another repository. Name the paths, or make a WIP commit first; `git worktree remove <path>` refuses when dirty and `git clean -n` previews anywhere.",
  },
  {
    rx: (c, ctx) => discardPlaces(c, ctx).includes("nested"),
    decision: "ask",
    id: "discard-nested-worktree",
    why: "This discards uncommitted work in a linked worktree nested in this checkout, reached by `cd` or `-C`: it may be another agent's. The owner confirms it. Run it from inside your own worktree (the session's working directory) instead.",
  },
  {
    rx: deletesUnpushedBranch,
    decision: "ask",
    id: "branch-delete-unpushed",
    why: "`git branch -D` of a branch whose commits no remote holds (its upstream is not gone) deletes work git cannot fetch back; the owner confirms it. After a merged PR, `pnpm bot:git -- fetch --prune origin` marks the upstream gone.",
  },
  { rx: stashRefusal, why: "" },
  // STA-208: agents never act with the owner's GitHub login (ADR 0230 rule 5). Accident guard: same macOS user.
  {
    rx: botMerges,
    why: "Agents merge only through `pnpm pr:merge <n>` (ADR 0119, ADR 0230), which checks the gate and the reviewer's verdict. `pnpm bot:gh -- pr merge`, `api …/pulls/<n>/merge`, `api …/merges` and the GraphQL merge, enqueue, `createCommitOnBranch` and ref mutations are denied.",
  },
  {
    rx: botLabelMutation,
    decision: "ask",
    why: "A GraphQL label mutation takes label ids, so the guard cannot tell whether it writes `owner-approved`. Use `pnpm bot:gh -- pr edit <n> --add-label <name>`.",
  },
  {
    rx: (c) => runs(c, BOT_GH_RELEASE_DELETE),
    decision: "ask",
    id: "bot-gh-release-delete",
    why: "A `pnpm bot:gh` release or delete (`release create|edit|delete|upload`, `<noun> delete`, `api` with `DELETE`) acts with the bot's write access; the owner confirms it.",
  },
  {
    rx: botGraphqlDelete,
    decision: "ask",
    id: "bot-gh-graphql-delete",
    why: "A GraphQL `delete…` mutation through `pnpm bot:gh` removes data with the bot's write access; the owner confirms it.",
  },
  {
    rx: botGitRunsProgram,
    why: "`pnpm bot:git` runs git with every /agents value in its environment, so an option that runs a program (`--upload-pack`, `--receive-pack`, `--exec`, `clone -u`, `rebase -x`, `bisect run`, `submodule foreach`, `difftool`, `mergetool`, `filter-branch`, `grep -O`) is denied. Run local git without the bot; use `pnpm bot:git` for fetch and push only.",
  },
  {
    rx: computedName,
    decision: "ask",
    why: "The command name is computed (`$x …`, `$(…) …`, `env -S`), so the guard cannot read what runs. Write the command name out.",
  },
  {
    // STA-214: pack plumbing pushes or fetches without the push-to-main check; no agent needs it.
    // The binary by path (`/usr/lib/git-core/git-send-pack`) is the same plumbing as `git send-pack`.
    rx: (c) =>
      runs(c, new RegExp(GIT + String.raw`(?:send|receive|fetch|upload)-pack\b`)) ||
      runs(c, atName(String.raw`git-(?:send|receive|fetch|upload)-pack\b`)),
    why: "`git send-pack`, `receive-pack`, `fetch-pack` and `upload-pack` (and the `git-*-pack` binaries) are pack plumbing that bypasses the push guard. Use `pnpm bot:git -- push origin HEAD` or `pnpm bot:git -- fetch origin`.",
  },
  {
    // STA-216: a config alias runs any git command (`-c alias.x=credential x fill`, `-c alias.p=push p origin main`);
    // an included config file or GIT_CONFIG_* env can define one too. Also `git config alias.x …` writes, the
    // config-file env (`GIT_CONFIG_GLOBAL`, `HOME=`, `XDG_CONFIG_HOME=`) and a pager other than cat or less.
    rx: (c) =>
      scanTexts(c).some(
        (d) =>
          /\b(?:git|man)\b/.test(d) &&
          (/(?:^|\s)(?:GIT_EDITOR|GIT_SEQUENCE_EDITOR)=(?!(?:true|:|cat)(?:\s|$))|(?:^|\s)(?:MANPAGER|PAGER|GIT_PAGER)=(?!(?:cat|less)(?:\s|$))|(?:^|\s)(?:--config-env\b|(?:GIT_CONFIG(?:_GLOBAL|_SYSTEM|_COUNT|_KEY_\d+|_PARAMETERS)?|HOME|XDG_CONFIG_HOME|GIT_ASKPASS|SSH_ASKPASS|GIT_EXEC_PATH|GIT_SSH(?:_COMMAND)?|GIT_PROXY_COMMAND|GIT_EXTERNAL_DIFF|GIT_TEMPLATE_DIR)=)/i.test(
            d,
          ) ||
            gitConfigLevel(d) === "deny"),
      ),
    why: "git `-c` outside a short display/identity allow-list, any `git config` that is not a read or a write of an allowed key, `--config-env`, and the `GIT_CONFIG*`, `HOME=`, `XDG_CONFIG_HOME=`, `GIT_ASKPASS=`, `SSH_ASKPASS=`, `GIT_EXEC_PATH=`, `GIT_SSH[_COMMAND]=` and `GIT_PROXY_COMMAND=` prefixes (and a pager other than `cat` or `less`) make git run another command, redefine a remote or alias past the push and credential guards. For an editor, `GIT_EDITOR=true` is already set in .claude/settings.json `env`.",
  },
  {
    // `man -P <cmd>` and `--pager=<cmd>` run <cmd>; plain `man git-credential` stays allowed.
    rx: (c) =>
      scanTexts(c).some((d) =>
        /\bman\b[^|;&\n]*\s-(?:[a-zA-Z]*[PHBTC]\b|-(?:pager|html|browser|troff|ditroff|config-file))/.test(
          d,
        ),
      ),
    why: "`man -P`, `-H`, `-B`, `-T`, `-C` and their long forms (`--pager`, `--html`, ...) run an arbitrary command. Read the page with plain `man <page>`.",
  },
  {
    // STA-216: a GraphQL document read from a file or a substitution cannot be checked for a merge mutation;
    // `gh alias` rewrites the owner's gh config. tools/scripts/bot-gh.mjs denies both as well.
    rx: (c) =>
      [dropMessages(c), ...runnable(c)].some((t) =>
        segments(t).some(
          (s) =>
            BOT_GH_WORD.test(blank(s)) &&
            (/\balias\s+(?:set|import|delete)\b/.test(s) ||
              (/\bapi\s+(?:-\S+\s+)*graphql\b/.test(s) && /=@|--input\b|\$\(|`/.test(s))),
        ),
      ),
    why: "`pnpm bot:gh -- api graphql` with the query from a file (`-F query=@f`, `--input`) or a substitution, and `gh alias set`, are denied: the query cannot be checked for a merge mutation. Inline the query, or merge with `pnpm pr:merge <n>`.",
  },
  {
    // STA-291: a shell reading a pipe or a file written earlier from text the guard cannot read.
    rx: runsOpaque,
    decision: "ask",
    lookThrough: false, // _inbox reads `pnpm exec sh` itself; a script name is not a command
    why: "A shell runs text the guard cannot read (`curl … | sh`, `cat x | sh`, `cmd > f; sh f`). Run the commands directly instead.",
  },
  {
    rx: (c) => runs(c, BARE_GH),
    why: "Agents never run `gh` on the owner's login, in any form (`pnpm gh`, `pnpm exec gh` and a `GH_TOKEN=` prefix included: an empty token falls back to the owner). Use `pnpm bot:gh -- <args>` (builder, stackra-bot; `-R figentra/os` for the OS repo), `pnpm bot:review -- <args>` (reviewer) or `pnpm pr:merge <n>`; in a pipe, `pnpm --silent bot:gh -- <args> | …`.",
  },
  {
    rx: (c) => runs(c, NETWORK_GIT),
    why: "Agents never run network git (push, fetch, pull, clone, ls-remote, submodule, subtree, remote update, archive --remote) on the owner's credential helper. Run it as the bot: `pnpm bot:git -- push origin HEAD`, `pnpm bot:git -- fetch origin`; another repo: `pnpm bot:git -- -C <dir> …`.",
  },
  {
    // The token belongs in the wrapper's child environment only, never in the transcript or in gh's config.
    rx: (c) =>
      runnable(c).some((t) => /\bbot:token\b/.test(t)) ||
      /\$\{?\w*(?:TOKEN|_API_KEY|_SECRET|_PASSWORD|_PRIVATE_KEY)\b/.test(
        scanShell(dropMessages(c)).literal,
      ) ||
      runs(c, /(?:^|\s)(?:\S*\/)?(?:node|bun|deno|tsx)\b[^|;&\n]*(?:\s|\/)bot-token\.mjs\b/) ||
      // The private CLI's form (`figentra bot token`), bare or through any runner (`pnpm exec`, `npx`, `mise exec --`).
      runs(c, /(?:\bfigentra(?:\.mjs)?|@figentra\/cli(?:@\S*)?)\s+(?:--\s+)?bot\s+token\b/) ||
      runs(
        c,
        new RegExp(
          String.raw`\bbot:(?:gh|review)\s+(?:--\s+)?auth\b|\bbot:git\s+(?:--\s+)?(?:\S+\s+)*?credential\b|` +
            // The private CLI's bot modes (`figentra bot gh|review auth`, `figentra bot git credential`).
            String.raw`\bfigentra\s+(?:--\s+)?bot\s+(?:(?:gh|review)\s+(?:--\s+)?auth\b|git\s+(?:--\s+)?(?:\S+\s+)*?credential\b)|` +
            // STA-214: `git credential fill` and `git credential-<helper> get` answer with the owner's token.
            // `man git-credential` and similar read-only help is not a credential call (STA-216).
            String.raw`(?<!\b(?:man|help|which|whereis|type)\s+(?:-\S+\s+)*)\bgit(?:-|\s+(?:--\s+)?` +
            GIT_OPTS +
            String.raw`)credential\b`,
        ),
      ),
    why: "A token is never printed, read or handed to `gh auth`: `pnpm bot:token`, running `bot-token.mjs` or `figentra bot token`, `$GH_TOKEN` (any `$…_TOKEN`, `$…_API_KEY`, `$…_SECRET`), `bot:gh -- auth …`, and `git credential …` or `git credential-<helper> …` (bare or through `bot:git`) are denied. Use `pnpm bot:gh -- <args>`, which keeps the token in its child process.",
  },
  // ADR 0230: an agent never speaks for the owner, and only the reviewer identity posts verdicts. A tripwire, not
  // the control: pr-merge checks the verdict's author.
  {
    rx: writesOwnerApproval,
    why: "`owner-approval` / `owner-approved` record the owner's own decision; an agent never adds the label or submits an approving review that ends in the token. Ask the owner.",
  },
  {
    // Only a write whose body starts with the token: a builder's reply or a `--jq` read may mention it.
    rx: /(?:^|[\s;&|(:])gh\s+(?:--\s+)?(?:pr\s+(?:comment|review)\b[^\n]*\s(?:-b|--body)(?:=|\s+)["']?\s*AI-REVIEW:|api\b[^\n]*\s(?:-[fF]|--(?:raw-)?field)(?:=|\s+)["']?body=["']?\s*AI-REVIEW:)/i,
    why: "AI-REVIEW verdicts are posted only by the reviewer identity: `pnpm bot:review -- pr comment <n> --body-file <f>`, from a reviewer agent, never on the reviewer's own work.",
  },
  {
    rx: (c, ctx) => !REVIEWER_AGENTS.has(ctx.agentType) && runs(c, runsBotReview),
    why: "`pnpm bot:review` posts as the reviewer identity, so only a reviewer agent runs it (the agents whose source sets `reviewer: true`, ADR 0230). A builder or the lead asks a reviewer agent for the verdict. Tripwire until the CI reviewer posts verdicts.",
  },
  {
    rx: (c) => runsQuoted(c, new RegExp(GIT + String.raw`tag\s+(-a\s+)?\S+@\d`)),
    why: "Release tags (`<package>@x.y.z`) are created by CI from a merged version PR, never by hand.",
  },

  // --- Database / release process ---------------------------------------------------------------
  {
    // SQL reaches a client quoted, piped, in a here-string or a heredoc: once a SQL client runs, the whole command
    // is read, heredoc bodies included (STA-330 review).
    rx: (c, ctx) => runs(c, DROP_DB) || (DROP_DB.test(ctx.raw) && runsSqlClient(c)),
    why: "Dropping a database is a human decision. `encore db reset <service>` resets a local one, with the owner's yes.",
  },
  {
    rx: (c) =>
      runsQuoted(c, /\b(drizzle-kit|mikro-orm)\s+(push|migrate|migration:up|schema:update)\b/),
    why: "Encore applies migrations when the app runs. Write `<n>_<name>.up.sql` by hand, then `encore run`; never push directly to a database.",
  },
  {
    rx: (c) => runsQuoted(c, /\bchangeset(\s+|:)version\b/),
    why: "`changeset version` runs in CI (the Release workflow's version PR). Locally, add a changeset with `pnpm changeset`; the version bump is the version PR's job.",
  },
];

/**
 * A word re-quoted for the shell: plain words bare, an assignment's value quoted, an expansion double-quoted. An
 * expansion keeps its double-quoted text as written (`raw`), so an escaped `\$` or backtick stays escaped.
 */
function requote(w, dynamic, raw) {
  if (dynamic && raw != null) w = raw;
  if (/^[\w./:@%+,~{}!^-]*$/.test(w) && w) return w;
  const eq = /^(\w+=)(.*)$/s.exec(w);
  if (eq) return eq[1] + requote(eq[2], dynamic);
  if (dynamic) return w.includes('"') ? w : `"${w}"`;
  // One quoted string, so prose stays one span (`"it's .env"`, STA-351); `'\''` would split it.
  if (w.includes("'") && !/["$\x60\\]/.test(w)) return `"${w}"`;
  return `'${w.replaceAll("'", "'\\''")}'`;
}
/**
 * `c` re-serialised from its unquoted words (`"gh"`, `g''h`, `\gh` → `gh`; `"a; b"` → `'a; b'`), so a quoted or
 * escaped command name meets every rule. Null when `c` has no quote or backslash.
 */
function dequoted(c) {
  if (!/['"\\]/.test(c)) return null;
  return simpleCommands(c)
    .map(
      (s) =>
        [
          ...s.words.map((w, k) => requote(w, s.dyn[k], s.raw[k])),
          ...s.redirects.map((r) => r.op + requote(r.target, r.dynamic, r.raw)),
        ].join(" ") + (s.op ? ` ${s.op} ` : ""),
    )
    .join("");
}
/** A text, its runner-free form and its dequoted forms, once each. */
function forms(t) {
  const d = dequoted(t);
  return [...new Set([t, lookThroughRunners(t), ...(d ? [d, lookThroughRunners(d)] : [])])];
}

/**
 * Substitutions nested deeper than this are not read: every level is scanned again, so a deeper command would
 * cost more than the hook's time limit, and the hook fails open when it is killed (STA-330 review).
 */
const MAX_DEPTH = 16;
const TOO_MANY_GIT = `The command needs more than ${MAX_GIT} git lookups (checkouts, branches, push targets) to decide, more than the guard runs in its time limit. Split it into smaller commands.`;
const TOO_SLOW = `The command takes the guard more than ${DEADLINE_MS / 1000} s to decide (git lookups, paths, nesting), and a hook that runs out of time fails open. Split it into smaller commands.`;
const TOO_DEEP = `The command nests \`$(…)\`, \`<(…)\` or backtick substitutions more than ${MAX_DEPTH} levels deep, or script strings (\`sh -c\`, \`eval\`) more than ${MAX_SCRIPTS}, which the guard does not read. Split it into plain commands.`;
/** The deepest nesting of `$(`, `<(`, `>(` and backtick bodies in `c`, quotes ignored (deny-leaning). */
function substitutionDepth(c) {
  const stack = []; // true for a substitution's `(`, false for a plain one
  let depth = 0;
  let max = 0;
  let tick = false;
  for (let i = 0; i < c.length; i++) {
    const ch = c[i];
    if (ch === "\\") i++;
    else if (ch === "`") tick = !tick;
    else if (ch === "(") {
      const sub = "$<>".includes(c[i - 1] ?? "");
      stack.push(sub);
      if (sub) depth++;
    } else if (ch === ")" && stack.pop()) depth--;
    max = Math.max(max, depth + (tick ? 1 : 0));
  }
  return max;
}

/**
 * The evaluation context: the command as written (`raw`, heredoc bodies included), the shell's directory, the
 * agent type, the session's scratchpad (resolved, lazy), the session's own checkout (lazy) and a memo.
 */
function context(raw, cwd, agentType, scratchpad, role) {
  let checkout;
  const cache = new Map();
  const memo = (key, f) => {
    if (!cache.has(key)) cache.set(key, f());
    return cache.get(key);
  };
  let scratch;
  const own = () => (checkout ??= ownCheckout(cwd));
  return {
    raw,
    cwd,
    agentType,
    role,
    memo,
    own,
    scratch: () => (scratch ??= scratchpad && realDir(scratchpad)),
  };
}

/**
 * The tier for a shell command: `{ decision: "allow" | "ask" | "deny", reason }`. Every rule runs on the command
 * and on its runner-free form (`lookThroughRunners`); any deny wins over any ask. Safety net (STA-254): deny rules
 * also run on every substitution body found with quotes ignored. An ask is a deny (`unattended`) unless every ask
 * it hit is in `HUMAN_ASKS`, from the main thread and a subagent alike (STA-400; STA-351 did it for subagents).
 * @param {string} raw the command as the agent wrote it
 * @param {{ cwd?: string, agentType?: string, scratchpad?: string, executor?: boolean, deadlineMs?: number }} [options]
 *   the shell's
 *   directory, the agent type (`agent_type`, for the reviewer rule), the session's scratchpad directory
 *   (`sessionScratchpad`; none: no scratch `rm -rf`), and whether an OpenCode executor runs it (the `executor`
 *   rules: `npx`, `eas`, `wrangler secret|--remote`, `encore env set|create`, `secrets:import --confirm`), and the
 *   session's role (`STACKRA_ROLE`; `qa-release` may deploy, the deploy rules), and the
 *   decision's deadline (`DEADLINE_MS`; a test lifts it so box load never decides an outcome)
 */
export function decideBash(raw, options = {}) {
  try {
    return decide(raw, options);
  } catch (error) {
    // A command that breaks the reader (a stack overflow, a regex too large) is not let through: the hook fails open.
    return { decision: "deny", reason: `${UNREADABLE} (${error?.name ?? "error"})` };
  }
}
const UNREADABLE =
  "The guard could not read this command, so it is denied. Split it into plain commands";
function decide(
  raw,
  {
    cwd = process.cwd(),
    agentType = "",
    scratchpad = "",
    executor = false,
    role = "",
    deadlineMs = DEADLINE_MS,
  } = {},
) {
  clearCaches();
  gitRuns = 0;
  gitLate = false;
  deadline = performance.now() + deadlineMs;
  if (substitutionDepth(raw) > MAX_DEPTH) return { decision: "deny", reason: TOO_DEEP };
  const cmd = stripHeredocs(raw);
  const ctx = context(raw, cwd, agentType, scratchpad, role);
  tooDeep = false;
  for (const text of forms(cmd)) {
    runnable(text);
    scanTexts(text);
  }
  if (tooDeep) return { decision: "deny", reason: TOO_DEEP };
  const check = (rule, text) => {
    const target = rule.scan === "bare" ? blank(text) : text;
    const hit = typeof rule.rx === "function" ? rule.rx(target, ctx) : rule.rx.test(target);
    if (!hit) return null;
    return typeof hit === "string" ? hit : rule.why;
  };
  // Past `MAX_GIT` or the deadline a rule may have decided on an unknown checkout: the reason is the cap.
  const done = (d) =>
    gitRuns > MAX_GIT
      ? { decision: "deny", reason: TOO_MANY_GIT }
      : gitLate || late()
        ? { decision: "deny", reason: TOO_SLOW }
        : d;
  let asked = null;
  let rewrite = null; // the first ask outside `HUMAN_ASKS`: the whole command is a deny
  const all = forms(cmd);
  const rules = executor ? RULES : RULES.filter((r) => !r.executor);
  for (const rule of rules)
    for (const text of rule.lookThrough === false ? [cmd] : all) {
      if (late()) return done(null);
      const why = check(rule, text);
      if (why && rule.decision !== "ask") return done({ decision: "deny", reason: why });
      if (why) asked ??= why;
      if (why && !HUMAN_ASKS.has(rule.id)) rewrite ??= why;
    }
  for (const body of rawSubstitutions(cmd)) {
    const texts = forms(body);
    for (const text of texts)
      for (const rule of rules) {
        if (late()) return done(null);
        if (rule.lookThrough === false && text !== body) continue;
        const why = rule.decision === "ask" ? null : check(rule, text);
        if (why) return done({ decision: "deny", reason: why });
      }
  }
  if (rewrite) return done(unattended({ decision: "ask", reason: rewrite }));
  return done(asked ? { decision: "ask", reason: asked } : { decision: "allow", reason: "" });
}

/**
 * True when a command word names a secret file (`isSecretPath`), after brace expansion, or is a glob whose literal
 * text names one (`.env*`, `*.pem`, `*.secrets*`, `~/.ssh/id_*`). What a wildcard could match never counts, so
 * `*.json` and `.*` name no secret (STA-330 review); a glob that spells a name with wildcards (`.e?v`, `.en[v]`) is
 * a deliberate workaround the accident guard does not read. Only a path-shaped word counts: one with a space, quote,
 * paren, `=`, `<`, `>` or bracket is program text (`console.log(a.key`, `x=>x.key`, `.actions[].key`).
 */
function namesSecret(w) {
  for (const b of braces(w) ?? [w]) {
    const p = unquote(b);
    if (/[\s'"()=<>[\]]/.test(p)) continue;
    if (isSecretPath(p)) return true;
    if (/[*?]/.test(p) && p.split(/[*?]/).some((lit) => lit && isSecretPath(lit))) return true;
  }
  return false;
}
/** Commands whose program is a flag's value: `node -e|-p|-pe`, `python -c`, `perl -e|-ne|-E`. */
const PROGRAM_FLAG = new Map([
  ["node", /^(?:-[ep]+|--eval|--print)$/],
  ["python", /^-[A-Za-z]*c$/],
  ["perl", /^-[A-Za-z]*[eE]$/],
]);
/** Options that take values before the program or pattern, and how many (`jq --arg a b`, `grep -A 3`). */
const JQ_VALUES = {
  "--arg": 2,
  "--argjson": 2,
  "--slurpfile": 2,
  "--rawfile": 2,
  "--indent": 1,
  "-L": 1,
};
/**
 * Short options of a search that take a value, besides `-e` (a pattern) and `-f` (a pattern file): the value is the
 * rest of the cluster (`-A3`) or the next word. Only known ones: a missed value shifts the pattern onto a file.
 */
const SEARCH_SHORT = {
  grep: "ABCDdm",
  rg: "ABCEMTdgjmrt",
  ag: "ABCGm", // `-g` is the pattern, never an option value
  ack: "ABCmt",
  git: "ABCm",
};
/** Long options of a search whose value may be the next word (`--include '*.ts'`); `=` joins it otherwise. */
const SEARCH_LONG = new Set(
  "include exclude exclude-dir exclude-from context after-context before-context max-count label binary-files devices directories group-separator glob iglob type type-not replace max-depth max-columns threads encoding type-add ignore-file pre pre-glob sort sortr max-filesize path-separator context-separator".split(
    " ",
  ),
);
/** rg's own valued long options that grep reads differently (`grep --color` takes no next word). */
const RG_LONG = new Set(["color", "colors", "field-context-separator", "field-match-separator"]);
const SEARCHES = new Set(["grep", "egrep", "fgrep", "rg", "ag", "ack"]);
/**
 * The indexes of a search's pattern words from `from` (STA-351): every `-e` / `--regexp` value, attached
 * (`-ex`, `-e=x`, `-nex`, `--regexp=x`) or the next word, or else the first operand, other options' values
 * skipped. With `-f` / `--file` (clustered too: `-nf .env`) the pattern comes from that file, which stays a word;
 * an attached one (`-f.env`, `-nf.env`) is returned in `files`.
 */
function patternIndexes(words, from, short, longs) {
  const out = [];
  const files = [];
  const operands = [];
  let given = false;
  for (let j = from; j < words.length; j++) {
    const w = words[j];
    if (w === "--") {
      for (let k = j + 1; k < words.length; k++) operands.push(k);
      break;
    }
    const long = /^--([^=]+)(=?)/.exec(w);
    if (long) {
      const joined = long[2] === "=";
      if (long[1] === "regexp" || long[1] === "file") given = true;
      if (long[1] === "regexp") out.push(joined ? j : j + 1);
      if (!joined && (long[1] === "regexp" || long[1] === "file" || longs.has(long[1]))) j++;
    } else if (/^-./.test(w)) {
      for (let k = 1; k < w.length; k++) {
        if (!(w[k] === "e" || w[k] === "f" || short.includes(w[k]))) continue;
        const attached = k < w.length - 1;
        if (w[k] === "e" || w[k] === "f") given = true;
        if (w[k] === "e") out.push(attached ? j : j + 1);
        if (w[k] === "f" && attached) files.push(w.slice(k + 1).replace(/^=/, ""));
        if (!attached) j++;
        break;
      }
    } else operands.push(j);
  }
  if (!given && operands.length) out.push(operands[0]);
  return { pattern: new Set(out), files };
}
/** git's global options whose value is the next word (`-C dir`, `-c k=v`, `--git-dir x`). */
const GIT_GLOBAL_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);
/** The index of git's subcommand after `git` at `i`, global options and their values skipped; -1 when none. */
function gitSubcommandAt(words, i) {
  for (let j = i + 1; j < words.length; j++) {
    if (GIT_GLOBAL_VALUE.has(words[j])) j++;
    else if (!words[j].startsWith("-")) return j;
  }
  return -1;
}
/** git options whose value is a search pattern, never a file: `log -S…`, `-G…`, `--grep=…` (STA-351). */
const GIT_PATTERN = /^(?:-[SG]|--grep)$/;
const GIT_PATTERN_JOINED = /^(?:-[SG].|--grep=)/;
/** A vitest test-name filter: its value is a pattern, never a file (`vitest run -t "reads action.key"`). */
const TEST_NAME_FLAG = /^(?:-t|--testNamePattern|--test-name-pattern)$/;
/** The first operand of `words` from `from`: options and their `values` skipped, the word after `--` taken. */
function firstOperand(words, from, values) {
  for (let j = from; j < words.length; j++) {
    if (words[j] === "--") return j + 1;
    if (values[words[j]]) j += values[words[j]];
    else if (!words[j].startsWith("-")) return j;
  }
  return -1;
}
/**
 * `words` without the program or pattern a command reads as code or text, not as file names (STA-330 review): the
 * first operand of `jq` (its option values skipped) and `awk` (none when `-f` names a program file), the pattern of
 * a search (`grep`, `rg`, `git grep`: `patternIndexes`), the `-S` / `-G` / `--grep` values of `git log|show|diff`,
 * a vitest `-t` value and the value of a `PROGRAM_FLAG`. A file operand is kept, so `jq . .env`, `grep x .env` and
 * `grep -f .env x` still name the file.
 */
function withoutPrograms(words) {
  const i = commandAt(words);
  const name = baseName(words[i] ?? "").replace(/[\d.]+$/, "");
  const drop = (k) => words.filter((_, j) => j !== k);
  if (name === "jq" || name === "awk" || name === "gawk") {
    if (words.includes("-f") || words.includes("--from-file")) return words;
    return drop(firstOperand(words, i + 1, name === "jq" ? JQ_VALUES : {}));
  }
  const sub = name === "git" ? gitSubcommandAt(words, i) : -1;
  if (SEARCHES.has(name) || words[sub] === "grep") {
    const tool = sub >= 0 ? "git" : /^[ef]?grep$/.test(name) ? "grep" : name;
    const longs = tool === "rg" ? new Set([...SEARCH_LONG, ...RG_LONG]) : SEARCH_LONG;
    const from = sub >= 0 ? sub + 1 : i + 1;
    const { pattern, files } = patternIndexes(words, from, SEARCH_SHORT[tool], longs);
    return [...words.filter((_, j) => !pattern.has(j)), ...files];
  }
  if (["log", "show", "diff"].includes(words[sub]))
    return words.filter(
      (w, j) => !(j > sub && (GIT_PATTERN_JOINED.test(w) || GIT_PATTERN.test(words[j - 1]))),
    );
  if (words.some((w) => baseName(w) === "vitest"))
    return words.filter(
      (w, j) =>
        !/^--(?:testNamePattern|test-name-pattern)=/.test(w) &&
        !TEST_NAME_FLAG.test(words[j - 1] ?? ""),
    );
  const flag = PROGRAM_FLAG.get(name);
  return flag ? words.filter((_, j) => !(j > i + 1 && flag.test(words[j - 1]))) : words;
}

// ---- the guard engine's table (STA-1945) ---------------------------------------------------------------------

/**
 * `decideBash`'s options from the hook payload, moved from core's `guard-bash.mjs`: the shell's directory, the agent
 * type, the session's role (`STACKRA_ROLE` in the hook's environment, which is the session's, so an agent cannot set
 * it; owner decision 2026-10-31), its scratchpad, and whether an OpenCode executor runs it (`isExecutor`, which core's
 * OpenCode guard always passes).
 * @param {string} cwd
 * @param {Record<string, any>} payload
 */
export function payloadOptions(cwd, payload) {
  // Core's OpenCode guard passes no role and no scratchpad: an executor never inherits a lead's (STA-2136).
  const executor = isExecutor();
  return {
    cwd,
    agentType: String(payload.agent_type ?? ""),
    role: executor ? "" : String(process.env.STACKRA_ROLE ?? ""),
    scratchpad: executor
      ? ""
      : sessionScratchpad({
          scratchpadDir: typeof payload.scratchpad_dir === "string" ? payload.scratchpad_dir : "",
          sessionIds: [payload.session_id, process.env.CLAUDE_CODE_SESSION_ID],
          projectDirs: [process.env.CLAUDE_PROJECT_DIR, cwd],
        }),
    executor,
  };
}

/**
 * Core's decision as the engine's rules: one rule for its deny, one for its ask, deciding once per call. `extra`
 * overrides `decideBash`'s options (the differential test lifts `deadlineMs` and names the scratchpad, as core's did).
 * An executor's command that core's rules do not deny is put to the executor layer too (`decideExecutor`), as core's
 * OpenCode guard does.
 * @param {{ deadlineMs?: number, scratchpad?: string, role?: string, executor?: boolean }} [extra]
 * @returns {import("@figentra-oss/flow/guard").BashRule[]}
 */
export function bashRules(extra = {}) {
  /** @type {{ command: string, cwd: string, how: unknown, d: { decision: string, reason: string } } | undefined} */
  let last;
  const decided = (
    /** @type {string} */ command,
    /** @type {string} */ cwd,
    /** @type {{ payload?: Record<string, any> } | undefined} */ how,
  ) => {
    if (last?.command !== command || last.cwd !== cwd || last.how !== how) {
      const options = { ...payloadOptions(cwd, how?.payload ?? {}), ...extra };
      let d = decideBash(command, options);
      if (options.executor && d.decision !== "deny") {
        const e = decideExecutor(command);
        if (e.decision === "deny") d = e;
      }
      last = { command, cwd, how, d };
    }
    return last.d;
  };
  /** Core's reason when it decided `decision`, else false. */
  const hit = (
    /** @type {string} */ decision,
    /** @type {{ decision: string, reason: string }} */ d,
  ) => d.decision === decision && (d.reason || true);
  return [
    {
      id: "stackra-deny",
      decision: "deny",
      reason: UNREADABLE,
      match: (command, cwd, how) => hit("deny", decided(command, cwd, how)),
    },
    {
      id: "stackra-ask",
      decision: "ask",
      reason: "The guard asks the owner to confirm this command.",
      match: (command, cwd, how) => hit("ask", decided(command, cwd, how)),
    },
  ];
}

/** @type {import("@figentra-oss/flow/guard").BashRule[]} */
export const BASH_RULES = bashRules();
