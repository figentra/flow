/**
 * The neutral preset's Bash rules for the guard engine: the lifecycle's side doors (a worktree outside
 * `.claude/worktrees/`, a push to the default branch, `gh pr merge`, skipping the hooks). A preset with its own
 * `guard/bash-rules.mjs` keeps them by spreading this table into its own.
 */
import { SIDE_DOORS } from "../../../../../src/guard/bash.mjs";

/** @type {import("../../../../../src/guard/bash.mjs").BashRule[]} */
export const BASH_RULES = [...SIDE_DOORS];
