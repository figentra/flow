/**
 * parseTaskItems reads a task together with the lines that belong to it: the
 * continuation lines a formatter wraps it onto (so a trailer moved to a later
 * line is still read) and the Kiro IDE's nested `_Requirements:_` bullet.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeChecksum, parseFrontmatter } from "../frontmatter.js";
import { extractTaskIdentifiers, parseTaskItems } from "../markers.js";

const fixture = (name: string) =>
  parseFrontmatter(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"))!.body;

describe("parseTaskItems", () => {
  it("reads a single-line task as parseTaskLine does, with its line number", () => {
    expect(parseTaskItems("# Tasks\n\n- [x] 1.1 Build it _Requirements: 1.1_\n")).toEqual([
      {
        lineNumber: 3,
        marker: "x",
        identifier: "1.1",
        text: "Build it",
        requirementsTrailer: ["1.1"],
        isOptional: false,
      },
    ]);
  });

  it("joins continuation lines, so a trailer wrapped onto a later line is read", () => {
    const plan = [
      "- [ ] 2. Pipeline",
      "  - [-] 2.2* Create `request.ts` exporting",
      "        `buildRequest()` returning a frozen request _Requirements: 1.2,",
      "        1.3_ _Properties:",
      "        5_",
      "  - [ ] 2.3 Next <!-- criteria:",
      "    2.1 -->",
    ].join("\n");
    const items = parseTaskItems(plan);
    expect(items.map((i) => i.identifier)).toEqual(["2", "2.2", "2.3"]);
    expect(items[1]).toEqual({
      lineNumber: 2,
      marker: "-",
      identifier: "2.2",
      text: "Create `request.ts` exporting `buildRequest()` returning a frozen request",
      requirementsTrailer: ["1.2", "1.3"],
      propertiesTrailer: ["P5"],
      isOptional: true,
    });
    expect(items[2]?.requirementsTrailer).toEqual(["2.1"]);
    expect(items[0]?.requirementsTrailer).toBeUndefined();
  });

  it("does not take a wrapped line that starts like `200) …` for a list item", () => {
    const [item] = parseTaskItems(
      "- [ ] 3.1 Sleep for `baseDelayMs` (default\n      200) × 2 _Requirements: 6.1_\n",
    );
    expect(item?.text).toBe("Sleep for `baseDelayMs` (default 200) × 2");
    expect(item?.requirementsTrailer).toEqual(["6.1"]);
  });

  it("reads the Kiro IDE's nested trailer bullet as the task's trailer", () => {
    const plan = [
      "- [ ] 1. Set up the project",
      "  - Create the directory layout",
      "  - Define the interfaces",
      "  - _Requirements: 1.1, 2.3_",
      "",
      "- [ ] 2. Implement the model",
      "  - [ ] 2.1 Write the validators",
      "    - Validate the payload",
      "    - _Requirements: 3.1_",
      "    - _Properties: 2_",
      "  - [ ] 2.2 Write the tests",
      "    - _Requirements: 3.2,",
      "      3.3_",
    ].join("\n");
    const items = parseTaskItems(plan);
    expect(
      items.map((i) => [i.identifier, i.text, i.requirementsTrailer, i.propertiesTrailer]),
    ).toEqual([
      ["1", "Set up the project", ["1.1", "2.3"], undefined],
      ["2", "Implement the model", undefined, undefined],
      ["2.1", "Write the validators", ["3.1"], ["P2"]],
      ["2.2", "Write the tests", ["3.2", "3.3"], undefined],
    ]);
    expect(items.map((i) => i.lineNumber)).toEqual([1, 6, 7, 11]);
  });

  it("merges a nested trailer with the task line's own", () => {
    const [item] = parseTaskItems(
      "- [ ] 1 Do it _Requirements: 1.1_\n  - _Requirements: 1.1, 1.2_\n",
    );
    expect(item?.requirementsTrailer).toEqual(["1.1", "1.2"]);
  });

  it("ends an item at a blank line, a sibling list item, a heading or a table", () => {
    const plan = [
      "- [ ] 1 One",
      "",
      "  Loose paragraph _Requirements: 9.9_",
      "- [ ] 2 Two",
      "- Sibling bullet _Requirements: 9.9_",
      "- [ ] 3 Three",
      "  ## Heading _Requirements: 9.9_",
      "- [ ] 4 Four",
      "| table _Requirements: 9.9_ |",
    ].join("\n");
    const items = parseTaskItems(plan);
    expect(items.map((i) => [i.identifier, i.text, i.requirementsTrailer])).toEqual([
      ["1", "One", undefined],
      ["2", "Two", undefined],
      ["3", "Three", undefined],
      ["4", "Four", undefined],
    ]);
  });

  it("reads comment and Kiro trailers in any order once lines are joined", () => {
    const [item] = parseTaskItems(
      "- [ ] 1.1 Write tests (spec-executor) <!-- properties: P1 -->\n_Requirements: 1.1_ <!-- criteria: 1.2 -->\n",
    );
    expect(item).toMatchObject({
      text: "Write tests (spec-executor)",
      requirementsTrailer: ["1.1", "1.2"],
      propertiesTrailer: ["P1"],
    });
  });

  it("reads a Markdown lazy continuation line (no indent) as part of the task", () => {
    const items = parseTaskItems("- [ ] 1. Create the file\n_Requirements: 1.1, 1.2_\n");
    expect(items.map((i) => [i.text, i.requirementsTrailer])).toEqual([
      ["Create the file", ["1.1", "1.2"]],
    ]);
  });

  it("ignores task lines inside a fenced code block", () => {
    const plan =
      "- [ ] 1 Real\n\n```md\n- [ ] 2 Example\n```\n\n~~~\n- [ ] 3 Example\n~~~\n- [ ] 4 Real\n";
    expect(extractTaskIdentifiers(plan)).toEqual(["1", "4"]);
  });

  it("reads CRLF text", () => {
    const [item] = parseTaskItems("- [ ] 1 Do\r\n  it _Requirements: 1.1_\r\n");
    expect(item?.text).toBe("Do it");
    expect(item?.requirementsTrailer).toEqual(["1.1"]);
  });

  describe("the real plan, before and after a formatter", () => {
    const original = fixture("network-plan.tasks.md");
    const variants = {
      "prettier (default)": fixture("network-plan.prettier-default.tasks.md"),
      "prettier --prose-wrap always": fixture("network-plan.prose-wrap-always.tasks.md"),
    };

    for (const [name, body] of Object.entries(variants)) {
      it(`${name}: every task, trailer and marker reads the same`, () => {
        const strip = (items: ReturnType<typeof parseTaskItems>) =>
          items.map(({ lineNumber: _line, ...rest }) => rest);
        expect(strip(parseTaskItems(body))).toEqual(strip(parseTaskItems(original)));
        expect(parseTaskItems(original)).toHaveLength(24);
      });

      it(`${name}: the Artifact Checksum is unchanged`, () => {
        expect(body).not.toBe(original);
        expect(computeChecksum(body)).toBe(computeChecksum(original));
      });
    }

    it("task 2.2's trailers survive prettier --prose-wrap always", () => {
      const task = parseTaskItems(variants["prettier --prose-wrap always"]).find(
        (t) => t.identifier === "2.2",
      );
      expect(task?.requirementsTrailer).toEqual(["1.2", "1.3", "2.1", "2.2", "2.3", "2.4"]);
      expect(task?.text.endsWith("when the merged headers lack one")).toBe(true);
    });
  });
});
