/**
 * Required Tasks: optional tasks and parent tasks need no evidence of their
 * own; a checkpoint does.
 */

import { describe, expect, it } from "vitest";
import { parseTaskLine } from "@vellum/protocol";
import { ancestorTasks, parentTaskIds, parentsCompletedBy, requiredTasks } from "../required-tasks.js";

const PLAN = `- [ ] 1. Greeting core
  - [ ] 1.1 Implement _Requirements: 1.1_
  - [ ] 1.2* Tests _Requirements: 1.1_
- [ ] 2. Checkpoint: ensure all tests pass
- [ ] 3. Single change _Requirements: 1.2_
- [ ] 4. Only optional work beneath
  - [ ] 4.1* Tests _Requirements: 1.2_`;

const lines = PLAN.split("\n").flatMap((line) => parseTaskLine(line) ?? []);

describe("requiredTasks", () => {
  it("keeps leaves and checkpoints; drops optional tasks and parents", () => {
    expect(requiredTasks(lines).map((t) => t.identifier)).toEqual(["1.1", "2", "3"]);
  });

  it("names every task that has a sub-task line as a parent", () => {
    expect([...parentTaskIds(lines)].sort()).toEqual(["1", "4"]);
  });

  it("keeps extra fields of the lines it is given", () => {
    const numbered = lines.map((line, index) => ({ ...line, lineNumber: index + 1 }));
    expect(requiredTasks(numbered)[1]).toMatchObject({ identifier: "2", lineNumber: 4 });
  });
});

describe("parentsCompletedBy", () => {
  const NESTED = `- [ ] 1. Top
  - [ ] 1.1 Leaf
  - [ ] 1.2 Group
    - [ ] 1.2.1 Leaf
    - [ ] 1.2.2* Optional
- [ ] 2. Checkpoint: all green`;
  const nested = NESTED.split("\n").flatMap((line) => parseTaskLine(line) ?? []);

  it("names the parent once its last required sub-task is verified, not before", () => {
    expect(parentsCompletedBy(lines, new Set(["1.1"]), "1.1")).toEqual(["1"]);
    expect(parentsCompletedBy(nested, new Set(["1.2.1"]), "1.2.1")).toEqual(["1.2"]);
  });

  it("names every ancestor whose required descendants are all verified, nearest first", () => {
    expect(parentsCompletedBy(nested, new Set(["1.1", "1.2.1"]), "1.2.1")).toEqual(["1.2", "1"]);
    expect(parentsCompletedBy(nested, new Set(["1.2.1", "1.1"]), "1.1")).toEqual(["1"]);
  });

  it("names nothing for an optional task, a parent, a top-level task or an unverified one", () => {
    expect(parentsCompletedBy(nested, new Set(["1.1", "1.2.1", "1.2.2"]), "1.2.2")).toEqual([]);
    expect(parentsCompletedBy(nested, new Set(["1.1", "1.2.1", "1.2"]), "1.2")).toEqual([]);
    expect(parentsCompletedBy(nested, new Set(["2"]), "2")).toEqual([]);
    expect(parentsCompletedBy(nested, new Set(["1.1"]), "1.2.1")).toEqual([]);
  });

  // Decision 15: a parent whose sub-tasks are all optional is complete only
  // when every one of them is verified. (Before it, such a parent was never
  // completed: it had no required sub-task to wait for.)
  const OPTIONAL_ONLY = `- [ ] 1. Core
  - [ ] 1.1 Leaf
  - [ ] 1.2* Extra
- [ ] 2. Extras
  - [ ] 2.1* First extra
  - [ ] 2.2* Second extra
- [ ] 3. Mixed
  - [ ] 3.1 Leaf
  - [ ] 3.2 Group of extras
    - [ ] 3.2.1* Extra
    - [ ] 3.2.2* Extra`;
  const optionalOnly = OPTIONAL_ONLY.split("\n").flatMap((line) => parseTaskLine(line) ?? []);

  it("completes an all-optional parent only when every optional sub-task is verified", () => {
    expect(parentsCompletedBy(lines, new Set(["4.1"]), "4.1")).toEqual(["4"]);
    expect(parentsCompletedBy(optionalOnly, new Set(["2.1"]), "2.1")).toEqual([]);
    expect(parentsCompletedBy(optionalOnly, new Set(["2.1", "2.2"]), "2.2")).toEqual(["2"]);
    expect(parentsCompletedBy(optionalOnly, new Set(["2.2", "2.1"]), "2.1")).toEqual(["2"]);
  });

  it("an all-optional group completes on its own; its mixed ancestor waits for required work only", () => {
    expect(parentsCompletedBy(optionalOnly, new Set(["3.2.1", "3.2.2"]), "3.2.2")).toEqual(["3.2"]);
    expect(parentsCompletedBy(optionalOnly, new Set(["3.1"]), "3.1")).toEqual(["3"]);
  });

  it("a parent with a required sub-task completes without its optional ones (unchanged)", () => {
    expect(parentsCompletedBy(optionalOnly, new Set(["1.1"]), "1.1")).toEqual(["1"]);
    expect(parentsCompletedBy(optionalOnly, new Set(["1.1", "1.2"]), "1.2")).toEqual([]);
  });
});

describe("ancestorTasks", () => {
  it("names the ancestors that are task lines, nearest first", () => {
    const tree = `- [ ] 1. Top
  - [ ] 1.2 Group
    - [ ] 1.2.1 Leaf
- [ ] 2. Checkpoint: all green`
      .split("\n")
      .flatMap((line) => parseTaskLine(line) ?? []);
    expect(ancestorTasks(tree, "1.2.1")).toEqual(["1.2", "1"]);
    expect(ancestorTasks(tree, "2")).toEqual([]);
  });
});
