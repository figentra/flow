/**
 * Figentra Flow file contract:
 * Purpose: the lifecycle's stage table (FR-13): every task runs `start` → `spec` → `approval` → `plan` → `worktree`
 *   → `build` → `gate` → `review` → `land` → `release` → `ship`, and `nextStep` names, for any record, the one stage
 *   it is at and the command that moves it on (P-017).
 * Boundary: pure: reads nothing, writes nothing.
 * Runtime: node
 * Governing contract: STA-1945 (FR-13, FR-24, AC-13, AC-26, P-017, P-029).
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
 * status proves. A shipped record names `status`. The build continues from tasks.md's markers (FR-24): with a wave
 * left it names that wave, so a dead session's restarts at its first unfinished task; with every wave done it is the
 * gate's turn.
 * @param {import("./record.mjs").FlowRecord} record
 * @param {{ specStatus?: string, specDir?: string, wave?: import("./waves.mjs").Wave, built?: boolean }} [facts]
 *   `wave` is `nextWave` of the spec's tasks; `built` says tasks.md has tasks and no wave is left
 * @returns {{ stage: Stage, command: string, wave?: import("./waves.mjs").Wave }}
 */
export function nextStep(record, facts = {}) {
  let at = STAGES.indexOf(record.stage);
  if (record.state === "done") {
    if (at === STAGES.length - 1) return { stage: "ship", command: `${NAME} status` };
    at += 1;
  }
  let floor = STAGES.indexOf(BY_STATUS[facts.specStatus ?? ""] ?? "start");
  const build = STAGES.indexOf("build");
  if (facts.built && Math.max(at, floor) === build && record.state !== "waiting") floor = build + 1;
  const moved = floor > at;
  const stage = STAGES[Math.max(at, floor)];
  if (!moved && record.state === "waiting" && record.asks.length)
    return { stage, command: record.asks[0].command };
  const pr = record.prs.at(-1);
  const command = STAGE_COMMANDS[stage]
    .replace("{KEY}", record.key.toUpperCase())
    .replace("{DIR}", facts.specDir ?? "<spec folder>")
    .replace(" {PR}", pr ? ` ${pr}` : "");
  return stage === "build" && facts.wave
    ? { stage, command, wave: facts.wave }
    : { stage, command };
}
