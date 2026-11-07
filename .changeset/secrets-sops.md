---
"@figentra-oss/flow": minor
---

Secrets leave Infisical (Stackra ADR 0525). Figentra Flow fetches no secret: every command reads its values from
its own environment, which the caller fills (on a workstation, a secrets runner such as core's `secrets-exec.mjs`;
in CI, a decrypt step). `secrets.kind` takes `env` or `sops`; `infisical` still loads, with a warning, and is read
as `env`, so it no longer wraps a command in `infisical run`, and `app create` writes the key only to `--key-file`.
The approval workflow's land lane and verdict job now need `secrets: { "kind": "sops", "oidc": { "decrypt":
"<action>@<sha>", "scope": "<scope>" } }`: each keyed job puts mise on PATH and runs the decrypt for
`FFLOW_GATE_APP_ID` and `FFLOW_GATE_PRIVATE_KEY`, and the mint reads them from the job's environment. The old
Infisical `secrets.oidc` form and the `FFLOW_OIDC_IDENTITY_ID` variable are gone; run `fflow sync` to re-render
`fflow-approve.yml`. `**/.infisical.*` is no longer an owner-only path (CODEOWNERS). The stackra preset's agents,
rules and skills describe sops, the decrypt action and `secrets:put`/`generate`/`rotate`.
