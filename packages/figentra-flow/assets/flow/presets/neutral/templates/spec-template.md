# Feature Specification: [FEATURE NAME]

**Created**: [DATE]

**Status**: Draft <!-- Draft → Clarified → Planned → Tasked → Implementing → Done, or Abandoned / Superseded; the gate refuses a status ahead of its artifacts; append every change to Status history -->

**Tier**: [small / feature / big] <!-- trivial work has no spec; small keeps its design and tasks below; feature stops once after the spec and plan; big stops after the spec and after the plan -->

**Approver**: [who approves the stops]

<!-- Folder: .agents/specs/<key>-<slug>/, named by the issue key below. -->

**Issue**: [KEY-n] <!-- the issue for this spec; the plan gate needs a real key equal to the folder's -->

**Clarifications status**: pending <!-- /flow-clarify sets this to "complete" when nothing is open -->

**Input**: User description: "$ARGUMENTS"

## Discovery _(mandatory, before the requirements)_

<!-- What is true today, read from the repository before writing a requirement, so the requirements describe a change
     and not a wish. Each line names its source (SRC-###, listed under ### Sources). Worked example:
     - **Current behaviour**: `app export` writes one CSV per table and stops at the first error (SRC-001).
     - **Topology**: `src/export/` (the command), `src/db/` (the reader), tests in `test/export/` (SRC-001).
     - **Dependencies**: the database driver already installed; no new service (SRC-002).
     - **Ownership**: the data team (CODEOWNERS) (SRC-003).
     - **Constraints already decided**: decision record 12 (exports never hold a write lock) (SRC-004). -->

- **Current behaviour**: [what happens today without this change: the commands, screens or jobs involved and what they do] (SRC-001)
- **Topology**: [the modules, folders and files this lands in, by path] (SRC-001)
- **Dependencies**: [runtimes, services, tools and other specs this needs, or none]
- **Ownership**: [who owns each touched area: team, role or CODEOWNERS entry]
- **Constraints already decided**: [decisions and rules this must follow, or none]

### Sources

<!-- Every file, decision record, command output or issue the lines above and the requirements below rest on, one per line, each
     with an id that requirements cite ("Sources: SRC-001"). The gate refuses Clarified without Sources, or with a
     requirement that cites none. Worked example:
     - **SRC-001**: `src/export/command.ts` at a1b2c3d: `runExport` stops on the first error
     - **SRC-002**: `package.json`: the database driver and its version
     - **SRC-003**: `.github/CODEOWNERS`
     - **SRC-004**: `docs/adr/0012-export-locks.md`
     - **SRC-005**: the issue that asked for this change -->

- **SRC-001**: [a file path at a commit, a decision record, a command and what it printed, or an issue key, and what it shows]

## User Scenarios & Testing _(mandatory)_

### User Story 1 - [Brief Title] (Priority: P1)

[Describe this user journey in plain language]

**Acceptance Scenarios**:

1. **Given** [initial state], **When** [action], **Then** [expected outcome]

### Edge Cases

- **EC-01**: [boundary condition or error scenario, and the expected behaviour]

## Requirements _(mandatory)_

<!-- EARS: "WHEN <trigger> THE <subject> SHALL <response>". IDs are permanent: an amendment strikes an ID or appends
     a new one; it never renumbers. Every requirement ends with the sources it rests on ("Sources: SRC-001").

     Quality words: the gate flags the preset's vague terms in requirements and acceptance criteria (a warning on
     small and feature tiers, a failure on big). Write the number or the list, not the adjective. Worked examples:
     - "fast" → "within 2 s at p95 for 10,000 rows"
     - "secure" → "only a caller with the export permission"
     - "user-friendly", "intuitive" → the steps, and how many
     - "robust", "gracefully" → the failure, and the exact response to it
     - "etc.", "and so on" → the whole list
     - "as needed", "where appropriate" → the condition, as a WHEN or IF clause -->

### Functional Requirements

- **FR-001**: WHEN [trigger] THE [subject] SHALL [response]. Sources: SRC-001

### Non-functional Requirements

<!-- Qualities as their own EARS lines, each with its number: time, size, rate, limit, or the platforms it runs on.
     Worked example: "- **NFR-001**: WHEN an export of 10,000 rows runs THE command SHALL finish within 30 s.
     Sources: SRC-001" -->

- **NFR-001**: THE [system] SHALL [a quality, with its number]. Sources: SRC-001

## Acceptance criteria _(mandatory for a tiered spec)_

<!-- EARS, one per line, each with an id that tasks (`covers: AC-001`) and tests (`@covers <key>:AC-001`) trace to.
     A small spec keeps its design in this file (`## Design` below) and its `## Tasks` checklist, instead of plan.md
     and tasks.md. -->

- **AC-001**: WHEN [event] THE [system] SHALL [response]

## Success Criteria _(mandatory)_

<!-- Measurable: a number, a threshold and what is counted, and how it is verified. Worked example:
     "- **SC-001**: an export of 10,000 rows with one bad row writes 9,999 rows and one error line — verified by: e2e".
     Not measurable: "exports are more reliable". -->

- **SC-001**: [measurable outcome: a number, a threshold and what is counted] — verified by: [unit / e2e / k6 / manual]

## Out of scope

- [what this spec deliberately does not do]

## Design _(small tier only: delete it for feature and big, whose design is plan.md)_

<!-- A small spec's one-page design. The gate requires these nine `###` sections from Planned on (write "none" under one
     that does not apply); one line each, except the folder tree and the interfaces, which stay required at this
     tier. -->

### Architecture overview

[How the pieces fit, in one line]

### Components and responsibilities

[Each module this adds or changes, and what it owns]

### Files and folders

```text
[folder]/
├── [path]/[file]           (new)
└── [path]/[file test]      (new)
```

### Data models and migrations

[Models, tables and migrations, or none]

### Contracts

<!-- The real declarations, in the repository's language (change the fence): names, parameters, returns and thrown
     errors. -->

```ts
/** [what it does] @throws [ErrorType] [when] */
export function [name]([param]: [Type]): [ReturnType];
```

### Error handling

[Failures, and what a failure leaves behind]

### Security and tenancy

[Permissions, data isolation, personal data, secrets by name, or none]

### Testing strategy

[Which tests prove which acceptance criteria (AC-###)]

### Rollout

[Flags, migration order, release notes, or none]

## Amendments

None.

## Status history

- [DATE] · — → Draft · [author] · created
