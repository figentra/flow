/**
 * @vellum/engine — Wave Graph validation (criterion 11.6)
 *
 * Checks the `## Task Dependency Graph` section of tasks.md against the rules
 * the method's tasks template states are lint-checked:
 *
 *   1. every incomplete leaf task appears in exactly one wave — no duplicate,
 *      no omission;
 *   2. parent tasks and checkpoint tasks appear in no wave;
 *   3. wave ids are integers, contiguous, starting at 0.
 *
 * A wave naming a task tasks.md does not define is WAVE_TASK_UNDEFINED
 * (criterion 11.6, naming the wave and the task); every other violation is
 * WAVE_GRAPH_INVALID. The graph records wave membership only, so there are no
 * dependency edges to check for a cycle (WAVE_DEPENDENCY_CYCLE is not
 * reported by this check).
 *
 * A plan with no `## Task Dependency Graph` section yields no finding here.
 *
 * Pure: takes the file text, returns findings. Task lines are read with the
 * same parser every other reader uses (criterion 11.10).
 */

import type { Finding } from "@vellum/protocol";
import { parseTaskItems } from "@vellum/protocol";
import { RuleIdentifier } from "./rules.js";

const HEADING = /^##\s+Task Dependency Graph\s*$/;
const NEXT_SECTION = /^##\s/;
const JSON_FENCE_OPEN = /^\s*```json\s*$/;
const FENCE_CLOSE = /^\s*```\s*$/;
const CHECKPOINT = /^checkpoint\b/i;

interface PlanTask {
  readonly id: string;
  readonly line: number;
  readonly complete: boolean;
  readonly checkpoint: boolean;
}

/**
 * Validate the wave graph in a tasks.md text.
 *
 * @param text - tasks.md, frontmatter included (line numbers are file lines)
 * @param file - the path findings name
 */
export function validateWaveGraph(text: string, file: string): Finding[] {
  const lines = text.split("\n").map((l) => l.replace(/\r$/, ""));
  const headingIndex = lines.findIndex((l) => HEADING.test(l));
  if (headingIndex === -1) return [];

  const finding = (line: number, rule: RuleIdentifier, message: string): Finding => ({
    file,
    line,
    rule,
    message,
  });

  // The first ```json block inside the section.
  let open = -1;
  let close = -1;
  for (let i = headingIndex + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (open === -1) {
      if (NEXT_SECTION.test(line)) break;
      if (JSON_FENCE_OPEN.test(line)) open = i;
    } else if (FENCE_CLOSE.test(line)) {
      close = i;
      break;
    }
  }
  if (open === -1 || close === -1) {
    return [
      finding(
        headingIndex + 1,
        RuleIdentifier.WAVE_GRAPH_INVALID,
        "The Task Dependency Graph section has no complete ```json block",
      ),
    ];
  }
  const graphLine = open + 1;

  let parsed: unknown;
  try {
    parsed = JSON.parse(lines.slice(open + 1, close).join("\n"));
  } catch (error) {
    return [
      finding(
        graphLine,
        RuleIdentifier.WAVE_GRAPH_INVALID,
        `The wave graph is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      ),
    ];
  }
  const waves = readWaves(parsed);
  if (typeof waves === "string") {
    return [finding(graphLine, RuleIdentifier.WAVE_GRAPH_INVALID, waves)];
  }

  const tasks = planTasks(text);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const isParent = (id: string) => tasks.some((t) => t.id.startsWith(`${id}.`));
  const findings: Finding[] = [];

  // Rule 3
  waves.forEach((wave, index) => {
    if (wave.id !== index) {
      findings.push(
        finding(
          graphLine,
          RuleIdentifier.WAVE_GRAPH_INVALID,
          `Wave ids must be contiguous from 0: position ${index} has id ${wave.id}`,
        ),
      );
    }
  });

  // Rules 1 and 2
  const placed = new Map<string, number>();
  for (const wave of waves) {
    for (const id of wave.tasks) {
      const task = byId.get(id);
      if (task === undefined) {
        findings.push(
          finding(
            graphLine,
            RuleIdentifier.WAVE_TASK_UNDEFINED,
            `Wave ${wave.id} names task ${id}, which tasks.md does not define`,
          ),
        );
        continue;
      }
      if (task.checkpoint) {
        findings.push(
          finding(
            graphLine,
            RuleIdentifier.WAVE_GRAPH_INVALID,
            `Wave ${wave.id} names checkpoint task ${id}; checkpoints belong to no wave`,
          ),
        );
        continue;
      }
      if (isParent(id)) {
        findings.push(
          finding(
            graphLine,
            RuleIdentifier.WAVE_GRAPH_INVALID,
            `Wave ${wave.id} names parent task ${id}; only leaf tasks belong to a wave`,
          ),
        );
        continue;
      }
      const earlier = placed.get(id);
      if (earlier !== undefined) {
        findings.push(
          finding(
            graphLine,
            RuleIdentifier.WAVE_GRAPH_INVALID,
            `Task ${id} appears in wave ${earlier} and again in wave ${wave.id}; a task belongs to exactly one wave`,
          ),
        );
        continue;
      }
      placed.set(id, wave.id);
    }
  }
  for (const task of tasks) {
    if (task.complete || task.checkpoint || isParent(task.id) || placed.has(task.id)) continue;
    findings.push(
      finding(
        task.line,
        RuleIdentifier.WAVE_GRAPH_INVALID,
        `Incomplete leaf task ${task.id} appears in no wave of the Task Dependency Graph`,
      ),
    );
  }
  return findings;
}

/** The waves array, or a message saying why the JSON is not a wave graph. */
function readWaves(value: unknown): { id: number; tasks: string[] }[] | string {
  if (
    typeof value !== "object" ||
    value === null ||
    !Array.isArray((value as { waves?: unknown }).waves)
  ) {
    return 'The wave graph must be an object with a "waves" array';
  }
  const waves: { id: number; tasks: string[] }[] = [];
  for (const [index, wave] of (value as { waves: unknown[] }).waves.entries()) {
    const w = wave as { id?: unknown; tasks?: unknown };
    if (typeof wave !== "object" || wave === null || !Number.isInteger(w.id)) {
      return `Wave at position ${index} has no integer "id"`;
    }
    if (!Array.isArray(w.tasks) || !w.tasks.every((t) => typeof t === "string")) {
      return `Wave ${String(w.id)} has no "tasks" array of task ids`;
    }
    waves.push({ id: w.id as number, tasks: w.tasks as string[] });
  }
  return waves;
}

/** Every task outside a code fence, in document order (protocol parseTaskItems). */
function planTasks(text: string): PlanTask[] {
  return parseTaskItems(text).map((task) => ({
    id: task.identifier,
    line: task.lineNumber,
    complete: task.marker === "x",
    checkpoint: CHECKPOINT.test(task.text),
  }));
}
