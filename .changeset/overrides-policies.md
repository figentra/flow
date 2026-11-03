---
"@figentra-oss/flow": minor
---

Overrides and mandatory policies (STA-1945 PR 2). A repository changes what `sync` renders with owner-only
overrides at `.flow/overrides/<surface>/<id>.yml` (schema: `schema/override.schema.json`), each one of `extend`
(append `items` or `text` to an output, or to one Markdown section), `configure` (set a parameter the preset
declares), `replace` (swap an output, or a preset command, agent, rule or template, for a file) or `disable` (drop
an output); `replace` and `disable` need `reason`, `owner` and `review`. The header of each file an override shaped
names it. The mandatory policies (`guard.secrets`, `guard.tenancy`, `owner-only`, `guard.wiring`) cannot be
disabled, replaced or configured, and an `extend` of one may only add rules: `sync` does not apply an override that
breaks one, and `validate` and `check` refuse it, naming the policy. An `extend` of `owner-only` adds its globs to
CODEOWNERS and the approval workflow. `validate` also refuses an invalid override and one on a target `sync` does not
render; `check` warns from 14 days before an override's review date and fails after it. Today's whole-file overrides
(`.flow/overrides/<name>.md`, `commands/`, `agents/`, `rules/`) keep working as `replace`, and `validate` warns until
each gets its `.yml`. `.flow/overrides/**` is now an owner-only path, so the rendered CODEOWNERS changes on the next
`sync`.
