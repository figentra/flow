/**
 * @vellum/protocol — Checksum form 1: the canonical body Vellum 0.1.2 hashed
 *
 * FROZEN. Approvals and Task Bindings recorded by Vellum 0.1.2 and earlier
 * bind the SHA-256 of this form, and carry no `checksum_form` field. This is
 * a copy of `canonicalArtifactBody` exactly as 0.1.2 shipped it (release
 * commit 690c8a5), kept apart so later changes to the readers' canonical form
 * cannot move it. Never edit it: a changed byte would void every approval
 * recorded under 0.1.2 — or worse, validate one it should not. The golden
 * checksums in __tests__/checksum-form.test.ts were computed by 0.1.2's own
 * source and pin it.
 *
 * Normalised: a leading byte-order mark; a leading Lifecycle Frontmatter
 * block; line endings; trailing spaces and tabs; trailing blank lines;
 * Markdown table padding outside fenced code; every Task Marker read as
 * `[ ]` outside fenced code; and the contents of a `## Execution Log` section
 * outside fenced code (its heading is kept). Everything else, line breaks and
 * blank-line runs included, is kept exactly — which is why this form is
 * strictly more sensitive than form 2 (canonicalChecksumBody): every edit that
 * changes form 2 also changes form 1.
 */

const FRONTMATTER = /^---\n[\s\S]*?\n---(?:\n|$)/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const DELIMITER_CELL = /^(:?)-+(:?)$/;
/** A task line's marker, as the Kiro Task Line Grammar (markers.ts) reads it. */
const TASK_MARKER = /^(\s*-\s*\[)[ x~-](\]\*?\s*\d+(?:\.\d+)*)/;
const EXECUTION_LOG_HEADING = /^##\s+Execution Log\s*$/i;
const SECTION_END = /^#{1,2}\s/;

/** The form-1 canonical body of an artifact's text (frontmatter excluded). */
export function canonicalBodyForm1(text: string): string {
  const lf = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
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
