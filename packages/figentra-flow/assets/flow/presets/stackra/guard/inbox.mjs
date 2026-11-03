/**
 * Stackra preset: the guard engine's shell scanner and secrets-inbox matcher, moved unchanged from core's
 * `.agents/hooks/_inbox.mjs` (core 220f92c2; STA-1945 T052). Change it together with core's copy until core's
 * migration PR removes that one.
 * Stackra file contract:
 * Purpose: Does a path (or glob), or a shell command, reach ~/Secrets-inbox/ or the import confirm key? Shared by
 *          guard-bash, guard-paths and the OpenCode guard (decide.ts). An ACCIDENT guard, not a security boundary (ADR
 *          0257): it stops an agent opening the inbox by habit; the guarantee is that `pnpm secrets:import` never
 *          outputs a value.
 * Boundary: pure path and command text checks; reads nothing and writes nothing.
 * Runtime: node (agent hook)
 * Governing contract: ADR 0257; ADR 0293.
 */
import { homedir } from "node:os";
import { resolve } from "node:path";

/** Memo tables, one per scan; `clearCaches` empties them all (`decideBash` does, before each decision). */
const tables = [];
export const memoTable = () => {
  const table = new Map();
  tables.push(table);
  return table;
};
export const clearCaches = () => tables.forEach((table) => table.clear());
/**
 * `f()` for text `c`, computed once per decision: every rule reads the same texts, and a capped table that
 * emptied itself mid-decision rescanned them all (STA-330 review). The cap is only a safety net for a process
 * that never clears (results are read, never changed).
 */
export function cached(table, c, f) {
  if (table.has(c)) return table.get(c);
  if (table.size > 50_000) table.clear();
  const value = f();
  table.set(c, value);
  return value;
}

const INBOX = "Secrets-inbox";
const KEY = "secrets-confirm.key";

/** One path segment as a case-insensitive regex; glob characters become wildcards. */
function segmentRx(seg) {
  const body = seg
    .replaceAll(/[.+^$()|\\]/g, "\\$&")
    .replaceAll(/\*+/g, ".*")
    .replaceAll("?", ".")
    .replaceAll(/\{([^}]*)\}/g, (_, alts) => `(?:${alts.split(",").join("|")})`);
  try {
    return new RegExp(`^${body}$`, "i");
  } catch {
    return /^.*$/; // an unparseable glob is treated as matching anything
  }
}

/** True when a segment literally names the inbox (any case) or the key. */
export const namesInbox = (seg) => seg.toLowerCase() === INBOX.toLowerCase() || seg === KEY;

/**
 * `p` reaches the inbox when a segment literally names it, anywhere. Globs count only on a path rooted at
 * home (`~`, `$HOME`, an absolute path, or a relative one resolved against a known `cwd`): `p` reaches the
 * inbox when its segments match home then the inbox (`~/Secrets-inbo?`, `~/*`), descend with `**`, or `p` is
 * home or an ancestor of it and `recursive` (a Grep root, `grep -r`, `find`).
 */
export function reachesInbox(p, { recursive = false, home = homedir(), cwd } = {}) {
  if (typeof p !== "string" || !p) return false;
  const expanded = p
    .trim()
    .replace(/^~(?=\/|$)/, home)
    .replaceAll(/\$\{HOME\}|\$HOME(?!\w)/g, home);
  if (expanded.split("/").some(namesInbox)) return true;
  if (/^[~$]/.test(expanded)) return false; // another user's home or an unknown variable
  if (!expanded.startsWith("/") && !cwd) return false;
  const segs = resolve(cwd ?? "/", expanded)
    .split("/")
    .filter(Boolean);
  const target = resolve(home, INBOX).split("/").filter(Boolean);
  for (let i = 0; i < segs.length; i++) {
    if (segs[i] === "**") return true;
    if (i >= target.length) return true;
    if (!segmentRx(segs[i]).test(target[i])) return false;
  }
  // Every inbox segment matched (a glob like `~/*`), or `p` is home / an ancestor and searched recursively.
  return segs.length >= target.length || recursive;
}

// ---- shell commands --------------------------------------------------------------------------------------
// shortcut: a small lexer (quotes, separators, `$(`), not a shell parser; `cd` is followed only in order, so a
// subshell's `cd` leaks into later segments. Upgrade to a real parser if a miss or a false positive slips through.
/**
 * Walk a command by bash quoting rules (STA-254), shared by guard-bash and the OpenCode guard. States: plain,
 * `'…'`, `$'…'` (where `\'` is escaped; `$$` is the PID, so `$$'x'` is plain quoting), `"…"` / `$"…"`, and a
 * stack of `$(…)`, `$((…))`, `((…))`, `<(…)`, `>(…)` and backtick bodies, inside which quoting restarts
 * (`"$(echo "it's")"`), and of `${…}` / `$[…]` expansions (nesting counted; no comment, `case` or heredoc there). A `'` inside double quotes is literal; a `#` at an unescaped word start comments to the
 * end of the line (in backticks, to the closing backtick); a `case … esac` pattern `)` does not end a body and
 * ends a command (`a) git push` is two).
 * Heredocs are stripped only when certain, else their lines stay commands (deny-leaning): the `<<` / `<<-`
 * operator is in plain state in a command or backtick body (not `<<<`, not in quotes, comments, arithmetic,
 * `${…}` or `$[…]`); its delimiter is a plain word `[A-Za-z0-9_]+` once quotes are removed; the newline that
 * starts the body is at the operator's own nesting level (no substitution opened since); and the closing line
 * is found. An unquoted delimiter keeps the body's substitutions. Returns:
 * - `literal`: every `'…'` / `$'…'` span and comment (never run) blanked to `''` / dropped, heredoc bodies
 *   replaced by their substitutions; the rest verbatim;
 * - `blanked`: also every outermost `"…"` span blanked to `""`, so only command words are left;
 * - `bodies`: the text (of `literal`) of every direct substitution body, backtick bodies unescaped; callers
 *   scan each body again for the ones nested in it;
 * - `spans`: `[start, end)` in `c` of every outermost closed quoted span;
 * - `stripped`: `source` verbatim except each heredoc: operator → `<<HEREDOC`, body → its substitutions as `$(…)`;
 * - `source`: `c` with every backslash-newline outside single quotes and stripped heredoc bodies removed, as the
 *   shell does before parsing (`"$\⏎(cmd)"` runs `cmd`); every other output, `spans` included, refers to it.
 * A `${…}` opened inside double quotes or a heredoc body keeps `'` and `$'` literal (bash 5, zsh).
 * A heredoc read by a shell (`sh`, `bash`, `zsh`, `dash`, `ksh`, `eval`, `source`, `.` anywhere on its line,
 * `cat <<EOF | sh` included), or whose operator line ends in `|` / `|&` (`cat <<EOF |⏎…⏎EOF⏎sh`), is a script, so
 * its body is never stripped. A `)` or backtick that closes a substitution is not a word boundary (`$(x)#y`).
 * Fail closed: an unclosed `"`, `$(` or backtick runs to the end; an unclosed `'` stays visible.
 * Safety net: `rawSubstitutions` finds every `$(…)`, `<(…)`, `>(…)` and backtick body ignoring quotes; callers run
 * their deny rules on those bodies too, so a quoting edge case here can only cost a deny, never an allow.
 * A heredoc written to a file (`> f`, `tee f`) that a later shell, `source`, `.` or `./f` runs is a script too
 * (STA-291). A case pattern's optional `(` is skipped, so `(a) cmd` splits like `a) cmd`.
 * Function, alias and pipe-to-shell bodies are `scriptStrings`' job (STA-291).
 * shortcut: a body rescanned out of its `((…))` context can misread a `<<` shift as a heredoc (only an
 * unterminated one, which is then read as commands); a file is matched to its run by basename only. Known gaps
 * (STA-291 review, later): a written file copied or moved before it runs (`cp`/`mv`/`ln` chains); writers other
 * than redirects and `tee` (`dd of=`, `cp`, `install`, `sed -i`); a script on PATH or a PATH change
 * (`PATH=.:$PATH f`); zsh alias quoting and global aliases. Upgrade to a real parser if one slips through.
 */
export function scanShell(c, opts = {}) {
  // Every rule scans the same texts: memoised (results are read, never changed).
  return opts.heredoc ? scanTwice(c, opts) : cached(scanCache, c, () => scanTwice(c, opts));
}
const scanCache = memoTable();
function scanTwice(c, opts) {
  const first = scanOnce(c, opts);
  if (!first.joins.length) return { ...first, source: c };
  let source = "";
  let at = 0;
  for (const j of first.joins) {
    source += c.slice(at, j);
    at = j + 2;
  }
  return { ...scanOnce(source + c.slice(at), opts), source: source + c.slice(at) };
}

/** A span inside double quotes or a heredoc body. */
const isQuotedSpan = (s) => s.kind === "dq" || s.kind === "heredoc";

/** One pass of `scanShell` over `c` as given; `joins` lists where a backslash-newline sits outside single quotes. */
function scanOnce(c, { heredoc = false } = {}) {
  let literal = "";
  let blanked = "";
  let quietFrom = -1; // where the outermost open double quote began; `blanked` hides text from there
  let escaped = -1; // index of the last character a backslash consumed: never a word boundary
  let closedAt = -1; // index of the last `)` or backtick that closed a substitution: never a word boundary
  const joins = [];
  let pending = []; // heredocs whose bodies start after the next newline
  const bodies = [];
  const spans = [];
  const edits = []; // [start, end, text] in `c`, for `stripped`
  const frame = (kind, extra) => ({ kind, parens: 0, cases: 0, start: literal.length, ...extra });
  const stack = [frame("cmd")];
  if (heredoc) stack.push({ kind: "heredoc" }); // like "…", but a `"` is literal
  const direct = () => stack.every((s, k) => k === 0 || isQuotedSpan(s) || s.kind === "param");
  const emit = (s, b = s) => {
    literal += s;
    if (quietFrom < 0) blanked += b;
  };
  const close = () => {
    const f = stack.pop();
    if (direct()) {
      const text = literal.slice(f.start);
      bodies.push(f.kind === "bt" ? text.replaceAll(/\\([`$\\])/g, "$1") : text);
    }
  };
  const wordStart = (i) =>
    i === 0 || (escaped !== i - 1 && closedAt !== i - 1 && /[\s;&|()<>`]/.test(c[i - 1]));
  const word = (i, w) =>
    wordStart(i) &&
    c.startsWith(w, i) &&
    /^(?:[\s;&|()`]|$)/.test(c.slice(i + w.length, i + w.length + 1));
  /** A heredoc delimiter word from `j`: its unquoted text, whether any of it was quoted, and where it ends. */
  const delimiter = (j) => {
    while (c[j] === " " || c[j] === "\t") j++;
    const from = j;
    let text = "";
    let isQuoted = false;
    while (j < c.length && !/[\s;&|()<>]/.test(c[j])) {
      if (c[j] === "'" || c[j] === '"') {
        const q = c.indexOf(c[j], j + 1);
        if (q < 0) return null;
        text += c.slice(j + 1, q);
        isQuoted = true;
        j = q + 1;
      } else if (c[j] === "\\") {
        text += c[j + 1] ?? "";
        isQuoted = true;
        j += 2;
      } else text += c[j++];
    }
    return j > from && /^[A-Za-z0-9_]+$/.test(text) ? { text, isQuoted, end: j } : null;
  };
  /** The pending heredoc bodies after the newline at `i`: where the last delimiter line ends, and the substitutions. */
  const heredocBodies = (i) => {
    let j = i + 1;
    let end = i;
    const subs = [];
    if (pending.some((h) => h.script)) return null; // a shell runs the body: keep it as commands
    for (const h of pending) {
      let k = j;
      for (;;) {
        const nl = c.indexOf("\n", k);
        end = nl < 0 ? c.length : nl;
        const line = c.slice(k, end);
        if ((h.strip ? line.replace(/^\t+/, "") : line) === h.text) break;
        if (nl < 0) return null;
        k = nl + 1;
      }
      if (!h.isQuoted) subs.push(...scanShell(c.slice(j, k), { heredoc: true }).bodies);
      j = end + 1;
    }
    return { end, subs };
  };
  for (let i = 0; i < c.length; i++) {
    const ch = c[i];
    const f = stack.at(-1);
    if (ch === "\\" || (ch === "$" && c[i + 1] === "$")) {
      emit(c.slice(i, i + 2));
      i++;
      if (ch === "\\") escaped = i;
      if (ch === "\\" && c[i] === "\n") joins.push(i - 1);
      continue;
    }
    if (isQuotedSpan(f)) {
      if (ch === '"' && f.kind === "dq") {
        stack.pop();
        literal += ch;
        if (!stack.some((s) => s.kind === "dq")) {
          spans.push([quietFrom, i + 1]);
          quietFrom = -1;
        }
        continue;
      }
    } else {
      if (ch === "\n" && pending.length) {
        const h = pending.every((p) => p.frame === f) ? heredocBodies(i) : null;
        pending = [];
        if (h) {
          const text = h.subs.map((b) => ` $(${b})`).join("");
          edits.push([i, h.end, text]);
          emit(text);
          if (direct()) bodies.push(...h.subs);
          i = h.end - 1;
          continue;
        }
      }
      if (f.kind === "param") {
        if (ch === f.closer && f.nest === 0) {
          stack.pop();
          emit(ch);
          continue;
        }
        if (ch === f.opener) f.nest++;
        else if (ch === f.closer) f.nest--;
      } else if (ch === "#" && wordStart(i)) {
        while (i + 1 < c.length && c[i + 1] !== "\n" && !(f.kind === "bt" && c[i + 1] === "`")) i++;
        continue;
      }
      const ansi = ch === "$" && c[i + 1] === "'";
      if ((ch === "'" || ansi) && !f.literalQuotes) {
        let j = i + (ansi ? 2 : 1);
        while (j < c.length && c[j] !== "'") j += ansi && c[j] === "\\" ? 2 : 1;
        if (j >= c.length) {
          emit(c.slice(i));
          break;
        }
        if (quietFrom < 0) spans.push([i, j + 1]);
        emit("''", '""');
        i = j;
        continue;
      }
      if (ch === '"' || (ch === "$" && c[i + 1] === '"')) {
        if (ch === "$") emit(c[i++]);
        if (quietFrom < 0) {
          blanked += '""';
          quietFrom = i;
        }
        literal += '"';
        stack.push({ kind: "dq" });
        continue;
      }
      if (c.startsWith("<<<", i)) {
        emit("<<<");
        i += 2;
        continue;
      }
      if (c.startsWith("<<", i) && (f.kind === "bt" || (f.kind === "cmd" && !f.arith))) {
        const strip = c[i + 2] === "-";
        const d = delimiter(i + (strip ? 3 : 2));
        if (d) {
          const from = c.lastIndexOf("\n", i - 1) + 1;
          const to = c.indexOf("\n", i);
          const line = c.slice(from, to < 0 ? c.length : to);
          const rest = to < 0 ? c.length : to;
          const script =
            SHELL_WORD.test(line) ||
            /\|&?\s*$/.test(line) ||
            writtenFiles(line).some((file) => runsFile(c, file, rest));
          pending.push({ ...d, strip, frame: f, script });
          edits.push([i, d.end, "<<HEREDOC"]);
          emit("<<HEREDOC");
          i = d.end - 1;
          continue;
        }
      }
      if (f.kind === "cmd") {
        if (word(i, "case")) f.cases++;
        else if (word(i, "esac") && f.cases > 0) f.cases--;
        else if (ch === "(" && c[i + 1] === "(" && wordStart(i)) {
          emit("((");
          i++;
          stack.push(frame("cmd", { arith: true }));
          continue;
        } else if (
          ch === "(" &&
          f.cases > 0 &&
          /(?:^|[\s;&])in$|;[;&]&?$/.test(c.slice(0, i).trimEnd())
        ) {
          emit(ch); // a case pattern's optional `(`: its `)` ends the pattern (`(a) git push` is two commands)
          continue;
        } else if (ch === "(") f.parens++;
        else if (ch === ")" && f.parens > 0) f.parens--;
        else if (ch === ")" && f.cases > 0 && !f.arith) {
          emit(");"); // a case pattern ends here and its command starts
          continue;
        } else if (ch === ")" && stack.length > 1) {
          close();
          const two = f.arith && c[i + 1] === ")";
          emit(two ? "))" : ")");
          if (two) i++;
          closedAt = i;
          continue;
        }
      } else if (f.kind === "bt" && ch === "`") {
        close();
        emit(ch);
        closedAt = i;
        continue;
      }
      if ((ch === "<" || ch === ">") && c[i + 1] === "(") {
        emit(c[i] + c[++i]);
        stack.push(frame("cmd"));
        continue;
      }
    }
    if (c.startsWith("${", i) || c.startsWith("$[", i)) {
      emit(c[i] + c[++i]);
      const brace = c[i] === "{";
      // Inside "…" or a heredoc body, `'` stays literal in the expansion (bash 5, zsh).
      const literalQuotes = isQuotedSpan(f) || Boolean(f.literalQuotes);
      stack.push(
        frame("param", { opener: c[i], closer: brace ? "}" : "]", nest: 0, literalQuotes }),
      );
      continue;
    }
    if (c.startsWith("$((", i)) {
      emit("$((");
      i += 2;
      stack.push(frame("cmd", { arith: true }));
      continue;
    }
    if ((ch === "$" && c[i + 1] === "(") || ch === "`") {
      emit(ch === "`" ? ch : c[i] + c[++i]);
      stack.push(frame(ch === "`" ? "bt" : "cmd"));
      continue;
    }
    emit(ch);
  }
  while (stack.length > 1) {
    if (isQuotedSpan(stack.at(-1)) || stack.at(-1).kind === "param") stack.pop();
    else close();
  }
  if (quietFrom >= 0) blanked += c.slice(quietFrom);
  let stripped = "";
  let at = 0;
  for (const [start, end, text] of edits) {
    stripped += c.slice(at, start) + text;
    at = end;
  }
  return { literal, blanked, bodies, spans, joins, stripped: stripped + c.slice(at) };
}

/**
 * Heredoc bodies are file content, not commands: `cat > rules.md <<'EOF' … EOF` must not trip a rule because the
 * prose names a forbidden command. Found by `scanShell` (so `'<<EOF'` and `<<<EOF` are not heredocs); a body with
 * an unquoted delimiter keeps its `$(…)` and backtick substitutions (STA-254).
 */
export const stripHeredocs = (raw) => scanShell(raw).stripped;

/**
 * A shell's name: sh, bash, zsh, dash, ksh, csh, tcsh, ash, mksh, yash, posh, rbash, osh, fish, nu, xonsh,
 * elvish, rc, es, versioned (`bash5`, `zsh-5.9`).
 */
const SHELL_NAME = String.raw`(?:(?:ba|z|da|k|c|tc|a|mk|ya|po|rba|o)?sh|fish|nu|xonsh|elvish|rc|es)(?:-?\d[\w.]*)?`;
/** A shell (or `eval` / `source` / `.`) as a word: its heredoc or here-string is a script. */
const SHELL_WORD = new RegExp(
  String.raw`(?:^|[\s;&|(\x60])(?:[^\s;&|()<>\x60]*/)?(?:${SHELL_NAME}|eval|source|\.)(?=[\s;&|)\x60]|$)`,
);

/**
 * Command position, for a definition: start, a separator, a group or a substitution opener. A lookbehind, after a
 * lookahead for the definition's first character, so a run of blank lines is not rescanned from every line.
 */
const DEFINE_AT = String.raw`(?<=(?:^|[;&|(){}\n\x60])\s*)`;
/** A function header (`f() {`, `function f {`) or a `{` group opener; replaced by `;`, its body is commands. */
const FUNCTION = new RegExp(
  String.raw`(?=[\w.:@{-])${DEFINE_AT}(?:(?:function\s+[\w.:@-]+(?:\s*\(\s*\))?|[\w.:@-]+\s*\(\s*\))\s*[{(]|\{(?=\s))`,
  "g",
);
const ALIAS = new RegExp(String.raw`(?=alias\s)${DEFINE_AT}alias\s`, "g");
const ALIAS_VALUE = /\s*(?:-\w+\s+)*[^\s=;&|]+=(?:'([^']*)'|"((?:\\.|[^"\\])*)"|([^\s;&|]*))/y;

/**
 * Script text a shell runs from a string: `sh -c "…"`, `eval "…"`, a here-string read by a shell, and (STA-291)
 * a function or group body, an alias value, the literal text piped into a shell (`echo '…' | sh`) and the
 * literal content of a file written then run (`echo … > f && sh f`). Text a shell runs that cannot be read
 * (`curl … | sh`) is `shellInputs(c).opaque`.
 */
export const scriptStrings = (c) => cached(scriptCache, c, () => findScriptStrings(c));
const scriptCache = memoTable();
function findScriptStrings(c) {
  const out = [];
  for (const m of c.matchAll(
    new RegExp(String.raw`\b(?:${SHELL_NAME}\s+-c|eval)\s+(["'])((?:\\.|(?!\1)[^\\])*)\1`, "g"),
  ))
    out.push(m[1] === '"' ? doubleQuoted(m[2]) : m[2]);
  // A here-string read by a shell, `source` or `.` in the same command; and `mise exec … -c '<cmd>'` (`x`,
  // `--command`, `--command=`, `-c<cmd>`), which runs a command line like `sh -c`, its own `--` ending its options.
  // One pass over the words (STA-330 review: a regex for the here-string was quadratic in `.` words).
  for (const { words, redirects } of simpleCommands(c)) {
    if (words.some((w) => SHELL.test(w.split("/").pop()) || /^(?:.*\/)?source$|^\.$/.test(w)))
      for (const r of redirects) if (r.op === "<<<") out.push(r.target);
    let mise = false;
    for (let k = 0; k < words.length; k++) {
      const w = words[k];
      if (w.split("/").pop() === "mise" && /^(?:exec|x)$/.test(words[k + 1] ?? "")) {
        mise = true;
        k++;
      } else if (!mise) continue;
      else if (w === "--") mise = false;
      else if (w === "-c" || w === "--command") out.push(words[++k] ?? "");
      else if (/^(?:-c|--command=)/.test(w)) out.push(w.replace(/^(?:-c|--command=)/, ""));
    }
  }
  const bodies = c.replace(FUNCTION, ";");
  if (bodies !== c) out.push(bodies);
  for (const m of c.matchAll(ALIAS)) {
    ALIAS_VALUE.lastIndex = m.index + m[0].length;
    for (let d; (d = ALIAS_VALUE.exec(c));) out.push(d[1] ?? d[2] ?? d[3]);
  }
  out.push(...shellInputs(c).scripts);
  return out;
}

/** Words of `text`, a quoted word kept whole (`"f x"`), quotes removed; `<` separates. */
const operands = (text) =>
  (text.match(/"[^"]*"|'[^']*'|[^\s<"']+/g) ?? []).map((w) => w.replace(/^(["'])(.*)\1$/s, "$2"));

/** Basenames of the files a command line writes: `> f`, `>> f`, `&> f`, `tee [-a] f…`. */
function writtenFiles(line) {
  const out = [];
  for (const m of line.matchAll(
    /(?:^|[^<>&\d])(?:1?>>?\|?|&>>?)\s*(?:"([^"]+)"|'([^']+)'|([^\s;&|<>()'"]+))/g,
  ))
    out.push(m[1] ?? m[2] ?? m[3]);
  for (const m of line.matchAll(/\btee\s+([^;&|<>\n]*)/g))
    out.push(...operands(m[1]).filter((w) => !w.startsWith("-")));
  return out
    .map((f) =>
      f
        .replaceAll(/^['"]|['"]$/g, "")
        .split("/")
        .pop(),
    )
    .filter(Boolean);
}

/** Commands that run the command after them (their options, `NAME=value` and a duration skipped). */
export const WRAPPERS = new Set([
  "sudo",
  "doas",
  "env",
  "busybox",
  "command",
  "exec",
  "nohup",
  "nice",
  "time",
  "timeout",
  "stdbuf",
]);
/** Wrapper options whose value is the next word (`sudo -u x`, `env -u NAME`, `nice -n 5`, `exec -a name`). */
export const WRAPPER_VALUE = new Set(["-u", "-n", "-a", "-g", "-C", "-k", "-s"]);
const SHELL = new RegExp(`^${SHELL_NAME}$`);
/** A shell, or `$` for a computed word that may be one (`caffeinate $SHELL`). */
const shellLike = (name) => name === "$" || SHELL.test(name);
/**
 * The toolchain's own shell setup, trusted when it is the bare command or under a known install directory and
 * its arguments are plain words (`eval "$(mise activate zsh)"`, `eval "$(/opt/homebrew/bin/brew shellenv)"`).
 */
const TRUSTED =
  /^\s*(?:(?:\/opt\/homebrew\/bin|\/usr\/local\/bin|\/home\/linuxbrew\/\.linuxbrew\/bin|(?:\$HOME|\$\{HOME\}|~)\/\.local\/bin)\/)?(?:mise\s+(?:activate|env|hook-env|completion)|brew\s+shellenv)(?:\s+[\w.=:/@+-]+)*\s*$/;

/**
 * True when `text` runs a file named `base` (any directory, globs and `find -exec`'s `{}` included): a shell,
 * `source` or `.` found by `shellAt` with it as an operand or `<` input (`caffeinate sh f`, `sh<f`, `sh f*`,
 * `find . -exec sh {} \;`), inside a `-c` or `eval` script, `./f` as a command, or its content substituted
 * (`$(cat f)`, `$(<f)`, backticks) anywhere. `from`: only the commands that start at or after that offset.
 * What each command runs is read once per text (`fileRunsOf`), so asking for every write in a line stays linear
 * (STA-330 review: re-parsing the rest of the line per write was quadratic in time and memory).
 */
function runsFile(text, base, from = 0) {
  if (fileRunsOf(text).some(([start, runs]) => start >= from && runsIn(runs, base))) return true;
  return substitutedFiles(text).some(([at, name]) => at >= from && name === base);
}
const runsIn = ({ words, texts }, base) =>
  words.some((w) => w === "{}" || (w && segmentRx(w).test(base))) ||
  texts.some((t) => runsFile(t, base));
const fileRunsTable = memoTable();
/** The simple commands of `text` that run a file or hold a script: where each starts, and what it runs. */
const fileRunsOf = (text) =>
  cached(fileRunsTable, text, () =>
    simpleCommands(text)
      .map((s, k, list) => [k ? list[k - 1].end : 0, fileRuns(s)])
      .filter(([, runs]) => runs.words.length || runs.texts.length),
  );
function fileRuns(s) {
  const words = [];
  const texts = [];
  const at = shellAt(s);
  if (at) {
    const rest = s.words.slice(at.j + 1);
    const flag = shellLike(at.name) ? commandFlag(rest) : -1;
    if (at.name === "eval") texts.push(rest.join(" "));
    if (flag >= 0) texts.push(rest[flag + 1] ?? "");
    if (at.name !== "eval" && flag < 0) words.push(...rest.filter((w) => !w.startsWith("-")));
    if (at.name !== "eval")
      words.push(...s.redirects.filter((r) => r.op === "<").map((r) => r.target));
  }
  texts.push(...programStrings(s).texts.map((t) => t.text));
  const { i, raw, name } = nameOf(s);
  if (i >= 0 && raw.includes("/")) words.push(raw);
  // `open -a Terminal f` runs f.
  const rest = s.words.slice(i + 1);
  if (name === "open" && rest.some((w) => /^-[a-zA-Z]*a/.test(w))) words.push(...rest);
  return { words: words.map((w) => (w === "{}" ? w : w.split("/").pop())), texts };
}
/** A file's content substituted: `$(cat f)`, `$(<f)`, `` `cat f` ``; the file is group 1 or 2. */
const SUBSTITUTED_FILE =
  /\$\(\s*(?:cat\s+(?:-\S+\s+)*)?<?\s*['"]?([^\s'"()\x60]+)['"]?\s*\)|\x60\s*cat\s+(?:-\S+\s+)*['"]?([^\s'"()\x60]+)['"]?\s*\x60/g;
const substitutedTable = memoTable();
/** The basenames of the files `text` substitutes, with their offsets. */
const substitutedFiles = (text) =>
  cached(substitutedTable, text, () =>
    [...text.matchAll(SUBSTITUTED_FILE)].map((m) => [m.index, (m[1] ?? m[2]).split("/").pop()]),
  );

/**
 * Top-level simple commands of `c`: unquoted words with whether each holds an expansion (`dyn`) and where each
 * starts in `c` (`at`), redirections, whether any expansion (`$`, backtick, `<(…)`) sits outside single quotes
 * (`dynamic`), the operator after it and where that operator ends. Substitution bodies are kept whole inside their
 * word. `all` keeps the empty commands too, so every `(` and `)` operator shows.
 */
export const simpleCommands = (c, { all = false } = {}) =>
  cached(all ? commandsAllCache : commandsCache, c, () => splitCommands(c, all));
const commandsCache = memoTable();
const commandsAllCache = memoTable();
/** An empty command record for `splitCommands`. */
const freshCommand = () => ({
  words: [],
  dyn: [],
  at: [],
  raw: [],
  redirects: [],
  dynamic: false,
  op: "",
  end: 0,
});

function splitCommands(c, all) {
  const out = [];
  let lessEnv = false; // LESSOPEN / LESSCLOSE set in this or an earlier command of the line
  let cur = freshCommand();
  let word = null;
  let raw = null; // the word with its double-quoted bodies as written, for re-quoting it (`dequoted`)
  let wordAt = 0;
  let wordDyn = false;
  let redirect = null;
  const end = () => {
    if (word === null) return;
    if (redirect) cur.redirects.push({ op: redirect, target: word, dynamic: wordDyn, raw });
    else {
      cur.words.push(word);
      cur.dyn.push(wordDyn);
      cur.at.push(wordAt);
      cur.raw.push(raw);
    }
    word = null;
    raw = null;
    wordDyn = false;
    redirect = null;
  };
  const add = (s, written = s) => {
    word = (word ?? "") + s;
    raw = (raw ?? "") + written;
  };
  const push = (op, at) => {
    end();
    redirect = null;
    lessEnv ||= cur.words.some((w) => /^LESS(?:OPEN|CLOSE)=/.test(w));
    out.push(Object.assign(cur, { op, end: at, lessEnv }));
    cur = freshCommand();
  };
  /** Index of the `)` closing the `(` at `k`, or the last index. */
  const closing = (k) => {
    for (let depth = 0, j = k; j < c.length; j++) {
      if (c[j] === "(") depth++;
      else if (c[j] === ")" && --depth === 0) return j;
    }
    return c.length - 1;
  };
  const dynamicPart = (from, to) => {
    cur.dynamic = true;
    wordDyn = true;
    add(c.slice(from, to + 1));
    return to;
  };
  for (let i = 0; i < c.length; i++) {
    const ch = c[i];
    if (word === null) wordAt = i;
    if (ch === "\\") add(c[++i] ?? "");
    else if (ch === "$" && c[i + 1] === "'" && ansiEnd(c, i + 2) < c.length) {
      // ANSI-C quoting (`$'gh'`, `$'\x67h'`) is a literal word with its escapes decoded (STA-330 review); an
      // unclosed one stays an expansion (deny-leaning).
      const j = ansiEnd(c, i + 2);
      add(ansiC(c.slice(i + 2, j)));
      i = j;
    } else if (ch === "'") {
      const j = c.indexOf("'", i + 1);
      const stop = j < 0 ? c.length : j;
      add(c.slice(i + 1, stop));
      i = stop;
    } else if (ch === '"') {
      let j = i + 1;
      while (j < c.length && c[j] !== '"') j += c[j] === "\\" ? 2 : 1;
      const text = c.slice(i + 1, j);
      if (/[$`]/.test(text)) {
        cur.dynamic = true;
        wordDyn = true;
      }
      add(doubleQuoted(text), text);
      i = j;
    } else if (ch === "`") {
      let j = i + 1;
      while (j < c.length && c[j] !== "`") j += c[j] === "\\" ? 2 : 1;
      i = dynamicPart(i, j);
    } else if (ch === "$") i = dynamicPart(i, c[i + 1] === "(" ? closing(i + 1) : i);
    else if ((ch === "<" || ch === ">") && c[i + 1] === "(") i = dynamicPart(i, closing(i + 1));
    else if (ch === "<" || ch === ">" || (ch === "&" && c[i + 1] === ">")) {
      const fd = word !== null && /^\d+$/.test(word) ? word : null;
      if (fd !== null) word = raw = null;
      else end();
      const op = /^(?:&>>?|<<<|<<-?|<>|<&|>&|>>|>\||<|>)/.exec(c.slice(i))[0];
      redirect = (fd ?? "") + op;
      i += op.length - 1;
    } else if (/[|&;\n()]/.test(ch)) {
      const two = c.slice(i, i + 2);
      const op = ["||", "&&", ";;", "|&"].includes(two) ? two : ch;
      i += op.length - 1;
      push(op === "|&" ? "|" : op, i + 1);
    } else if (/\s/.test(ch)) end();
    else add(ch);
  }
  push("", c.length);
  return all ? out : out.filter((s) => s.words.length || s.redirects.length);
}

/**
 * A double-quoted body as the shell passes it: the backslash before `\`, `"`, `$` and a backtick dropped, so a
 * line quoted inside a quoted line (`sh -c "sh -c \"rm -rf ~\""`) reads as it runs (STA-330 review round 5).
 */
const doubleQuoted = (text) => text.replaceAll(/\\([\\"$`])/g, "$1");
/** Where the `$'…'` body that starts at `j` closes (`\'` escapes a quote), or `c.length`. */
function ansiEnd(c, j) {
  while (j < c.length && c[j] !== "'") j += c[j] === "\\" ? 2 : 1;
  return j;
}
const ANSI_ESCAPES = {
  a: "\x07",
  b: "\b",
  e: "\x1b",
  E: "\x1b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
};
/** The text of a `$'…'` body: `\xHH`, `\uHHHH`, `\UHHHHHHHH`, octal, `\cX` and the letter escapes decoded. */
const ansiC = (s) =>
  s.replaceAll(
    /\\(?:x([0-9a-fA-F]{1,2})|u([0-9a-fA-F]{1,4})|U([0-9a-fA-F]{1,8})|([0-7]{1,3})|c(.)|(.))/gs,
    (_, x, u, big, oct, ctl, ch) => {
      const code = x ?? u ?? big;
      if (code) return String.fromCodePoint(Math.min(parseInt(code, 16), 0x10_ff_ff));
      if (oct) return String.fromCodePoint(parseInt(oct, 8) & 0xff);
      if (ctl) return String.fromCodePoint(ctl.codePointAt(0) & 31);
      return ANSI_ESCAPES[ch] ?? ch;
    },
  );

/**
 * Index of the command name: past assignments, shell keywords and wrappers (`env -i A=1`, `nice -n 5`,
 * `timeout 5`, `busybox`). -1 when a wrapper builds the command from a string (`env -S`).
 */
export function commandAt(words) {
  let i = 0;
  let wrapped = false;
  while (i < words.length) {
    const w = words[i];
    if (WRAPPERS.has(w.split("/").pop())) {
      wrapped = true;
      i++;
    } else if (PREFIX.has(w) || /^\w+=/.test(w)) i++;
    else if (wrapped && w.startsWith("-")) {
      if (/^-(?:\w*S|-split-string)/.test(w)) return -1;
      i += WRAPPER_VALUE.has(w) ? 2 : 1;
    } else if (wrapped && /^\d+(?:\.\d+)?[smhd]?$/.test(w)) i++;
    else break;
  }
  return i;
}

/** The command name of a simple command: its index, raw word and basename. */
const nameOf = (s) => {
  const i = commandAt(s.words);
  const raw = i < 0 ? "$" : (s.words[i] ?? "");
  return { i, raw, name: raw.split("/").pop() };
};

/** Index of a shell's `-c` flag (`-c`, `-lc`) in `words`, or -1. */
const commandFlag = (words) => words.findIndex((w) => /^-[a-z]*c[a-z]*$/i.test(w));
/** Commands that only read their input, never run it, unless `READER_RUNS` says this use does. */
const READERS = new Set(
  "grep egrep fgrep rg jq sort uniq wc head tail cat less more cut tr tee sed awk gawk column nl base64 tac rev".split(
    " ",
  ),
);
/**
 * True when a sed program uses only commands that never run, read or write anything: addresses (`N`, `$`,
 * `first~step`, `/re/` or `\cREc` with `I`/`M`, ranges with `,` `+N` `~N`, `!`), `p d q Q n N = l D P h H g G x
 * z`, `s` without the `e` / `w` flags, `y`, `a i c` text, `b t T :label` and `{ }`. Anything else, unparsed
 * forms included, counts as running (fail closed: GNU `e`, `s///e`, `w`, `W`, `r`, `R`).
 */
function sedSafe(prog) {
  let k = 0;
  const at = (re) => re.test(prog[k] ?? "");
  const address = () => {
    if (at(/\d/)) {
      while (at(/[\d~]/)) k++;
      return true;
    }
    if (at(/\$/)) return ++k > 0;
    if (!at(/[/\\]/)) return true; // no address
    const d = prog[k] === "\\" ? prog[++k] : "/";
    for (k++; k < prog.length && prog[k] !== d; k++) if (prog[k] === "\\") k++;
    if (k++ >= prog.length) return false;
    while (at(/[IM]/)) k++;
    return true;
  };
  for (;;) {
    while (at(/[\s;}]/)) k++;
    if (k >= prog.length) return true;
    if (!address()) return false;
    if (at(/,/)) {
      k++;
      if (at(/[+~]/)) k++;
      if (!address()) return false;
    }
    while (at(/[ \t]/)) k++;
    if (at(/!/)) k++;
    while (at(/[ \t]/)) k++;
    const c = prog[k++];
    if (c === "{") continue;
    if (c && "pdqQnN=lDPhHgGxz".includes(c)) while (at(/[\d \t]/)) k++;
    else if (c && "btT:".includes(c)) while (k < prog.length && !at(/[;\n}]/)) k++;
    else if (c && "aic".includes(c))
      // text to the end of the line; a line ending in `\` continues it
      for (; k < prog.length && !(at(/\n/) && prog[k - 1] !== "\\");) k++;
    else if (c === "s" || c === "y") {
      const d = prog[k++];
      if (!d || /[\s\\\n]/.test(d)) return false;
      for (let seen = 0; seen < 2; k++) {
        if (k >= prog.length) return false;
        if (prog[k] === "\\") k++;
        else if (prog[k] === d) seen++;
      }
      if (c === "s") while (at(/[gpiImM0-9]/)) k++;
    } else return false;
    if (k < prog.length && !at(/[\s;}]/)) return false;
  }
}
/** Compressors `sort --compress-program` may name without running anything else. */
const COMPRESSORS = new Set(["gzip", "pigz", "zstd", "xz", "lz4", "bzip2", "pbzip2", "lzop"]);
/** Reader uses that run a command (`words` are the whole command): then the reader counts as a shell. */
const READER_RUNS = {
  sort: (words) =>
    words.some((w, j) => {
      const [flag, ...value] = w.split("=");
      if (!(flag.length > 4 && flag.startsWith("--com") && "--compress-program".startsWith(flag)))
        return false;
      const program = (value.length ? value.join("=") : (words[j + 1] ?? "")).split("/").pop();
      return !COMPRESSORS.has(program);
    }),
  rg: (words) => words.some((w) => /^--pre(?:=|$)/.test(w)),
  less: (words, s) =>
    s.lessEnv || words.some((w) => /^LESS(?:OPEN|CLOSE)=/.test(w) || w.includes("!")),
  awk: (words) => words.some((w) => /^(?:-[a-zA-Z]*[fE]|--file|--exec)|system|getline|\|/.test(w)),
  sed: (words) => {
    const programs = [];
    for (let j = 1; j < words.length; j++) {
      const w = words[j];
      if (/^(?:-[a-zA-Z]*f|--file)/.test(w)) return true;
      if (/^-[a-zA-Z]*e$|^--expression$/.test(w)) programs.push(words[++j] ?? "");
      else if (w.startsWith("--expression=")) programs.push(w.slice(13));
    }
    if (!programs.length) programs.push(words.slice(1).find((w) => !w.startsWith("-")) ?? "");
    return !programs.every(sedSafe);
  },
};
READER_RUNS.gawk = READER_RUNS.awk;

/**
 * Commands that never run their operands: the shell-word fallback skips them (`cp -r source "$DEST"`). Options
 * that do run a program (`tar -I`, `rsync -e`, `git rebase -x`) are read by `programStrings`.
 */
const NEVER_RUNS = new Set(
  "cp mv rm ls mkdir rmdir touch ln chmod chown tar zip unzip rsync scp git gh cat echo printf diff wc file stat du df open code cd pushd".split(
    " ",
  ),
);
/** Package managers: built-in subcommands, and options whose value is the next word. */
const PACKAGE_MANAGERS = new Set(["pnpm", "npm", "yarn", "bun"]);
const PACKAGE_BUILTINS = new Set(
  "install i add remove rm uninstall un run run-script test t build lint verify why list ls outdated update up upgrade publish pack audit info view config store prune rebuild link unlink init".split(
    " ",
  ),
);
const PACKAGE_VALUE = new Set([
  "--filter",
  "-F",
  "-C",
  "--dir",
  "--prefix",
  "-w",
  "--workspace",
  "--cwd",
]);
/**
 * True when a package manager only runs a package script or a built-in: no word is `exec`, `dlx`, `x`,
 * `create` or a shell, and the first non-option word is a built-in. pnpm and yarn run an unknown first word
 * like `exec` (`pnpm sh -c …`), so anything else is not exempt.
 */
function packageScriptOnly(words) {
  if (
    words.some((w) => ["exec", "dlx", "x", "create"].includes(w) || SHELL.test(w.split("/").pop()))
  )
    return false;
  for (let j = 0; j < words.length; j++) {
    if (words[j] === "--") return false;
    if (!words[j].startsWith("-")) return PACKAGE_BUILTINS.has(words[j]);
    if (PACKAGE_VALUE.has(words[j])) j++;
  }
  return true;
}
/** xargs options whose value is the next word. */
export const XARGS_VALUE = new Set(["-I", "-n", "-L", "-P", "-s", "-d", "-E", "-a", "-l"]);
/** Words after which the next word is the command run (`pnpm exec "$X"`, `find -exec "$X"`). */
const RUNS_NEXT = new Set(["exec", "dlx", "x", "-exec", "-execdir", "-ok", "-okdir"]);

/** Options whose value is a command line the program runs, per program (`short` flags may be clustered). */
const PROGRAM_OPTIONS = {
  tar: {
    short: "I",
    long: [
      "--use-compress-program",
      "--to-command",
      "--rsh-command",
      "--info-script",
      "--new-volume-script",
    ],
    exec: ["--checkpoint-action"],
  },
  rsync: { short: "e", long: ["--rsh", "--rsync-path"] },
  scp: { short: "S", ssh: true },
  sftp: { short: "S", ssh: true },
  ssh: { ssh: true },
  zip: { long: ["--unzip-command"], tt: true },
};
/** ssh options that run a local command (`-o ProxyCommand=…`). */
const SSH_LOCAL = /^\s*(?:ProxyCommand|LocalCommand|KnownHostsCommand)\s*[= ]\s*(.*)$/is;
/** The long option `flag` names, allowing GNU unique prefixes (`--to-com` for `--to-command`). */
const longOption = (flag, list = []) => flag.length > 3 && list.some((l) => l.startsWith(flag));

/** Push every program-running option value in `args` (with its `dyn` flag) through `add`. */
function optionPrograms(args, dyn, spec, add) {
  for (let j = 0; j < args.length; j++) {
    const w = args[j];
    if (w === "--") break;
    if (w.startsWith("--")) {
      const eq = w.indexOf("=");
      const flag = eq < 0 ? w : w.slice(0, eq);
      const isLong = longOption(flag, spec.long);
      if (!isLong && !longOption(flag, spec.exec)) continue;
      const value = eq < 0 ? (args[j + 1] ?? "") : w.slice(eq + 1);
      const dynamic = eq < 0 ? dyn[j + 1] : dyn[j];
      if (eq < 0) j++;
      if (isLong) add(value, dynamic);
      else if (value.startsWith("exec=")) add(value.slice(5), dynamic);
    } else if (spec.tt && w.startsWith("-TT")) {
      const attached = w.slice(3).replace(/^=/, "");
      add(attached || (args[++j] ?? ""), attached ? dyn[j] : dyn[j]);
    } else if (/^-[^-]/.test(w))
      for (let k = 1; k < w.length; k++) {
        if (w[k] !== spec.short && !(spec.ssh && w[k] === "o")) continue;
        const attached = w.slice(k + 1);
        const value = attached || (args[j + 1] ?? "");
        const dynamic = attached ? dyn[j] : dyn[j + 1];
        if (!attached) j++;
        if (w[k] !== "o") add(value, dynamic);
        else {
          const m = SSH_LOCAL.exec(value);
          if (m) add(m[1], dynamic);
        }
        break;
      }
  }
}

/** git global options whose value is the next word. */
const GIT_VALUE_OPTIONS = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--super-prefix",
]);
/**
 * Command lines git runs: `bisect run`, `submodule foreach`, `rebase -x`, `grep -O`, `difftool -x`,
 * `filter-branch --*-filter` / `--setup`. `mergetool` and `difftool` without `-x` run a configured tool
 * (unknown).
 */
function gitPrograms(args, dyn, add) {
  let j = 0;
  while (j < args.length && args[j].startsWith("-")) j += GIT_VALUE_OPTIONS.has(args[j]) ? 2 : 1;
  const sub = args[j];
  const rest = args.slice(j + 1);
  const rdyn = dyn.slice(j + 1);
  const command = (from) => {
    while (from < rest.length && rest[from].startsWith("-")) from++;
    add(rest.slice(from).join(" "), rdyn.slice(from).some(Boolean));
  };
  if (sub === "bisect" && rest[0] === "run") command(1);
  else if (sub === "submodule" && rest.includes("foreach")) command(rest.indexOf("foreach") + 1);
  else if (sub === "rebase") optionPrograms(rest, rdyn, { short: "x", long: ["--exec"] }, add);
  else if (sub === "grep")
    rest.forEach((w, k) => {
      const m = /^-O(.+)$/s.exec(w) ?? /^--open-files[a-z-]*=(.*)$/s.exec(w);
      if (m) add(m[1], rdyn[k]);
    });
  else if (sub === "difftool") {
    let found = false;
    optionPrograms(rest, rdyn, { short: "x", long: ["--extcmd"] }, (v, d) => {
      found = true;
      add(v, d);
    });
    if (!found) return true;
  } else if (sub === "mergetool") return true;
  else if (sub === "filter-branch")
    optionPrograms(
      rest,
      rdyn,
      {
        long: [
          "--env-filter",
          "--tree-filter",
          "--index-filter",
          "--parent-filter",
          "--msg-filter",
          "--commit-filter",
          "--tag-name-filter",
          "--setup",
        ],
      },
      add,
    );
  // `--upload-pack`, `--receive-pack`, `--exec` (and clone's `-u`) name the program run for the remote end.
  else if (["fetch", "pull", "ls-remote", "clone", "push", "archive"].includes(sub))
    optionPrograms(
      rest,
      rdyn,
      { short: sub === "clone" ? "u" : "", long: ["--upload-pack", "--receive-pack", "--exec"] },
      add,
    );
  return false;
}

/** True when git `args` (global options, the subcommand, its arguments) run a command line or a configured tool. */
export function gitRunsProgram(args) {
  let found = false;
  return (
    gitPrograms(
      args,
      args.map(() => false),
      () => (found = true),
    ) || found
  );
}

/**
 * Command lines a simple command runs from option values, not words: `env -S '…'` (any position), the
 * `PROGRAM_OPTIONS` values (`tar -I`, `rsync -e`, `scp -S`, `ssh -o ProxyCommand=`, `zip -TT`) and git's
 * (`gitPrograms`). `texts` are checked like `sh -c` strings; `unknown` when git runs a configured tool.
 */
function programStrings(s) {
  const texts = [];
  const add = (text, dynamic) => texts.push({ text, dynamic: Boolean(dynamic) });
  const env = s.words.findIndex((w) => w.split("/").pop() === "env");
  if (env >= 0)
    for (let k = env + 1; k < s.words.length && /^-|^\w+=/.test(s.words[k]); k++) {
      const w = s.words[k];
      const short = /^-[a-zA-Z]*S(.*)$/s.exec(w);
      const eq = w.indexOf("=");
      const long =
        w.startsWith("--") && longOption(eq < 0 ? w : w.slice(0, eq), ["--split-string"]);
      if (!short && !long) continue;
      const attached = short ? short[1] : eq < 0 ? "" : w.slice(eq + 1);
      add(attached || (s.words[k + 1] ?? ""), attached ? s.dyn[k] : s.dyn[k + 1]);
      break;
    }
  const { i, name } = nameOf(s);
  if (i < 0) return { texts, unknown: false };
  const args = s.words.slice(i + 1);
  const dyn = s.dyn.slice(i + 1);
  if (PROGRAM_OPTIONS[name]) optionPrograms(args, dyn, PROGRAM_OPTIONS[name], add);
  const unknown = name === "git" && gitPrograms(args, dyn, add);
  return { texts, unknown };
}

/**
 * Where a simple command runs a shell (`sh`, `csh`, `bash5`, …), `eval`, `source` or `.`: `j` indexes `s.words`.
 * Fast path: the command name past the known wrappers. Otherwise fail closed: any later word naming a shell,
 * `eval` or `source` (`caffeinate sh`, `pnpm exec bash`, `find . -exec sh {} \;`), or a computed word that may
 * be one (`caffeinate $SHELL`, name `$`), unless the command is a known reader or never runs its operands
 * (`grep -c sh`, `cp source "$DEST"`, `pnpm lint --rule source`). `xargs` is judged by the command it runs. A
 * reader that does run (`sed e`, `sort --compress-program`) reports itself, so its input counts as unreadable.
 */
function shellAt(s, depth = 0) {
  const { i, name } = nameOf(s);
  if (i < 0) return null;
  if (SHELL.test(name) || ["eval", "source", "."].includes(name)) return { j: i, name };
  const after = s.words.slice(i + 1);
  if (READERS.has(name))
    return READER_RUNS[name]?.([name, ...after, ...s.words.slice(0, i)], s)
      ? { j: s.words.length - 1, name: "sh", reader: true }
      : null;
  if (NEVER_RUNS.has(name)) return null;
  let from = i + 1;
  if (name === "xargs") {
    // A chain of xargs past 8 is unreadable: each level copies the words, and a long chain overflowed the stack,
    // which fails open (STA-330 review).
    if (depth >= 8) return { j: s.words.length - 1, name: "sh", reader: true };
    while (from < s.words.length && s.words[from].startsWith("-"))
      from += XARGS_VALUE.has(s.words[from]) ? 2 : 1;
    const inner = shellAt({ ...s, words: s.words.slice(from), dyn: s.dyn.slice(from) }, depth + 1);
    return inner && { ...inner, j: inner.j + from };
  }
  if (PACKAGE_MANAGERS.has(name) && packageScriptOnly(after)) return null;
  // A computed word counts only where the wrapped command goes: the first operand, or after `exec`.
  const first = s.words.findIndex((w, j) => j >= from && !w.startsWith("-"));
  for (let j = from; j < s.words.length; j++) {
    const b = s.words[j].split("/").pop();
    if (SHELL.test(b) || b === "eval" || b === "source") return { j, name: b };
    const wrapped = j === first || RUNS_NEXT.has(s.words[j - 1]);
    if (wrapped && s.dyn[j] && /^[$`]/.test(s.words[j])) return { j, name: "$" };
  }
  return null;
}

/** True when a simple command runs its standard input as a script: a shell without `-c`, `source`, `.`. */
function readsStdin(s) {
  const at = shellAt(s);
  if (!at || at.name === "eval") return false;
  return at.reader || !shellLike(at.name) || commandFlag(s.words.slice(at.j + 1)) < 0;
}

/**
 * What simple command `k` prints when the guard can read it: `echo` / `printf` of literal words, `cat` or `tee`
 * of a heredoc ("": a run heredoc's body is already scanned as commands), a here-string, or the pipe into it.
 * Null when unknown: another command, an expansion, a `printf` directive other than `%s` / `%b` / `%%` or more
 * arguments than the format takes once, or an escape other than `\n` / `\t`.
 */
function output(list, k) {
  const s = list[k];
  const { i, name } = nameOf(s);
  if (s.dynamic && name !== "tee") return null; // tee's operands do not change what it prints
  const args = s.words.slice(i + 1);
  const stdin = () => {
    const h = s.redirects.find((r) => r.op.startsWith("<<"));
    if (h) return h.op === "<<<" ? h.target : "";
    return k > 0 && list[k - 1].op === "|" ? output(list, k - 1) : null;
  };
  let text;
  if (i < 0) return null;
  if (name === "echo")
    text = args.filter((a, j) => !args.slice(0, j + 1).every((f) => /^-[neE]+$/.test(f))).join(" ");
  else if (name === "printf") {
    const [format = "", ...rest] = args[0] === "--" ? args.slice(1) : args;
    if (format === "-v") return "";
    const directives = format.replaceAll("%%", "").match(/%./g) ?? [];
    if (directives.some((d) => !/^%[sb]$/.test(d)) || rest.length > directives.length) return null;
    text = format
      .replaceAll("%%", "\0")
      .replaceAll(/%[sb]/g, () => rest.shift() ?? "")
      .replaceAll("\0", "%");
  } else if ((name === "cat" && !args.length) || name === "tee") return stdin();
  else return null;
  const plain = text.replaceAll(/\\[nt]/g, "\n");
  return /\\/.test(plain) ? null : plain;
}

/** What the last command of `body` prints, when readable (`<(…)` and `$(…)` bodies). */
const lastOutput = (body) => {
  const list = simpleCommands(body);
  return list.length ? output(list, list.length - 1) : "";
};
/** The body of a word that is exactly one `$(…)`, `<(…)` or backtick substitution, else null. */
const substitutionBody = (w) =>
  /^(?:[$<]\((.*)\)|`(.*)`)$/s
    .exec(w)
    ?.slice(1)
    .find((b) => b !== undefined) ?? null;

/**
 * Text a shell runs from a pipe, a process substitution, a substituted string or a file written earlier in the
 * same command line (STA-291): `echo '…' | sh`, `printf … | bash`, `sh <(echo …)`, `tee >(sh)`,
 * `eval "$(echo …)"`, `echo … > f && sh f`, `cat > f <<EOF … EOF; ./f`. `scripts` is the readable text;
 * `opaque` is true when a shell runs text the guard cannot read (`curl … | sh`, `cat x | sh`, `… | $SHELL`,
 * `… | xargs sh`, `eval "$x"`, `sh -c "$(curl …)"`, `cmd > f; sh f`).
 */
export function shellInputs(c) {
  const list = simpleCommands(c);
  const scripts = [];
  const known = new Set(); // written files whose content was read here
  let opaque = false;
  const take = (text) => (text === null ? (opaque = true) : scripts.push(text));
  /** A word's text when readable: literal, the toolchain's own setup, one readable substitution, or a read file. */
  const resolveWord = (word, dynamic) => {
    if (!dynamic) return word;
    const body = substitutionBody(word);
    if (body === null) return null;
    if (TRUSTED.test(body)) return "";
    const read = lastOutput(body);
    if (read !== null) return read;
    const file = /^\s*(?:cat\s+)?<?\s*(\S+)\s*$/.exec(body)?.[1];
    return file &&
      known.has(
        file
          .replace(/^(["'])(.*)\1$/, "$2")
          .split("/")
          .pop(),
      )
      ? ""
      : null;
  };
  /** One script from its words (`eval` joins them all): checked once, unreadable if any part is. */
  const script = (parts) =>
    parts.some((p) => p === null) ? (opaque = true) : scripts.push(parts.join(" "));
  list.forEach((s, k) => {
    const { i, raw, name } = nameOf(s);
    const at = shellAt(s);
    const runner = at && !at.reader ? at.name : "";
    const words = at && !at.reader ? s.words.slice(at.j + 1) : [];
    const dyn = at && !at.reader ? s.dyn.slice(at.j + 1) : [];
    const piped = k > 0 && list[k - 1].op === "|";
    const shell = shellLike(runner);
    const sourced = shell || runner === "source" || runner === ".";
    const xargsShell = name === "xargs" && at !== null;
    // A reader that runs commands (`sed e`, `awk '{system(…)}'`, `sort --compress-program`): what it runs is
    // built from its program and input, so it cannot be read.
    if (at?.reader || (piped && (i < 0 || /[$`]/.test(raw) || xargsShell))) opaque = true;
    // Readable input to an executing reader is checked too, so a forbidden command still denies.
    if (at?.reader && piped) {
      const text = output(list, k - 1);
      if (text !== null) scripts.push(text);
    } else if (piped && readsStdin(s)) take(output(list, k - 1));
    // A shell reading a process substitution: `sh <(…)`, `sh < <(…)`.
    if (sourced)
      for (const w of [...words, ...s.redirects.filter((r) => r.op === "<").map((r) => r.target)])
        if (w.startsWith("<(")) {
          const body = substitutionBody(w) ?? "";
          take(TRUSTED.test(body) ? "" : lastOutput(body));
        }
    // Output sent into a shell through `>(sh)`: `tee >(sh)`, `echo … > >(bash)`.
    for (const w of [...s.words, ...s.redirects.map((r) => r.target)]) {
      const body = w.startsWith(">(") ? substitutionBody(w.replace(/^>/, "<")) : null;
      const first = body === null ? undefined : simpleCommands(body)[0];
      if (first && readsStdin(first)) take(output(list, k));
    }
    // Command lines in option values: `tar -I '…'`, `git rebase -x '…'`, `env -S '…'`.
    const programs = programStrings(s);
    if (programs.unknown) opaque = true;
    for (const t of programs.texts) script([resolveWord(t.text, t.dynamic)]);
    // Script strings built at run time.
    if (runner === "eval") script(words.map((w, j) => resolveWord(w, dyn[j])));
    const flag = shell ? commandFlag(words) : -1;
    if (flag >= 0 && flag + 1 < words.length) script([resolveWord(words[flag + 1], dyn[flag + 1])]);
    if (sourced) {
      for (const r of s.redirects) if (r.op === "<<<") script([resolveWord(r.target, r.dynamic)]);
      // A script file named at run time (`sh "$F"`, `sh $(echo f)`); `$HOME` alone is fine.
      if (flag < 0 && runner !== "$")
        words.forEach((w, j) => {
          if (dyn[j] && !/^[<>]\(/.test(w) && /[$`]/.test(w.replaceAll(/\$\{?HOME\}?(?!\w)/g, "")))
            opaque = true;
        });
    }
    // A file written here and run later in the line.
    const targets = s.redirects
      .filter((r) => /^1?(?:>>?|>\||&>>?)$/.test(r.op))
      .map((r) => r.target);
    if (name === "tee") targets.push(...s.words.slice(i + 1).filter((w) => !/^[-<>]/.test(w)));
    for (const t of targets) {
      const base = t.split("/").pop();
      if (!runsFile(c, base, s.end)) continue;
      const text = output(list, k);
      take(text);
      if (text !== null) known.add(base);
    }
  });
  return { scripts, opaque };
}

/**
 * True when `c` or any command nested in it (substitution bodies found with quotes ignored, script strings) runs
 * text the guard cannot read (`shellInputs(…).opaque`). Bodies are taken raw, never quote-blanked, so a blanked
 * `''` is not mistaken for an unknown script.
 */
export const runsOpaque = (c) =>
  cached(opaqueCache, c, () => {
    // Script strings nested past 8 levels are not read: unreadable, so opaque (STA-330 review).
    if (opaqueDepth >= 8) return true;
    opaqueDepth++;
    try {
      // `rawSubstitutions` already holds every depth: recursing into each body too was exponential.
      return [c, ...rawSubstitutions(c)].some(
        (t) => shellInputs(t).opaque || scriptStrings(t).some(runsOpaque),
      );
    } finally {
      opaqueDepth--;
    }
  });
const opaqueCache = memoTable();
let opaqueDepth = 0;

/**
 * The safety net (STA-254): every `$(…)`, `<(…)`, `>(…)` and backtick body at any depth, found by balanced
 * parentheses while ignoring every quote. Only for deny rules: it can add a deny, never an allow. Accepted false
 * positive: a dangerous command written literally inside real single quotes (`echo '$(git push origin main)'`).
 */
export function rawSubstitutions(raw) {
  const c = raw.replaceAll("\\\n", ""); // backslash-newline goes first, quotes or not
  const out = [];
  for (let i = 0; i < c.length; i++) {
    if (c[i] === "\\") i++;
    else if ("$<>".includes(c[i]) && c[i + 1] === "(") {
      let depth = 1;
      let j = i + 2;
      for (; j < c.length && depth > 0; j++) {
        if (c[j] === "\\") j++;
        else if (c[j] === "(") depth++;
        else if (c[j] === ")") depth--;
      }
      out.push(c.slice(i + 2, depth === 0 ? j - 1 : c.length));
    } else if (c[i] === "`") {
      let j = i + 1;
      while (j < c.length && c[j] !== "`") j += c[j] === "\\" ? 2 : 1;
      out.push(c.slice(i + 1, j));
      i = j;
    }
  }
  return out;
}

/** Split a command into segments of words; each word is its unquoted text. Separators outside quotes split. */
function lex(cmd) {
  const segs = [[]];
  let word = null;
  const end = () => {
    if (word !== null) segs.at(-1).push(word);
    word = null;
  };
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (c === "'" || c === '"') {
      const close = cmd.indexOf(c, i + 1);
      const stop = close === -1 ? cmd.length : close;
      word = (word ?? "") + cmd.slice(i + 1, stop);
      i = stop;
    } else if (c === "\\" && i + 1 < cmd.length) word = (word ?? "") + cmd[++i];
    else if (/\s/.test(c) && c !== "\n") end();
    else if (/[;&|\n()`]/.test(c)) {
      end();
      if (segs.at(-1).length) segs.push([]);
    } else word = (word ?? "") + c;
  }
  end();
  return segs.filter((s) => s.length);
}

/** Words before the command name: assignments, wrappers and shell keywords. */
const PREFIX = new Set([
  "sudo",
  "command",
  "exec",
  "time",
  "nohup",
  "do",
  "then",
  "else",
  "!",
  "{",
]);

/**
 * Per command: which flags take a value (`value`, kept as a possible path), a pattern (`pattern`), a program
 * (`program`) or a file to read (`file`, a path); and what the first positional is when no flag gave it.
 * Booleans (grep `-v`, `-F`, `-r`; sed `-n`) are not listed, so the word after them is not swallowed.
 */
const GREP = {
  value: [
    "-A",
    "-B",
    "-C",
    "-m",
    "-d",
    "-D",
    "--include",
    "--exclude",
    "--exclude-dir",
    "--max-count",
  ],
  pattern: ["-e", "--regexp"],
  file: ["-f", "--file"],
  first: "pattern",
};
const AWK = { value: ["-F", "-v"], file: ["-f"], first: "program" };
const COMMANDS = {
  grep: GREP,
  egrep: GREP,
  fgrep: GREP,
  rg: {
    ...GREP,
    value: ["-A", "-B", "-C", "-m", "-g", "--glob", "-t", "--type", "-T", "--type-not", "-j", "-M"],
  },
  ag: { value: ["-A", "-B", "-C", "-m", "-G"], first: "pattern" },
  sed: { program: ["-e", "--expression"], file: ["-f", "--file"], first: "program" },
  awk: AWK,
  gawk: AWK,
  perl: { program: /^-[a-zA-Z]*[eE]$/, first: "path" }, // `-e`, `-ne`, `-lne`; else the first word is a script
  // fd's first positional is its pattern; the paths follow (none: the current directory).
  fd: {
    value: [
      "-e",
      "--extension",
      "-t",
      "--type",
      "-E",
      "--exclude",
      "-d",
      "--max-depth",
      "-S",
      "--size",
    ],
    first: "pattern",
  },
};
/** Flags whose value is prose (an issue title, a commit message), never a path, unless it runs a command. */
const PROSE_FLAG = /^(?:--title|--body|--message|-m)$/;
const PROSE_EQ = /^(?:--title|--body|--message)=/;
const RUNS = /\$\(|`/;
const LITERAL = /secrets-inbox|secrets-confirm\.key/i;
const URL = /^[a-z][a-z0-9+.-]*:\/\//i;
const RECURSIVE =
  /\b(?:rg|ag|find|tar|zip|rsync|du)\b|\bgrep\b.*\s(?:-\w*[rR]\w*|--recursive|--directories=recurse|-d\s*recurse)\b|\bcp\b.*\s(?:-\w*[rRa]\w*|--recursive|--archive)\b/;
const has = (list, w) => (list instanceof RegExp ? list.test(w) : (list ?? []).includes(w));

/**
 * Sort a segment's words: `paths` are checked as paths (literal name, home-rooted globs, recursive reads);
 * `texts` (programs, and prose that runs a command) only for the literal name; exempt: a grep/rg/ag pattern
 * and plain prose values. A pattern that starts with `~` or `$` is checked as a path.
 */
function classify(words) {
  let i = 0;
  while (i < words.length && (PREFIX.has(words[i]) || /^\w+=/.test(words[i]))) i++;
  const name = (words[i] ?? "").split("/").pop();
  const spec = COMMANDS[name];
  // `[pnpm] linear comment <KEY> "…"`: the text after the key is prose.
  const at = name === "linear" ? i : words[i + 1] === "linear" ? i + 1 : -1;
  const proseFrom = at >= 0 && words[at + 1] === "comment" ? at + 3 : Infinity;
  const paths = words.slice(0, i + 1); // assignment values (`x=~/…`) are paths too
  const texts = [];
  let firstSeen = false;
  const pattern = (v) => /^[~$]/.test(v) && paths.push(v);
  for (let j = i + 1; j < words.length; j++) {
    const w = words[j];
    if (j >= proseFrom) {
      if (RUNS.test(w)) paths.push(w);
    } else if (PROSE_FLAG.test(w) || PROSE_EQ.test(w)) {
      const v = PROSE_FLAG.test(w) ? (words[++j] ?? "") : w;
      if (RUNS.test(v)) paths.push(v);
    } else if (spec && has(spec.value, w)) paths.push(w, words[++j] ?? "");
    else if (spec && has(spec.file, w)) {
      paths.push(words[++j] ?? "");
      firstSeen = true;
    } else if (spec && has(spec.pattern, w)) {
      pattern(words[++j] ?? "");
      firstSeen = true;
    } else if (spec && has(spec.program, w)) {
      texts.push(words[++j] ?? "");
      firstSeen = true;
    } else if (spec && spec.first !== "path" && !firstSeen && !w.startsWith("-")) {
      firstSeen = true;
      if (spec.first === "pattern") pattern(w);
      else texts.push(w);
    } else paths.push(w);
  }
  return { name, paths, texts, operands: paths.slice(i + 1) };
}

/** A path word's tokens: split on shell punctuation, `@file` and `file://` prefixes dropped. */
const tokensOf = (w) =>
  w
    .split(/[\s=<>()+;|&`'"]+/)
    .map((t) => t.replace(/^@/, "").replace(/^file:\/\//i, ""))
    .filter(Boolean);

/**
 * True when a shell command could reach the inbox: a word (after unquoting) that names it, except a grep
 * pattern or plain prose; or a path token whose home-rooted glob or recursive read could match it. `cwd` is
 * the shell's directory; a `cd` moves it, and a recursive read with no path operand reads it.
 */
export function commandReachesInbox(cmd, { cwd, home = homedir() } = {}) {
  let dir = cwd;
  for (const words of lex(cmd)) {
    const { name, paths, texts, operands: args } = classify(words);
    if (texts.some((w) => LITERAL.test(w))) return true;
    // `mdfind` without `-onlyin` searches the whole Spotlight index, home included.
    if (name === "mdfind" && !args.some((w) => /^-onlyin$/i.test(w))) return true;
    const recursive =
      RECURSIVE.test(paths.join(" ")) ||
      ["tree", "fd", "mdfind"].includes(name) ||
      (name === "ls" && args.some((w) => /^-\w*R/.test(w)));
    const opts = { recursive, home, cwd: dir };
    const tokens = paths.flatMap(tokensOf);
    if (tokens.some((t) => (URL.test(t) ? LITERAL.test(t) : reachesInbox(t, opts)))) return true;
    // `cd ~ && rg x`, `du -a`: no path operand means the current directory.
    if (recursive && dir && !args.some((w) => !w.startsWith("-")) && reachesInbox(".", opts))
      return true;
    if (name === "cd" || name === "pushd") {
      const to = args.find((w) => !/^-[LP]$/.test(w)) ?? "~";
      const expanded = to.replace(/^(~|\$HOME|\$\{HOME\})(?=\/|$)/, home);
      dir =
        /^[~$]/.test(expanded) || (!expanded.startsWith("/") && !dir)
          ? undefined
          : resolve(dir ?? "/", expanded);
      // A `cd` chain past PATH_MAX is no real command, and resolving every word against it was quadratic.
      if (dir && dir.length > 4096) return true;
    }
  }
  return false;
}
