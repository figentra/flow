---
"@figentra-oss/flow": minor
---

A preset package's guard files can import Flow (STA-2097, PLAN section 9 P2). Two new exports:
`@figentra-oss/flow/guard` (`collectStrings`, `CONFIG_FILE`, `LEGACY_CONFIG_FILE`, and the `BashRule`, `PathRule`,
`PromptTable`, `SessionTable` and `Decision` types) and `@figentra-oss/flow/guard/neutral` (the neutral preset's
`PATH_RULES`, `BASH_RULES` and `isSecretPath`). The bundled `neutral` and `stackra` guard files now import through
them instead of relative paths into Flow's source, so the `stackra` guard folder can move to its own package as it is.
A test holds every import in a bundled preset's `guard/*.mjs` to `node:*`, a file of the same preset, or a public
export. The README's preset section says what guard files may import.
