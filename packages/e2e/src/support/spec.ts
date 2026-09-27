/**
 * Spec documents shaped the way the method's templates
 * (packages/method/templates) shape them: an EARS requirements document with
 * numbered criteria under `### Requirement N:` headings, a design whose
 * Correctness Properties carry `**Validates: Requirements …**`, and a plan of
 * parent tasks, leaf tasks with Kiro `_Requirements: …_` trailers, optional
 * `N.M*` test tasks citing each Correctness Property with `_Properties: …_`,
 * a checkpoint, a Task Dependency Graph and an Execution Log. Template comments and placeholders are removed, as the
 * templates instruct. The Lifecycle Frontmatter the protocol requires is added
 * by the installed CLI's `vellum adopt` and `vellum stamp` (TestRepo.writeSpec).
 */

export const SLUG = "001-greeting";

export const REQUIREMENTS = `# Requirements Document

## Introduction

A command-line greeter that prints a greeting for a name and refuses an empty one.

## Glossary

- **Greeter**: the command-line program this spec describes.

## Requirements

### Requirement 1: Greet a person by name

**User Story:** As a user, I want a greeting that names me, so that the output is personal.

#### Acceptance Criteria

1. WHEN the Greeter receives a non-empty name, THE Greeter SHALL print "Hello, <name>!" on one line.
2. IF the Greeter receives an empty name, THEN THE Greeter SHALL exit with status 2 and print nothing to stdout.

### Requirement 2: Say goodbye

**User Story:** As a user, I want a farewell, so that the program can close a session.

#### Acceptance Criteria

1. WHEN the Greeter receives the --bye option, THE Greeter SHALL print "Goodbye, <name>!" instead of the greeting.
`;

export const DESIGN = `# Design Document

## Overview

One module, \`src/greet.mjs\`, exporting \`greet(name, { bye })\`; a test file exercises it with node's test runner.

## Correctness Properties

Property 1: Greeting names the person

For all non-empty names, the output is exactly "Hello, " followed by the name and "!".

**Validates: Requirements 1.1**

Property 2: Empty names are refused

For every empty or whitespace-only name, the Greeter exits 2 and writes nothing to stdout.

**Validates: Requirements 1.2**

Property 3: Farewell replaces greeting

For all names with --bye, the output is "Goodbye, " followed by the name and "!".

**Validates: Requirements 2.1**

## Testing Strategy

Unit tests with \`node --test\`.
`;

export const TASKS = `# Implementation Plan

## Overview

Build the greeting, then the farewell. Two waves.

**Source documents:** \`requirements.md\`, \`design.md\` (both in this spec directory)

**Total leaf tasks:** 5 · **Optional leaf tasks:** 0 · **Waves:** 4

## Tasks

- [ ] 1. Greeting core
  - [ ] 1.1 Implement greet() in src/greet.mjs _Requirements: 1.1_
  - [ ] 1.2 Refuse an empty name in src/greet.mjs _Requirements: 1.2_
  - [ ] 1.3 Unit tests for greet() in test/greet.test.mjs _Requirements: 1.1, 1.2_ _Properties: 1, 2_

- [ ] 2. Checkpoint: ensure all tests pass

- [ ] 3. Farewell
  - [ ] 3.1 Farewell option in src/greet.mjs _Requirements: 2.1_
  - [ ] 3.2 Unit test for --bye in test/greet.test.mjs _Requirements: 2.1_ _Properties: 3_

## Task Dependency Graph

\`\`\`json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3", "3.1"] },
    { "id": 3, "tasks": ["3.2"] }
  ]
}
\`\`\`

## Execution Log

| Task | Criteria | Command | Exit | Evidence |
| ---- | -------- | ------- | ---- | -------- |
`;

/**
 * Tasks the engine requires evidence for: every task line that is neither
 * optional nor a parent — the leaves 1.1, 1.2, 1.3, 3.1 and 3.2, and checkpoint 2.
 * Parents 1 and 3 are complete when their required sub-tasks are.
 * (Tasks 1.3 and 3.2 cite Properties and are thus required, not optional.)
 */
export const REQUIRED_TASKS = ["1.1", "1.2", "1.3", "2", "3.1", "3.2"] as const;

/** Parent tasks: containers with sub-tasks, never started or evidenced themselves. */
export const PARENT_TASKS = ["1", "3"] as const;

/** The project the tasks build, so a verification command has something real to run. */
export const PROJECT_FILES: Readonly<Record<string, string>> = {
  "package.json": `${JSON.stringify({ name: "greeter", private: true, type: "module" }, null, 2)}\n`,
  "src/greet.mjs": `export function greet(name, { bye = false } = {}) {
  if (name.trim() === "") throw new RangeError("empty name");
  return \`\${bye ? "Goodbye" : "Hello"}, \${name}!\`;
}
`,
  "test/greet.test.mjs": `import { test } from "node:test";
import assert from "node:assert/strict";
import { greet } from "../src/greet.mjs";

test("greets by name", () => assert.equal(greet("Ada"), "Hello, Ada!"));
test("refuses an empty name", () => assert.throws(() => greet("  "), RangeError));
test("says goodbye", () => assert.equal(greet("Ada", { bye: true }), "Goodbye, Ada!"));
`,
};

/** A real verification command that passes in the project above. */
export const PASSING_COMMAND = "node --test test/greet.test.mjs";
