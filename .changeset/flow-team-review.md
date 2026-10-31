---
"@figentra-oss/flow": minor
---

With a roster, `land` refuses `REVIEWER_IS_BUILDER` (a PASS with no `role=`, from the builder's role or session, or from
a role outside its `reviewed_by`), reports changed files outside the builder role's `changes` (also in `gate ci`, and
as a warning at `start`), and accepts an owner-kept spec's approvals only from the owner. Verdict lines take optional
`role=<id> session=<name>`.
