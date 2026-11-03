---
"@figentra-oss/flow": patch
---

The stackra and neutral presets' oxfmt pre-commit job no longer swallows oxfmt's exit 2. It passes
`--no-error-on-unmatched-pattern`, so staged files that are all on oxfmt's ignore list still pass, and a staged file
oxfmt cannot parse, which also exits 2, now fails the commit.
