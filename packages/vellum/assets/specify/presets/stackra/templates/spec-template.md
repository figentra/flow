# Feature Specification: [FEATURE NAME]

**Feature Branch**: `[figentra/sta-n-feature-name]`

**Created**: [DATE]

**Status**: Draft <!-- Draft → Clarified → Planned → Tasked → Implementing → Done, or Abandoned / Superseded (OR12). spec-gate refuses a status ahead of its artifacts; append every change to Status history -->

<!-- Specs are public on GitHub: no secrets, customer data or details of an unfixed vulnerability (ADR 0120 D17). -->

<!-- Folder: .agents/specs/sta-n-<slug>/, named by the Linear key below (ADR 0120 D1). -->

**Linear**: STA-n <!-- the Linear issue for this spec; the plan gate needs a real key equal to the folder's -->

**Linear project**: [project name, or "none"]

**Clarifications status**: pending <!-- /speckit.clarify sets this to "complete" when nothing is open -->

**Analyze**: — <!-- after /speckit.analyze: "<date> clean (C0 H# M#)"; Tasked needs C0 -->

**Input**: User description: "$ARGUMENTS"

## Impact _(mandatory, answer every line before /speckit.clarify completes)_

<!-- Write "none" for a line that does not apply; never leave a [placeholder] or NEEDS CLARIFICATION. -->

- **Apps touched**: [apps/console, apps/mobile, apps/docs, or none]
- **Services touched**: [services/<name>, or none]
- **Packages touched**: [packages/<category>/<name>, or none]
- **Public contract change**: [none / additive / breaking: what]
- **Cross-service events**: [event names, e.g. user.created.v1, and publisher/subscribers, or none]
- **Tenancy and data**: [tenant-owned tables or scope-tree changes, or none]
- **Security and privacy**: [auth, IAM, webhooks, outbound HTTP, crypto; new PII and its retention; or none]
- **Secrets**: [secret names the feature needs (never values), or none]
- **ADR needed**: [yes: topic / no]
- **New dependencies**: [packages to add to a pnpm catalog, or none]
- **Deploy modes**: [what differs in SaaS / on-prem / air-gapped (outbound calls, hosted services, licence checks), or "same in all three"]
- **Licence tier**: [free (MIT, this repo) / Pro (figentra/stackra-pro)]
- **UI surfaces**: [screens or components, or none]
- **Docs to update**: [apps/docs/src/docs/... pages, or none; spec-trace drift checks that a Done spec touched them]
- **Lane**: [full / lite / bug / chore, from the ADR 0120 lane table (first match wins)]
- **Change risk**: [R0 / R1 / R2 / R3 (ADR 0120), derived from the answers above; it can be raised, never lowered]

## Glossary _(full lane)_

- **[Term]**: [meaning in this spec]

## User Scenarios & Testing _(mandatory)_

<!-- Prioritised, independently testable user stories (P1 first). Each becomes a phase in tasks.md. -->

### User Story 1 - [Brief Title] (Priority: P1)

[Describe this user journey in plain language]

**Why this priority**: [the value, and why it has this priority]

**Independent Test**: [how this story can be tested on its own]

**Acceptance Scenarios**:

1. **Given** [initial state], **When** [action], **Then** [expected outcome]

---

### Edge Cases

- **EC-01**: [boundary condition or error scenario, and the expected behaviour]

## Requirements _(mandatory)_

<!--
  EARS wording (guidance, ADR 0120 D18): "WHEN <trigger> THE <subject> SHALL <response>", "WHILE <state> …",
  "IF <unwanted condition> THEN THE <subject> SHALL …". IDs are permanent: an amendment strikes an ID
  (~~FR-007~~ (A-001)) or appends a new one; it never renumbers. Every FR is covered by a task (`covers:`) and, by
  Done, by a test carrying `@covers sta-n:FR-###` (spec-trace).
-->

### Functional Requirements

- **FR-001**: WHEN [trigger] THE [subject] SHALL [response].

### Key Entities _(include if feature involves data)_

- **[Entity 1]**: [What it represents, key attributes without implementation]

## Success Criteria _(mandatory)_

<!-- Measurable and technology-agnostic. Each SC names how it is verified: unit, e2e, k6 or manual. -->

- **SC-001**: [measurable outcome] — verified by: [unit / e2e / k6 / manual]

## Out of scope

- [what this spec deliberately does not do]

## Assumptions

- [assumption, and why it is reasonable]

## Amendments

<!-- Append-only: "A-001 · <date> · <reason> · added: FR-012 · struck: FR-007". Status returns to Draft. -->

None.

## Status history

<!-- Append-only: "<date> · <from> → <to> · <by> · <note or approval>". spec-gate needs a line for the current status. -->

- [DATE] · — → Draft · [author] · created
