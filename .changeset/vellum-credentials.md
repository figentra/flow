---
"@stackra/vellum": patch
---

`vellum land` calls GitHub only with the credentials the repository names in `package.json` (`"vellum": { "credentials": "wrapper:<script>" }`, or `"gh-user"` to use your own `gh` login on purpose) and refuses otherwise; it never falls back to a personal `gh` login.
