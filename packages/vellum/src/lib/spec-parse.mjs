/**
 * Stackra file contract:
 * Purpose: pure parsers for spec-kit artifacts shared by spec-gate and spec-trace (spec.md, plan.md, tasks.md,
 *   `.agents/routing.yaml` task types, `@covers` tags in tests). Dependency-free; no I/O.
 * Boundary: pure functions over text; no file or network access.
 * Runtime: node
 * Governing contract: ADR 0120 (SDLC spec location, lanes and change risk); ADR 0121.
 * Secrets: none.
 */

/** Text without HTML comments, which hold template guidance, never content. */
export const strip = (text) => text.replaceAll(/<!--[\s\S]*?-->/g, "");

/** IDs defined as `- **FR-001**: …` (or SC/EC/P), split into live and struck (`~~FR-001~~`, amendments). */
export function definedIds(text, prefix) {
  const live = new Set();
  const struck = new Set();
  const re = new RegExp(`^\\s*[-*] (~~)?\\*\\*(${prefix}-\\d+)\\*\\*(~~)?(.*)$`, "gm");
  for (const m of strip(text).matchAll(re)) {
    if (m[1] || m[3] || /^\s*~~/.test(m[4])) struck.add(m[2]);
    else live.add(m[2]);
  }
  return { live, struck };
}

/** `- **FR-001**: rest` → Map(id → rest), struck or not. */
export function definedLines(text, prefix) {
  const out = new Map();
  const re = new RegExp(`^\\s*[-*] (?:~~)?\\*\\*(${prefix}-\\d+)\\*\\*(?:~~)?(.*)$`, "gm");
  for (const m of strip(text).matchAll(re)) out.set(m[1], m[2]);
  return out;
}

const list = (s) =>
  s ? [...s.matchAll(/\b(?:FR|SC|EC|P)-\d+\b|\bT\d{3}\b/g)].map((m) => m[0]) : [];
const field = (rest, name) =>
  rest.match(new RegExp(`\\b${name}:\\s*([^—\\[]*?)\\s*(?:—|\\[STA-|$)`))?.[1]?.trim();

/** Task lines of tasks.md, with their phase heading. */
export function parseTasks(text) {
  const tasks = [];
  let phase = "";
  for (const [i, line] of strip(text).split("\n").entries()) {
    const h = line.match(/^##\s+(.*)$/);
    if (h) {
      phase = h[1].trim();
      continue;
    }
    const m = line.match(/^\s*[-*] \[([ xX])\] (~~)?(T\d{3})(~~)?(.*)$/);
    if (!m) continue;
    const rest = m[5];
    tasks.push({
      line: i + 1,
      id: m[3],
      done: m[1] !== " ",
      struck: Boolean(m[2] || m[4]),
      parallel: /^\s*\[P\]/.test(rest),
      covers: list(field(rest, "covers")),
      route: field(rest, "route"),
      deps: list(field(rest, "deps")),
      paths: [...rest.matchAll(/`([^`]+)`/g)].map((p) => p[1]),
      key: rest.match(/\[(STA-\d+)\]\s*$/)?.[1],
      phase,
    });
  }
  return tasks;
}

/** `P-001 … Validates: FR-001, FR-003` lines of plan.md → Map(P → [FR]). */
export function properties(plan) {
  const out = new Map();
  for (const [id, rest] of definedLines(plan, "P")) {
    const v = rest.match(/Validates:\s*(.*)$/i)?.[1] ?? "";
    out.set(
      id,
      [...v.matchAll(/\bFR-\d+\b/g)].map((m) => m[0]),
    );
  }
  return out;
}

/** Task types under `tasks:` in `.agents/routing.yaml`. */
export function routes(yaml) {
  const block = yaml.match(/^tasks:\s*\n([\s\S]*?)(?=^\S|(?![\s\S]))/m)?.[1] ?? "";
  return new Set([...block.matchAll(/^ {2}([a-z][a-z0-9-]*):/gm)].map((m) => m[1]));
}

/** `@covers sta-163:FR-001 sta-163:P-002` tags in a test file → the IDs for spec `key` (`163`). */
export function coversTags(text, key) {
  const out = [];
  for (const m of text.matchAll(/@covers\s+((?:sta-\d+:[A-Z]+(?:-\d+)?[\s,]*)+)/gi))
    for (const t of m[1].matchAll(/sta-(\d+):([A-Z]+(?:-\d+)?)/gi))
      if (t[1] === String(key)) out.push(t[2].toUpperCase());
  return out;
}

/** Path prefixes of workspace members a repo path belongs to (packages/<cat>/<name>, apps/<n>, services/<n>). */
export function memberOf(path) {
  return (
    path.match(/^packages\/[^/]+\/[^/]+(?=\/)/)?.[0] ??
    path.match(/^(?:apps|services)\/[^/]+(?=\/)/)?.[0]
  );
}
