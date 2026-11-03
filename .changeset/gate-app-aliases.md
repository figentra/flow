---
"@figentra-oss/flow": minor
---

`apps.gate.aliases` lists the gate App's other logins, so renaming the App (figentra-gate to figentra-flow, ADR 0523)
breaks nothing: `land`, `train`, `status` and the approval check count the `fflow/gate` status from the login or any
alias, and from no one else. `sync` writes the approval workflow's `TRUSTED` value as a list of logins when there are
aliases, and as the one login otherwise, so an existing workflow does not change. The approval check reads both
forms and refuses when `TRUSTED` is not JSON or names a source in any other shape. A repository adopts an alias only
after it runs this release, since earlier releases refuse `aliases` and trust no list; once the App is renamed, the new
login becomes `login` and the old one is dropped.
