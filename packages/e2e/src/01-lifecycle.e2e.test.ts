/**
 * Scenario 1 — the happy path, end to end, through the installed tarball:
 * a spec written the way the method's templates shape it lints clean; a human
 * at a terminal approves each document and commits each approval signed with
 * the key the policy lists; every required task is started and completed by
 * `vellum task complete` running a real passing command; then verify, status,
 * check and doctor all agree the spec is done.
 */

import { afterAll, describe, expect, it } from "vitest";
import { APPROVED_STATE, approve, completeAll, draftSpec, recordEffectiveState } from "./support/lifecycle.js";
import { KINDS, type TestRepo } from "./support/repo.js";
import { PASSING_COMMAND, REQUIRED_TASKS, SLUG } from "./support/spec.js";

describe("scenario 1: full lifecycle", () => {
  let repo: TestRepo;
  afterAll(() => repo?.dispose());

  it("lints a template-shaped draft clean", () => {
    repo = draftSpec();
    const lint = repo.vellum(["lint", SLUG, "--json"]);
    expect(lint.stderr).toBe("");
    expect(lint.status).toBe(0);
    expect(JSON.parse(lint.stdout)).toMatchObject({
      command: "lint",
      status: "PASS",
      findings: [],
      examined: { specs: 1, artifacts: 3, taskLines: 8 },
    });
  });

  it("approves each document from a terminal and a signed commit, one at a time", () => {
    for (const kind of KINDS) {
      approve(repo, kind);
      // The human records the state the approval reaches; the engine confirms it.
      repo.setRecordedState(APPROVED_STATE[kind]);
      repo.commitAll(`docs: ${SLUG} is ${APPROVED_STATE[kind]}`);
      const spec = JSON.parse(repo.vellum(["status", SLUG, "--json"]).stdout).specs[0];
      expect(spec.approvals[kind]).toEqual({ current: 1, required: 1, complete: true });
      expect(spec.effectiveState).toBe(APPROVED_STATE[kind]);
      expect(repo.vellum(["check", SLUG]).status).toBe(0);
    }
    // `vellum adopt` wrote the first entry when requirements.md was brought under management.
    expect(repo.ledger().map((e) => e.kind)).toEqual(["adoption", "approval", "approval", "approval"]);
  });

  it("completes every required task with engine-recorded evidence", () => {
    completeAll(repo);
    const evidence = repo.ledger().filter((e) => e.kind === "evidence");
    expect(evidence.map((e) => e.task_id)).toEqual([...REQUIRED_TASKS]);
    for (const entry of evidence) {
      expect(entry).toMatchObject({ command: PASSING_COMMAND, exit_status: 0, uncommitted: false, timed_out: false });
      expect(entry.output_sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    // V-06: Property tests are no longer optional, so all tasks are now required
  });

  it("verify --strict passes", () => {
    const human = repo.vellum(["verify", SLUG, "--strict"]);
    expect(human.stdout).toContain("Result: PASS");
    expect(human.status).toBe(0);
    const json = JSON.parse(repo.vellum(["verify", SLUG, "--strict", "--json"]).stdout);
    expect(json.result).toBe("PASS");
    expect(json.specs[0].findings).toEqual([]);
  });

  it("status --json reports the effective state and the evidence", () => {
    const state = recordEffectiveState(repo);
    expect(state).toBe("VERIFIED");
    const status = repo.vellum(["status", SLUG, "--json"]);
    expect(status.status).toBe(0);
    const spec = JSON.parse(status.stdout).specs[0];
    expect(spec.specId).toBe(SLUG);
    expect(spec.effectiveState).toBe(state);
    expect(spec.recordedState).toBe(state);
    expect(spec.verification).toEqual({ required: REQUIRED_TASKS.length, completed: REQUIRED_TASKS.length, failed: 0, complete: true });
    expect(spec.ledger.valid).toBe(true);
    for (const kind of KINDS) expect(spec.artifacts[kind].checksumCurrent).toBe(true);
  });

  it("check and doctor pass", () => {
    const check = repo.vellum(["check", "--json"]);
    expect(check.stderr).toBe("");
    expect(JSON.parse(check.stdout)).toMatchObject({ command: "check", exitStatus: 0, findings: [] });
    expect(check.status).toBe(0);
    const doctor = repo.vellum(["doctor"]);
    expect(doctor.stdout).not.toMatch(/^\s*FAIL/m);
    expect(doctor.status).toBe(0);
  });
});
