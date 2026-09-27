/**
 * Checksum forms (decision 14 in 002's design): a checksum recorded by Vellum
 * 0.1.2 (form 1, no `checksum_form` field) keeps binding the artifact it was
 * recorded for, and stops binding it after a content edit; new checksums are
 * form 2.
 *
 * The golden form-1 checksums below were computed by 0.1.2's own source
 * (canonical-body.ts at release commit 690c8a5), not by this package, so they
 * pin canonicalBodyForm1 to what 0.1.2 actually hashed. 49e04a64… is also the
 * checksum a real 0.1.2 ledger recorded when approving the fixture plan.
 */

import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { canonicalChecksumBody } from "../canonical-body.js";
import { canonicalBodyForm1 } from "../canonical-body-form-1.js";
import {
  CHECKSUM_FORM,
  checksumBindsBody,
  checksumInCurrentForm,
  computeChecksumInForm,
  isEarlierFormChecksum,
  readChecksumForm,
} from "../checksum-form.js";
import { computeChecksum, parseFrontmatter, validateFrontmatterChecksum } from "../frontmatter.js";
import type { Checksum } from "../types.js";

const PLAN_FILE = readFileSync(
  new URL("./fixtures/network-plan.tasks.md", import.meta.url),
  "utf8",
);
const PLAN_BODY = parseFrontmatter(PLAN_FILE)!.body;
/** The checksum Vellum 0.1.2 recorded approving the fixture plan. */
const PLAN_FORM_1 = "49e04a6490e370be4a0f526de0ac6964a2cb70d15ac6aac9af2b7bcce6341df3";

const WRAPPED =
  "\n# Requirements Document\n\n## Introduction\n\nA command-line greeter that prints a greeting\nfor a name and refuses an empty one.\n\n\n## Requirements\n\n1. WHEN the Greeter receives a name, THE Greeter SHALL\n   print it.\n";
const MARKED =
  "---\nversion: 1\nchecksum: x\n---\n# Implementation Plan\r\n\r\n- [x] 1.1 Build it _Requirements: 1.1_\r\n- [-] 1.2 Test it   \r\n\r\n| Task |  Exit |\r\n|:----|---:|\r\n\r\n## Execution Log\r\n\r\n| Task | Exit |\r\n| --- | --- |\r\n| 1.1 | 0 |\r\n";
const FENCED = '﻿Text.\n\n```json\n{ "a": 1 }   \n```\n\n\n\n';

const GOLDEN_FORM_1: ReadonlyArray<readonly [string, string, string]> = [
  [
    "wrapped prose and a blank-line run",
    WRAPPED,
    "fc0af6f22a40d7ab7dee966db0167174fdf7664390c59b2a120f0556f19278dc",
  ],
  [
    "markers, CRLF, table padding and an Execution Log",
    MARKED,
    "77a8035b8cb7c8b8e201ceabfe4196605275834496ea5b8fcf458be883489117",
  ],
  [
    "a BOM, a fence and trailing blank lines",
    FENCED,
    "ed5223bdb6efdd95397f2862d59e31e3236bf44629ac1c15ec489d4f9c82e19c",
  ],
  ["the fixture plan", PLAN_FILE, PLAN_FORM_1],
];

describe("form 1 is what Vellum 0.1.2 hashed", () => {
  it.each(GOLDEN_FORM_1)("%s", (_name, text, golden) => {
    expect(computeChecksumInForm(text, 1)).toBe(golden);
  });

  it("differs from form 2 where a formatter's layout is involved, and only there", () => {
    expect(computeChecksumInForm(WRAPPED, 1)).not.toBe(computeChecksumInForm(WRAPPED, 2));
    expect(computeChecksumInForm(PLAN_BODY, 1)).not.toBe(computeChecksum(PLAN_BODY));
    const plain = "# Title\n\nOne paragraph on one line.\n";
    expect(computeChecksumInForm(plain, 1)).toBe(computeChecksumInForm(plain, 2));
  });

  it("is strictly more sensitive: form 2 is computed from the form-1 body", () => {
    const line = fc.oneof(
      fc.constantFrom(
        "",
        "# Heading",
        "- [x] 1.1 Task",
        "| a |  b |",
        "```",
        "> quote",
        "## Execution Log",
        "- item",
      ),
      fc.string({ maxLength: 12 }),
    );
    fc.assert(
      fc.property(fc.array(line, { maxLength: 14 }), (lines) => {
        const text = lines.join("\n");
        expect(canonicalChecksumBody(canonicalBodyForm1(text))).toBe(canonicalChecksumBody(text));
      }),
      { numRuns: 500 },
    );
  });
});

describe("readChecksumForm", () => {
  it("reads an absent field as form 1, as 0.1.2 wrote every entry", () => {
    expect(readChecksumForm(undefined)).toBe(1);
  });

  it("reads 1 and 2 as themselves and anything else as no known form", () => {
    expect(readChecksumForm(1)).toBe(1);
    expect(readChecksumForm(2)).toBe(2);
    for (const other of [0, 3, "2", null, 2.5]) expect(readChecksumForm(other)).toBeNull();
  });

  it("new checksums are form 2", () => {
    expect(CHECKSUM_FORM).toBe(2);
    expect(computeChecksum(WRAPPED)).toBe(computeChecksumInForm(WRAPPED, 2));
  });
});

describe("checksumBindsBody", () => {
  it("a form-1 checksum recorded by 0.1.2 binds the unchanged body", () => {
    expect(checksumBindsBody(PLAN_FORM_1, 1, PLAN_BODY)).toBe(true);
    expect(checksumBindsBody(PLAN_FORM_1, 1, PLAN_FILE)).toBe(true);
  });

  it("a form-1 checksum does not bind the body after a content edit", () => {
    const edited = PLAN_BODY.replace("packages/network", "packages/networking");
    expect(edited).not.toBe(PLAN_BODY);
    expect(checksumBindsBody(PLAN_FORM_1, 1, edited)).toBe(false);
  });

  it("is compared in the recorded form only", () => {
    expect(checksumBindsBody(PLAN_FORM_1, 2, PLAN_BODY)).toBe(false);
    expect(checksumBindsBody(computeChecksum(PLAN_BODY), 2, PLAN_BODY)).toBe(true);
    expect(checksumBindsBody(computeChecksum(PLAN_BODY), 1, PLAN_BODY)).toBe(false);
    expect(checksumBindsBody(PLAN_FORM_1, null, PLAN_BODY)).toBe(false);
  });
});

describe("checksumInCurrentForm", () => {
  const current = computeChecksum(PLAN_BODY);

  it("reads a binding form-1 checksum as the body's current checksum", () => {
    expect(checksumInCurrentForm(PLAN_FORM_1 as Checksum, 1, PLAN_BODY)).toBe(current);
  });

  it("leaves a form-1 checksum that no longer binds as it was recorded", () => {
    const edited = PLAN_BODY.replace("packages/network", "packages/networking");
    expect(checksumInCurrentForm(PLAN_FORM_1 as Checksum, 1, edited)).toBe(PLAN_FORM_1);
  });

  it("leaves a current-form checksum, and one of no known form, as recorded", () => {
    expect(checksumInCurrentForm(current, 2, "other text\n")).toBe(current);
    expect(checksumInCurrentForm(PLAN_FORM_1 as Checksum, null, PLAN_BODY)).toBe(PLAN_FORM_1);
  });
});

describe("frontmatter stamped by 0.1.2", () => {
  const frontmatter = parseFrontmatter(PLAN_FILE)!.frontmatter;

  it("is valid for the unchanged body, and recognised as an earlier form", () => {
    expect(frontmatter.checksum).toBe(PLAN_FORM_1);
    expect(validateFrontmatterChecksum(frontmatter, PLAN_BODY)).toBe(true);
    expect(isEarlierFormChecksum(frontmatter.checksum, PLAN_BODY)).toBe(true);
  });

  it("is stale once the content changes", () => {
    const edited = PLAN_BODY.replace("packages/network", "packages/networking");
    expect(validateFrontmatterChecksum(frontmatter, edited)).toBe(false);
    expect(isEarlierFormChecksum(frontmatter.checksum, edited)).toBe(false);
  });

  it("a current-form checksum is not an earlier form", () => {
    expect(isEarlierFormChecksum(computeChecksum(PLAN_BODY), PLAN_BODY)).toBe(false);
  });
});
