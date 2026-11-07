/**
 * Figentra Flow file contract:
 * Purpose: a spec's questions, for `fflow mcp` (STA-2098 H4): the open ones (each `[NEEDS CLARIFICATION: …]` marker
 *   outside an HTML comment, and each `## Clarifications` question with no answer), the record of one answer (a
 *   `- Q: … → A: …` bullet under `### Session YYYY-MM-DD`, the matching marker replaced by the answer: the spec is the
 *   record), and a bounded search of the repository's specs, `docs/` and `.flow/` text.
 * Boundary: `openQuestions`, `recordAnswer` and `checkLine` are pure; `docsLookup` reads, never following a symbolic
 *   link; `writeAnswer` writes one file, only `<repo>/.agents/specs/<folder>/spec.md` as its real path, and
 *   nothing else.
 * Runtime: node
 * Governing contract: STA-2098 (PLAN section 10, H4).
 * Secrets: none.
 */
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { extname, join, relative, sep } from "node:path";

import { FLOW_DIR, SPECS_DEFAULT } from "./flow-dir.mjs";

/** One marker; its text is the question. */
const MARKER = /\[NEEDS CLARIFICATION:\s*([^\]\n]*?)\s*\]/g;

/** A refused input or an answer that cannot be recorded. */
export class QuestionError extends Error {}

/** `text` with each HTML comment (template guidance) blanked character for character, so offsets still match. */
const blankComments = (/** @type {string} */ text) =>
  text.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, " "));

/**
 * Why `value` cannot be one line of a spec (`what` names it), or undefined: it must be a non-empty string of at most
 * `max` characters, with no line break or other control character.
 * @param {unknown} value
 * @param {string} what
 * @param {number} [max]
 */
export function checkLine(value, what, max = 500) {
  if (typeof value !== "string" || !value.trim()) return `${what} must be a non-empty string`;
  if (value.length > max) return `${what} must be at most ${max} characters`;
  if ([...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127))
    return `${what} must be one line, with no control character`;
  return undefined;
}

/**
 * The open questions of a spec, each with its 1-based line.
 * @param {string} spec
 * @returns {{ markers: { line: number, question: string }[], unanswered: { line: number, question: string }[] }}
 */
export function openQuestions(spec) {
  /** @type {{ line: number, question: string }[]} */
  const markers = [];
  /** @type {{ line: number, question: string }[]} */
  const unanswered = [];
  let clarifications = false;
  for (const [i, line] of blankComments(spec).split("\n").entries()) {
    for (const m of line.matchAll(MARKER)) markers.push({ line: i + 1, question: m[1] });
    if (line.startsWith("## ")) clarifications = /^## Clarifications\s*$/.test(line);
    const q = clarifications ? line.match(/^\s*[-*] Q:\s*(.*?)\s*$/) : null;
    if (!q) continue;
    const [question, answer = ""] = q[1].split(/\s*→\s*A:\s*/);
    if (!answer.trim()) unanswered.push({ line: i + 1, question });
  }
  return { markers, unanswered };
}

/**
 * The spec with one answer recorded: the bullet `- Q: <question> → A: <answer>` at the end of `### Session <date>`
 * under `## Clarifications` (each made when missing: the section before the first `## ` heading, else at the end),
 * and the first live marker whose text is `marker` (else the question) replaced by the answer. The same bullet twice
 * in one session is recorded once.
 * @param {string} spec
 * @param {{ question: string, answer: string, date: string, marker?: string }} entry
 * @returns {{ text: string, replaced: boolean }}
 * @throws {QuestionError} when `marker` is given and no live marker has that text
 */
export function recordAnswer(spec, { question, answer, date, marker }) {
  let text = spec;
  const wanted = (marker ?? question).trim();
  const found = [...blankComments(text).matchAll(MARKER)].find((m) => m[1] === wanted);
  if (marker !== undefined && !found)
    throw new QuestionError(`the spec has no open [NEEDS CLARIFICATION: ${marker}]`);
  if (found?.index !== undefined)
    text = text.slice(0, found.index) + answer + text.slice(found.index + found[0].length);
  const lines = text.split("\n");
  /** The index before which to insert at the end of [from, to): past the trailing blank lines. */
  const endOf = (/** @type {number} */ from, /** @type {number} */ to) => {
    let at = to;
    while (at - 1 > from && !lines[at - 1].trim()) at -= 1;
    return at;
  };
  const next = (/** @type {number} */ from, /** @type {RegExp} */ heading) => {
    const at = lines.findIndex((l, i) => i > from && heading.test(l));
    return at < 0 ? lines.length : at;
  };
  let section = lines.findIndex((l) => /^## Clarifications\s*$/.test(l));
  if (section < 0) {
    const first = lines.findIndex((l) => l.startsWith("## "));
    if (first < 0) {
      section = endOf(-1, lines.length);
      lines.splice(section, 0, "", "## Clarifications");
      section += 1;
    } else {
      lines.splice(first, 0, "## Clarifications", "");
      section = first;
    }
  }
  const title = `### Session ${date}`;
  let session = lines.findIndex(
    (l, i) => i > section && i < next(section, /^## /) && l.trim() === title,
  );
  if (session < 0) {
    session = endOf(section, next(section, /^## /));
    lines.splice(session, 0, "", title);
    session += 1;
  }
  const bullet = `- Q: ${question} → A: ${answer}`;
  const end = next(session, /^#{1,3} /);
  if (!lines.slice(session + 1, end).includes(bullet)) {
    const at = endOf(session, end);
    const opening = at - 1 === session;
    lines.splice(at, 0, ...(opening ? ["", bullet] : [bullet]));
    // A heading right after the bullet gets its blank line back.
    const after = at + (opening ? 2 : 1);
    if ((lines[after] ?? "").startsWith("#")) lines.splice(after, 0, "");
  }
  return { text: lines.join("\n"), replaced: Boolean(found) };
}

/**
 * The real path of `<repo>/.agents/specs/<folder>/spec.md`, the one file `writeAnswer` writes.
 * @param {string} repo
 * @param {string} folder
 * @throws {QuestionError} when it is missing, not a file, or resolves anywhere else (a symbolic link on the way)
 */
export function specFile(repo, folder) {
  const file = join(repo, SPECS_DEFAULT, folder, "spec.md");
  if (!existsSync(file)) throw new QuestionError(`${file} does not exist`);
  const real = realpathSync(file);
  if (
    real !== join(realpathSync(repo), SPECS_DEFAULT, folder, "spec.md") ||
    !lstatSync(real).isFile()
  )
    throw new QuestionError(
      `${file} is not ${SPECS_DEFAULT}/${folder}/spec.md itself; refusing to write`,
    );
  return real;
}

/**
 * Records one answer in the spec (`recordAnswer`), written in place through a temporary file beside it.
 * @param {string} repo
 * @param {string} folder the spec's folder under `.agents/specs`
 * @param {{ question: string, answer: string, date: string, marker?: string }} entry
 * @returns {{ spec: string, session: string, recorded: boolean, replaced: boolean }}
 * @throws {QuestionError} as `specFile`, `checkLine` and `recordAnswer` refuse
 */
export function writeAnswer(repo, folder, entry) {
  const problem = checkLine(entry.answer, "answer");
  if (problem) throw new QuestionError(problem);
  if (entry.answer.includes("[NEEDS CLARIFICATION"))
    throw new QuestionError("answer must not be another [NEEDS CLARIFICATION] marker");
  const file = specFile(repo, folder);
  const before = readFileSync(file, "utf8");
  const { text, replaced } = recordAnswer(before, entry);
  if (text !== before) {
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, text);
    renameSync(temporary, file);
  }
  return {
    spec: `${SPECS_DEFAULT}/${folder}/spec.md`,
    session: entry.date,
    recorded: text !== before,
    replaced,
  };
}

/** Where `docsLookup` searches, under the repository. */
export const DOCS_ROOTS = Object.freeze([SPECS_DEFAULT, "docs", FLOW_DIR]);
/** The files it reads: text only, none larger than `MAX_BYTES`, at most `MAX_FILES` of them. */
const TEXT = new Set([".md", ".mdx", ".txt", ".yml", ".yaml", ".json", ".jsonc"]);
const MAX_BYTES = 512 * 1024;
const MAX_FILES = 2000;
/** The most matches one lookup returns, and the longest line it quotes. */
export const MAX_MATCHES = 100;
const MAX_LINE = 240;

/**
 * The lines of the repository's specs, `docs/` and `.flow/` text that contain `query` (any case), each with its
 * repository-relative path and line, sorted by path; symbolic links are never followed, so nothing outside the
 * repository is read.
 * @param {string} repo
 * @param {string} query
 * @param {{ limit?: number }} [options] at most `MAX_MATCHES`
 * @returns {{ query: string, matches: { path: string, line: number, text: string }[], truncated: boolean }}
 */
export function docsLookup(repo, query, { limit = 20 } = {}) {
  const wanted = query.toLowerCase();
  const most = Math.min(limit, MAX_MATCHES);
  /** @type {{ path: string, line: number, text: string }[]} */
  const matches = [];
  let files = 0;
  let truncated = false;
  /** @param {string} dir */
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).toSorted((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      if (truncated) return;
      const at = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== ".git") walk(at);
        continue;
      }
      if (!entry.isFile() || !TEXT.has(extname(entry.name).toLowerCase())) continue;
      if (lstatSync(at).size > MAX_BYTES) continue;
      if (++files > MAX_FILES) {
        truncated = true;
        return;
      }
      for (const [i, line] of readFileSync(at, "utf8").split("\n").entries()) {
        if (!line.toLowerCase().includes(wanted)) continue;
        if (matches.length === most) {
          truncated = true;
          return;
        }
        matches.push({
          path: relative(repo, at).split(sep).join("/"),
          line: i + 1,
          text: line.trim().slice(0, MAX_LINE),
        });
      }
    }
  };
  for (const root of DOCS_ROOTS) {
    const at = join(repo, root);
    // A root that is itself a link (or not a folder) is skipped: it could lead anywhere.
    if (existsSync(at) && lstatSync(at).isDirectory()) walk(at);
  }
  return { query, matches, truncated };
}
