/**
 * Figentra Flow file contract:
 * Purpose: contract drift (FR-30, AC-33): each function a design declares in its interface blocks (a plan's
 *          `## Components`, a small spec's `## Design`) exists in a file of its component's folder trees with the same
 *          name, parameters and return; a missing or changed one, and an interface block nothing can be read from, is
 *          reported.
 * Boundary: pure; reads files only through the `read` callback; no git or network access.
 * Runtime: node
 * Governing contract: STA-1945 FR-30 (contracts), AC-33, P-034.
 * Secrets: none.
 */
import { strip } from "./spec-parse.mjs";
import { treePaths } from "./scope-drift.mjs";

/** Fence languages that declare no interface (FR-27): trees, diagrams, data, shell sessions and prose. */
const NOT_CODE = new Set(
  "|text|txt|plaintext|tree|mermaid|plantuml|dot|md|markdown|yaml|yml|json|jsonc|toml|ini|csv|sh|bash|zsh|shell|console|diff".split(
    "|",
  ),
);

/** Fence languages of a folder tree. */
const TREE = new Set(["text", "tree"]);

/** A function declaration's head up to its name: JavaScript and TypeScript, Python `def` and Go `func`. */
// shortcut: functions only; classes, types, consts and methods are not checked. Add a pattern when a design declares them.
const HEAD =
  /^[ \t]*(?:export[ \t]+(?:default[ \t]+)?)?(?:declare[ \t]+)?(?:async[ \t]+)?(?:function\*?|def|func(?:[ \t]*\([^)\n]*\))?)[ \t]+([A-Za-z_$][\w$]*)[ \t]*(?:<[^(\n]*>)?[ \t]*\(/gm;

/** Text without comments: `/* … *\/`, `//` and `#` lines. */
const uncomment = (/** @type {string} */ text) =>
  text.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/^[ \t]*(?:\/\/|#).*$/gm, "");

/** Whitespace and trailing commas do not change a signature. */
const norm = (/** @type {string} */ s) => s.replaceAll(/\s+/g, "").replaceAll(/,(?=[)\]}>])/g, "");

/**
 * The functions `text` declares: name → signature (`name(params)` and the return written after the parameters).
 * @param {string} text
 * @returns {Map<string, string>}
 */
export function declarations(text) {
  const src = uncomment(text);
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const m of src.matchAll(HEAD)) {
    const open = (m.index ?? 0) + m[0].length - 1;
    let depth = 0;
    let close = open;
    for (; close < src.length; close++) {
      if (src[close] === "(") depth++;
      else if (src[close] === ")" && --depth === 0) break;
    }
    // the return: the rest of the closing line, less the body opener (`{`, `{}`, `;` or Python's `:`)
    // shortcut: a return type wrapped over lines, or a body on the declaring line, reads as part of the return.
    const rest = src
      .slice(close + 1)
      .split("\n")[0]
      .replace(/\s*(?:\{\s*\}?|;|:)\s*$/, "")
      .trim();
    if (!out.has(m[1])) out.set(m[1], norm(`${m[1]}${src.slice(open, close + 1)}${rest}`));
  }
  return out;
}

/** The fenced blocks of `text`, each with its language. */
function blocks(/** @type {string} */ text) {
  return [
    ...text.matchAll(/^[ \t]*(`{3,}|~{3,})[ \t]*([^\s`]*)[^\n]*\n([\s\S]*?)^[ \t]*\1[ \t]*$/gm),
  ].map((m) => ({ lang: m[2].toLowerCase(), body: m[3] }));
}

/** The design parts: each `###` under `## Components` or `## Design`, or the section itself when it has none. */
function parts(/** @type {string} */ doc) {
  const found = [];
  for (const [, title, body] of strip(doc).matchAll(
    /^## (Components|Design)\b[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/gm,
  )) {
    const subs = [...body.matchAll(/^### (.+)\n([\s\S]*?)(?=^### |(?![\s\S]))/gm)];
    if (subs.length) for (const [, name, part] of subs) found.push({ name: name.trim(), part });
    else found.push({ name: title, part: body });
  }
  return found;
}

/**
 * FR-30, AC-33: the declared interfaces the code lacks or declares otherwise. A component's functions are looked up
 * in the files of its folder trees (a folder, glob or missing file is skipped); an interface block with code but no
 * function declaration is reported, never passed.
 * @param {string} plan a plan, or a small spec with its `## Design`
 * @param {(path: string) => string | undefined} read a repository-relative file's text, or undefined
 * @returns {string[]} declared interfaces missing or with another signature
 */
export function contractDrift(plan, read) {
  const problems = [];
  for (const { name, part } of parts(plan)) {
    const all = blocks(part);
    const files = all
      .filter((b) => TREE.has(b.lang))
      .flatMap((b) => treePaths(b.body.split("\n")))
      .filter((p) => !/[*{}]/.test(p) && !p.endsWith("/"))
      .flatMap((p) => {
        const text = read(p);
        return text === undefined ? [] : [{ path: p, found: declarations(text) }];
      });
    for (const [i, b] of all.entries()) {
      if (NOT_CODE.has(b.lang)) continue;
      const declared = declarations(b.body);
      if (!declared.size) {
        if (uncomment(b.body).trim())
          problems.push(
            `component \`${name}\`: interface block ${i + 1} (\`\`\`${b.lang}) declares no function that can be read (FR-30)`,
          );
        continue;
      }
      for (const [fn, sig] of declared) {
        const at = files.filter((f) => f.found.has(fn));
        if (!at.length)
          problems.push(
            `component \`${name}\` declares \`${fn}\`, which no file of its folder tree has (FR-30)`,
          );
        else if (!at.some((f) => f.found.get(fn) === sig))
          problems.push(
            `component \`${name}\` declares \`${sig}\`, but \`${at[0].path}\` has \`${at[0].found.get(fn)}\` (FR-30)`,
          );
      }
    }
  }
  return problems;
}
