/**
 * @vellum/protocol — Canonical form of an Artifact Body
 *
 * An approval binds to the Artifact Checksum, which is the SHA-256 of the
 * canonical form computed here. The canonical form removes what a formatter
 * may change without changing what the document says, so a formatting-only
 * edit keeps an approval valid and a content edit voids it.
 *
 * Normalised:
 * - a leading byte-order mark;
 * - the Lifecycle Frontmatter block, when the text starts with one;
 * - line endings (CRLF and lone CR become LF);
 * - trailing spaces and tabs on every line;
 * - trailing blank lines (the body ends with exactly one LF, or is empty);
 * - outside fenced code blocks, Markdown table padding: each row whose first
 *   non-blank character is `|` is re-emitted as `| cell | cell |` with every
 *   cell trimmed, and each delimiter cell collapses to `---`, keeping its
 *   alignment colons;
 * - outside fenced code blocks, the Task Marker of each task line (`- [x] 1 …`
 *   and the other three markers) reads as `[ ]`. A marker is execution state
 *   the Platform writes (criteria 9.7, 10.2), not plan content: without this,
 *   recording one task's completion would void the plan's approval and every
 *   other task's Task Binding.
 * - the contents of a `## Execution Log` section (from its heading to the next
 *   `#` or `##` heading), outside fenced code blocks. The heading is kept. The
 *   log is an append-only record of execution the executor writes after each
 *   task, not plan content: without this, the first row would void the plan's
 *   approval and every later `task start` would be refused. The ledger, not the
 *   log, is the evidence.
 *
 * Everything else — words, punctuation, line breaks, blank lines between
 * paragraphs, indentation outside tables, and every character inside a fenced
 * code block apart from trailing whitespace — is kept exactly. This is the
 * form readers parse (a Property's `**Validates:**` line, a criterion's number
 * and a task's lines keep their own lines here).
 *
 * The Artifact Checksum hashes canonicalChecksumBody, which additionally
 * normalises the layout a Markdown formatter owns (decision 13 in 002's
 * design):
 * - blank lines before the first content line, and each run of blank lines
 *   outside fenced code blocks, which becomes one blank line;
 * - soft wraps: outside fenced code blocks, a paragraph, list item or block
 *   quote continued on following lines reads as one line — each continuation
 *   line is trimmed and joined to the previous one with a single space. A line
 *   continues the block above it unless it is blank or starts a block of its
 *   own (a heading, table row, fence, thematic break, setext underline, list
 *   item or, outside a quote, a block quote). So reflowing text at a different
 *   width, or changing a list item's hanging indent, keeps the checksum, while
 *   a changed word, a new paragraph break or a new list item changes it.
 *   Headings, table rows and code fences are never joined.
 */

const FRONTMATTER = /^---\n[\s\S]*?\n---(?:\n|$)/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const DELIMITER_CELL = /^(:?)-+(:?)$/;
/** A task line's marker, as the Kiro Task Line Grammar (markers.ts) reads it. */
const TASK_MARKER = /^(\s*-\s*\[)[ x~-](\]\*?\s*\d+(?:\.\d+)*)/;
const EXECUTION_LOG_HEADING = /^##\s+Execution Log\s*$/i;
const SECTION_END = /^#{1,2}\s/;

/** Return the canonical form of an artifact's text (frontmatter excluded). */
export function canonicalArtifactBody(text: string): string {
  const lf = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const body = lf.replace(FRONTMATTER, "");

  const out: string[] = [];
  let fence: { readonly char: string; readonly length: number } | null = null;
  let inExecutionLog = false;

  for (const rawLine of body.split("\n")) {
    const line = rawLine.replace(/[ \t]+$/, "");

    if (inExecutionLog) {
      if (!SECTION_END.test(line)) continue;
      inExecutionLog = false;
    }

    if (fence) {
      out.push(line);
      if (closesFence(line, fence)) fence = null;
      continue;
    }

    const open = FENCE_OPEN.exec(line);
    if (open?.[1] !== undefined) {
      fence = { char: open[1].charAt(0), length: open[1].length };
      out.push(line);
      continue;
    }

    if (EXECUTION_LOG_HEADING.test(line)) {
      out.push(line);
      inExecutionLog = true;
      continue;
    }

    out.push(
      line.trimStart().startsWith("|")
        ? canonicalTableRow(line)
        : line.replace(TASK_MARKER, "$1 $2"),
    );
  }

  const joined = out.join("\n").replace(/\n+$/, "");
  return joined === "" ? "" : `${joined}\n`;
}

function closesFence(
  line: string,
  fence: { readonly char: string; readonly length: number },
): boolean {
  const trimmed = line.replace(/^ {0,3}/, "");
  if (!trimmed.startsWith(fence.char.repeat(fence.length))) return false;
  const run = trimmed.length - trimmed.replace(new RegExp(`^\\${fence.char}+`), "").length;
  return run >= fence.length && trimmed.slice(run).trim() === "";
}

/** Split a table row on unescaped pipes, trim cells, collapse delimiter runs. */
function canonicalTableRow(line: string): string {
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line.charAt(i);
    if (ch === "\\" && i + 1 < line.length) {
      current += ch + line.charAt(i + 1);
      i++;
      continue;
    }
    if (ch === "|") {
      cells.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current);

  // The row starts with `|`, so the first split piece is the (blank) indent.
  // A trailing `|` leaves a blank last piece; a row without one does not.
  const inner = cells.slice(1);
  if (inner.length > 0 && inner[inner.length - 1]?.trim() === "") inner.pop();

  const trimmed = inner.map((cell) => cell.trim());
  const isDelimiterRow = trimmed.length > 0 && trimmed.every((cell) => DELIMITER_CELL.test(cell));
  const canonical = isDelimiterRow
    ? trimmed.map((cell) => cell.replace(DELIMITER_CELL, "$1---$2"))
    : trimmed;

  return `| ${canonical.join(" | ")} |`;
}

const HEADING = /^ {0,3}#{1,6}(?:\s|$)/;
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)\s*$/;
/**
 * A list item that can interrupt a paragraph (CommonMark): a bullet, or an
 * ordered item numbered 1. A wrapped line that happens to start `200) ` or
 * `3. ` continues the text above it.
 */
const LIST_ITEM = /^\s*(?:[-*+]|0{0,8}1[.)])(?:\s|$)/;
const BLOCK_QUOTE = /^ {0,3}>\s?/;

/**
 * The form the Artifact Checksum hashes: canonicalArtifactBody with leading
 * and repeated blank lines and soft wraps normalised (see the module comment).
 */
export function canonicalChecksumBody(text: string): string {
  const out: string[] = [];
  let fence: { readonly char: string; readonly length: number } | null = null;
  /** The block continuation lines join onto, and whether it is a block quote. */
  let open: { quote: boolean } | null = null;

  for (const line of canonicalArtifactBody(text).split("\n")) {
    if (fence) {
      out.push(line);
      if (closesFence(line, fence)) fence = null;
      continue;
    }

    if (line === "") {
      open = null;
      if (out.length > 0 && out[out.length - 1] !== "") out.push("");
      continue;
    }

    const fenceOpen = FENCE_OPEN.exec(line);
    if (fenceOpen?.[1] !== undefined) {
      fence = { char: fenceOpen[1].charAt(0), length: fenceOpen[1].length };
      open = null;
      out.push(line);
      continue;
    }

    const standalone =
      HEADING.test(line) ||
      line.trimStart().startsWith("|") ||
      THEMATIC_BREAK.test(line) ||
      (open !== null && SETEXT_UNDERLINE.test(line));
    if (standalone) {
      open = null;
      out.push(line);
      continue;
    }

    if (open !== null && !LIST_ITEM.test(line)) {
      if (open.quote && BLOCK_QUOTE.test(line)) {
        const rest = line.replace(BLOCK_QUOTE, "").trim();
        if (rest !== "" && !startsBlock(rest)) {
          out[out.length - 1] += ` ${rest}`;
          continue;
        }
      } else if (!BLOCK_QUOTE.test(line)) {
        out[out.length - 1] += ` ${line.trim()}`;
        continue;
      }
    }

    open = { quote: BLOCK_QUOTE.test(line) };
    out.push(line);
  }

  const joined = out.join("\n").replace(/\n+$/, "");
  return joined === "" ? "" : `${joined}\n`;
}

/** True when `line` opens a block of its own rather than continuing one. */
function startsBlock(line: string): boolean {
  return (
    FENCE_OPEN.test(line) ||
    HEADING.test(line) ||
    line.startsWith("|") ||
    THEMATIC_BREAK.test(line) ||
    LIST_ITEM.test(line) ||
    BLOCK_QUOTE.test(line)
  );
}
