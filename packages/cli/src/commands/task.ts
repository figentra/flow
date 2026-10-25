/**
 * vellum task — start a task after the pre-execution check; complete it by
 * running its verification command and recording the evidence.
 */

import { join, relative } from "node:path";
import type { Checksum, LedgerEntry, LifecycleState } from "@vellum/protocol";
import {
  CHECKSUM_FORM,
  EXIT_STATUS,
  LEDGER_SCHEMA_VERSION,
  parseTaskItems,
  readChecksumForm,
} from "@vellum/protocol";
import {
  checkLedgerIntegrity,
  ancestorTasks,
  checkTaskBinding,
  computeEffectiveLifecycleState,
  containsSecretPattern,
  parentsCompletedBy,
  requiredTasks,
  planRecordState,
  preExecutionCheck,
  type TaskBinding,
} from "@vellum/engine";
import {
  LedgerError,
  appendLedgerEntry,
  changedPaths,
  findTask,
  headCommit,
  loadSpec,
  resolveSpec,
  runVerificationCommand,
  setTaskMarker,
  setTaskMarkers,
  specRiskClass,
  writeFileAtomically,
  type LoadedSpec,
  type SpecRef,
} from "@vellum/storage";
import { VERSION } from "../version.js";
import type { CliContext } from "../context.js";
import { enginePolicy, gitContext, isLegacy, openRepo, type Repo } from "../repo.js";

/** Default time a verification command may run before it is stopped. */
export const DEFAULT_TIMEOUT_SECONDS = 600;

interface Opened {
  readonly repo: Repo;
  readonly spec: LoadedSpec;
}

/** Open the repo and spec, refusing a legacy spec or a damaged ledger. */
async function open(ctx: CliContext, fragment: string, verb: string): Promise<Opened | number> {
  const repo = await openRepo(ctx);
  if (typeof repo === "number") return repo;
  const match = resolveSpec(repo.root, fragment);
  if (match.kind !== "one") {
    ctx.stderr.write(
      `vellum task ${verb}: '${fragment}' matches ${match.kind === "none" ? "no spec" : `more than one spec: ${match.matches.map((m) => m.slug).join(", ")}`}\n`,
    );
    return EXIT_STATUS.INCONCLUSIVE;
  }
  const spec = loadSpec(match.spec);
  if (isLegacy(spec)) {
    // Criterion 18.8
    ctx.stderr.write(
      `vellum task ${verb}: refused — ${spec.ref.slug} is a legacy spec; run npx vellum adopt ${spec.ref.slug} first\n`,
    );
    return EXIT_STATUS.FAILURE;
  }
  if (spec.artifactProblems.length > 0 || spec.ledgerProblem !== null) {
    ctx.stderr.write(
      `vellum task ${verb}: cannot read the spec: ${[...spec.artifactProblems.map((p) => p.message), ...(spec.ledgerProblem ? [spec.ledgerProblem] : [])].join("; ")}\n`,
    );
    return EXIT_STATUS.INCONCLUSIVE;
  }
  const integrity = checkLedgerIntegrity(spec.ledger, spec.ledgerHead);
  if (!integrity.valid) {
    ctx.stderr.write(
      `vellum task ${verb}: refused — ledger integrity failure: ${integrity.failures.map((f) => `entry ${f.entry_id}: ${f.message}`).join("; ")}\n`,
    );
    return EXIT_STATUS.FAILURE;
  }
  if (repo.policy.kind === "invalid") {
    ctx.stderr.write(`vellum task ${verb}: Approval Policy is invalid: ${repo.policy.message}\n`);
    return EXIT_STATUS.INCONCLUSIVE;
  }
  return { repo, spec };
}

/** Tasks with committed, passing evidence: exit status 0, not recorded as uncommitted. */
function passingTasks(ledger: readonly LedgerEntry[]): string[] {
  return ledger.flatMap((entry) => {
    const evidence = entry as unknown as Record<string, unknown>;
    return entry.kind === "evidence" &&
      evidence.exit_status === 0 &&
      evidence.uncommitted !== true &&
      typeof evidence.task_id === "string"
      ? [evidence.task_id]
      : [];
  });
}

function nextId(spec: LoadedSpec): number {
  return (spec.ledger[spec.ledger.length - 1]?.id ?? 0) + 1;
}

/** The latest Task Binding the ledger holds for `taskId`, in the engine's shape. */
function latestBinding(ledger: readonly LedgerEntry[], taskId: string): TaskBinding | null {
  for (let i = ledger.length - 1; i >= 0; i--) {
    const entry = ledger[i] as unknown as Record<string, unknown>;
    if (entry.kind !== "task_binding" || entry.task_id !== taskId) continue;
    return {
      taskIdentifier: taskId,
      requirementsVersion: entry.requirements_version as number,
      requirementsChecksum: entry.requirements_checksum as Checksum,
      designVersion: entry.design_version as number,
      designChecksum: entry.design_checksum as Checksum,
      planVersion: entry.plan_version as number,
      planChecksum: entry.plan_checksum as Checksum,
      checksumForm: readChecksumForm(entry.checksum_form),
    };
  }
  return null;
}

/**
 * Record the first of `targets` the content now supports as the Recorded
 * Lifecycle State (decision 16 in 002's design): the spec is read again as
 * this command left it, and only each artifact's `state:` line is rewritten.
 * Returns the sentence to print, or "" when nothing changes.
 */
function recordState(repo: Repo, ref: SpecRef, targets: readonly LifecycleState[]): string {
  const spec = loadSpec(ref);
  const policy = enginePolicy(repo.policy);
  const git = gitContext(repo.root, spec, policy);
  for (const target of targets) {
    const effective = computeEffectiveLifecycleState({
      artifacts: spec.artifacts,
      ledger: spec.ledger,
      recordedState: target,
      policy,
      riskClass: specRiskClass(repo.policy, ref.slug),
      gitCommits: git.gitCommits,
      ledgerHead: spec.ledgerHead,
      approvalCommits: git.approvalCommits,
      verifiedHistory: git.verifiedHistory,
    });
    const plan = planRecordState({ spec: ref.slug, texts: spec.texts, target, effective });
    if (plan.kind !== "record") continue;
    for (const write of plan.writes) writeFileAtomically(join(ref.path, `${write.kind}.md`), write.text);
    return ` Recorded Lifecycle State: ${plan.from} → ${plan.to}.`;
  }
  return "";
}

export const task = {
  /**
   * Start a task (criterion 18): the pre-execution check (artifacts exist,
   * hold valid approvals bound to their current checksums, the task's
   * references resolve); on success a Task Binding is appended and the
   * marker set to `[-]`. On failure nothing is written (18.6, 18.7).
   *
   * Exit: 0 started; 1 refused; 2 usage error or unreadable input.
   */
  start: async (args: { spec: string; taskId: string }, ctx: CliContext): Promise<number> => {
    const opened = await open(ctx, args.spec, "start");
    if (typeof opened === "number") return opened;
    const { repo, spec } = opened;
    const policy = enginePolicy(repo.policy);
    const git = gitContext(repo.root, spec, policy);

    const result = preExecutionCheck(spec.artifacts, spec.ledger, args.taskId, {
      policy,
      riskClass: specRiskClass(repo.policy, spec.ref.slug),
      gitCommits: git.gitCommits,
      approvalCommits: git.approvalCommits,
    });
    if (!result.passed || result.taskBinding === null) {
      ctx.stderr.write(`vellum task start: refused — task ${args.taskId} failed the pre-execution check:\n`);
      if (repo.policy.kind === "missing") {
        ctx.stderr.write(`  the Approval Policy is missing (${repo.policy.path})\n`);
      }
      for (const error of result.errors) ctx.stderr.write(`  ${error}\n`);
      return EXIT_STATUS.FAILURE;
    }

    const b = result.taskBinding;
    try {
      await appendLedgerEntry(spec.ledgerPath, {
        kind: "task_binding",
        id: nextId(spec),
        timestamp: new Date().toISOString(),
        task_id: args.taskId,
        requirements_version: b.requirementsVersion,
        requirements_checksum: b.requirementsChecksum,
        design_version: b.designVersion,
        design_checksum: b.designChecksum,
        plan_version: b.planVersion,
        plan_checksum: b.planChecksum,
        checksum_form: CHECKSUM_FORM,
      });
    } catch (error) {
      if (error instanceof LedgerError) {
        ctx.stderr.write(`vellum task start: refused — ${error.message}\n`);
        return EXIT_STATUS.FAILURE;
      }
      throw error;
    }
    // Decision 15: a parent has started once any of its sub-tasks has. Only a
    // `[ ]` parent changes; the roll-up in `task complete` decides `[x]`.
    const items = parseTaskItems(spec.texts.get("tasks") ?? "");
    const started = ancestorTasks(items, args.taskId).filter(
      (id) => items.find((item) => item.identifier === id)?.marker === " ",
    );
    setTaskMarkers(
      join(spec.ref.path, "tasks.md"),
      new Map([args.taskId, ...started].map((id) => [id, "-"] as const)),
    );
    ctx.stdout.write(
      `Task ${args.taskId} started: Task Binding recorded, marker set to [-]` +
        (started.length > 0 ? `; ${started.map((p) => `parent ${p}`).join(" and ")} marked [-] too.` : ".") +
        `${recordState(repo, spec.ref, ["IN_PROGRESS"])}\n`,
    );
    return EXIT_STATUS.SUCCESS;
  },

  /**
   * Complete a task (criteria 9, 18.10-18.12). Vellum runs the verification
   * command itself — the caller reports nothing — and appends an Evidence
   * Entry with the real exit status, timestamps, duration, HEAD commit and a
   * SHA-256 of the output (never the output). Only exit status 0 with a
   * working tree equal to HEAD outside the spec directory sets `[x]`.
   *
   * Exit: 0 verified and marked `[x]`; 1 the command failed, the evidence is
   * uncommitted, or completion was refused; 2 usage error or unreadable
   * input.
   */
  complete: async (
    args: { spec: string; taskId: string; command: string; timeoutSeconds: number },
    ctx: CliContext,
  ): Promise<number> => {
    const opened = await open(ctx, args.spec, "complete");
    if (typeof opened === "number") return opened;
    const { repo, spec } = opened;
    const tasksPath = join(spec.ref.path, "tasks.md");
    const tasksText = spec.texts.get("tasks");
    if (tasksText === undefined || findTask(tasksText, args.taskId) === null) {
      ctx.stderr.write(`vellum task complete: task ${args.taskId} is not in ${spec.ref.slug}/tasks.md\n`);
      return EXIT_STATUS.FAILURE;
    }

    // Criterion 18.12
    const binding = latestBinding(spec.ledger, args.taskId);
    if (binding === null) {
      ctx.stderr.write(
        `vellum task complete: refused — task ${args.taskId} has no Task Binding; run 'vellum task start ${spec.ref.slug} ${args.taskId}' first\n`,
      );
      return EXIT_STATUS.FAILURE;
    }
    // Criteria 18.10, 18.11
    const bound = checkTaskBinding(binding, spec.artifacts);
    if (!bound.matches) {
      setTaskMarker(tasksPath, args.taskId, " ");
      ctx.stderr.write(
        `vellum task complete: refused — ${bound.mismatchedArtifact}.md changed since task ${args.taskId} started; marker reset to [ ]. Start the task again.\n`,
      );
      return EXIT_STATUS.FAILURE;
    }
    // Criterion 9.4
    const secret = containsSecretPattern(args.command);
    if (secret.contains) {
      ctx.stderr.write(
        `vellum task complete: refused — the command for task ${args.taskId} matches secret pattern ${secret.pattern}\n`,
      );
      return EXIT_STATUS.FAILURE;
    }

    const commit = headCommit(repo.root);
    if (commit === null) {
      ctx.stderr.write("vellum task complete: refused — the repository has no commit to bind evidence to\n");
      return EXIT_STATUS.FAILURE;
    }
    // Criterion 9.6. Tasks declare no Affected Paths in this protocol version,
    // so every path outside the spec directory counts.
    const dirty = changedPaths(repo.root, relative(repo.root, spec.ref.path));

    ctx.stderr.write(`vellum: running task ${args.taskId}'s verification command: ${args.command}\n`);
    const run = await runVerificationCommand(args.command, {
      cwd: repo.root,
      timeoutMs: args.timeoutSeconds * 1000,
    });
    if (run.stdoutTail !== "") ctx.stderr.write(`--- stdout (tail) ---\n${run.stdoutTail}\n`);
    if (run.stderrTail !== "") ctx.stderr.write(`--- stderr (tail) ---\n${run.stderrTail}\n`);

    try {
      await appendLedgerEntry(spec.ledgerPath, {
        kind: "evidence",
        id: nextId(spec),
        timestamp: run.finishedAt,
        task_id: args.taskId,
        command: args.command,
        exit_status: run.exitStatus,
        start_timestamp: run.startedAt,
        finish_timestamp: run.finishedAt,
        commit,
        affected_paths: [],
        environment_versions: {
          platform: VERSION,
          schema: LEDGER_SCHEMA_VERSION,
          node: process.versions.node,
        },
        uncommitted: dirty.length > 0,
        output_sha256: run.outputSha256,
        duration_ms: run.durationMs,
        timed_out: run.timedOut,
      });
    } catch (error) {
      if (error instanceof LedgerError) {
        ctx.stderr.write(`vellum task complete: could not record evidence — ${error.message}\n`);
        return EXIT_STATUS.FAILURE;
      }
      throw error;
    }

    const summary = `exit status ${run.exitStatus}${run.timedOut ? ` (stopped after ${args.timeoutSeconds}s)` : ""}, ${run.durationMs} ms, at ${commit.slice(0, 12)}`;
    if (run.exitStatus !== 0) {
      ctx.stdout.write(`Task ${args.taskId} FAILED: ${summary}. Evidence recorded; marker unchanged.\n`);
      return EXIT_STATUS.FAILURE;
    }
    if (dirty.length > 0) {
      ctx.stdout.write(
        `Task ${args.taskId}: command passed (${summary}) but the working tree differs from HEAD (${dirty.slice(0, 5).join(", ")}${dirty.length > 5 ? ", …" : ""}); evidence recorded as uncommitted, marker unchanged. Commit and run again.\n`,
      );
      return EXIT_STATUS.FAILURE;
    }
    // A parent whose last required sub-task this was is complete too; its
    // marker flips in the same write (Task Markers are outside the checksum).
    // A parent whose sub-tasks all count as done — its required ones, or every
    // one when all are optional (decision 15) — completes in the same write.
    const items = parseTaskItems(tasksText);
    const parents = parentsCompletedBy(
      items,
      new Set([...passingTasks(spec.ledger), args.taskId]),
      args.taskId,
    );
    setTaskMarkers(tasksPath, new Map([args.taskId, ...parents].map((id) => [id, "x"] as const)));
    const required = requiredTasks(items).map((item) => item.identifier as string);
    const reasons = parents.map((p) =>
      required.some((id) => id.startsWith(`${p}.`))
        ? `every required sub-task of task ${p} is verified`
        : `every sub-task of task ${p} is verified (all are optional)`,
    );
    ctx.stdout.write(
      `Task ${args.taskId} verified: ${summary}. Evidence recorded; marker set to [x]` +
        (parents.length > 0
          ? `; ${reasons.join(", and ")}, so ${parents.length === 1 ? "its marker is" : "their markers are"} set to [x] too.`
          : ".") +
        `${recordState(repo, spec.ref, ["VERIFIED", "IN_PROGRESS"])}\n`,
    );
    return EXIT_STATUS.SUCCESS;
  },
};
