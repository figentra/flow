/**
 * The lint query: the Protocol Validator over spec artifacts.
 */

import { relative } from "node:path";
import type { ArtifactKind, Finding } from "@vellum/protocol";
import {
  canonicalArtifactBody,
  parseTaskItems,
  validateLedgerEntry,
} from "@vellum/protocol";
import {
  checkLedgerIntegrity,
  detectLegacyStage,
  extractCriteria,
  extractProperties,
  findClarificationMarkers,
  sortFindings,
  validateMachineFolder,
  validateProtocol,
  validateSpecFolder,
  validateWaveGraph,
} from "@vellum/engine";
import { loadSpec, type LoadedSpec, type SpecRef } from "../workspace.js";
import { isLegacy, relativeFinding, type Repository } from "./repository.js";
import { outcomeExitStatus, type Outcome } from "./result.js";

export const ARTIFACT_KINDS: readonly ArtifactKind[] = [
  "requirements",
  "design",
  "tasks",
];

export function isArtifactKind(value: string): value is ArtifactKind {
  return (ARTIFACT_KINDS as readonly string[]).includes(value);
}

/** Machine Folder entries that are transient artifacts of an append in progress. */
const TRANSIENT = /^(ledger\.jsonl\.lock|\..*\.tmp)$/;

/** What lint examined, so a PASS says what it covered (criterion 19.2). */
export interface LintExamined {
  specs: number;
  legacySpecs: number;
  artifacts: number;
  taskLines: number;
  ledgerEntries: number;
}

export interface LintQuery {
  readonly type: ArtifactKind | "all";
  readonly status: Outcome;
  readonly examined: LintExamined;
  /** Legacy specs, listed and not validated: `<slug> (stage: <stage>)` */
  readonly legacy: readonly string[];
  /** Sorted findings, paths relative to the repository root */
  readonly findings: readonly Finding[];
}

/**
 * Checks, for each spec under Vellum management: the spec folder contract
 * (criteria 23.1-23.5), each artifact's Lifecycle Frontmatter and checksum
 * (11.1, 11.8), task-line markers (10.5), task criterion references (11.4),
 * the tasks.md wave graph when the plan has one (11.6: every incomplete leaf
 * in exactly one wave, no parent or checkpoint in a wave, wave ids contiguous
 * from 0), unresolved `[NEEDS CLARIFICATION: …]` markers in requirements.md
 * and design.md, and, without `only`, the ledger's schema and integrity.
 * Legacy specs are listed and not validated. The Markdown Protocol checks of
 * 11.2 and 11.5 are not implemented in this version.
 *
 * FAIL when there is a finding; INCONCLUSIVE when no artifact was examined.
 */
export function queryLint(
  repo: Repository,
  specs: readonly SpecRef[],
  only: ArtifactKind | undefined,
): LintQuery {
  const findings: Finding[] = [];
  const legacy: string[] = [];
  const examined: LintExamined = {
    specs: 0,
    legacySpecs: 0,
    artifacts: 0,
    taskLines: 0,
    ledgerEntries: 0,
  };

  for (const ref of specs) {
    const spec = loadSpec(ref);
    if (isLegacy(spec)) {
      examined.legacySpecs++;
      legacy.push(`${ref.slug} (stage: ${detectLegacyStage(spec.entries)})`);
      continue;
    }
    examined.specs++;
    findings.push(...lintSpec(repo.root, spec, only, examined));
  }

  const sorted = sortFindings(findings);
  const status: Outcome =
    sorted.length > 0
      ? "FAIL"
      : examined.artifacts === 0
        ? "INCONCLUSIVE"
        : "PASS";
  return { type: only ?? "all", status, examined, legacy, findings: sorted };
}

/** The JSON document `vellum lint --json` writes (criterion 3.5). */
export function lintDocument(
  query: LintQuery,
): { command: "lint" } & LintQuery {
  return {
    command: "lint",
    type: query.type,
    status: query.status,
    examined: query.examined,
    legacy: query.legacy,
    findings: query.findings,
  };
}

/** 1 when there is a finding; 2 when nothing was examined; 0 otherwise. */
export function lintExitStatus(query: LintQuery) {
  return outcomeExitStatus(query.status);
}

function lintSpec(
  root: string,
  spec: LoadedSpec,
  only: ArtifactKind | undefined,
  examined: LintExamined,
): Finding[] {
  const findings: Finding[] = [];
  const slugPath = relative(root, spec.ref.path);
  const rel = (f: Finding) => relativeFinding(root, f);
  const withSpecPath = (f: Finding) => ({
    ...f,
    file: f.file.replace(spec.ref.slug, slugPath),
  });

  if (only === undefined) {
    findings.push(
      ...validateSpecFolder(spec.entries, spec.ref.slug, false).findings.map(
        withSpecPath,
      ),
    );
    if (spec.machineEntries !== null) {
      const entries = spec.machineEntries.filter((e) => !TRANSIENT.test(e));
      findings.push(
        ...validateMachineFolder(entries, spec.ref.slug).findings.map(
          withSpecPath,
        ),
      );
    }
  }

  for (const problem of spec.artifactProblems) {
    if (only !== undefined && problem.kind !== only) continue;
    examined.artifacts++;
    findings.push({
      file: relative(root, problem.file),
      line: 1,
      rule: "FRONTMATTER_MISSING",
      message: problem.message,
    });
  }
  for (const artifact of spec.artifacts) {
    if (only !== undefined && artifact.kind !== only) continue;
    examined.artifacts++;
    findings.push(...validateProtocol([artifact]).findings.map(rel));
  }

  for (const kind of ["requirements", "design"] as const) {
    const text = spec.texts.get(kind);
    if (text === undefined || (only !== undefined && only !== kind)) continue;
    findings.push(
      ...findClarificationMarkers(text, relative(root, `${spec.ref.path}/${kind}.md`)),
    );
  }

  const tasksText = spec.texts.get("tasks");
  if (tasksText !== undefined && (only === undefined || only === "tasks")) {
    const tasksFile = relative(root, `${spec.ref.path}/tasks.md`);
    findings.push(...validateWaveGraph(tasksText, tasksFile));
    const requirements = spec.artifacts.find((a) => a.kind === "requirements");
    const criteria = requirements
      ? new Set(extractCriteria(canonicalArtifactBody(requirements.body)))
      : null;
    const design = spec.artifacts.find((a) => a.kind === "design");
    const properties = design
      ? new Set(extractProperties(canonicalArtifactBody(design.body)))
      : null;
    tasksText.split("\n").forEach((raw, index) => {
      const line = raw.replace(/\r$/, "");
      const checkbox = /^\s*-\s*\[(.)\]\*?\s*\d/.exec(line);
      if (checkbox && !" x~-".includes(checkbox[1]!)) {
        findings.push({
          file: tasksFile,
          line: index + 1,
          rule: "TASK_MARKER_INVALID",
          message: `Task marker [${checkbox[1]}] is not one of [ ], [~], [-], [x]`,
        });
      }
    });
    // A task's trailers may sit on the lines a formatter wrapped it onto, or in
    // a nested Kiro bullet; parseTaskItems reads them all.
    for (const task of parseTaskItems(tasksText)) {
      examined.taskLines++;
      for (const ref of task.requirementsTrailer ?? []) {
        if (criteria !== null && !criteria.has(ref)) {
          findings.push({
            file: tasksFile,
            line: task.lineNumber,
            rule: "TASK_CRITERION_UNDEFINED",
            message: `Task ${task.identifier} cites criterion ${ref}, which requirements.md does not define`,
          });
        }
      }
      for (const ref of task.propertiesTrailer ?? []) {
        if (properties !== null && !properties.has(ref)) {
          findings.push({
            file: tasksFile,
            line: task.lineNumber,
            rule: "TASK_PROPERTY_UNDEFINED",
            message: `Task ${task.identifier} cites property ${ref}, which design.md does not define`,
          });
        }
      }
    }
  }

  if (only === undefined) {
    const ledgerFile = relative(root, spec.ledgerPath);
    if (spec.ledgerProblem !== null) {
      findings.push({
        file: ledgerFile,
        line: 0,
        rule: "LEDGER_UNREADABLE",
        message: spec.ledgerProblem,
      });
    } else {
      examined.ledgerEntries += spec.ledger.length;
      for (const entry of spec.ledger) {
        for (const f of validateLedgerEntry(
          entry as unknown as Record<string, unknown>,
        )) {
          findings.push({
            file: ledgerFile,
            line: entry.id,
            rule: "LEDGER_SCHEMA",
            message: `entry ${entry.id}: ${f.message}`,
          });
        }
      }
      for (const failure of checkLedgerIntegrity(spec.ledger, spec.ledgerHead)
        .failures) {
        findings.push({
          file: ledgerFile,
          line: failure.entry_id,
          rule: "LEDGER_INTEGRITY",
          message: failure.message,
        });
      }
    }
  }
  return findings;
}
