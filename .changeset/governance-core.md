---
"@figentra-oss/flow": minor
---

The governance core (STA-1945 PR 1). `.flow/lock.json` is now v2: it records the preset's name, version and digest,
the Flow version, the profile, the digest of `.flow/overrides/` and every owned file with its digest; a v1 lock still
reads, and the next `sync` writes it as v2. Every owned file that can carry a comment starts with a provenance header
naming fflow and the preset ("do not edit; change `.flow/overrides/`"); strict JSON is identified by its digest alone.
`sync` renders only the locked preset and refuses, naming `fflow update`, when the installed one differs. New commands:
`fflow update [--preset <version>]` prints the diff, adopts the installed preset and syncs; `fflow check` is the CI
check and writes nothing; `fflow diff` prints what `sync` or `update` would change; `fflow validate` checks the config
against its schema. Each of the five takes `--workspace <dir>` and prints one line per repository.
