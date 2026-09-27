/**
 * @vellum/engine — Effective Lifecycle State
 *
 * The Effective Lifecycle State is the latest state in Table 5.A whose
 * Transition Preconditions hold (criterion 5.10), computed from the
 * repository content alone: the artifacts, the ledger, the Approval Policy and
 * what storage read from git. Pure function — no I/O.
 *
 * The walk starts at DRAFT and follows the main chain towards the Recorded
 * Lifecycle State, checking the preconditions of each transition; the first
 * transition whose preconditions fail stops it, and that failure is named.
 * So an Invalidated Approval puts the spec back in the in-review state of
 * that artifact's stage (criterion 8.3).
 *
 * A precondition this engine version cannot decide is never assumed to hold:
 * the result is then `inconclusive`, naming the state the spec provably
 * reached and why the next could not be decided.
 *
 * Readings the specs leave open, taken fail-closed:
 * - A Decision entry with `blocking: true` is an unresolved blocking
 *   Decision — the protocol records no resolution of a Decision.
 * - An Open Question is "marked blocking" when an item under an "Open
 *   questions" heading of design.md contains the word "blocking" or "blocker".
 * - A failure entry is unresolved until a later Evidence Entry for the same
 *   task exits 0.
 *
 * @see requirements.md Requirement 5 (Table 5.A), criteria 5.10-5.12, 8.3
 */

import type {
  ApprovalPolicy,
  Artifact,
  ArtifactKind,
  GitCommit,
  LedgerEntry,
  LedgerHead,
  LifecycleState,
  RiskClass,
  TaskLine,
} from "@vellum/protocol";
import { canonicalArtifactBody, computeChecksum, parseTaskItems } from "@vellum/protocol";
import {
  approvalRecords,
  resolveApprovalSignals,
  type ApprovalCommitResolution,
  type ApprovalRecordView,
} from "../approval/records.js";
import { hasRequiredApprovals } from "../approval/verify.js";
import { decidePlanApproval } from "../coverage/plan-approval.js";
import { validateProtocol } from "../validate/protocol-validator.js";
import { buildTaskGraph, validateTaskGraph } from "../validate/task-graph.js";
import { strictVerify } from "../verify/strict.js";
import { requiredTasks } from "./required-tasks.js";

/** Everything the Effective Lifecycle State is computed from. */
export interface EffectiveStateInput {
  readonly artifacts: readonly Artifact[];
  readonly ledger: readonly LedgerEntry[];
  /** The Recorded Lifecycle State as written in the frontmatter (validated here) */
  readonly recordedState: string;
  readonly policy: ApprovalPolicy | null;
  readonly riskClass: RiskClass;
  readonly gitCommits: ReadonlyMap<string, GitCommit>;
  readonly ledgerHead?: LedgerHead | null;
  readonly approvalCommits?: ReadonlyMap<number, ApprovalCommitResolution>;
  /**
   * The verified commit and its ancestors. Needed to decide VERIFICATION →
   * VERIFIED (a Strict Verifier PASS against the verified history); without
   * it that transition is inconclusive.
   */
  readonly verifiedHistory?: ReadonlySet<string>;
}

/** The Effective Lifecycle State, or why it could not be decided. */
export type EffectiveState =
  | {
      readonly kind: "computed";
      readonly state: LifecycleState;
      /** The precondition that stopped the walk short of the recorded state; null when none did */
      readonly failedPrecondition: string | null;
    }
  | {
      readonly kind: "inconclusive";
      /** The latest state whose preconditions were shown to hold */
      readonly holdsThrough: LifecycleState;
      /** Why the next transition's preconditions could not be decided */
      readonly reason: string;
    };

const LIFECYCLE_STATES: readonly LifecycleState[] = [
  "DRAFT",
  "IN_REVIEW",
  "REQUIREMENTS_APPROVED",
  "DESIGN_IN_REVIEW",
  "DESIGN_APPROVED",
  "PLAN_IN_REVIEW",
  "PLAN_APPROVED",
  "IN_PROGRESS",
  "VERIFICATION",
  "VERIFIED",
  "MERGED",
  "RELEASED",
  "DONE",
  "BLOCKED",
  "REJECTED",
  "SUPERSEDED",
  "ABANDONED",
  "INVALID",
];

/** The main chain of Table 5.A, in order. */
const CHAIN: readonly LifecycleState[] = [
  "DRAFT",
  "IN_REVIEW",
  "REQUIREMENTS_APPROVED",
  "DESIGN_IN_REVIEW",
  "DESIGN_APPROVED",
  "PLAN_IN_REVIEW",
  "PLAN_APPROVED",
  "IN_PROGRESS",
  "VERIFICATION",
  "VERIFIED",
  "MERGED",
  "RELEASED",
  "DONE",
];

type Check =
  | { readonly status: "met" }
  | { readonly status: "unmet"; readonly message: string }
  | { readonly status: "unknown"; readonly reason: string };

const MET: Check = { status: "met" };

/** Is `value` one of the Lifecycle State Set's values? */
export function isLifecycleState(value: string): value is LifecycleState {
  return (LIFECYCLE_STATES as readonly string[]).includes(value);
}

/** Position of a state on the main chain; -1 for a state off it. */
export function chainIndex(state: LifecycleState): number {
  return CHAIN.indexOf(state);
}

/**
 * Compute the Effective Lifecycle State of a non-Legacy Spec.
 *
 * @param input - The spec's artifacts, ledger, recorded state, policy and git context
 * @returns The effective state and the failed precondition, or why it is inconclusive
 */
export function computeEffectiveLifecycleState(input: EffectiveStateInput): EffectiveState {
  // Criterion 5.11: a recorded value outside the Lifecycle State Set
  if (!isLifecycleState(input.recordedState)) {
    return {
      kind: "computed",
      state: "INVALID",
      failedPrecondition: `Recorded Lifecycle State '${input.recordedState}' is not a Lifecycle State`,
    };
  }
  const recorded = input.recordedState;

  // Criterion 5.12: a later artifact without an earlier one
  const present = new Set(input.artifacts.map((a) => a.kind));
  const order: readonly ArtifactKind[] = ["requirements", "design", "tasks"];
  for (let i = 1; i < order.length; i++) {
    if (!present.has(order[i]!)) continue;
    const missing = order.slice(0, i).find((kind) => !present.has(kind));
    if (missing !== undefined) {
      return {
        kind: "computed",
        state: "INVALID",
        failedPrecondition: `${order[i]}.md is present without ${missing}.md`,
      };
    }
  }

  if (recorded === "INVALID") {
    return { kind: "computed", state: "INVALID", failedPrecondition: null };
  }

  const context = new Context(input);

  switch (recorded) {
    case "BLOCKED":
      return context.openBlock()
        ? { kind: "computed", state: "BLOCKED", failedPrecondition: null }
        : context.withReason(
            context.walk("VERIFIED"),
            "BLOCKED: no unresolved blocking reason is recorded in the ledger",
          );
    case "REJECTED":
      return context.has("rejection")
        ? { kind: "computed", state: "REJECTED", failedPrecondition: null }
        : context.withReason(
            context.walk("VERIFIED"),
            "REJECTED: no rejection rationale is recorded in the ledger",
          );
    case "SUPERSEDED":
    case "ABANDONED":
      return {
        kind: "inconclusive",
        holdsThrough: "DRAFT",
        reason: `${recorded}: the ledger has no entry kind that records the rationale${recorded === "SUPERSEDED" ? " and superseding Spec" : ""}, so its precondition cannot be checked`,
      };
    default:
      return context.walk(recorded);
  }
}

/** Precondition checks over one spec's content. */
class Context {
  private readonly byKind: ReadonlyMap<ArtifactKind, Artifact>;
  private readonly approvals: readonly ApprovalRecordView[];
  private readonly tasks: readonly TaskLine[];

  constructor(private readonly input: EffectiveStateInput) {
    this.byKind = new Map(input.artifacts.map((a) => [a.kind, a] as const));
    this.approvals = resolveApprovalSignals(
      approvalRecords(input.ledger, input.artifacts),
      input.approvalCommits,
    ).flatMap((resolved) => (resolved.problem === undefined ? [resolved.record] : []));
    const tasks = this.byKind.get("tasks");
    this.tasks = tasks
      ? parseTaskItems(canonicalArtifactBody(tasks.body))
      : [];
  }

  /** Walk the main chain from DRAFT towards `target`. */
  walk(target: LifecycleState): EffectiveState {
    const end = chainIndex(target);
    for (let i = 1; i <= end; i++) {
      const state = CHAIN[i]!;
      const check = this.into(state);
      if (check.status === "unmet") {
        return {
          kind: "computed",
          state: CHAIN[i - 1]!,
          failedPrecondition: `${CHAIN[i - 1]} → ${state}: ${check.message}`,
        };
      }
      if (check.status === "unknown") {
        return {
          kind: "inconclusive",
          holdsThrough: CHAIN[i - 1]!,
          reason: `${CHAIN[i - 1]} → ${state}: ${check.reason}`,
        };
      }
    }
    return { kind: "computed", state: target, failedPrecondition: null };
  }

  /** Attach the side state's own failure when the walk itself found none. */
  withReason(result: EffectiveState, reason: string): EffectiveState {
    if (result.kind === "computed" && result.failedPrecondition === null) {
      return { ...result, failedPrecondition: reason };
    }
    return result;
  }

  has(kind: LedgerEntry["kind"]): boolean {
    return this.input.ledger.some((entry) => entry.kind === kind);
  }

  /** A block entry not followed by an unblock entry. */
  openBlock(): boolean {
    let open = false;
    for (const entry of this.input.ledger) {
      if (entry.kind === "block") open = true;
      if (entry.kind === "unblock") open = false;
    }
    return open;
  }

  /** The preconditions of the transition into `state` (Table 5.A). */
  private into(state: LifecycleState): Check {
    switch (state) {
      case "IN_REVIEW":
        return this.artifactValid("requirements");
      case "REQUIREMENTS_APPROVED":
        return all(this.approved("requirements"), this.noBlockingDecisions());
      case "DESIGN_IN_REVIEW":
        return this.artifactValid("design");
      case "DESIGN_APPROVED":
        return all(
          this.approved("requirements"),
          this.approved("design"),
          this.noBlockingOpenQuestions(),
        );
      case "PLAN_IN_REVIEW":
        return this.artifactValid("tasks");
      case "PLAN_APPROVED":
        return all(
          this.approved("requirements"),
          this.approved("design"),
          this.approved("tasks"),
          this.taskGraphValid(),
          this.planCovered(),
        );
      case "IN_PROGRESS":
        return this.taskDispatched();
      case "VERIFICATION":
        return all(this.requiredTasksVerified(), this.noBlockingDecisions());
      case "VERIFIED":
        return this.strictPass();
      default:
        return {
          status: "unknown",
          reason:
            "the Merge Gate, Release Gate and post-release preconditions (slice 3) are not checked by this engine version",
        };
    }
  }

  private artifactValid(kind: ArtifactKind): Check {
    const artifact = this.byKind.get(kind);
    if (!artifact) return { status: "unmet", message: `${kind}.md does not exist` };
    const findings = validateProtocol([artifact]).findings;
    return findings.length === 0
      ? MET
      : {
          status: "unmet",
          message: `the Protocol Validator reports ${findings.length} finding(s) for ${kind}.md, first: ${findings[0]!.rule} ${findings[0]!.message}`,
        };
  }

  private approved(kind: ArtifactKind): Check {
    const artifact = this.byKind.get(kind);
    if (!artifact) return { status: "unmet", message: `${kind}.md does not exist` };
    const result = hasRequiredApprovals(
      this.approvals,
      this.input.policy,
      this.input.riskClass,
      kind,
      computeChecksum(artifact.body),
      this.input.gitCommits,
    );
    if (result.met) return MET;
    return {
      status: "unmet",
      message:
        this.input.policy === null
          ? `${kind}.md has no valid approval: the Approval Policy is missing`
          : result.required === 0
            ? `the Approval Policy names no required approvals for ${kind} at risk class ${this.input.riskClass}`
            : `${kind}.md has ${result.count} of the ${result.required} valid approvals the policy requires at its current checksum`,
    };
  }

  private noBlockingDecisions(): Check {
    const blocking = this.input.ledger.find(
      (entry) =>
        entry.kind === "decision" && (entry as unknown as { blocking?: unknown }).blocking === true,
    );
    return blocking === undefined
      ? MET
      : { status: "unmet", message: `decision entry ${blocking.id} is a blocking Decision` };
  }

  private noBlockingOpenQuestions(): Check {
    const design = this.byKind.get("design");
    if (!design) return { status: "unmet", message: "design.md does not exist" };
    let inOpenQuestions = false;
    let level = 0;
    for (const line of canonicalArtifactBody(design.body).split("\n")) {
      const heading = /^(#{1,6})\s+(.*)$/.exec(line);
      if (heading) {
        const depth = heading[1]!.length;
        if (/open questions?/i.test(heading[2]!)) {
          inOpenQuestions = true;
          level = depth;
        } else if (inOpenQuestions && depth <= level) {
          inOpenQuestions = false;
        }
        continue;
      }
      if (
        inOpenQuestions &&
        /^\s*(?:[-*]|\d+\.)\s/.test(line) &&
        /\bblock(?:ing|er)\b/i.test(line)
      ) {
        return {
          status: "unmet",
          message: `design.md has an Open Question marked blocking: ${line.trim().slice(0, 80)}`,
        };
      }
    }
    return MET;
  }

  private taskGraphValid(): Check {
    if (!this.byKind.get("tasks")) return { status: "unmet", message: "tasks.md does not exist" };
    const result = validateTaskGraph(buildTaskGraph(this.tasks), this.tasks, "tasks.md");
    return result.valid
      ? MET
      : {
          status: "unmet",
          message: `the task graph fails validation: ${result.findings[0]?.message ?? "invalid"}`,
        };
  }

  /** Criteria 20.1-20.3, 20.7: every criterion covered and every property cited. */
  private planCovered(): Check {
    const decision = decidePlanApproval(this.input.artifacts);
    return decision.approvable
      ? MET
      : { status: "unmet", message: `the plan's coverage fails: ${decision.problems.join("; ")}` };
  }

  private taskDispatched(): Check {
    const started =
      this.tasks.some((task) => task.marker !== " ") ||
      this.input.ledger.some((entry) =>
        (["claim", "attempt", "evidence", "task_binding"] as const).includes(
          entry.kind as "claim" | "attempt" | "evidence" | "task_binding",
        ),
      );
    return started
      ? MET
      : { status: "unmet", message: "no task has been dispatched or recorded as started" };
  }

  private requiredTasksVerified(): Check {
    const passed = new Map<string, number>(); // task → latest passing entry position
    const failed = new Map<string, number>(); // task → latest failure position
    this.input.ledger.forEach((entry, position) => {
      const loose = entry as unknown as {
        task_id?: unknown;
        taskIdentifier?: unknown;
        exit_status?: unknown;
        commit?: unknown;
      };
      const task =
        typeof loose.task_id === "string"
          ? loose.task_id
          : typeof loose.taskIdentifier === "string"
            ? loose.taskIdentifier
            : null;
      if (task === null) return;
      if (entry.kind === "failure") failed.set(task, position);
      if (entry.kind !== "evidence" || loose.exit_status !== 0) return;
      const history = this.input.verifiedHistory;
      if (
        history !== undefined &&
        !(typeof loose.commit === "string" && history.has(loose.commit))
      ) {
        return;
      }
      passed.set(task, position);
    });

    for (const task of requiredTasks(this.tasks)) {
      if (!passed.has(task.identifier)) {
        return {
          status: "unmet",
          message: `Required Task ${task.identifier} has no Evidence Entry with exit status 0`,
        };
      }
    }
    for (const [task, position] of failed) {
      if ((passed.get(task) ?? -1) < position) {
        return { status: "unmet", message: `task ${task} has an unresolved failure` };
      }
    }
    return MET;
  }

  private strictPass(): Check {
    if (this.input.verifiedHistory === undefined) {
      return {
        status: "unknown",
        reason:
          "a Strict Verifier PASS is checked against the verified commit's history, which was not supplied",
      };
    }
    const result = strictVerify(
      this.input.artifacts,
      this.input.ledger,
      this.input.policy,
      this.input.gitCommits,
      this.input.riskClass,
      {
        ...(this.input.ledgerHead !== undefined ? { ledgerHead: this.input.ledgerHead } : {}),
        ...(this.input.approvalCommits ? { approvalCommits: this.input.approvalCommits } : {}),
        verifiedHistory: this.input.verifiedHistory,
      },
    );
    return result.result === "PASS"
      ? MET
      : {
          status: "unmet",
          message: `the Strict Verifier reports ${result.result} (${result.findings.length} finding(s))`,
        };
  }
}

/** All checks met; otherwise the first unmet, else the first unknown. */
function all(...checks: Check[]): Check {
  return (
    checks.find((c) => c.status === "unmet") ?? checks.find((c) => c.status === "unknown") ?? MET
  );
}
