/**
 * The CLI's adapter over the shared repository queries in @vellum/storage:
 * the same queries, with the command's own error output.
 */

import { EXIT_STATUS } from "@vellum/protocol";
import {
  notARepositoryMessage,
  openRepository,
  selectSpecs as selectRepositorySpecs,
  type Repository,
  type SpecRef,
} from "@vellum/storage";
import type { CliContext } from "./context.js";

export {
  enginePolicy,
  gitContext,
  isLegacy,
  recordedState,
  relativeFinding,
  type GitContext,
} from "@vellum/storage";

/** An open repository. */
export type Repo = Repository;

/**
 * Open the repository containing ctx.cwd; exit status 2 when there is none.
 * The Approval Policy is ctx.targetBranch's when it is set (criterion 7.10).
 */
export async function openRepo(ctx: CliContext): Promise<Repo | number> {
  const repo = await openRepository(ctx.cwd, ctx.targetBranch);
  if (repo === null) {
    ctx.stderr.write(`vellum: ${notARepositoryMessage(ctx.cwd)}\n`);
    return EXIT_STATUS.INCONCLUSIVE;
  }
  return repo;
}

/**
 * The specs a command runs on: the one `fragment` names, or every spec.
 * A fragment matching none or several is a usage error (criterion 6.4).
 */
export function selectSpecs(
  ctx: CliContext,
  root: string,
  fragment: string | undefined,
): SpecRef[] | number {
  const selection = selectRepositorySpecs(root, fragment);
  if (selection.kind === "specs") return selection.specs;
  ctx.stderr.write(`vellum: ${selection.message}\n`);
  return EXIT_STATUS.INCONCLUSIVE;
}

/** Write one JSON document to stdout (criterion 3.5). */
export function writeJson(ctx: CliContext, value: unknown): void {
  ctx.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
