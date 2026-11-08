---
"@figentra-oss/flow": minor
---

A preset can name the checks every gate runs first (`gate.required` in `preset.yml`); a repository's `gate.check` runs
after them and can add a step, never remove one. The stackra preset requires format, lint, typecheck, unit tests, int
tests, strict gen, validate, the secret scan and the dependency scan (`pnpm format:check`, `lint`, `typecheck`, `test`,
`test:int`, `STACKRA_GEN_STRICT=1 pnpm gen:check`, `validate`, `secrets:scan`, `deps:scan`). A repository on the stackra
preset that lacks one of those scripts fails its gate until it adds it.
