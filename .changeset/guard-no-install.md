---
"@figentra-oss/flow": minor
---

The guard runs with no install. `fflow sync` writes `.agents/hooks/fflow-guard.mjs`: one self-contained file with the
guard engine and the preset's guard tables inside, importing only `node:` modules, locked in `.flow/lock.json` so
`fflow check` names a hand edit. The rendered Claude Code hooks and the OpenCode guard plugin run it instead of
`node_modules/@figentra-oss/flow/bin/fflow-guard.mjs`, which a checkout with no `node_modules` lacks, so no guard ran
there. The file is laid out as oxfmt prints it and is oxlint-clean, so a repository's `oxfmt --check .` and
`oxlint` pass on it; the preset's lefthook still skips it, as its bytes are locked. The plan gate imports
`lib/spec-check.mjs` instead of the whole `gate` command, which keeps the file small. STA-1945 NFR-2 is amended by
A-8.
