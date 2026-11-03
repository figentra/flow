---
"@figentra-oss/flow": minor
---

The governance core (STA-1945 PR 1). `.flow/lock.json` is now v2: it records the preset's name, version and digest,
the Flow version, the profile, the digest of `.flow/overrides/` and every owned file with its digest; a v1 lock still
reads, and the next `sync` writes it as v2; a lock with a newer `lockVersion` is refused rather than overwritten, and a
malformed one is named by `check`. Every owned file that can carry a comment starts with a provenance header
naming fflow and the preset ("do not edit; change `.flow/overrides/`"); strict JSON is identified by its digest alone.
`sync` renders only the locked preset and refuses, naming `fflow update`, when the installed one differs, and names a
preset folder that is missing. New commands:
`fflow update [--preset <version>]` prints the diff, adopts the installed preset and syncs; `fflow check` is the CI
check and writes nothing; `fflow diff` prints what `sync` or `update` would change; `fflow validate` checks the config
against its schema. Each of the five takes `--workspace <dir>` and prints one line per repository.
`update`, `check`, `diff` and `validate` run on the console engine with their options declared, so
`fflow <command> --help` lists them; without `--workspace`, each refuses outside a git repository as `sync` and
`spec` do. Under `--workspace`, a folder with no repository that has `flow.config.json` exits 1.
