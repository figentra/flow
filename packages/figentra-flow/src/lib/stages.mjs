/**
 * Figentra Flow file contract:
 * Purpose: the lifecycle's stage table (FR-13): every task runs `start` → `spec` → `approval` → `plan` → `worktree`
 *   → `build` → `gate` → `review` → `land` → `release` → `ship`, and `nextStep` names, for any record, the one stage
 *   it is at and the command that moves it on (P-017).
 * Boundary: pure: reads nothing, writes nothing. A command a later PR builds (`task wave`) is named
 *   here already, since the chain is the contract.
 * Runtime: node
 * Governing contract: STA-1945 (FR-13, AC-13, P-017).
 * Secrets: none.
 */
import { NAME } from "./product.mjs";

/** @typedef {"start" | "spec" | "approval" | "plan" | "worktree" | "build" | "gate" | "review" | "land" | "release" | "ship"} Stage */

/** The stages, in order. @type {Stage[]} */
export const STAGES = [
  "start",
  "spec",
  "approval",
  "plan",
  "worktree",
  "build",
  "gate",
  "review",
  "land",
  "release",
  "ship",
];

/** Each stage's command; `{KEY}`, `{DIR}` and `{PR}` are filled from the record and the facts. */
export const STAGE_COMMANDS = {
  start: `${NAME} start {KEY}`,
  spec: `${NAME} gate check {DIR}`,
  approval: `${NAME} gate check {DIR}`,
  plan: `${NAME} plan {KEY}`,
  worktree: `${NAME} start {KEY}`,
  build: `${NAME} task wave {KEY}`,
  gate: `${NAME} gate run`,
  review: `${NAME} review {PR}`,
  land: `${NAME} land {PR}`,
  release: `${NAME} release`,
  ship: `${NAME} ship staging`,
};

/** The least stage a spec's `**Status**` proves reached: its earlier stages are done. @type {Record<string, Stage>} */
const BY_STATUS = {
  draft: "spec",
  clarified: "approval",
  planned: "plan",
  tasked: "worktree",
  implementing: "build",
  done: "gate",
};

/**
 * The stage a record is at and the command that moves it on: the recorded stage while it is active, waiting or
 * failed (an owner ask's command while waiting on one), else the stage after it; never earlier than the spec's
 * status proves. A shipped record names `status`.
 * @param {import("./record.mjs").FlowRecord} record
 * @param {{ specStatus?: string, specDir?: string }} [facts]
 * @returns {{ stage: Stage, command: string }}
 */
export function nextStep(record, facts = {}) {
  let at = STAGES.indexOf(record.stage);
  if (record.state === "done") {
    if (at === STAGES.length - 1) return { stage: "ship", command: `${NAME} status` };
    at += 1;
  }
  const floor = STAGES.indexOf(BY_STATUS[facts.specStatus ?? ""] ?? "start");
  const moved = floor > at;
  const stage = STAGES[Math.max(at, floor)];
  if (!moved && record.state === "waiting" && record.asks.length)
    return { stage, command: record.asks[0].command };
  const pr = record.prs.at(-1);
  const command = STAGE_COMMANDS[stage]
    .replace("{KEY}", record.key.toUpperCase())
    .replace("{DIR}", facts.specDir ?? "<spec folder>")
    .replace(" {PR}", pr ? ` ${pr}` : "");
  return { stage, command };
}
