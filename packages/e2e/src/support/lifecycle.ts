/**
 * Lifecycle steps shared by the scenarios, each asserting what it did so a
 * scenario that builds on it fails at the step that broke.
 */

import { expect } from "vitest";
import { DESIGN, PASSING_COMMAND, REQUIRED_TASKS, REQUIREMENTS, SLUG, TASKS } from "./spec.js";
import { HUMAN, KINDS, TestRepo, type Kind } from "./repo.js";

/**
 * A repository holding spec 001 as the method leaves it before any approval:
 * each document written bare and brought under management by `vellum adopt`
 * / `vellum stamp`, recorded PLAN_IN_REVIEW, committed.
 */
export function draftSpec(): TestRepo {
  const repo = TestRepo.create();
  repo.writeSpec({ requirements: REQUIREMENTS, design: DESIGN, tasks: TASKS });
  expect(repo.frontmatter("requirements").state).toBe("PLAN_IN_REVIEW");
  repo.commitAll(`docs: spec ${SLUG}`);
  return repo;
}

/**
 * `vellum approve` from a terminal session, then the human's signed commit of
 * the ledger files and nothing else.
 */
export function approve(repo: TestRepo, kind: Kind): void {
  const before = repo.ledgerLines().length;
  const result = repo.vellumInTerminal(["approve", SLUG, kind]);
  expect(result.output).toContain("It is NOT valid yet");
  expect(result.status).toBe(0);
  expect(repo.ledgerLines()).toHaveLength(before + 1);
  expect(repo.ledger().at(-1)).toMatchObject({
    kind: "approval",
    artifact: `${kind}.md`,
    identity: HUMAN.email,
    session_type: "human",
    checksum_form: 2,
    // The fingerprint the policy lists for the key git signs with — never
    // user.signingkey's path (a file under this repository's root here).
    identity_key: repo.policyFingerprint(),
  });
  expect(repo.ledgerLines().at(-1)).not.toContain(repo.root);
  repo.commitLedger(`approve: ${SLUG} ${kind}`, HUMAN.key);
}

/** The state each approval lets the spec reach. */
export const APPROVED_STATE: Readonly<Record<Kind, string>> = {
  requirements: "REQUIREMENTS_APPROVED",
  design: "DESIGN_APPROVED",
  tasks: "PLAN_APPROVED",
};

/** Approve all three documents, then record PLAN_APPROVED (committed). */
export function approveAll(repo: TestRepo): void {
  for (const kind of KINDS) approve(repo, kind);
  repo.setRecordedState(APPROVED_STATE.tasks);
  repo.commitAll(`docs: ${SLUG} is ${APPROVED_STATE.tasks}`);
}

/** Start and complete every required task with a real passing command, then commit. */
export function completeAll(repo: TestRepo): void {
  for (const id of REQUIRED_TASKS) {
    const start = repo.vellum(["task", "start", SLUG, id]);
    expect(start.stderr).toBe("");
    expect(start.status).toBe(0);
    expect(repo.marker(id)).toBe("-");
    const complete = repo.vellum(["task", "complete", SLUG, id, "--command", PASSING_COMMAND]);
    expect(complete.stdout).toContain(`Task ${id} verified: exit status 0`);
    expect(complete.status).toBe(0);
    expect(repo.marker(id)).toBe("x");
  }
  repo.commitAll(`chore: record ${SLUG} task evidence`);
}

/**
 * Record the furthest state the content supports: claim `claim`, read the
 * Effective Lifecycle State `vellum status` computes for that claim (the
 * engine walks towards the recorded state and stops at the first unmet
 * precondition), record that, and commit. The default claim is VERIFIED:
 * beyond it (MERGED, RELEASED, DONE) this engine version reports the
 * preconditions as undecidable, so the effective state would be null.
 */
export function recordEffectiveState(repo: TestRepo, claim = "VERIFIED"): string {
  repo.setRecordedState(claim);
  const status = JSON.parse(repo.vellum(["status", SLUG, "--json"]).stdout) as {
    specs: Array<{ effectiveState: string | null }>;
  };
  const effective = status.specs[0]!.effectiveState;
  expect(effective).not.toBeNull();
  repo.setRecordedState(effective!);
  repo.commitAll(`docs: ${SLUG} is ${effective}`);
  return effective!;
}

/** A repository whose spec is approved by signed commits and fully evidenced. */
export function verifiedSpec(): TestRepo {
  const repo = draftSpec();
  approveAll(repo);
  completeAll(repo);
  recordEffectiveState(repo);
  return repo;
}
