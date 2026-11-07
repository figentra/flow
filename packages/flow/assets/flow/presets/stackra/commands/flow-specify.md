---
description: Create the spec in .agents/specs/sta-<n>-<slug>, interview the Impact questionnaire, then hand off to clarify.
derived-from: github/spec-kit 1.0.10 (MIT)
---

## Stackra: feature directory (runs first)

Specs live in `.agents/specs/sta-<n>-<slug>/`, keyed by the spec's Linear issue (ADR 0120 D1). Never use
`specs/` and never auto-number: the directory always comes
from the Linear key, never from a scan. Once step 1 below has chosen the short name, and before step 3
creates the directory, run:

```bash
pnpm spec:gate dir --slug <short-name>
```

It reads the STA key from the branch name (`figentra/sta-<n>-…`; pass `--key STA-n` when the branch has none),
prints the folder and writes `.flow/current.json`. That printed path **is** `FEATURE_DIR` below: use it as-is. If the command fails, STOP: there is no Linear issue yet. Create one
(`pnpm linear create --title "…"`), or ask the user for its key, and work on a Linear-named branch.

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Outline

The text the user typed after `/flow-specify` in the triggering message **is** the feature description. Assume you always have it available in this conversation even if `$ARGUMENTS` appears literally below. Do not ask the user to repeat it unless they provided an empty command.

Given that feature description, do this:

1. **Generate a concise short name** (2-4 words) for the feature:
   - Analyze the feature description and extract the most meaningful keywords
   - Create a 2-4 word short name that captures the essence of the feature
   - Use action-noun format when possible (e.g., "add-user-auth", "fix-payment-bug")
   - Preserve technical terms and acronyms (OAuth2, API, JWT, etc.)
   - Keep it concise but descriptive enough to understand the feature at a glance
   - Examples:
     - "I want to add user authentication" → "user-auth"
     - "Implement OAuth2 integration for the API" → "oauth2-api-integration"
     - "Create a dashboard for analytics" → "analytics-dashboard"
     - "Fix payment processing timeout bug" → "fix-payment-timeout"

2. **Branch**: work on the issue's branch (`fflow start <key>` makes it, with its worktree). The branch
   name carries the issue key, which `gate dir` reads.

3. **Create the spec feature directory**:

   The directory is the path `fflow gate dir --slug <short-name>` printed (call it `FEATURE_DIR`). It is
   keyed by the issue, never numbered, and `gate dir` has already written `.flow/current.json`, which every later
   command reads.

   **Create the directory and spec file**:
   - `mkdir -p FEATURE_DIR`
   - If `FEATURE_DIR/spec.md` exists (`fflow start` created it from the template and committed it), edit it in
     place: never overwrite it
   - Otherwise print the active spec template with `fflow spec template spec-template` (the repository's
     `.flow/overrides/` first, then the preset) and write it to `FEATURE_DIR/spec.md` as the starting point
   - Set `SPEC_FILE` to `FEATURE_DIR/spec.md`

   **IMPORTANT**:
   - You must only create one feature per `/flow-specify` invocation
   - The spec directory name and the git branch name are independent — they may be the same but that is the user's choice

4. Load the resolved active `spec-template` file to understand required sections.

5. **IF EXISTS**: Load `.flow/constitution.md` for project principles and governance constraints.

6. Follow this execution flow:
    1. Parse user description from arguments
       If empty: ERROR "No feature description provided"
    2. Extract key concepts from description
       Identify: actors, actions, data, constraints
       Then fill `## Discovery` before any requirement: read the code, ADRs and issues the change touches, and
       state its current behaviour, topology, dependencies, ownership and the constraints already decided. List
       every file, ADR, command output and issue you read under `### Sources` as `- **SRC-###**:` lines. Never
       invent a source: when you could not read one, ask the user for it.
    3. For unclear aspects:
       - Make informed guesses based on context and industry standards
       - Only mark with [NEEDS CLARIFICATION: specific question] if:
         - The choice significantly impacts feature scope or user experience
         - Multiple reasonable interpretations exist with different implications
         - No reasonable default exists
       - **LIMIT: Maximum 3 [NEEDS CLARIFICATION] markers total**
       - Prioritize clarifications by impact: scope > security/privacy > user experience > technical details
    4. Fill User Scenarios & Testing section
       If no clear user flow: ERROR "Cannot determine user scenarios"
    5. Generate Functional Requirements
       Each requirement must be testable and end with the sources it rests on (`Sources: SRC-###`)
       Write non-functional requirements as their own `NFR-###` EARS lines, each with its number
       Use reasonable defaults for unspecified details (document assumptions in Assumptions section)
    6. Define Success Criteria
       Create measurable, technology-agnostic outcomes
       Include both quantitative metrics (time, performance, volume) and qualitative measures (user satisfaction, task completion)
       Each criterion must be verifiable without implementation details
    7. Identify Key Entities (if data involved)
    8. Return: SUCCESS (spec ready for planning)

7. Write the specification to SPEC_FILE using the template structure, replacing placeholders with concrete details derived from the feature description (arguments) while preserving section order and headings.

8. **Specification Quality Validation**: After writing the initial spec, validate it against quality criteria:

   a. **Create Spec Quality Checklist**: Generate a checklist file at `FEATURE_DIR/checklists/requirements.md` using the checklist template structure with these validation items:

      ```markdown
      # Specification Quality Checklist: [FEATURE NAME]

      **Purpose**: Validate specification completeness and quality before proceeding to planning
      **Created**: [DATE]
      **Feature**: [Link to spec.md]

      ## Content Quality

      - [ ] No implementation details (languages, frameworks, APIs)
      - [ ] Focused on user value and business needs
      - [ ] Written for non-technical stakeholders
      - [ ] All mandatory sections completed

      ## Requirement Completeness

      - [ ] No [NEEDS CLARIFICATION] markers remain
      - [ ] Requirements are testable and unambiguous
      - [ ] Success criteria are measurable
      - [ ] Success criteria are technology-agnostic (no implementation details)
      - [ ] All acceptance scenarios are defined
      - [ ] Edge cases are identified
      - [ ] Scope is clearly bounded
      - [ ] Dependencies and assumptions identified

      ## Feature Readiness

      - [ ] All functional requirements have clear acceptance criteria
      - [ ] User scenarios cover primary flows
      - [ ] Feature meets measurable outcomes defined in Success Criteria
      - [ ] No implementation details leak into specification

      ## Notes

      - Items marked incomplete require spec updates before `/flow-clarify` or `/flow-plan`
      ```

   b. **Run Validation Check**: Review the spec against each checklist item:
      - For each item, determine if it passes or fails
      - Document specific issues found (quote relevant spec sections)

   c. **Handle Validation Results**:

      - **If all items pass**: Mark checklist complete and proceed to the Mandatory Post-Execution Hooks section

      - **If items fail (excluding [NEEDS CLARIFICATION])**:
        1. List the failing items and specific issues
        2. Update the spec to address each issue
        3. Re-run validation until all items pass (max 3 iterations)
        4. If still failing after 3 iterations, document remaining issues in checklist notes and warn user

      - **If [NEEDS CLARIFICATION] markers remain**:
        1. Extract all [NEEDS CLARIFICATION: ...] markers from the spec
        2. **LIMIT CHECK**: If more than 3 markers exist, keep only the 3 most critical (by scope/security/UX impact) and make informed guesses for the rest
        <!-- flow:ask -->
        3. For each clarification needed (max 3), present options to user in this format:

           ```markdown
           ## Question [N]: [Topic]

           **Context**: [Quote relevant spec section]

           **What we need to know**: [Specific question from NEEDS CLARIFICATION marker]

           **Suggested Answers**:

           | Option | Answer | Implications |
           |--------|--------|--------------|
           | A      | [First suggested answer] | [What this means for the feature] |
           | B      | [Second suggested answer] | [What this means for the feature] |
           | C      | [Third suggested answer] | [What this means for the feature] |
           | Custom | Provide your own answer | [Explain how to provide custom input] |

           **Your choice**: _[Wait for user response]_
           ```

        4. **CRITICAL - Table Formatting**: Ensure markdown tables are properly formatted:
           - Use consistent spacing with pipes aligned
           - Each cell should have spaces around content: `| Content |` not `|Content|`
           - Header separator must have at least 3 dashes: `|--------|`
           - Test that the table renders correctly in markdown preview
        5. Number questions sequentially (Q1, Q2, Q3 - max 3 total)
        6. Present all questions together before waiting for responses
        7. Wait for user to respond with their choices for all questions (e.g., "Q1: A, Q2: Custom - [details], Q3: B")
        <!-- /flow:ask -->
        8. Update the spec by replacing each [NEEDS CLARIFICATION] marker with the user's selected or provided answer
        9. Re-run validation after all clarifications are resolved

   d. **Update Checklist**: After each validation iteration, update the checklist file with current pass/fail status

## Completion Report

Report completion to the user with:
- `FEATURE_DIR` — the feature directory path
- `SPEC_FILE` — the spec file path
- Checklist results summary
- Readiness for the next phase (`/flow-clarify` or `/flow-plan`)

## Quick Guidelines

- Focus on **WHAT** users need and **WHY**.
- Avoid HOW to implement (no tech stack, APIs, code structure).
- Written for business stakeholders, not developers.
- DO NOT create any checklists that are embedded in the spec. That will be a separate command.

### Section Requirements

- **Mandatory sections**: Must be completed for every feature
- **Optional sections**: Include only when relevant to the feature
- When a section doesn't apply, remove it entirely (don't leave as "N/A")

### For AI Generation

When creating this spec from a user prompt:

1. **Make informed guesses**: Use context, industry standards, and common patterns to fill gaps
2. **Document assumptions**: Record reasonable defaults in the Assumptions section
3. **Limit clarifications**: Maximum 3 [NEEDS CLARIFICATION] markers - use only for critical decisions that:
   - Significantly impact feature scope or user experience
   - Have multiple reasonable interpretations with different implications
   - Lack any reasonable default
4. **Prioritize clarifications**: scope > security/privacy > user experience > technical details
5. **Think like a tester**: Every vague requirement should fail the "testable and unambiguous" checklist item
6. **Common areas needing clarification** (only if no reasonable default exists):
   - Feature scope and boundaries (include/exclude specific use cases)
   - User types and permissions (if multiple conflicting interpretations possible)
   - Security/compliance requirements (when legally/financially significant)

**Examples of reasonable defaults** (don't ask about these):

- Data retention: Industry-standard practices for the domain
- Performance targets: Standard web/mobile app expectations unless specified
- Error handling: User-friendly messages with appropriate fallbacks
- Authentication method: Standard session-based or OAuth2 for web apps
- Integration patterns: Use project-appropriate patterns (REST or RPC for web services, function calls for libraries, CLI args for tools, etc.)

### Success Criteria Guidelines

Success criteria must be:

1. **Measurable**: Include specific metrics (time, percentage, count, rate)
2. **Technology-agnostic**: No mention of frameworks, languages, databases, or tools
3. **User-focused**: Describe outcomes from user/business perspective, not system internals
4. **Verifiable**: Can be tested/validated without knowing implementation details

**Good examples**:

- "Users can complete checkout in under 3 minutes"
- "System supports 10,000 concurrent users"
- "95% of searches return results in under 1 second"
- "Task completion rate improves by 40%"

**Bad examples** (implementation-focused):

- "API response time is under 200ms" (too technical, use "Users see results instantly")
- "Database can handle 1000 TPS" (implementation detail, use user-facing metric)
- "React components render efficiently" (framework-specific)
- "Redis cache hit rate above 80%" (technology-specific)

## Done When

- [ ] Specification written to `SPEC_FILE` and validated against quality checklist
- [ ] Completion reported to user with feature directory, spec file path, and checklist results

## Stackra: Impact questionnaire (mandatory)

The spec template (v2) carries an `## Impact` section. After drafting, ask the user each question in it and write
the answers in. Then ask for the Discovery facts and Sources you could not read yourself (an issue, a decision, a
command's output); Clarified needs `### Sources`, and every requirement cites at least one. Set
`**Linear**` to the folder's key. Never guess an answer: leave it as
`[NEEDS CLARIFICATION: ...]`. Write requirements in EARS form ("WHEN … THE <subject> SHALL …"), give every SC a
verification method, and keep `## Amendments` and `## Status history` (one line: `<date> · — → Draft · <you> ·
created`). Leave `**Status**: Draft` and `**Clarifications status**: pending`, then run
`pnpm spec:gate check <folder>`. Do not run `/flow-plan`: the next step is always
`/flow-clarify`.
