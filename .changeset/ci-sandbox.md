---
"@figentra-oss/flow": minor
---

`ci.sandbox` renders `fflow-sandbox.yml`: a manual run (`workflow_dispatch` only, never on a push or a pull request, never in `Quality Gate`'s needs) of one command against a provider's sandbox. It runs in an owner-gated GitHub environment (`sandbox` by default), with its `env` and its named `secrets` as `${{ secrets.NAME }}`, and the written evidence is uploaded as an artifact. An env value holding `${{` is refused.
