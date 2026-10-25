/**
 * Tests for recording a lifecycle state the content supports (decision 16):
 * forward along the main chain only, only when the effective state computed
 * for the target is the target, and a state-only frontmatter rewrite.
 */

import { describe, expect, it } from "vitest";
import type { ArtifactKind, LifecycleState } from "@vellum/protocol";
import { computeChecksum } from "@vellum/protocol";
import type { EffectiveState } from "../effective-state.js";
import { planRecordState } from "../stamp.js";

const BODY: Record<ArtifactKind, string> = {
  requirements: "# Requirements Document\n\nOne line.\n",
  design: "# Design Document\n\nOne line.\n",
  tasks: "# Implementation Plan\n\n- [ ] 1. Only task _Requirements: 1.1_\n",
};

function file(kind: ArtifactKind, state: string): string {
  return `---\nversion: 3\nchecksum: ${computeChecksum(BODY[kind])}\nstate: ${state}\ncreatedAt: 2026-09-01T00:00:00.000Z\nupdatedAt: 2026-09-02T00:00:00.000Z\n---\n${BODY[kind]}`;
}

function texts(state: string): Map<ArtifactKind, string> {
  return new Map((["requirements", "design", "tasks"] as const).map((k) => [k, file(k, state)]));
}

const computed = (state: LifecycleState): EffectiveState => ({
  kind: "computed",
  state,
  failedPrecondition: null,
});

describe("planRecordState", () => {
  it("records IN_PROGRESS over PLAN_IN_REVIEW, rewriting only each state line", () => {
    const before = texts("PLAN_IN_REVIEW");
    const plan = planRecordState({ spec: "001-x", texts: before, target: "IN_PROGRESS", effective: computed("IN_PROGRESS") });
    expect(plan).toMatchObject({ kind: "record", from: "PLAN_IN_REVIEW", to: "IN_PROGRESS" });
    if (plan.kind !== "record") throw new Error("expected a record plan");
    expect(plan.writes.map((w) => w.kind)).toEqual(["requirements", "design", "tasks"]);
    for (const write of plan.writes) {
      expect(write.text).toBe(before.get(write.kind)!.replace("state: PLAN_IN_REVIEW", "state: IN_PROGRESS"));
    }
  });

  it("records VERIFIED over IN_PROGRESS when the effective state is VERIFIED", () => {
    const plan = planRecordState({ spec: "001-x", texts: texts("IN_PROGRESS"), target: "VERIFIED", effective: computed("VERIFIED") });
    expect(plan).toMatchObject({ kind: "record", from: "IN_PROGRESS", to: "VERIFIED" });
  });

  it("never records a state the effective state does not reach", () => {
    const short: EffectiveState = {
      kind: "computed",
      state: "IN_PROGRESS",
      failedPrecondition: "IN_PROGRESS → VERIFICATION: Required Task 2 has no Evidence Entry with exit status 0",
    };
    expect(planRecordState({ spec: "001-x", texts: texts("IN_PROGRESS"), target: "VERIFIED", effective: short })).toEqual({
      kind: "unchanged",
      reason:
        "the Effective Lifecycle State reaches IN_PROGRESS, not VERIFIED (IN_PROGRESS → VERIFICATION: Required Task 2 has no Evidence Entry with exit status 0)",
    });
    const unknown: EffectiveState = { kind: "inconclusive", holdsThrough: "VERIFICATION", reason: "no history" };
    expect(planRecordState({ spec: "001-x", texts: texts("IN_PROGRESS"), target: "VERIFIED", effective: unknown }).kind).toBe(
      "unchanged",
    );
  });

  it("never lowers the recorded state, and leaves an off-chain state alone", () => {
    for (const state of ["IN_PROGRESS", "VERIFIED", "MERGED"] as const) {
      expect(
        planRecordState({ spec: "001-x", texts: texts(state), target: "IN_PROGRESS", effective: computed("IN_PROGRESS") }).kind,
        state,
      ).toBe("unchanged");
    }
    for (const state of ["BLOCKED", "ABANDONED", "INVALID"] as const) {
      expect(
        planRecordState({ spec: "001-x", texts: texts(state), target: "VERIFIED", effective: computed("VERIFIED") }),
      ).toEqual({ kind: "unchanged", reason: `the Recorded Lifecycle State ${state} is off the main chain` });
    }
  });

  it("refuses a target off the main chain", () => {
    expect(
      planRecordState({ spec: "001-x", texts: texts("IN_PROGRESS"), target: "BLOCKED", effective: computed("BLOCKED") }).kind,
    ).toBe("unchanged");
  });
});
