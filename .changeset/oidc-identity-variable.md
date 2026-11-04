---
"@figentra-oss/flow": minor
---

The Infisical OIDC identity's id can live in the Actions variable `FFLOW_OIDC_IDENTITY_ID` instead of
`flow.config.json` (Infisical plan K7). `secrets.oidc.identityId` is now optional; the approval workflow's verdict,
approve and merge jobs pass the variable to the minter, a config id wins, and a missing or malformed id still refuses
before any network call.
