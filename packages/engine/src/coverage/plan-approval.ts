/**
 * @vellum/engine — Coverage gates plan approval (Requirement 20)
 *
 * A plan that leaves any criterion without a task, or any property without a
 * citing task, cannot be approved. This decides it; `vellum approve <spec>
 * tasks` refuses on it (criterion 20.4) and the Effective Lifecycle State
 * holds `PLAN_APPROVED` to it (criterion 20.3).
 *
 * Pure function - no I/O.
 *
 * @see requirements.md Criteria 20.1-20.4, 20.7
 */

import type { Artifact, TaskLine } from "@vellum/protocol";
import { canonicalArtifactBody, parseTaskItems } from "@vellum/protocol";
import { computeCoverage, type CoverageResult } from "./validate.js";

/** Whether the plan, as the artifacts stand, may be approved. */
export type PlanApprovalDecision =
  | { readonly approvable: true; readonly coverage: CoverageResult }
  | {
      readonly approvable: false;
      /** One line per reason: a missing artifact, zero criteria, each gap named */
      readonly problems: readonly string[];
      /** Null when coverage could not be computed (an artifact is missing) */
      readonly coverage: CoverageResult | null;
    };

/**
 * Decide whether the plan covers every criterion requirements.md defines and
 * cites every property design.md defines (criteria 20.1, 20.2). Refused when
 * requirements.md or design.md is absent, or requirements.md yields zero
 * criteria (criterion 20.7: coverage is then INCONCLUSIVE, and the
 * transition is rejected).
 */
export function decidePlanApproval(artifacts: readonly Artifact[]): PlanApprovalDecision {
  const body = (kind: Artifact["kind"]) => {
    const artifact = artifacts.find((a) => a.kind === kind);
    return artifact === undefined ? undefined : canonicalArtifactBody(artifact.body);
  };
  const requirements = body("requirements");
  const design = body("design");
  const tasks = body("tasks");

  const missing = (
    [
      ["requirements", requirements],
      ["design", design],
      ["tasks", tasks],
    ] as const
  ).flatMap(([kind, text]) =>
    text === undefined ? [`${kind}.md is missing, so the plan's coverage cannot be evaluated`] : [],
  );
  if (requirements === undefined || design === undefined || tasks === undefined) {
    return { approvable: false, problems: missing, coverage: null };
  }

  const coverage = computeCoverage(requirements, design, planTaskLines(tasks));
  if (coverage.result === "PASS") return { approvable: true, coverage };
  if (coverage.result === "INCONCLUSIVE") {
    return {
      approvable: false,
      problems: ["requirements.md yields zero criteria; coverage is INCONCLUSIVE"],
      coverage,
    };
  }
  return {
    approvable: false,
    problems: [
      ...coverage.uncoveredCriteria.map(
        (id) => `Criterion ${id} is referenced by no task's requirements trailer`,
      ),
      ...coverage.uncitedProperties.map((id) => `Property ${id} is cited by no task`),
    ],
    coverage,
  };
}

function planTaskLines(body: string): TaskLine[] {
  return parseTaskItems(body);
}
