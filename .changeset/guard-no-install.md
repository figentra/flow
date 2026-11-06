---
"@figentra-oss/flow": minor
---

The guard runs with no install. `fflow sync` writes `.agents/hooks/fflow-guard.mjs`: one self-contained file with the
guard engine and the preset's guard tables inside, importing only `node:` modules, locked in `.flow/lock.json` so
`fflow check` names a hand edit. The rendered Claude Code hooks and the OpenCode guard plugin run it instead of
`node_modules/@figentra-oss/flow/bin/fflow-guard.mjs`, which a checkout with no `node_modules` lacks, so no guard ran
there. The preset's lefthook skips the file in oxfmt and oxlint; a repository whose own formatter or linter config
covers `.agents/hooks/` should ignore it too. STA-1945 NFR-2 is amended by A-8.
