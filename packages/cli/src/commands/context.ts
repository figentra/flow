/**
 * vellum context — the per-task briefing an executor reads instead of the
 * whole spec (decision 17 in 002's design).
 */

import { EXIT_STATUS } from "@vellum/protocol";
import { formatTaskContextMarkdown } from "@vellum/engine";
import { queryContext } from "@vellum/storage";
import type { CliContext } from "../context.js";
import { openRepo, selectSpecs, writeJson } from "../repo.js";

/**
 * Print task `taskId`'s briefing as Markdown, or as JSON with `--json`.
 * Writes nothing.
 *
 * Exit: 0 printed; 1 tasks.md defines no such task; 2 usage error, an
 * unmatched spec, or a spec with no tasks.md.
 */
export async function context(
  args: { spec: string; taskId: string; json: boolean },
  ctx: CliContext,
): Promise<number> {
  const repo = await openRepo(ctx);
  if (typeof repo === "number") return repo;
  const selected = selectSpecs(ctx, repo.root, args.spec);
  if (typeof selected === "number") return selected;
  const ref = selected[0]!;

  const query = queryContext(ref, args.taskId);
  if (query.kind === "inconclusive") {
    ctx.stderr.write(`vellum context: ${query.message}\n`);
    return EXIT_STATUS.INCONCLUSIVE;
  }
  if (query.value === null) {
    ctx.stderr.write(`vellum context: ${ref.slug}/tasks.md defines no task ${args.taskId}\n`);
    return EXIT_STATUS.FAILURE;
  }
  if (args.json) writeJson(ctx, query.value);
  else ctx.stdout.write(formatTaskContextMarkdown(ref.slug, query.value));
  return EXIT_STATUS.SUCCESS;
}
