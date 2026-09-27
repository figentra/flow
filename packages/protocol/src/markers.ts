/**
 * @vellum/protocol — Task markers and Kiro Task Line Grammar
 *
 * Defines the four task markers and parsing/serialization for
 * the Kiro Task Line Grammar.
 */

import type { TaskMarker, TaskId, CriterionId, PropertyId, TaskLine } from "./types";
import { parseTaskId, formatTaskId, parseCriterionId, parsePropertyId } from "./types";

// ============================================================================
// Marker Definitions
// ============================================================================

/**
 * Marker character to display mapping
 */
export const MARKER_DISPLAY: Record<TaskMarker, string> = {
  " ": "[ ]", // Not started
  "~": "[~]", // Queued (Kiro)
  "-": "[-]", // In progress (Kiro)
  x: "[x]", // Complete
} as const;

/**
 * Marker descriptions
 */
export const MARKER_DESCRIPTIONS: Record<TaskMarker, string> = {
  " ": "Not started",
  "~": "Queued",
  "-": "In progress",
  x: "Complete",
} as const;

/**
 * Parse a marker character from a checkbox string
 */
export function parseMarker(checkbox: string): TaskMarker | null {
  switch (checkbox) {
    case "[ ]":
      return " ";
    case "[~]":
      return "~";
    case "[-]":
      return "-";
    case "[x]":
      return "x";
    default:
      return null;
  }
}

/**
 * Format a marker to checkbox string
 */
export function formatMarker(marker: TaskMarker): string {
  return MARKER_DISPLAY[marker];
}

// ============================================================================
// Task Line Grammar
// ============================================================================

/**
 * Parse a task line from tasks.md
 *
 * Format: `- [x] 1. Task text <!-- criteria: 1.2, 3.4 --> <!-- properties: P1, P2 -->`
 *
 * The grammar supports:
 * - Checkbox marker: [ ], [x], [-], [~]
 * - Task identifier: number with optional hierarchy (1, 2.3, 5.1.4)
 * - Task text: any text after identifier
 * - Optional trailers: HTML comments with criteria and/or properties
 * - Kiro trailers ending the text, in either order: `_Requirements: 1.2, 3.4_`
 *   and `_Properties: 1, 3_` (the forms the method's tasks template writes;
 *   a property is cited by its design.md number, `3` or `P3`); each merged
 *   with the matching comment trailer when both are present
 * - Optional task marker: `(optional)` in the text, or Kiro's `*` right after
 *   the checkbox (`- [ ]* 1.3`) or the identifier (`- [ ] 1.3* …`)
 */
export function parseTaskLine(line: string): {
  marker: TaskMarker;
  identifier: TaskId;
  text: string;
  requirementsTrailer?: CriterionId[];
  propertiesTrailer?: PropertyId[];
  isOptional: boolean;
} | null {
  // Match the basic task line structure
  // Format: - [x] N(.N)*  Text <!-- criteria: ... --> <!-- properties: ... -->
  // A `*` right after the checkbox (`- [ ]* 1.3`) or right after the
  // identifier (`- [ ] 1.3* …`) marks the task optional (Kiro form).
  const baseMatch = line.match(
    /^(\s*)-\s*\[([ x~-])\](\*?)\s*(\d+(?:\.\d+)*)(\*?)\s*\.?\s*(.*?)(\s*<!--[\s\S]*?-->)?$/,
  );

  if (!baseMatch) {
    return null;
  }

  const markerChar = baseMatch[2];
  const identifierStr = baseMatch[4];
  const starred = baseMatch[3] === "*" || baseMatch[5] === "*";
  const text = baseMatch[6];
  const trailers = baseMatch[7];

  // Validate required groups exist
  if (!markerChar || !identifierStr || text === undefined) {
    return null;
  }

  // Parse marker
  const marker = parseMarker(`[${markerChar}]`);
  if (!marker) {
    return null;
  }

  // Parse identifier
  const identifier = parseTaskId(identifierStr);
  if (!identifier) {
    return null;
  }

  // Check for optional marker
  let taskText = text.trim();
  const isOptional = starred || taskText.includes("(optional)");
  if (taskText.includes("(optional)")) {
    taskText = taskText.replace(/\s*\(optional\)\s*/g, "").trim();
  }

  // Kiro trailers at the end of the text, in either order:
  // `_Requirements: 1.2, 3.4_` and `_Properties: 1, 3_` (or `P1, P3`)
  const kiro = takeKiroTrailers(taskText);
  taskText = kiro.rest;
  let requirementsTrailer = kiro.requirements;
  let propertiesTrailer = kiro.properties;

  if (trailers) {
    // Parse criteria trailer: <!-- criteria: 1.2, 3.4 -->
    const criteriaMatch = trailers.match(/<!--\s*criteria:\s*([\d.,\s]+)\s*-->/);
    if (criteriaMatch && criteriaMatch[1]) {
      const criteria = parseCriterionList(criteriaMatch[1]);
      if (criteria.length > 0) {
        requirementsTrailer = [...new Set([...(requirementsTrailer ?? []), ...criteria])];
      }
    }

    // Parse properties trailer: <!-- properties: P1, P2 -->
    const propertiesMatch = trailers.match(/<!--\s*properties:\s*([A-Z\d,\s]+)\s*-->/);
    if (propertiesMatch && propertiesMatch[1]) {
      const properties = parsePropertyList(propertiesMatch[1]);
      if (properties.length > 0) {
        propertiesTrailer = [...new Set([...(propertiesTrailer ?? []), ...properties])];
      }
    }
  }

  const result: {
    marker: TaskMarker;
    identifier: TaskId;
    text: string;
    requirementsTrailer?: CriterionId[];
    propertiesTrailer?: PropertyId[];
    isOptional: boolean;
  } = {
    marker,
    identifier,
    text: taskText,
    isOptional,
  };

  if (requirementsTrailer) {
    result.requirementsTrailer = requirementsTrailer;
  }
  if (propertiesTrailer) {
    result.propertiesTrailer = propertiesTrailer;
  }

  return result;
}

/**
 * Strip the Kiro trailers ending `text`, in either order —
 * `_Requirements: 1.2, 3.4_` and `_Properties: 1, 3_` (or `P1, P3`) — and
 * return what precedes them with the identifiers each named.
 */
function takeKiroTrailers(text: string): {
  rest: string;
  requirements?: CriterionId[];
  properties?: PropertyId[];
} {
  let rest = text.trim();
  let requirements: CriterionId[] | undefined;
  let properties: PropertyId[] | undefined;
  for (;;) {
    const kiroRequirements = /\s*_Requirements:\s*([\d.,\s]+?)\s*_$/.exec(rest);
    if (kiroRequirements?.[1] !== undefined && requirements === undefined) {
      rest = rest.slice(0, kiroRequirements.index).trim();
      const criteria = parseCriterionList(kiroRequirements[1]);
      if (criteria.length > 0) requirements = criteria;
      continue;
    }
    const kiroProperties = /\s*_Properties:\s*((?:P?\d+)(?:\s*,\s*P?\d+)*)\s*_$/.exec(rest);
    if (kiroProperties?.[1] !== undefined && properties === undefined) {
      rest = rest.slice(0, kiroProperties.index).trim();
      const list = parsePropertyList(kiroProperties[1]);
      if (list.length > 0) properties = list;
      continue;
    }
    break;
  }
  return {
    rest,
    ...(requirements ? { requirements } : {}),
    ...(properties ? { properties } : {}),
  };
}

/**
 * Property identifiers in a comma-separated list. `3` and `P3` both name
 * design.md's `Property 3`; unparseable items are dropped.
 */
function parsePropertyList(list: string): PropertyId[] {
  return list
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s)
    .map((s) => parsePropertyId(/^\d+$/.test(s) ? `P${s}` : s))
    .filter((id): id is PropertyId => id !== null);
}

/** Criterion identifiers in a comma-separated list; unparseable items are dropped. */
function parseCriterionList(list: string): CriterionId[] {
  return list
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s)
    .map((s) => parseCriterionId(s))
    .filter((id): id is CriterionId => id !== null);
}

/**
 * Serialize a task line back to string
 */
export function serializeTaskLine(params: {
  marker: TaskMarker;
  identifier: TaskId;
  text: string;
  requirementsTrailer?: CriterionId[];
  propertiesTrailer?: PropertyId[];
  isOptional?: boolean;
}): string {
  const parts: string[] = [];

  // Add marker
  parts.push(`- ${formatMarker(params.marker)}`);

  // Add identifier
  parts.push(formatTaskId(params.identifier));

  // Add text
  let text = params.text.trim();
  if (params.isOptional) {
    text += " (optional)";
  }
  parts.push(text);

  // Add trailers
  const trailers: string[] = [];

  if (params.requirementsTrailer && params.requirementsTrailer.length > 0) {
    const criteria = params.requirementsTrailer.join(", ");
    trailers.push(`<!-- criteria: ${criteria} -->`);
  }

  if (params.propertiesTrailer && params.propertiesTrailer.length > 0) {
    const properties = params.propertiesTrailer.join(", ");
    trailers.push(`<!-- properties: ${properties} -->`);
  }

  let result = parts.join(" ");
  if (trailers.length > 0) {
    result += " " + trailers.join(" ");
  }

  return result;
}

/**
 * Update the marker on a task line, preserving the rest
 */
export function updateTaskMarker(line: string, newMarker: TaskMarker): string {
  const parsed = parseTaskLine(line);
  if (!parsed) {
    return line; // Return unchanged if parse fails
  }

  return serializeTaskLine({
    ...parsed,
    marker: newMarker,
  });
}

/**
 * Check if a line is a task line
 */
export function isTaskLine(line: string): boolean {
  return parseTaskLine(line) !== null;
}

// ============================================================================
// Task Items
// ============================================================================

const FENCE = /^\s*(`{3,}|~{3,})/;
const HEADING = /^ {0,3}#{1,6}(?:\s|$)/;
/**
 * A list item that can interrupt a task's text (CommonMark): a bullet, or an
 * ordered item numbered 1. A wrapped line starting `200) ` continues the text.
 */
const LIST_ITEM = /^\s*(?:[-*+]|0{0,8}1[.)])(?:\s+|$)/;

/**
 * Parse every Task Item of a tasks.md body, in document order.
 *
 * A Task Item is a task line (see parseTaskLine) together with the lines that
 * belong to it, so a plan reads the same after a formatter wraps it:
 *
 * - **continuation lines** — non-blank lines indented deeper than the task's
 *   list marker that are not themselves list items, headings or fences. They
 *   continue the task's text (a wrapped line, with any hanging indent), so a
 *   trailer that a formatter moved onto a later line is still read;
 * - **nested detail bullets** — non-task list items indented deeper than the
 *   task (the Kiro IDE's native shape, `- [ ] 1. Title` then
 *   `  - _Requirements: 1.1, 2.3_`). They are not part of the task's text, but
 *   a `_Requirements:_` or `_Properties:_` trailer ending one belongs to the
 *   task above it.
 *
 * An item ends at a blank line, a line indented no deeper than its marker, a
 * heading, a fence, or the next task line (a sub-task starts its own item).
 * Task lines inside a fenced code block are examples, not tasks. `lineNumber`
 * is the 1-based line of the task line itself, the line whose marker the
 * Platform writes. Every reader of tasks.md — lint, verify, coverage,
 * approve, status, task start and complete — reads tasks through this.
 */
export function parseTaskItems(body: string): TaskLine[] {
  const lines = body.split("\n").map((line) => line.replace(/\r$/, ""));
  const items: TaskLine[] = [];
  let fence: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const open = FENCE.exec(line);
    if (fence !== null) {
      if (open?.[1] !== undefined && open[1].charAt(0) === fence.charAt(0) &&
          open[1].length >= fence.length && line.trim() === open[1]) {
        fence = null;
      }
      continue;
    }
    if (open?.[1] !== undefined) {
      fence = open[1];
      continue;
    }
    if (parseTaskLine(line) === null) continue;

    const indent = indentOf(line);
    const text: string[] = [line.trimEnd()];
    const details: string[][] = [];
    let current = text;
    let j = i + 1;
    for (; j < lines.length; j++) {
      const next = lines[j]!;
      if (next.trim() === "" || indentOf(next) <= indent) break;
      if (FENCE.test(next) || HEADING.test(next) || parseTaskLine(next) !== null) break;
      if (LIST_ITEM.test(next)) {
        current = [next.trim().replace(LIST_ITEM, "")];
        details.push(current);
      } else {
        current.push(next.trim());
      }
    }

    const parsed = parseTaskLine(text.join(" "));
    if (parsed === null) continue;
    let requirements = parsed.requirementsTrailer;
    let properties = parsed.propertiesTrailer;
    for (const detail of details) {
      const trailers = takeKiroTrailers(detail.join(" "));
      if (trailers.requirements) {
        requirements = [...new Set([...(requirements ?? []), ...trailers.requirements])];
      }
      if (trailers.properties) {
        properties = [...new Set([...(properties ?? []), ...trailers.properties])];
      }
    }
    items.push({
      lineNumber: i + 1,
      marker: parsed.marker,
      identifier: parsed.identifier,
      text: parsed.text,
      isOptional: parsed.isOptional,
      ...(requirements ? { requirementsTrailer: requirements } : {}),
      ...(properties ? { propertiesTrailer: properties } : {}),
    });
    i = j - 1;
  }
  return items;
}

/** Width of a line's leading whitespace, a tab counting as four columns. */
function indentOf(line: string): number {
  const lead = /^[ \t]*/.exec(line)?.[0] ?? "";
  return lead.replace(/\t/g, "    ").length;
}

/**
 * Extract all task identifiers from a tasks.md body
 */
export function extractTaskIdentifiers(body: string): TaskId[] {
  return parseTaskItems(body).map((item) => item.identifier);
}
