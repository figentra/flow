/**
 * @vellum/engine — Required Tasks
 *
 * The tasks strict verification, the Effective Lifecycle State and status
 * require an Evidence Entry for. Pure.
 *
 * - An optional task (`*` or `(optional)`) is not required.
 * - A parent task — a line with sub-task lines beneath it (`1.` when `1.1`
 *   exists) — is a container, not a unit of work: the method's spec-implement
 *   refuses to implement one, and `vellum task start` refuses to start one. It
 *   is complete when each of its required sub-tasks is verified — or, when all
 *   its sub-tasks are optional, when every one of them is (decision 15) — so it
 *   needs no evidence of its own.
 * - A checkpoint (`N. Checkpoint: …`) is required. The method runs the
 *   workspace-wide verification at a checkpoint and marks it only if that run
 *   is green; the Evidence Entry `vellum task complete` records for that run is
 *   what makes the claim checkable, as for any other task.
 */

import type { TaskLine } from "@vellum/protocol";

type TaskRef = Pick<TaskLine, "identifier" | "isOptional">;

/** Identifiers of the tasks that have at least one sub-task line in `tasks`. */
export function parentTaskIds(tasks: readonly Pick<TaskLine, "identifier">[]): Set<string> {
  const parents = new Set<string>();
  for (const task of tasks) {
    const id = task.identifier as string;
    const dot = id.lastIndexOf(".");
    if (dot > 0) parents.add(id.slice(0, dot));
  }
  return parents;
}

/** The Required Tasks among `tasks`, in their order: neither optional nor a parent. */
export function requiredTasks<T extends TaskRef>(tasks: readonly T[]): T[] {
  const parents = parentTaskIds(tasks);
  return tasks.filter((task) => !task.isOptional && !parents.has(task.identifier as string));
}

/**
 * The ancestors of `taskId` that are task lines, nearest first. `vellum task
 * start` marks those still `[ ]` as `[-]`: a parent has started once any of
 * its sub-tasks has (decision 15).
 */
export function ancestorTasks(tasks: readonly Pick<TaskLine, "identifier">[], taskId: string): string[] {
  const ids = new Set(tasks.map((task) => task.identifier as string));
  const ancestors: string[] = [];
  for (let dot = taskId.lastIndexOf("."); dot > 0; dot = taskId.lastIndexOf(".", dot - 1)) {
    const parent = taskId.slice(0, dot);
    if (ids.has(parent)) ancestors.push(parent);
  }
  return ancestors;
}

/**
 * The parents `taskId`'s verification completes (decision 15): each ancestor
 * of `taskId` (nearest first) that is a task line whose counted sub-tasks
 * include `taskId` and are all in `verified`. A parent's counted sub-tasks
 * are its required leaf descendants when it has at least one; a parent whose
 * leaf descendants are all optional counts every one of them, so it is
 * complete only when all its optional work is done. `vellum task complete`
 * marks the parents `[x]` in the same write that marks `taskId`; Task Markers
 * are outside the Artifact Checksum, so approvals stay valid.
 *
 * Empty when `taskId` is a parent itself, is not in `verified`, or is an
 * optional task under a parent that has required sub-tasks (optional work
 * never decides such a parent).
 */
export function parentsCompletedBy<T extends TaskRef>(
  tasks: readonly T[],
  verified: ReadonlySet<string>,
  taskId: string,
): string[] {
  const parents = parentTaskIds(tasks);
  if (parents.has(taskId) || !verified.has(taskId)) return [];
  const leaves = tasks.filter((task) => !parents.has(task.identifier as string));

  const completed: string[] = [];
  for (const parent of ancestorTasks(tasks, taskId)) {
    const descendants = leaves.filter((task) => (task.identifier as string).startsWith(`${parent}.`));
    const required = descendants.filter((task) => !task.isOptional);
    const counted = (required.length > 0 ? required : descendants).map((task) => task.identifier as string);
    if (!counted.includes(taskId)) continue;
    if (counted.every((id) => verified.has(id))) completed.push(parent);
  }
  return completed;
}
