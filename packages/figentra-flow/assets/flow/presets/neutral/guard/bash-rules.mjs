/**
 * The neutral preset's Bash rules for the guard engine: none of its own. The lifecycle's side doors (a worktree
 * outside `.claude/worktrees/`, a push to the default branch, `gh pr merge`, skipping the hooks) are the engine's
 * (`SIDE_DOORS` in `src/guard/bash.mjs`), checked for every preset after its table (FR-5), so no preset can drop them.
 */

/** @type {import("@figentra-oss/flow/guard").BashRule[]} */
export const BASH_RULES = [];
