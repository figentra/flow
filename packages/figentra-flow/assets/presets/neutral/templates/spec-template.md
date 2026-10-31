# Feature Specification: [FEATURE NAME]

**Created**: [DATE]

**Status**: Draft <!-- Draft → Clarified → Planned → Tasked → Implementing → Done, or Abandoned / Superseded; the gate refuses a status ahead of its artifacts; append every change to Status history -->

**Tier**: [small / feature / big] <!-- trivial work has no spec; small keeps its design and tasks below; feature stops once after the spec and plan; big stops after the spec and after the plan -->

**Approver**: [who approves the stops]

<!-- Folder: .agents/specs/<key>-<slug>/, named by the issue key below. -->

**Issue**: [KEY-n] <!-- the issue for this spec; the plan gate needs a real key equal to the folder's -->

**Clarifications status**: pending <!-- /speckit.clarify sets this to "complete" when nothing is open -->

**Input**: User description: "$ARGUMENTS"

## User Scenarios & Testing _(mandatory)_

### User Story 1 - [Brief Title] (Priority: P1)

[Describe this user journey in plain language]

**Acceptance Scenarios**:

1. **Given** [initial state], **When** [action], **Then** [expected outcome]

### Edge Cases

- **EC-01**: [boundary condition or error scenario, and the expected behaviour]

## Requirements _(mandatory)_

<!-- EARS: "WHEN <trigger> THE <subject> SHALL <response>". IDs are permanent: an amendment strikes an ID or appends
     a new one; it never renumbers. -->

### Functional Requirements

- **FR-001**: WHEN [trigger] THE [subject] SHALL [response].

## Acceptance criteria _(mandatory for a tiered spec)_

<!-- EARS, one per line, each with an id that tasks (`covers: AC-001`) and tests (`@covers <key>:AC-001`) trace to.
     A small spec keeps its design in this file (`## Design` with the plan template's design sections as `###`, one
     line each) and its `## Tasks` checklist, instead of plan.md and tasks.md. -->

- **AC-001**: WHEN [event] THE [system] SHALL [response]

## Success Criteria _(mandatory)_

- **SC-001**: [measurable outcome] — verified by: [unit / e2e / k6 / manual]

## Out of scope

- [what this spec deliberately does not do]

## Amendments

None.

## Status history

- [DATE] · — → Draft · [author] · created
