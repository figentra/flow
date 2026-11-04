---
"@figentra-oss/flow": minor
---

Approvals are bound to the documents' content (STA-1945 A-3, FR-30, T048). Each "Approved by <who> <YYYY-MM-DD>"
the spec carries is recorded in Flow's record with the digest of what it approves (the spec at Clarified, the spec and
plan at Planned; the `**Status**` line and Status history left out, since every stage moves them) when a stage ends:
`fflow spec setup-plan`, `fflow plan --record` and `fflow task start`. When an approved document changes after that,
`fflow check` fails naming the stage to approve again (AC-34), `fflow next` sends the task back to the approval stage,
and `fflow task start` refuses. A new approval line approves the documents as they are and is recorded by the next
stage to end. `approvalsAt` lists every approval of a stage, re-approvals included.
