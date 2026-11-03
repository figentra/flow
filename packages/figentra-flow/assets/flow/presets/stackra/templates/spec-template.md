# Feature Specification: [FEATURE NAME]

**Feature Branch**: `[figentra/sta-n-feature-name]`

**Created**: [DATE]

**Status**: Draft <!-- Draft → Clarified → Planned → Tasked → Implementing → Done, or Abandoned / Superseded (OR12). spec-gate refuses a status ahead of its artifacts; append every change to Status history -->

**Tier**: [small / feature / big] <!-- ADR 0502: trivial work has no spec; small is a lite spec with ## Design and ## Tasks below; feature stops once after the spec and plan; big stops after the spec and after the plan. The lane check refuses a tier below what the diff needs (migrations, contracts, permissions, money, new members) -->

**Approver**: [owner / leader] <!-- feature and big: the owner for product, money, legal, security, brand and pricing; the leader for technical-only stops under the owner's delegation. An approval is "Approved by <who> <YYYY-MM-DD>" on the Status line of the stage it approves -->

<!-- Specs are public on GitHub: no secrets, customer data or details of an unfixed vulnerability (ADR 0120 D17). -->

<!-- Folder: .agents/specs/sta-n-<slug>/, named by the Linear key below (ADR 0120 D1). -->

**Linear**: STA-n <!-- the Linear issue for this spec; the plan gate needs a real key equal to the folder's -->

**Linear project**: [project name, or "none"]

**Clarifications status**: pending <!-- /flow-clarify sets this to "complete" when nothing is open -->

**Analyze**: — <!-- after /flow-analyze: "<date> clean (C0 H# M#)"; Tasked needs C0 -->

**Input**: User description: "$ARGUMENTS"

## Impact _(mandatory, answer every line before /flow-clarify completes)_

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

## Discovery _(mandatory, before the requirements)_

<!-- What is true today, read from the repository before writing a requirement, so the requirements describe a change
     and not a wish. Each line names its source (SRC-###, listed under ### Sources). Worked example (a Flow spec):
     - **Current behaviour**: `fflow sync` renders the `flow-*` skills and writes `.flow/lock.json` as
       `{ version, preset, files }`; only `gate ci` catches a hand edit, through `installProblems` (SRC-001).
     - **Topology**: one member, `packages/figentra-flow`: `bin/fflow.mjs` dispatches to `src/commands/<name>.mjs`;
       shared code in `src/lib/`, tests in `src/__tests__/` (SRC-001).
     - **Dependencies**: Node 24; git and the GitHub CLI on PATH; no runtime package (SRC-002).
     - **Ownership**: Flow's maintainers own the package; the owner owns `.flow/overrides/` (SRC-003).
     - **Constraints already decided**: ADR 0502 (tiers and approval stops), ADR 0510 (the lock) (SRC-004). -->

- **Current behaviour**: [what happens today without this change: the commands, screens or jobs involved and what they do] (SRC-001)
- **Topology**: [the members, folders and files this lands in, by path] (SRC-001)
- **Dependencies**: [runtimes, services, tools and other specs this needs, or none]
- **Ownership**: [who owns each touched area: team, role or CODEOWNERS entry]
- **Constraints already decided**: [ADRs and rules this must follow, by number, or none]

### Sources

<!-- Every file, ADR, command output or issue the lines above and the requirements below rest on, one per line, each
     with an id that requirements cite ("Sources: SRC-001"). Clarified needs Sources, and every requirement cites at
     least one. Worked example:
     - **SRC-001**: `packages/figentra-flow/src/lib/render.mjs` on `origin/main` (64a0f4d): `writeRendered`, `installProblems`
     - **SRC-002**: `packages/figentra-flow/package.json`: `dependencies` is empty
     - **SRC-003**: `.github/CODEOWNERS` and `src/lib/owner-only.mjs` (STA-1856)
     - **SRC-004**: ADR 0502 and ADR 0510 in `apps/docs/src/docs/adr/`
     - **SRC-005**: STA-1945, the owner's request of 2026-11-02 -->

- **SRC-001**: [a file path at a commit, an ADR number, a command and what it printed, or an issue key, and what it shows]

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
  Done, by a test carrying `@covers sta-n:FR-###` (spec-trace). Every requirement ends with the sources it rests on
  ("Sources: SRC-001, SRC-004").

  Quality words: never use the preset's vague terms in requirements and acceptance criteria. Write the number or the
  list, not the adjective. Worked examples:
  - "fast" → "within 2 s at p95 for a 500-file repository"
  - "secure" → "only a caller with the `flow.approve` permission"
  - "user-friendly", "intuitive" → the steps, and how many
  - "robust", "gracefully" → the failure, and the exact response to it
  - "etc.", "and so on" → the whole list
  - "as needed", "where appropriate" → the condition, as a WHEN or IF clause
-->

### Functional Requirements

- **FR-001**: WHEN [trigger] THE [subject] SHALL [response]. Sources: SRC-001

### Non-functional Requirements

<!-- Qualities as their own EARS lines, each with its number: time, size, rate, limit, or the platforms it runs on.
     Worked examples:
     - **NFR-001**: THE package SHALL add no runtime dependency. Sources: SRC-002
     - **NFR-002**: WHEN `fflow check` runs on a 500-file repository THE command SHALL finish within 5 s on the
       testbed. Sources: SRC-001 -->

- **NFR-001**: THE [system] SHALL [a quality, with its number]. Sources: SRC-001

### Key Entities _(include if feature involves data)_

- **[Entity 1]**: [What it represents, key attributes without implementation]

## Acceptance criteria _(mandatory for a tiered spec, ADR 0502)_

<!-- EARS, one per line, each with an id that tasks (`covers: AC-001`) and tests (`@covers sta-n:AC-001`) trace to:
     WHEN <event> THE <system> SHALL <response> · IF <condition> THEN THE <system> SHALL <response>
     WHILE <state> THE <system> SHALL <response> · WHERE <feature> THE <system> SHALL <response> · THE <system> SHALL <response>
     A small spec keeps a short form of the design in this file (`## Design` below) and its `## Tasks` checklist,
     instead of plan.md and tasks.md. -->

- **AC-001**: WHEN [event] THE [system] SHALL [response]

## Success Criteria _(mandatory)_

<!-- Measurable and technology-agnostic: a number, a threshold and what is counted. Each SC names how it is verified:
     unit, e2e, k6 or manual. Worked examples:
     - **SC-001**: a new repository passes `fflow check` within 10 minutes of `fflow init`, on 3 of 3 trial
       repositories — verified by: e2e
     - **SC-002**: no hand-copied agent file remains in the 18 repositories of the census — verified by: manual
     Not measurable: "setup is easier", "drift is reduced". -->

- **SC-001**: [measurable outcome: a number, a threshold and what is counted] — verified by: [unit / e2e / k6 / manual]

## Out of scope

- [what this spec deliberately does not do]

## Assumptions

- [assumption, and why it is reasonable]

## Design _(small tier only: delete it for feature and big, whose design is plan.md)_

<!-- ADR 0502: a small spec's one-page design. The gate requires these nine `###` sections from Planned on (write
     "none" under one that does not apply); one line each, except the folder tree and the interfaces, which stay
     required at this tier. -->

### Architecture overview

[How the pieces fit, in one line]

### Components and responsibilities

[Each module this adds or changes, and what it owns]

### Files and folders

```text
[member]/
├── src/[path]/[file].ts                    (new)
└── src/[path]/__tests__/[file].test.ts     (new)
```

### Data models and migrations

[Models, tables and migrations, or none]

### Contracts

<!-- The real declarations, in the repository's language: names, parameters, returns and thrown errors. -->

```ts
/** [what it does] @throws [ErrorType] [when] */
export function [name]([param]: [Type]): [ReturnType];
```

### Error handling

[Refusals and their codes, and what a failure leaves behind]

### Security and tenancy

[Permissions, tenant isolation, personal data, secrets by name, or none]

### Testing strategy

[Which tests prove which acceptance criteria (AC-###)]

### Rollout

[Flags, migration order, release notes, or none]

## Amendments

<!-- Append-only: "A-001 · <date> · <reason> · added: FR-012 · struck: FR-007". Status returns to Draft. -->

None.

## Status history

<!-- Append-only: "<date> · <from> → <to> · <by> · <note or approval>". spec-gate needs a line for the current status. -->

- [DATE] · — → Draft · [author] · created
