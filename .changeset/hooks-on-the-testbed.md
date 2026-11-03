---
"@figentra-oss/flow": minor
---

`fflow hooks run <pre-commit|commit-msg|pre-push>` runs a stage's git hooks where they can run (STA-1945, FR-18). With
the workspace install it runs `lefthook run <stage>` here; without it, the configured runner (an `ssh` box or a
`command` runner such as the testbed) runs the same jobs in a repository that holds only the run's commit, whose index
is exactly the staged tree; its git steps and the job run without the hook's `GIT_DIR` and `GIT_INDEX_FILE`, so a hook
in a linked worktree never moves that worktree's branch. A passing pre-commit run is recorded, and the commit-msg run
adds it to the commit as a `Hooks-Run: local` or `Hooks-Run: box <host> <run-id> <tree-sha>` trailer when it names the
tree being committed; without one (a merge, or a pre-commit job left out) the commit-msg run runs the pre-commit jobs
too. A failed run refuses the commit like a local failure and leaves no proof; no runner, or the `github-actions`
runner, is refused naming `"runner"` in `flow.config.json`, and a staged tree with build or tool output or an oversized
file is refused before it reaches a box. `LEFTHOOK` and `LEFTHOOK_EXCLUDE` never reach the jobs, here or on a box.
lefthook's jobs are not yet pointed at it, and `gate ci` does not yet require the trailer.
