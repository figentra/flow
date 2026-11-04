/**
 * Figentra Flow file contract:
 * Purpose: asynchronous questions (PLAN section 10 H5, STA-2098), as pure text functions: a spec's open questions
 *   (its `[NEEDS CLARIFICATION: …]` markers), the one tracker comment that asks them, the answers a later comment
 *   gives in the form it asked for (`Q1: <answer>`), the spec's waiting line, and recording an answer into the spec:
 *   the marker becomes the answer and `## Clarifications` gets its `- Q: … → A: …` bullet (the spec is the record).
 * Boundary: pure functions over text; no file or network access.
 * Runtime: node
 * Governing contract: ADR 0510; STA-2098.
 * Secrets: none.
 */
import { NAME } from "./product.mjs";
import { strip } from "./spec-parse.mjs";

/** The tag that marks the comment `spec ask --async` posts, so `spec resume` finds it. */
export const ASK_TAG = `${NAME} spec ask`;

/** The spec's waiting line prefix; the gate reads `**Status**` and the markers only, so it never trips on it. */
export const WAITING = "> Waiting on clarification:";

const MARKER = /\[NEEDS CLARIFICATION:\s*([^\]]*?)\s*\]/gi;

/**
 * The spec's open questions, in order, each once.
 * @param {string} text
 * @returns {string[]}
 */
export const openQuestions = (text) => [
  ...new Set([...strip(text).matchAll(MARKER)].map((m) => m[1])),
];

/**
 * The comment that asks `questions` on the issue `display`.
 * @param {string} display the issue key as shown (`STA-12`)
 * @param {string[]} questions
 */
export function questionComment(display, questions) {
  return [
    `**Open questions** for ${display} (\`${ASK_TAG}\`)`,
    "",
    ...questions.map((q, i) => `- **Q${i + 1}**: ${q}`),
    "",
    `Answer in a new comment, one line per question: \`Q1: <answer>\`. Then \`${NAME} spec resume ${display}\` records the answers in the spec.`,
  ].join("\n");
}

/**
 * The numbered questions of a comment `questionComment` wrote.
 * @param {string} body
 * @returns {Map<number, string>}
 */
export const askedIn = (body) =>
  new Map([...body.matchAll(/^- \*\*Q(\d+)\*\*: (.*)$/gm)].map((m) => [Number(m[1]), m[2].trim()]));

/**
 * The answers in a comment: each `Q<n>: <answer>` line (any case, at a line start).
 * @param {string} body
 * @returns {Map<number, string>}
 */
export const answersIn = (body) =>
  new Map(
    [...body.matchAll(/^[ \t]*Q(\d+)[ \t]*:[ \t]*(\S.*?)[ \t\r]*$/gim)].map((m) => [
      Number(m[1]),
      m[2],
    ]),
  );

/**
 * The URL on the spec's waiting line, or undefined when it is not waiting.
 * @param {string} text
 */
export const waitingOn = (text) => text.match(new RegExp(`^${WAITING}\\s*(.*)$`, "m"))?.[1].trim();

/**
 * `text` with its waiting line set to `url`: replaced, else put after `**Clarifications status**` (else the title).
 * @param {string} text
 * @param {string} url
 */
export function markWaiting(text, url) {
  const line = `${WAITING} ${url}`;
  const lines = clearWaiting(text).split("\n");
  const at = lines.findIndex((l) => l.startsWith("**Clarifications status**:"));
  lines.splice(at === -1 ? 1 : at + 1, 0, "", line);
  return lines.join("\n");
}

/**
 * `text` without its waiting line (and the blank line before it).
 * @param {string} text
 */
export const clearWaiting = (text) => text.replace(new RegExp(`\\n?\\n${WAITING}[^\\n]*`, "g"), "");

/**
 * `text` with each answer recorded: its question's marker replaced by the answer, and a `- Q: … → A: …` bullet in
 * `## Clarifications` under `### Session <date>` (both made when missing; the section goes before the first `## `).
 * @param {string} text
 * @param {{ question: string, answer: string }[]} answers
 * @param {string} date YYYY-MM-DD
 */
export function recordAnswers(text, answers, date) {
  if (!answers.length) return text;
  let out = text;
  for (const { question, answer } of answers)
    out = out.replace(MARKER, (whole, q) => (q === question ? answer : whole));
  const bullets = answers.map(({ question, answer }) => `- Q: ${question} → A: ${answer}`);
  const lines = out.split("\n");
  let section = lines.findIndex((l) => /^## Clarifications\b/.test(l));
  if (section === -1) {
    const first = lines.findIndex((l) => l.startsWith("## "));
    section = first === -1 ? lines.length : first;
    lines.splice(section, 0, "## Clarifications", "");
  }
  const sectionEnd = lines.findIndex((l, i) => i > section && l.startsWith("## "));
  const end = sectionEnd === -1 ? lines.length : sectionEnd;
  const session = lines.findIndex(
    (l, i) => i > section && i < end && l.trim() === `### Session ${date}`,
  );
  let at;
  if (session === -1) {
    at = end;
    while (at > section + 1 && lines[at - 1].trim() === "") at -= 1;
    lines.splice(at, 0, "", `### Session ${date}`, "");
    at += 3;
  } else {
    const next = lines.findIndex((l, i) => i > session && i < end && /^#{2,3} /.test(l));
    at = next === -1 ? end : next;
    while (at > session + 1 && lines[at - 1].trim() === "") at -= 1;
  }
  lines.splice(at, 0, ...bullets, ...(lines[at]?.trim() ? [""] : []));
  return lines.join("\n");
}
