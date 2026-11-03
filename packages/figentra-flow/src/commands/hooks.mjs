/**
 * Figentra Flow file contract:
 * Purpose: `fflow hooks run <pre-commit|commit-msg|pre-push> [<git hook arguments>…]`, what lefthook's jobs call:
 *   the stage's hooks here with the workspace install, else on the configured runner's box for the staged tree, and
 *   the `Hooks-Run:` trailer on the commit (`../lib/hooks-run.mjs`).
 * Boundary: resolves the runner only when the hooks cannot run here, so a broken `runner` block never stops a local
 *   run. Exits with the jobs' code; 2 for a refusal.
 * Runtime: node
 * Governing contract: STA-1945 (C13, PR 13).
 * Secrets: none.
 */
import { runnerFor } from "../adapters/runner/index.mjs";
import { loadConfig } from "../lib/config.mjs";
import { git } from "../lib/git.mjs";
import { canRunLocally, HOOK_STAGES, runHooks } from "../lib/hooks-run.mjs";
import { NAME } from "../lib/product.mjs";

/** `fflow hooks run <stage> [<git hook arguments>…]`. */
export async function run(/** @type {string[]} */ [mode, stage, ...args]) {
  if (mode !== "run" || !HOOK_STAGES.includes(stage)) {
    console.error(`usage: ${NAME} hooks run <${HOOK_STAGES.join("|")}> [<git hook arguments>]`);
    return 2;
  }
  const top = git(process.cwd(), ["rev-parse", "--show-toplevel"]);
  if (!top.ok) {
    console.error(`${NAME} hooks run: ${process.cwd()} is not in a git repository`);
    return 2;
  }
  const root = top.out;
  /** @type {import("../adapters/runner/index.mjs").Runner | undefined} */
  let runner;
  if (!canRunLocally(root)) {
    const loaded = loadConfig(root);
    if (loaded.errors.length) {
      console.error(`${NAME} hooks run: ${loaded.errors.join("; ")}`);
      return 2;
    }
    runner = runnerFor(root, loaded.config).runner;
  }
  const result = await runHooks({
    root,
    stage: /** @type {"pre-commit" | "commit-msg" | "pre-push"} */ (stage),
    args,
    runner,
  });
  if (result.problem) console.error(`${NAME} hooks run: ${result.problem}`);
  return result.code;
}
