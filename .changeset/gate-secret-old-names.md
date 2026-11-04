---
"@figentra-oss/flow": patch
---

The gate's App id and key are found under their names from before 0.2.2 during the switch (STA-2106). The box poster
reads `FIGENTRA_FLOW_GATE_APP_ID` and `FIGENTRA_FLOW_GATE_PRIVATE_KEY` when `FFLOW_GATE_*` are unset (the job file
gains `legacyEnvPrefix`), and the OIDC mint asks Infisical for the old names after a 404 on the new ones; when both
fail, the error names the new secret. The new names always win. The stackra preset's spec skill names `fflow gate ci`
and `fflow trace ci`, and its plan template no longer says "Vellum".
