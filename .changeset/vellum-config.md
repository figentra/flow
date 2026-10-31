---
"@stackra/vellum": minor
---

`vellum.config.json`: a repository chooses its adapters in one file, checked against the shipped schema (`schema/vellum.config.schema.json`); unknown keys and wrong types are refused by path, and a command that needs an unset port refuses naming the key. GitHub calls and network git go through the credentials port (`env`, `gh-user`, `wrapper`), never falling back to a personal login (a local origin needs none); the gate's poster on a `--box` host is wrapped by the secrets port (`env`, `infisical`); the check command is `gate.check`. The product's name-bearing literals (config file, status context, comment marker, gate folder, environment prefix, user folder) live in one module. The older `package.json` `"vellum"` keys are read with a deprecation warning until the next minor version.
