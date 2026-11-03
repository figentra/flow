/**
 * Figentra Flow file contract:
 * Purpose: the guard engine's prompt hints, ported from core's `prompt-hints.mjs`: the one-line reminders of a
 *   preset's hints table whose topic the prompt is about, under the table's title.
 * Boundary: pure; never blocks.
 * Runtime: node
 * Governing contract: STA-1945 (FR-7, P-012).
 * Secrets: none.
 */

/**
 * A preset's prompt hints: each `match` reads the lower-cased prompt.
 * @typedef {{ title: string, hints: { match: (prompt: string) => boolean, text: string }[] }} PromptTable
 */

/**
 * The hints for `prompt`, or undefined when none applies or the preset has no table.
 * @param {string} prompt
 * @param {PromptTable | undefined} table
 * @returns {string | undefined}
 */
export function promptHints(prompt, table) {
  if (!table) return undefined;
  const p = prompt.toLowerCase();
  const hits = table.hints.filter((h) => h.match(p)).map((h) => h.text);
  return hits.length ? `${table.title}\n- ${hits.join("\n- ")}` : undefined;
}
