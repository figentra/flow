/**
 * @vellum/engine — Task Context: the per-task briefing (a context bundle)
 *
 * An executor implementing one task needs the task, the criteria and
 * Properties it cites, the design it builds against and the terms it must
 * use — not the whole spec. buildTaskContext selects exactly that from the
 * three documents, and names every cited identifier it could not find so the
 * reader knows when to open the full documents (decision 15 in 002's design).
 *
 * Pure and deterministic: the same artifact bodies give the same briefing.
 */

import { canonicalArtifactBody, parseTaskItems } from "@vellum/protocol";
import type { ArtifactKind, TaskLine } from "@vellum/protocol";
import { parseCriteria } from "../quality/patterns/criterion-parser.js";
import { parseProperties } from "../quality/coverage-checker.js";

/** What buildTaskContext reads of an artifact: its kind and its body. */
export interface TaskContextArtifact {
  readonly kind: ArtifactKind;
  /** The artifact's text; Lifecycle Frontmatter, if present, is ignored */
  readonly body: string;
}

/** A cited acceptance criterion, in full. */
export interface ContextCriterion {
  /** `2.3` */
  readonly id: string;
  /** The heading of its requirement: `Requirement 2: Title` */
  readonly requirement: string;
  /** The criterion's text, continuation lines joined */
  readonly text: string;
}

/** A cited Correctness Property, in full. */
export interface ContextProperty {
  /** `P3` */
  readonly id: string;
  readonly title: string;
  /** Its lines from the heading to its `**Validates:**` line, inclusive */
  readonly text: string;
  /** The criteria its `**Validates:**` line names; empty when it has none */
  readonly validates: readonly string[];
}

/** A design.md section that mentions what the task names. */
export interface ContextDesignSection {
  /** Heading text without the leading `#`s */
  readonly heading: string;
  /** 1-based line of the heading in design.md as given (frontmatter included) */
  readonly line: number;
  /** The heading line and the section's content, subsections included */
  readonly text: string;
}

/** A glossary entry for a term the task, its criteria or its Properties use. */
export interface ContextGlossaryEntry {
  readonly term: string;
  readonly definition: string;
  readonly source: "requirements" | "design";
}

/** A cited identifier, or a document it would be in, that was not found. */
export interface ContextMissing {
  readonly kind: "criterion" | "property" | "document";
  /** `2.3`, `P3`, or the document's file name */
  readonly id: string;
}

/** The per-task briefing. */
export interface TaskContext {
  readonly task: {
    readonly id: string;
    /** The Task Marker character: ` `, `~`, `-` or `x` */
    readonly marker: string;
    readonly optional: boolean;
    readonly text: string;
    readonly requirements: readonly string[];
    readonly properties: readonly string[];
    /** Identifiers of its direct sub-tasks; empty for a leaf task */
    readonly subtasks: readonly string[];
  };
  /** Its parent task; null for a top-level task */
  readonly parent: { readonly id: string; readonly text: string } | null;
  /** The Task Dependency Graph wave that holds it; null when none does */
  readonly wave: { readonly id: number; readonly tasks: readonly string[] } | null;
  readonly criteria: readonly ContextCriterion[];
  readonly properties: readonly ContextProperty[];
  readonly design: readonly ContextDesignSection[];
  readonly glossary: readonly ContextGlossaryEntry[];
  /** Empty when every cited criterion and Property was found */
  readonly missing: readonly ContextMissing[];
}

/**
 * The briefing for task `taskId`, or null when tasks.md is absent or defines
 * no such task.
 *
 * - criteria and Properties: every one the task's trailers cite, in trailer
 *   order, in full; a cited one the documents do not define is `missing`,
 *   as is an absent requirements.md or design.md and every citation into it;
 * - design: the deepest design.md sections whose heading names a file or
 *   identifier the task names in backticks, or a term of design.md's own
 *   Glossary the task uses; whose heading the task text quotes (`the
 *   design's Error Handling section`); or whose own text names a full file
 *   path (with a `/`) the task names — in document order, never the
 *   Glossary or Correctness Properties sections, which are given separately;
 * - glossary: requirements.md then design.md Glossary rows whose term the
 *   task text, its criteria or its Properties use, first definition wins;
 * - parent, direct sub-tasks and the wave, from tasks.md.
 */
export function buildTaskContext(
  artifacts: readonly TaskContextArtifact[],
  taskId: string,
): TaskContext | null {
  const find = (kind: ArtifactKind): string | null => {
    const artifact = artifacts.find((a) => a.kind === kind);
    return artifact === undefined ? null : normalise(artifact.body);
  };
  const tasksBody = find("tasks");
  if (tasksBody === null) return null;
  const items = parseTaskItems(stripFrontmatter(tasksBody));
  const task = items.find((t) => t.identifier === taskId);
  if (task === undefined) return null;

  const requirementsBody = find("requirements");
  const designBody = find("design");
  const requirements = requirementsBody === null ? null : canonicalArtifactBody(requirementsBody);
  const design = designBody === null ? null : canonicalArtifactBody(designBody);
  // canonicalArtifactBody drops the frontmatter block; line numbers count it.
  const designOffset =
    designBody === null ? 0 : (FRONTMATTER.exec(designBody)?.[0].match(/\n/g)?.length ?? 0);

  const citedCriteria = [...(task.requirementsTrailer ?? [])].map(String);
  const citedProperties = [...(task.propertiesTrailer ?? [])].map(String);
  const missing: ContextMissing[] = [];

  const criteria: ContextCriterion[] = [];
  if (requirements === null) {
    missing.push({ kind: "document", id: "requirements.md" });
    for (const id of citedCriteria) missing.push({ kind: "criterion", id });
  } else {
    const titles = requirementTitles(requirements);
    const parsed = parseCriteria(requirements);
    for (const id of citedCriteria) {
      const found = parsed.find((c) => c.reference === id);
      if (found === undefined) {
        missing.push({ kind: "criterion", id });
        continue;
      }
      criteria.push({
        id,
        requirement:
          titles.get(found.requirement_number) ?? `Requirement ${found.requirement_number}`,
        text: found.text,
      });
    }
  }

  const properties: ContextProperty[] = [];
  if (design === null) {
    missing.push({ kind: "document", id: "design.md" });
    for (const id of citedProperties) missing.push({ kind: "property", id });
  } else {
    const defined = propertyBlocks(design);
    for (const id of citedProperties) {
      const found = defined.get(id);
      if (found === undefined) missing.push({ kind: "property", id });
      else properties.push(found);
    }
  }

  const glossaryRows = [
    ...(requirements === null ? [] : glossaryEntries(requirements, "requirements")),
    ...(design === null ? [] : glossaryEntries(design, "design")),
  ];
  const usedText = [
    task.text,
    ...criteria.map((c) => c.text),
    ...properties.map((p) => p.text),
  ].join("\n");
  const seen = new Set<string>();
  const glossary: ContextGlossaryEntry[] = [];
  for (const row of glossaryRows) {
    const key = plain(row.term).toLowerCase();
    if (key === "" || seen.has(key) || !mentions(usedText, plain(row.term), true)) continue;
    seen.add(key);
    glossary.push(row);
  }

  // Components are design.md's glossary terms; requirements.md's are domain
  // nouns (`Request`, `Attempt`) that would match most headings.
  const termsInTask = glossaryRows
    .filter((r) => r.source === "design")
    .map((r) => plain(r.term))
    .filter((t) => t !== "" && mentions(task.text, t, true));
  const designSections =
    design === null ? [] : matchDesignSections(design, task.text, termsInTask, designOffset);

  const parentId = task.identifier.includes(".")
    ? task.identifier.slice(0, task.identifier.lastIndexOf("."))
    : null;
  const parentTask = parentId === null ? undefined : items.find((t) => t.identifier === parentId);
  const depth = task.identifier.split(".").length;
  const subtasks = items
    .filter(
      (t) =>
        t.identifier.startsWith(`${task.identifier}.`) &&
        t.identifier.split(".").length === depth + 1,
    )
    .map((t) => String(t.identifier));

  return {
    task: {
      id: String(task.identifier),
      marker: task.marker,
      optional: task.isOptional,
      text: task.text,
      requirements: citedCriteria,
      properties: citedProperties,
      subtasks,
    },
    parent:
      parentTask === undefined
        ? null
        : { id: String(parentTask.identifier), text: parentTask.text },
    wave: findWave(tasksBody, task),
    criteria,
    properties,
    design: designSections,
    glossary,
    missing,
  };
}

// ============================================================================
// Reading the documents
// ============================================================================

const FRONTMATTER = /^---\n[\s\S]*?\n---(?:\n|$)/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

function normalise(text: string): string {
  return text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
}

function stripFrontmatter(text: string): string {
  return text.replace(FRONTMATTER, "");
}

/** `N` → `Requirement N: Title`, from each `### Requirement N: Title` heading. */
function requirementTitles(requirements: string): Map<string, string> {
  const titles = new Map<string, string>();
  for (const line of requirements.split("\n")) {
    const match = /^#{2,4}\s+(Requirement\s+(\d+):.*?)\s*$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined && !titles.has(match[2])) {
      titles.set(match[2], match[1]);
    }
  }
  return titles;
}

/**
 * Every Property design.md defines, by `PN`: its lines from the heading to its
 * `**Validates:**` line, or to the line before the next Property or heading
 * when it has none. The first definition of a number wins.
 */
function propertyBlocks(design: string): Map<string, ContextProperty> {
  const lines = design.split("\n");
  const blocks = new Map<string, ContextProperty>();
  for (const property of parseProperties(design)) {
    const id = `P${property.number}`;
    if (blocks.has(id)) continue;
    const start = property.line_number - 1;
    let end = start;
    for (let j = start + 1; j < lines.length; j++) {
      const line = lines[j]!;
      if (/^\s*(?:\*\*)?Property\s+\d+:/.test(line) || HEADING.test(line)) break;
      end = j;
      if (/\*\*Validates:/i.test(line)) break;
    }
    blocks.set(id, {
      id,
      title: property.title.replace(/\*+$/, "").trim(),
      text: trimBlankLines(lines.slice(start, end + 1)).join("\n"),
      validates: property.validates ?? [],
    });
  }
  return blocks;
}

/** The rows of every Glossary table (under a heading named Glossary). */
function glossaryEntries(
  body: string,
  source: ContextGlossaryEntry["source"],
): ContextGlossaryEntry[] {
  const entries: ContextGlossaryEntry[] = [];
  let inGlossary = false;
  let fence: string | null = null;
  for (const line of body.split("\n")) {
    const open = FENCE.exec(line);
    if (fence !== null) {
      if (
        open?.[1] !== undefined &&
        open[1].charAt(0) === fence.charAt(0) &&
        open[1].length >= fence.length
      )
        fence = null;
      continue;
    }
    if (open?.[1] !== undefined) {
      fence = open[1];
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading?.[2] !== undefined) {
      inGlossary = /^glossary$/i.test(heading[2].trim());
      continue;
    }
    if (!inGlossary || !line.trim().startsWith("|")) continue;
    const cells = line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
    const [term, ...rest] = cells;
    const definition = rest.join(" | ").trim();
    if (term === undefined || definition === "") continue;
    if (/^:?-+:?$/.test(term) || /^term$/i.test(plain(term))) continue;
    if (/^\[.*\]$/.test(term)) continue; // an unfilled template placeholder
    entries.push({ term: plain(term), definition, source });
  }
  return entries;
}

/** A term without Markdown emphasis or code marks. */
function plain(term: string): string {
  return term.replace(/[*_`]/g, "").trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whether `text` mentions `name` as a whole word (a plural `s`/`es` allowed
 * for a term). Case-insensitive when `ignoreCase`.
 */
function mentions(text: string, name: string, ignoreCase: boolean): boolean {
  if (name === "") return false;
  const pattern = new RegExp(
    `(?<![A-Za-z0-9_])${escapeRegExp(name)}(?:s|es)?(?![A-Za-z0-9_])`,
    ignoreCase ? "i" : "",
  );
  return pattern.test(text);
}

function trimBlankLines(lines: readonly string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]!.trim() === "") start++;
  while (end > start && lines[end - 1]!.trim() === "") end--;
  return lines.slice(start, end);
}

// ============================================================================
// Design sections
// ============================================================================

interface Section {
  readonly level: number;
  readonly heading: string;
  /** 0-based index of the heading line */
  readonly start: number;
  /** 0-based index one past the section's last line (subsections included) */
  readonly end: number;
  /** 0-based index one past the section's own content (before its first subsection) */
  readonly ownEnd: number;
}

/** Sections whose content is given elsewhere in the briefing, or is the whole document. */
const EXCLUDED = /^(?:glossary|correctness properties)$/i;

/** Every heading outside fenced code, with the extent of its section. */
function sections(lines: readonly string[]): Section[] {
  const headings: Array<{ level: number; heading: string; start: number }> = [];
  let fence: string | null = null;
  lines.forEach((line, i) => {
    const open = FENCE.exec(line);
    if (fence !== null) {
      if (
        open?.[1] !== undefined &&
        open[1].charAt(0) === fence.charAt(0) &&
        open[1].length >= fence.length
      )
        fence = null;
      return;
    }
    if (open?.[1] !== undefined) {
      fence = open[1];
      return;
    }
    const heading = HEADING.exec(line);
    if (heading?.[1] !== undefined && heading[2] !== undefined) {
      headings.push({ level: heading[1].length, heading: heading[2], start: i });
    }
  });
  return headings.map((h, k) => {
    const next = headings.slice(k + 1).find((n) => n.level <= h.level);
    const child = headings[k + 1];
    return {
      ...h,
      end: next === undefined ? lines.length : next.start,
      ownEnd: child === undefined ? lines.length : child.start,
    };
  });
}

/** What a task names in backticks: file paths (with their base names) and identifiers. */
function namedInTask(taskText: string): { paths: string[]; identifiers: string[] } {
  const paths = new Set<string>();
  const identifiers = new Set<string>();
  for (const match of taskText.matchAll(/`([^`\n]+)`/g)) {
    const span = match[1]!.trim();
    if (/^[\w@.-]+(?:\/[\w@.-]+)+\/?$/.test(span) || /^[\w@-]+\.[A-Za-z]{1,5}$/.test(span)) {
      paths.add(span);
      const base = span.replace(/\/$/, "").split("/").pop();
      if (base !== undefined && base !== span && /\.[A-Za-z]{1,5}$/.test(base)) paths.add(base);
      continue;
    }
    const identifier = /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)(?:<[^>]*>)?(?:\(.*\))?$/.exec(
      span,
    )?.[1];
    // Only what reads as code: a call or generic, a dotted name, or a name
    // with an upper-case letter, `_` or `$`. A plain word (`test`, `cause`)
    // would match any heading that uses it in prose.
    const code = identifier !== undefined && (identifier !== span || /[A-Z_$.]/.test(identifier));
    if (identifier !== undefined && identifier.length >= 3 && code) identifiers.add(identifier);
  }
  return { paths: [...paths], identifiers: [...identifiers] };
}

/** A heading without code marks, emphasis or a trailing parenthetical. */
function headingTitle(heading: string): string {
  return plain(heading.replace(/\s*\([^)]*\)\s*$/, ""));
}

function matchDesignSections(
  design: string,
  taskText: string,
  termsInTask: readonly string[],
  lineOffset: number,
): ContextDesignSection[] {
  const lines = design.split("\n");
  const all = sections(lines);
  const { paths, identifiers } = namedInTask(taskText);
  const excludedRanges = all.filter((s) => EXCLUDED.test(headingTitle(s.heading)));
  const candidates = all.filter(
    (s) => s.level > 1 && !excludedRanges.some((x) => s.start >= x.start && s.start < x.end),
  );

  const matches = (s: Section): boolean => {
    const heading = s.heading.replace(/`/g, "");
    if ([...paths, ...identifiers].some((name) => mentions(heading, name, false))) return true;
    if (termsInTask.some((term) => mentions(heading, term, true))) return true;
    const title = headingTitle(s.heading);
    if (title.length >= 4 && mentions(taskText, title, false)) return true;
    // In a section's text only a full path counts: a folder tree or an import
    // list names every base name, and would match every file task.
    const own = lines.slice(s.start + 1, s.ownEnd).join("\n");
    return paths.some((path) => path.includes("/") && own.includes(path));
  };

  const matched = candidates.filter(matches);
  // The deepest match wins: a section with a matching subsection gives way to it.
  const deepest = matched.filter(
    (s) => !matched.some((d) => d !== s && d.start > s.start && d.start < s.end),
  );
  return deepest.map((s) => ({
    heading: s.heading,
    line: s.start + 1 + lineOffset,
    text: trimBlankLines(lines.slice(s.start, s.end)).join("\n"),
  }));
}

// ============================================================================
// Task Dependency Graph
// ============================================================================

/** The wave in tasks.md's Task Dependency Graph that lists `task`, if any. */
function findWave(tasks: string, task: TaskLine): TaskContext["wave"] {
  const lines = tasks.split("\n");
  const heading = lines.findIndex((l) => /^##\s+Task Dependency Graph\s*$/.test(l));
  if (heading === -1) return null;
  const open = lines.findIndex((l, i) => i > heading && /^\s*```json\s*$/.test(l));
  if (open === -1) return null;
  const close = lines.findIndex((l, i) => i > open && /^\s*```\s*$/.test(l));
  if (close === -1) return null;
  let graph: unknown;
  try {
    graph = JSON.parse(lines.slice(open + 1, close).join("\n"));
  } catch {
    return null;
  }
  const waves = (graph as { waves?: unknown }).waves;
  if (!Array.isArray(waves)) return null;
  for (const wave of waves as unknown[]) {
    const { id, tasks: ids } = (wave ?? {}) as { id?: unknown; tasks?: unknown };
    if (typeof id !== "number" || !Array.isArray(ids)) continue;
    const members = ids.filter((t): t is string => typeof t === "string");
    if (members.includes(task.identifier)) return { id, tasks: members };
  }
  return null;
}
