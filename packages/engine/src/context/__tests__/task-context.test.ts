/**
 * buildTaskContext: the per-task briefing holds the task, every criterion and
 * Property it cites in full, the design sections that name what it names,
 * the glossary terms it uses, its parent and wave, and names whatever cited
 * identifier it could not find.
 */

import { describe, expect, it } from "vitest";
import { buildTaskContext, type TaskContextArtifact } from "../task-context.js";
import { formatTaskContextMarkdown } from "../format.js";

const REQUIREMENTS = `# Requirements Document

## Glossary

| Term | Definition |
| ---- | ---------- |
| Greeter | The module that builds greetings. |
| **Visitor** | A person the Greeter greets. |
| Farewell | A greeting said on leaving. |

## Requirements

### Requirement 1: Greet a visitor

#### Acceptance Criteria

1. WHEN a Visitor arrives, THE Greeter SHALL return "Hello, <name>".
2. IF the name is empty, THEN THE Greeter SHALL reject it
   with an error naming the empty name.

### Requirement 2: Say goodbye

#### Acceptance Criteria

1. WHERE bye is set, THE Greeter SHALL return a Farewell.
`;

const DESIGN = `# Design Document

## Glossary

| Term | Definition |
| ---- | ---------- |
| Name Guard | The check that refuses an empty name. |

## Architecture

\`\`\`
src/
## not a heading, inside a fence
  greet.mjs
\`\`\`

## Components

### Greeter (\`greet.mjs\`)

Exports \`greet(name, { bye })\`.

#### Name Guard

Throws \`EmptyNameError\` for "".

### Farewell builder

Builds the farewell; lives in \`src/greet.mjs\` too.

## Correctness Properties

Property 1: Greeting names the visitor

For every non-empty name, the greeting contains it.

**Validates: Requirements 1.1**

Property 2: Empty names are refused

For the empty name, greet throws.

**Validates: Requirements 1.2**

## Error Handling

Every error is an \`EmptyNameError\`.
`;

const TASKS = `# Implementation Plan

## Tasks

- [ ] 1. Greeting core
  - [-] 1.1 Implement \`greet()\` in \`src/greet.mjs\` with the Name Guard _Requirements: 1.1, 1.2_
  - [ ] 1.2* Unit tests per the design's Error Handling section _Requirements: 1.2, 9.9_ _Properties: 2, 7_

- [ ] 2. Checkpoint: ensure all tests pass

## Task Dependency Graph

\`\`\`json
{ "waves": [ { "id": 0, "tasks": ["1.1"] }, { "id": 1, "tasks": ["1.2"] } ] }
\`\`\`
`;

const withFrontmatter = (body: string): string =>
  `---\nversion: 1\nchecksum: ${"0".repeat(64)}\nstate: PLAN_IN_REVIEW\ncreatedAt: 2026-09-28T00:00:00.000Z\nupdatedAt: 2026-09-28T00:00:00.000Z\n---\n${body}`;

const ARTIFACTS: TaskContextArtifact[] = [
  { kind: "requirements", body: REQUIREMENTS },
  { kind: "design", body: DESIGN },
  { kind: "tasks", body: TASKS },
];

describe("buildTaskContext", () => {
  it("returns null for a task tasks.md does not define, or with no tasks.md", () => {
    expect(buildTaskContext(ARTIFACTS, "7.1")).toBeNull();
    expect(buildTaskContext(ARTIFACTS, "1.1.1")).toBeNull();
    expect(buildTaskContext(ARTIFACTS.slice(0, 2), "1.1")).toBeNull();
  });

  it("gives the task, its parent and its wave", () => {
    const context = buildTaskContext(ARTIFACTS, "1.1")!;
    expect(context.task).toEqual({
      id: "1.1",
      marker: "-",
      optional: false,
      text: "Implement `greet()` in `src/greet.mjs` with the Name Guard",
      requirements: ["1.1", "1.2"],
      properties: [],
      subtasks: [],
    });
    expect(context.parent).toEqual({ id: "1", text: "Greeting core" });
    expect(context.wave).toEqual({ id: 0, tasks: ["1.1"] });
  });

  it("gives every cited criterion in full, continuation lines joined, in trailer order", () => {
    const context = buildTaskContext(ARTIFACTS, "1.1")!;
    expect(context.criteria).toEqual([
      {
        id: "1.1",
        requirement: "Requirement 1: Greet a visitor",
        text: 'WHEN a Visitor arrives, THE Greeter SHALL return "Hello, <name>".',
      },
      {
        id: "1.2",
        requirement: "Requirement 1: Greet a visitor",
        text: "IF the name is empty, THEN THE Greeter SHALL reject it with an error naming the empty name.",
      },
    ]);
    expect(context.missing).toEqual([]);
  });

  it("gives every cited Property with its Validates line, and names what it cannot find", () => {
    const context = buildTaskContext(ARTIFACTS, "1.2")!;
    expect(context.task.optional).toBe(true);
    expect(context.properties).toEqual([
      {
        id: "P2",
        title: "Empty names are refused",
        text: "Property 2: Empty names are refused\n\nFor the empty name, greet throws.\n\n**Validates: Requirements 1.2**",
        validates: ["1.2"],
      },
    ]);
    expect(context.missing).toEqual([
      { kind: "criterion", id: "9.9" },
      { kind: "property", id: "P7" },
    ]);
  });

  it("gives the deepest design sections naming its files, identifiers and design terms", () => {
    const context = buildTaskContext(ARTIFACTS, "1.1")!;
    // `greet.mjs` names the Greeter heading, but its Name Guard subsection
    // matches too (a design Glossary term the task uses), so only the
    // subsection is given; the Farewell builder's own text names the full
    // path `src/greet.mjs`. The fence's `## …` line is not a heading, and
    // the Architecture tree (a base name only) does not match.
    expect(context.design.map((s) => s.heading)).toEqual(["Name Guard", "Farewell builder"]);
    expect(context.design[0]).toEqual({
      heading: "Name Guard",
      line: 23,
      text: '#### Name Guard\n\nThrows `EmptyNameError` for "".',
    });
  });

  it("gives a section whose heading the task quotes, never the Glossary or Properties", () => {
    const context = buildTaskContext(ARTIFACTS, "1.2")!;
    expect(context.design.map((s) => s.heading)).toEqual(["Error Handling"]);
  });

  it("gives the glossary terms the task, its criteria and Properties use, once each", () => {
    const context = buildTaskContext(ARTIFACTS, "1.1")!;
    expect(context.glossary).toEqual([
      { term: "Greeter", definition: "The module that builds greetings.", source: "requirements" },
      { term: "Visitor", definition: "A person the Greeter greets.", source: "requirements" },
      { term: "Name Guard", definition: "The check that refuses an empty name.", source: "design" },
    ]);
  });

  it("reads bodies with Lifecycle Frontmatter and CRLF line endings the same", () => {
    const plain = buildTaskContext(ARTIFACTS, "1.2");
    const framed = buildTaskContext(
      ARTIFACTS.map((a) => ({
        kind: a.kind,
        body: withFrontmatter(a.body).replace(/\n/g, "\r\n"),
      })),
      "1.2",
    );
    // Only a design section's line moves: it is the line in the file given.
    expect(framed).toEqual({
      ...plain,
      design: plain!.design.map((section) => ({ ...section, line: section.line + 7 })),
    });
  });

  it("names an absent document and every citation into it", () => {
    const context = buildTaskContext([{ kind: "tasks", body: TASKS }], "1.2")!;
    expect(context.criteria).toEqual([]);
    expect(context.properties).toEqual([]);
    expect(context.missing).toEqual([
      { kind: "document", id: "requirements.md" },
      { kind: "criterion", id: "1.2" },
      { kind: "criterion", id: "9.9" },
      { kind: "document", id: "design.md" },
      { kind: "property", id: "P2" },
      { kind: "property", id: "P7" },
    ]);
  });

  it("lists a parent task's sub-tasks, and a checkpoint has no wave", () => {
    expect(buildTaskContext(ARTIFACTS, "1")!.task.subtasks).toEqual(["1.1", "1.2"]);
    const checkpoint = buildTaskContext(ARTIFACTS, "2")!;
    expect(checkpoint.wave).toBeNull();
    expect(checkpoint.parent).toBeNull();
    expect(checkpoint.criteria).toEqual([]);
  });

  it("is deterministic: the same artifacts give the same briefing", () => {
    expect(JSON.stringify(buildTaskContext(ARTIFACTS, "1.2"))).toBe(
      JSON.stringify(buildTaskContext([...ARTIFACTS].reverse(), "1.2")),
    );
  });
});

describe("formatTaskContextMarkdown", () => {
  it("prints the task, criteria, Properties, design, glossary and what is missing", () => {
    const text = formatTaskContextMarkdown("001-greeting", buildTaskContext(ARTIFACTS, "1.2")!);
    expect(text).toContain("# Task 1.2 — 001-greeting");
    expect(text).toContain("- [ ]* 1.2 Unit tests per the design's Error Handling section");
    expect(text).toContain("Parent: 1. Greeting core\nWave 1: 1.2");
    expect(text).toContain("- 1.2 IF the name is empty");
    expect(text).toContain("**Validates: Requirements 1.2**");
    // The design section's `##` heading is nested under the briefing's own `## Design`.
    expect(text).toContain("### Error Handling");
    expect(text).toContain(
      "## Missing\n\n- criterion 9.9\n- property P7\n\nOpen the full documents",
    );
  });

  it("says nothing is missing when every citation was found", () => {
    const text = formatTaskContextMarkdown("001-greeting", buildTaskContext(ARTIFACTS, "1.1")!);
    expect(text).toContain("## Missing\n\nNone: every cited criterion and Property is above.\n");
  });
});
