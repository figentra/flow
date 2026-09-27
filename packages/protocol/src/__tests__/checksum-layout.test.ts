/**
 * canonicalChecksumBody and computeChecksum: the layout a Markdown formatter
 * owns — blank lines after the frontmatter, repeated blank lines, soft wraps and
 * hanging indents — keeps the Artifact Checksum; a changed word, a new
 * paragraph break or a new list item changes it (decision 13 in 002's design).
 *
 * The fixture is a real plan written by the method's spec-tasks skill; the
 * reflowed variants model `prettier --prose-wrap always` (which wraps list
 * items with a hanging indent) and prettier's default blank line after the
 * frontmatter block.
 */

import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { canonicalArtifactBody, canonicalChecksumBody } from "../canonical-body.js";
import { computeChecksum, parseFrontmatter } from "../frontmatter.js";

const PLAN = readFileSync(new URL("./fixtures/network-plan.tasks.md", import.meta.url), "utf8");
const BODY = parseFrontmatter(PLAN)!.body;

const FENCE = /^\s*(`{3,}|~{3,})/;
const STANDALONE = /^\s*(?:#{1,6}\s|\||$)/;
const LIST_ITEM = /^(\s*(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ x~-]\]\*?\s+)?)/;

/**
 * Re-wrap every paragraph and list item of `text` outside code fences at
 * `width` columns, continuing a list item with `hang` extra spaces past its
 * marker's indent. Blocks, words and their order are unchanged. This is the
 * test's own model of a formatter, independent of the implementation.
 */
function reflow(text: string, width: number, hang: number): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (FENCE.test(line)) fenced = !fenced;
    if (fenced || FENCE.test(line) || STANDALONE.test(line) || /^\s*---\s*$/.test(line)) {
      out.push(line);
      continue;
    }
    const words = [line.trim()];
    while (
      i + 1 < lines.length &&
      !FENCE.test(lines[i + 1]!) &&
      !STANDALONE.test(lines[i + 1]!) &&
      !LIST_ITEM.test(lines[i + 1]!)
    ) {
      words.push(lines[++i]!.trim());
    }
    const lead = /^\s*/.exec(line)![0];
    const marker = LIST_ITEM.exec(line);
    const first = marker ? marker[1]! : lead;
    const tokens = words
      .join(" ")
      .slice(first.length - lead.length)
      .split(" ");
    const continuation = marker ? " ".repeat(lead.length + 2 + hang) : lead;
    let current = first;
    let atStart = true;
    for (const token of tokens) {
      if (!atStart && current.length + 1 + token.length > width) {
        out.push(current);
        current = continuation + token;
      } else {
        current += (atStart ? "" : " ") + token;
      }
      atStart = false;
    }
    out.push(current);
  }
  return out.join("\n");
}

describe("canonicalChecksumBody", () => {
  it("drops blank lines before the body, so prettier's default output keeps the checksum", () => {
    expect(computeChecksum(`\n${BODY}`)).toBe(computeChecksum(BODY));
    expect(computeChecksum(`\n\n\n${BODY}`)).toBe(computeChecksum(BODY));
    expect(canonicalChecksumBody(PLAN.replace(/\n---\n/, "\n---\n\n"))).toBe(
      canonicalChecksumBody(PLAN),
    );
  });

  it("property: any number of blank lines between frontmatter and body keeps the checksum", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 20 }), fc.constantFrom("\n", "\r\n"), (n, eol) => {
        const text = PLAN.replace(/\n---\n/, `\n---\n${eol.repeat(n)}`);
        expect(computeChecksum(parseFrontmatter(text.replace(/\r\n/g, "\n"))!.body)).toBe(
          computeChecksum(BODY),
        );
        expect(canonicalChecksumBody(text)).toBe(canonicalChecksumBody(PLAN));
      }),
    );
  });

  it("collapses a run of blank lines between blocks to one", () => {
    expect(computeChecksum("# A\n\n\n\nText.\n")).toBe(computeChecksum("# A\n\nText.\n"));
  });

  it("reads a wrapped paragraph or list item as one line", () => {
    expect(canonicalChecksumBody("One two\nthree.\n")).toBe("One two three.\n");
    expect(canonicalChecksumBody("- [x] 1.1 Build\n      it _Requirements:\n      1.1_\n")).toBe(
      "- [ ] 1.1 Build it _Requirements: 1.1_\n",
    );
    expect(canonicalChecksumBody("> quoted\n> text\n")).toBe("> quoted text\n");
  });

  it("keeps headings, tables, fences and separate list items apart", () => {
    const text = "# Title\nText\n| a | b |\n| - | - |\n```\ncode\nmore\n```\n- one\n- two\n";
    expect(canonicalChecksumBody(text)).toBe(
      "# Title\nText\n| a | b |\n| --- | --- |\n```\ncode\nmore\n```\n- one\n- two\n",
    );
  });

  it("changes when a paragraph is split in two or a list item is added", () => {
    const text = "Alpha beta gamma.\n";
    expect(computeChecksum("Alpha beta\n\ngamma.\n")).not.toBe(computeChecksum(text));
    expect(computeChecksum("- Alpha beta\n- gamma.\n")).not.toBe(
      computeChecksum("- Alpha beta\n  gamma.\n"),
    );
  });

  it("the prettier --prose-wrap always shape of the real plan has the original's checksum", () => {
    // Task 2.2 as prettier wraps it: the trailer moves onto a later line.
    const wrapped = BODY.replace(
      "  - [ ] 2.2 Create `packages/network/src/request.ts` exporting `buildRequest(clientOptions, requestOptions)`",
      "  - [ ] 2.2 Create `packages/network/src/request.ts` exporting\n        `buildRequest(clientOptions, requestOptions)`",
    );
    expect(wrapped).not.toBe(BODY);
    expect(computeChecksum(wrapped)).toBe(computeChecksum(BODY));
  });

  it("property: reflowing the real plan at any width and hanging indent keeps the checksum", () => {
    const original = computeChecksum(BODY);
    fc.assert(
      fc.property(
        fc.integer({ min: 20, max: 200 }),
        fc.integer({ min: 0, max: 6 }),
        (width, hang) => {
          expect(computeChecksum(reflow(BODY, width, hang))).toBe(original);
        },
      ),
    );
  });

  it("property: changing any word of the real plan's prose changes the checksum, at any width", () => {
    // The Execution Log's contents are outside the checksum (decision 12).
    const logStart = BODY.indexOf("## Execution Log");
    const logEnd = BODY.indexOf("## Notes");
    const words = [...BODY.matchAll(/[A-Za-z]{4,}/g)]
      .map((m) => m.index!)
      .filter((at) => at < logStart || at > logEnd);
    const original = computeChecksum(BODY);
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: words.length - 1 }),
        fc.integer({ min: 20, max: 200 }),
        (w, width) => {
          const at = words[w]!;
          const letter = BODY.charAt(at) === "Q" ? "Z" : "Q";
          const changed = `${BODY.slice(0, at)}${letter}${BODY.slice(at + 1)}`;
          expect(computeChecksum(reflow(changed, width, 2))).not.toBe(original);
        },
      ),
    );
  });

  it("leaves the reader-facing canonical form's line structure alone", () => {
    expect(canonicalArtifactBody("One two\nthree.\n")).toBe("One two\nthree.\n");
    expect(canonicalArtifactBody("\n\nText.\n")).toBe("\n\nText.\n");
  });
});
