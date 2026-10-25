/**
 * vellum verify — Run the Strict Verifier for one or all specs
 */

import { EXIT_STATUS } from "@vellum/protocol";
import { formatVerificationHuman } from "@vellum/engine";
import {
  NOTHING_TO_VERIFY,
  queryVerify,
  verifyDocument,
  verifyExitStatus,
} from "@vellum/storage";
import type { CliContext } from "../context.js";
import { openRepo, selectSpecs, writeJson } from "../repo.js";

interface VerifyArgs {
  spec?: string | undefined;
  json: boolean;
}

/**
 * Run verify (the Strict Verifier; `--strict` is accepted and changes
 * nothing — there is no lenient mode). See `queryVerify` in @vellum/storage
 * for what is verified. Without a spec argument, verifies each managed spec
 * whose Recorded Lifecycle State is IN_PROGRESS or later. (Criterion 12.9
 * selects by the Effective state, which `vellum status` and `vellum check`
 * compute; verify does not use it for selection yet, and `check` fails a spec
 * whose recorded state is ahead of its effective state.)
 *
 * Exit: 0 PASS, 1 FAIL, 2 INCONCLUSIVE (nothing to verify, or an input that
 * could not be read or parsed).
 */
export async function verify(
  args: VerifyArgs,
  ctx: CliContext,
): Promise<number> {
  const repo = await openRepo(ctx);
  if (typeof repo === "number") return repo;
  const selected = selectSpecs(ctx, repo.root, args.spec);
  if (typeof selected === "number") return selected;

  const query = queryVerify(repo, selected, args.spec !== undefined);
  if (query.kind === "inconclusive") {
    ctx.stderr.write(`vellum verify: INCONCLUSIVE — ${query.message}\n`);
    return EXIT_STATUS.INCONCLUSIVE;
  }
  const result = query.value;

  if (result.specs.length === 0) {
    ctx.stderr.write(`vellum verify: INCONCLUSIVE — ${NOTHING_TO_VERIFY}\n`);
    if (args.json) writeJson(ctx, verifyDocument(result));
    return EXIT_STATUS.INCONCLUSIVE;
  }

  if (args.json) {
    writeJson(ctx, verifyDocument(result));
  } else {
    if (result.policy.kind === "missing") {
      ctx.stdout.write(
        `Approval Policy: missing (${result.policy.path}); no approval can be valid\n\n`,
      );
    } else if (ctx.targetBranch !== undefined) {
      ctx.stdout.write(`Approval Policy: ${result.policy.path} (the target branch's)\n\n`);
    }
    for (const r of result.specs) {
      ctx.stdout.write(`Spec: ${r.spec}\n`);
      ctx.stdout.write(
        "problems" in r
          ? `Result: INCONCLUSIVE\n${r.problems.map((p) => `  ${p}`).join("\n")}\n\n`
          : `${formatVerificationHuman(r)}\n\n`,
      );
    }
    ctx.stdout.write(`Overall: ${result.result}\n`);
  }
  return verifyExitStatus(result);
}
