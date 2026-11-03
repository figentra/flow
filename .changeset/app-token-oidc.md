---
"@figentra-oss/flow": minor
---

A new `src/lib/app-token.mjs` mints a narrowed Figentra Flow App installation token inside one node process, from main's
approval job only (STA-1945, the L2 design). It refuses before any network call unless the job is GitHub Actions on a
GitHub-hosted runner, on the default branch, running the default branch's `fflow-approve.yml`, for a
`pull_request_target`, `status`, `workflow_run`, `issue_comment` or `schedule` event. It then trades the job's OIDC
token for the App's id and key at the gate path in Infisical, checks that the installation is the App's own on the
repository's owner, and mints a token for this one repository with a fixed role's permissions (`approve`, `merge`,
`merge-workflows` or `verdict`). A grant that is wider, narrower or for another repository is revoked and refused.
Every value is masked in the job's log and kept in memory only. The configuration gains `secrets.oidc`
(`identityId`, a uuid, and `audience`), and the schema checks string patterns. Nothing uses the mint yet.
