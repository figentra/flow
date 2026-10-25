/**
 * Scenario 10 — which tasks need evidence. A parent task (a line with
 * sub-tasks) is a container: `vellum task start` refuses it, naming its
 * sub-tasks, and verify requires no evidence for it. A checkpoint is
 * required: the method runs the workspace-wide verification there, and the
 * Evidence Entry of that run is what makes a `[x]` on it checkable. When a
 * parent's last required sub-task is verified, `task complete` marks the
 * parent `[x]` too, and the plan approval still counts (markers are outside
 * the checksum).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveAll, draftSpec } from "./support/lifecycle.js";
import type { TestRepo } from "./support/repo.js";
import { PARENT_TASKS, PASSING_COMMAND, REQUIRED_TASKS, SLUG } from "./support/spec.js";

describe("scenario 10: parents and checkpoints", () => {
  let repo: TestRepo;
  beforeAll(() => {
    repo = draftSpec();
    approveAll(repo);
  });
  afterAll(() => repo?.dispose());

  it("refuses to start a parent task, naming its sub-tasks, and records nothing", () => {
    const before = repo.fingerprint();
    const start = repo.vellum(["task", "start", SLUG, "1"]);
    expect(start.status).toBe(1);
    expect(`${start.stdout}${start.stderr}`).toContain(
      "Task 1 is a parent task; start one of its sub-tasks instead (1.1, 1.2, 1.3)",
    );
    expect(repo.marker("1")).toBe(" ");
    expect(repo.fingerprint()).toBe(before);
  });

  it("a checkpoint with no evidence is the one task verify names", () => {
    // A parent is [-] once a sub-task starts and flips to [x] with its last
    // required sub-task (decision 15; V-06: Property tests are required).
    // Order: 1.1, 1.2, 1.3 (parent 1 → x), 3.1, 3.2 (parent 3 → x)
    const parentMarkers = {
      "1.1": ["-", " "],  // After 1.1: parent 1 started, not complete
      "1.2": ["-", " "],  // After 1.2: parent 1 still needs 1.3
      "1.3": ["x", " "],  // After 1.3: parent 1 complete, parent 3 not started
      "3.1": ["x", "-"],  // After 3.1: parent 3 still needs 3.2
      "3.2": ["x", "x"],  // After 3.2: both parents complete
    } as const;
    for (const id of REQUIRED_TASKS.filter((t) => t !== "2")) {
      expect(repo.vellum(["task", "start", SLUG, id]).status).toBe(0);
      const complete = repo.vellum(["task", "complete", SLUG, id, "--command", PASSING_COMMAND]);
      expect(complete.status).toBe(0);
      const [one, three] = parentMarkers[id as keyof typeof parentMarkers];
      expect([repo.marker("1"), repo.marker("3")]).toEqual([one, three]);
      if (id === "1.3") expect(complete.stdout).toContain("every required sub-task of task 1 is verified");
      if (id === "3.2") expect(complete.stdout).toContain("every required sub-task of task 3 is verified");
    }
    repo.commitAll(`chore: record ${SLUG} leaf evidence`);
    const verify = repo.vellum(["verify", SLUG, "--strict", "--json"]);
    expect(verify.status).toBe(1);
    const findings = JSON.parse(verify.stdout).specs[0].findings as Array<{ rule: string; message: string }>;
    expect(findings.map((f) => `${f.rule}: ${f.message}`)).toEqual([
      "TASK_NOT_VERIFIED: Task 2 has no Evidence Entry with exit status 0",
    ]);
  });

  it("evidence for the checkpoint completes the spec; the parents never needed any", () => {
    expect(repo.vellum(["task", "start", SLUG, "2"]).status).toBe(0);
    expect(repo.vellum(["task", "complete", SLUG, "2", "--command", PASSING_COMMAND]).status).toBe(0);
    repo.commitAll(`chore: record ${SLUG} checkpoint evidence`);
    const verify = repo.vellum(["verify", SLUG, "--strict", "--json"]);
    expect(JSON.parse(verify.stdout).specs[0].findings).toEqual([]);
    expect(verify.status).toBe(0);
    const evidenced = new Set(repo.ledger().filter((e) => e.kind === "evidence").map((e) => e.task_id));
    for (const parent of PARENT_TASKS) expect(evidenced.has(parent)).toBe(false);
    const status = JSON.parse(repo.vellum(["status", SLUG, "--json"]).stdout).specs[0];
    expect(status.verification).toEqual({
      required: REQUIRED_TASKS.length,
      completed: REQUIRED_TASKS.length,
      failed: 0,
      complete: true,
    });
  });
});
