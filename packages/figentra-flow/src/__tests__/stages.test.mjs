/**
 * Figentra Flow file contract:
 * Purpose: hold the stage table to its contract (P-017): `nextStep` names one stage and one command for any record;
 *   an unfinished stage stays, a finished one moves on, a shipped task names `status`, an owner ask's command wins
 *   while waiting, and the spec's status never lets the stage fall behind it.
 * Boundary: pure; no files.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945.
 */
// @covers sta-1945:FR-13 sta-1945:AC-13 sta-1945:P-017
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyRecord } from "../lib/record.mjs";
import { nextStep, STAGES } from "../lib/stages.mjs";

/** A record of `sta-9` at `stage` in `state`. */
const at = (
  /** @type {import("../lib/stages.mjs").Stage} */ stage,
  /** @type {"active" | "waiting" | "done" | "failed"} */ state,
) => ({ ...emptyRecord("sta-9"), stage, state });

test("stages: every stage in every state names one known stage and one command (P-017)", () => {
  for (const stage of STAGES)
    for (const state of /** @type {const} */ (["active", "waiting", "done", "failed"]))
      for (const specStatus of [undefined, "draft", "tasked", "done"]) {
        const step = nextStep(at(stage, state), { specStatus });
        assert.ok(STAGES.includes(step.stage), `${stage}/${state}`);
        assert.match(step.command, /^fflow \S/, `${stage}/${state}`);
        assert.ok(STAGES.indexOf(step.stage) >= STAGES.indexOf(stage), `${stage}/${state}`);
      }
});

test("stages: an unfinished stage stays, a finished one moves on, a shipped task is done", () => {
  assert.deepEqual(nextStep(at("start", "active")), {
    stage: "start",
    command: "fflow start STA-9",
  });
  assert.deepEqual(nextStep(at("gate", "failed")), { stage: "gate", command: "fflow gate run" });
  assert.deepEqual(nextStep(at("gate", "done")), { stage: "review", command: "fflow review" });
  assert.deepEqual(nextStep({ ...at("review", "done"), prs: [3, 81] }), {
    stage: "land",
    command: "fflow land 81",
  });
  assert.deepEqual(nextStep(at("ship", "done")), { stage: "ship", command: "fflow status" });
});

test("stages: waiting on the owner names the ask's command", () => {
  const record = {
    ...at("release", "waiting"),
    asks: [{ what: "approve the release Environment", command: "https://example.test/run/1" }],
  };
  assert.deepEqual(nextStep(record), { stage: "release", command: "https://example.test/run/1" });
});

test("stages: the spec's status moves an early stage up to what it proves", () => {
  assert.deepEqual(nextStep(at("spec", "active"), { specStatus: "tasked" }), {
    stage: "worktree",
    command: "fflow start STA-9",
  });
  assert.deepEqual(
    nextStep(at("spec", "active"), { specStatus: "draft", specDir: ".agents/specs/sta-9-x" }),
    { stage: "spec", command: "fflow gate check .agents/specs/sta-9-x" },
  );
  assert.equal(nextStep(at("land", "active"), { specStatus: "done" }).stage, "land");
});
