---
"@figentra-oss/flow": minor
---

`fflow hooks run <pre-commit|commit-msg|pre-push>` runs a stage's git hooks where they can run (STA-1945, FR-18). With
the workspace install it runs `lefthook run <stage>` here; without it, the configured runner (an `ssh` box or a
`command` runner such as the testbed) runs the same jobs on a clone of exactly the staged tree. A passing pre-commit
run is recorded, and the commit-msg run adds it to the commit as a `Hooks-Run: local` or
`Hooks-Run: box <host> <run-id> <tree-sha>` trailer. A failed box run refuses the commit like a local failure; no
runner, or the `github-actions` runner, is refused naming `fflow doctor`. `LEFTHOOK` and `LEFTHOOK_EXCLUDE` never
reach the jobs. lefthook's jobs are not yet pointed at it, and `gate ci` does not yet require the trailer.
