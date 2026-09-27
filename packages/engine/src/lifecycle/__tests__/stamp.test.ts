/**
 * Tests for adoption (criterion 14) and re-stamping of Lifecycle Frontmatter.
 */

import { describe, expect, it } from "vitest";
import type { Artifact, ArtifactKind } from "@vellum/protocol";
import { computeChecksum, computeChecksumInForm, parseFrontmatter } from "@vellum/protocol";
import { planAdoption, planStamp, type FrontmatterPlanInput } from "../stamp.js";
import { strictVerify } from "../../verify/strict.js";
import {
  allArtifacts,
  artifact,
  commits,
  policyFor,
  verifiedLedger,
  DESIGN,
  REQUIREMENTS,
  TASKS,
} from "../../verify/__tests__/fixtures.js";

const NOW = "2026-09-27T10:00:00.000Z";
const LATER = "2026-09-28T11:00:00.000Z";

function input(
  texts: Partial<Record<ArtifactKind, string>>,
  ledgerEntries = 0,
  now = NOW,
): FrontmatterPlanInput {
  return {
    spec: "001-x",
    texts: new Map(Object.entries(texts) as Array<[ArtifactKind, string]>),
    ledgerEntries,
    now,
  };
}

/** The file texts a plan writes, by kind. */
function written(plan: ReturnType<typeof planStamp>): Partial<Record<ArtifactKind, string>> {
  if (plan.kind !== "plan") throw new Error(`expected a plan, got ${JSON.stringify(plan)}`);
  return Object.fromEntries(plan.writes.map((w) => [w.kind, w.text]));
}

function frontmatterOf(text: string) {
  const parsed = parseFrontmatter(text);
  if (parsed === null) throw new Error(`no valid frontmatter in:\n${text}`);
  return parsed;
}

/** Adopt, then apply `texts` over the adopted files. */
function adopted(
  texts: Partial<Record<ArtifactKind, string>>,
): Partial<Record<ArtifactKind, string>> {
  return written(planAdoption(input(texts)) as ReturnType<typeof planStamp>);
}

describe("planAdoption", () => {
  it("adds frontmatter to a bare requirements.md, keeping the body byte-identical (14.1, 14.2)", () => {
    const bare = "# Requirements\r\n\nTrailing spaces   \n";
    const plan = planAdoption(input({ requirements: bare }));
    expect(plan.kind).toBe("plan");
    const text = written(plan as ReturnType<typeof planStamp>).requirements!;
    expect(text.endsWith(bare)).toBe(true);
    expect(text.slice(0, text.length - bare.length)).toBe(
      [
        "---",
        "version: 1",
        `checksum: ${computeChecksum(bare)}`,
        "state: IN_REVIEW",
        `createdAt: ${NOW}`,
        `updatedAt: ${NOW}`,
        "---",
        "",
      ].join("\n"),
    );
    expect(frontmatterOf(text).frontmatter.checksum).toBe(computeChecksum(bare));
  });

  it("records the in-review state of the latest artifact present, in every artifact (14.2)", () => {
    for (const [texts, state] of [
      [{ requirements: REQUIREMENTS }, "IN_REVIEW"],
      [{ requirements: REQUIREMENTS, design: DESIGN }, "DESIGN_IN_REVIEW"],
      [{ requirements: REQUIREMENTS, design: DESIGN, tasks: TASKS }, "PLAN_IN_REVIEW"],
    ] as const) {
      const plan = planAdoption(input(texts));
      expect(plan).toMatchObject({ kind: "plan", recordedState: state });
      for (const text of Object.values(written(plan as ReturnType<typeof planStamp>))) {
        expect(frontmatterOf(text!).frontmatter).toMatchObject({ version: 1, state });
      }
    }
  });

  it("refuses a later artifact without an earlier one, naming the missing artifact (14.5)", () => {
    expect(planAdoption(input({ design: DESIGN }))).toEqual({
      kind: "refused",
      message: "001-x: design.md exists without requirements.md; write requirements.md first",
    });
    expect(planAdoption(input({ requirements: REQUIREMENTS, tasks: TASKS }))).toEqual({
      kind: "refused",
      message: "001-x: tasks.md exists without design.md; write design.md first",
    });
    expect(planAdoption(input({}))).toEqual({
      kind: "refused",
      message: "001-x has no requirements.md",
    });
  });

  it("finishes an interrupted adoption: an existing block is replaced, its createdAt kept", () => {
    const first = adopted({ requirements: REQUIREMENTS }).requirements!;
    const again = planAdoption(input({ requirements: first }, 0, LATER));
    const text = written(again as ReturnType<typeof planStamp>).requirements!;
    expect(frontmatterOf(text)).toEqual({
      frontmatter: {
        version: 1,
        checksum: computeChecksum(REQUIREMENTS),
        state: "IN_REVIEW",
        createdAt: NOW,
        updatedAt: LATER,
      },
      body: REQUIREMENTS,
    });
  });

  it("is a no-op once the ledger has entries and every artifact is current", () => {
    const texts = adopted({ requirements: REQUIREMENTS, design: DESIGN });
    expect(planAdoption(input(texts, 1))).toEqual({ kind: "current" });
  });

  it("refuses, naming stamp, once the ledger has entries and an artifact is not current", () => {
    const texts = { ...adopted({ requirements: REQUIREMENTS }), design: DESIGN };
    expect(planAdoption(input(texts, 1))).toEqual({
      kind: "refused",
      message:
        "001-x is already adopted (its ledger has entries) and the frontmatter of design.md is missing, incomplete or stale; run npx vellum stamp 001-x",
    });
  });

  it("refuses a block with a key Lifecycle Frontmatter does not define", () => {
    const plan = planAdoption(input({ requirements: `---\ntitle: X\n---\n${REQUIREMENTS}` }));
    expect(plan).toEqual({
      kind: "refused",
      message:
        "requirements.md: its frontmatter block has the key 'title', which Lifecycle Frontmatter does not define (version, checksum, state, createdAt, updatedAt); remove it",
    });
  });
});

describe("planStamp", () => {
  it("refuses a spec with no ledger entries, naming adopt", () => {
    expect(planStamp(input({ requirements: REQUIREMENTS }))).toEqual({
      kind: "refused",
      message: "001-x is not adopted (it has no ledger entries); run npx vellum adopt 001-x",
    });
  });

  it("changes nothing when every artifact is current", () => {
    const texts = adopted({ requirements: REQUIREMENTS, design: DESIGN, tasks: TASKS });
    expect(planStamp(input(texts, 1, LATER))).toEqual({
      kind: "plan",
      writes: [],
      recordedState: "PLAN_IN_REVIEW",
    });
  });

  it("gives an artifact written after adoption frontmatter and raises the recorded state", () => {
    const texts = { ...adopted({ requirements: REQUIREMENTS }), design: DESIGN };
    const plan = planStamp(input(texts, 1, LATER));
    expect(plan).toMatchObject({ kind: "plan", recordedState: "DESIGN_IN_REVIEW" });
    const out = written(plan);
    expect(frontmatterOf(out.design!)).toEqual({
      frontmatter: {
        version: 1,
        checksum: computeChecksum(DESIGN),
        state: "DESIGN_IN_REVIEW",
        createdAt: LATER,
        updatedAt: LATER,
      },
      body: DESIGN,
    });
    // requirements.md carries the Recorded Lifecycle State; its version and checksum stay.
    expect(frontmatterOf(out.requirements!).frontmatter).toEqual({
      version: 1,
      checksum: computeChecksum(REQUIREMENTS),
      state: "DESIGN_IN_REVIEW",
      createdAt: NOW,
      updatedAt: LATER,
    });
  });

  it("raises an approved state to the next in-review state, but never lowers one", () => {
    const approved = adopted({ requirements: REQUIREMENTS }).requirements!.replace(
      "state: IN_REVIEW",
      "state: REQUIREMENTS_APPROVED",
    );
    const raised = planStamp(input({ requirements: approved, design: DESIGN }, 2, LATER));
    expect(raised).toMatchObject({ recordedState: "DESIGN_IN_REVIEW" });

    const ahead = approved.replace("state: REQUIREMENTS_APPROVED", "state: PLAN_APPROVED");
    const kept = planStamp(input({ requirements: ahead }, 2, LATER));
    expect(kept).toEqual({ kind: "plan", writes: [], recordedState: "PLAN_APPROVED" });

    const blocked = approved.replace("state: REQUIREMENTS_APPROVED", "state: BLOCKED");
    expect(planStamp(input({ requirements: blocked, design: DESIGN }, 2, LATER))).toMatchObject({
      recordedState: "BLOCKED",
    });
  });

  it("re-stamps a changed body: next version, new checksum, updatedAt now", () => {
    const edited = REQUIREMENTS.replace("A folder", "A file");
    const before = adopted({ requirements: REQUIREMENTS }).requirements!;
    const text = before.replace(REQUIREMENTS, edited);
    const plan = planStamp(input({ requirements: text }, 3, LATER));
    expect(plan).toMatchObject({
      kind: "plan",
      writes: [
        {
          kind: "requirements",
          changes: [`body changed: version 1 -> 2, checksum ${computeChecksum(edited)}`],
        },
      ],
    });
    expect(frontmatterOf(written(plan).requirements!)).toEqual({
      frontmatter: {
        version: 2,
        checksum: computeChecksum(edited),
        state: "IN_REVIEW",
        createdAt: NOW,
        updatedAt: LATER,
      },
      body: edited,
    });
  });

  it("brings frontmatter stamped by Vellum 0.1.2 (checksum form 1) to the current form without a new version", () => {
    const wrapped = REQUIREMENTS.replace("# Requirements\n", "# Requirements\n\nWrapped by\nhand.\n\n\n");
    const form1 = computeChecksumInForm(wrapped, 1);
    expect(form1).not.toBe(computeChecksum(wrapped));
    const before = adopted({ requirements: wrapped })
      .requirements!.replace(computeChecksum(wrapped), form1);
    const plan = planStamp(input({ requirements: before }, 3, LATER));
    expect(plan).toMatchObject({
      kind: "plan",
      writes: [
        {
          kind: "requirements",
          changes: [
            `checksum form 2: ${computeChecksum(wrapped)} (body unchanged, version 1 kept)`,
          ],
        },
      ],
    });
    expect(frontmatterOf(written(plan).requirements!).frontmatter).toMatchObject({
      version: 1,
      checksum: computeChecksum(wrapped),
    });
  });

  it("still re-versions a body edited since 0.1.2 stamped it", () => {
    const wrapped = REQUIREMENTS.replace("# Requirements\n", "# Requirements\n\nWrapped by\nhand.\n\n\n");
    const edited = wrapped.replace("A folder", "A file");
    const before = adopted({ requirements: wrapped })
      .requirements!.replace(computeChecksum(wrapped), computeChecksumInForm(wrapped, 1))
      .replace(wrapped, edited);
    const plan = planStamp(input({ requirements: before }, 3, LATER));
    expect(frontmatterOf(written(plan).requirements!).frontmatter).toMatchObject({
      version: 2,
      checksum: computeChecksum(edited),
    });
  });

  it("does not re-stamp a Task Marker flip", () => {
    const texts = adopted({ requirements: REQUIREMENTS, design: DESIGN, tasks: TASKS });
    const flipped = texts.tasks!.replace(/- \[ \] 1 /, "- [x] 1 ");
    expect(flipped).not.toBe(texts.tasks);
    expect(planStamp(input({ ...texts, tasks: flipped }, 4, LATER))).toMatchObject({ writes: [] });
  });

  it("completes a partial block and refuses an unknown key or a bad value", () => {
    const partial = `---\nstate: IN_REVIEW\n---\n${REQUIREMENTS}`;
    const plan = planStamp(input({ requirements: partial }, 1, LATER));
    expect(plan).toMatchObject({
      writes: [
        { kind: "requirements", changes: ["added version, checksum, createdAt, updatedAt"] },
      ],
    });
    expect(frontmatterOf(written(plan).requirements!).frontmatter).toEqual({
      version: 1,
      checksum: computeChecksum(REQUIREMENTS),
      state: "IN_REVIEW",
      createdAt: LATER,
      updatedAt: LATER,
    });

    expect(planStamp(input({ requirements: `---\nowner: me\n---\nx\n` }, 1))).toMatchObject({
      kind: "refused",
    });
    expect(planStamp(input({ requirements: `---\nversion: two\n---\nx\n` }, 1))).toEqual({
      kind: "refused",
      message: "requirements.md: its frontmatter version 'two' is not a positive whole number",
    });
    expect(planStamp(input({ requirements: `---\nstate: SHIPPED\n---\nx\n` }, 1))).toEqual({
      kind: "refused",
      message: "requirements.md: its frontmatter state 'SHIPPED' is not a Lifecycle State",
    });
  });
});

describe("a stamp cannot revive a stale approval", () => {
  const policy = policyFor("standard");
  const edited = REQUIREMENTS.replace("A folder", "A file");

  function asArtifact(kind: ArtifactKind, text: string): Artifact {
    const { frontmatter, body } = frontmatterOf(text);
    return { kind, path: `/repo/.agents/specs/001-x/${kind}.md`, body, frontmatter };
  }

  it("an approval of the old body stays invalid after the edited body is stamped", () => {
    const before = adopted({ requirements: REQUIREMENTS }).requirements!;
    const stamped = written(
      planStamp(input({ requirements: before.replace(REQUIREMENTS, edited) }, 1, LATER)),
    ).requirements!;
    const artifacts = [asArtifact("requirements", stamped), ...allArtifacts().slice(1)];

    const result = strictVerify(artifacts, verifiedLedger(), policy, commits, "standard");
    expect(result.result).toBe("FAIL");
    expect(result.approvals).toEqual({ satisfied: 2, total: 3 });
    expect(result.findings[0]?.message).toBe(
      `Approval invalid: CHECKSUM_MISMATCH — requirements.md was approved at ${computeChecksum(REQUIREMENTS)} and is now ${computeChecksum(edited)}`,
    );
  });

  it("nor does frontmatter that claims the approved checksum for an edited body", () => {
    const forged = artifact("requirements", edited, computeChecksum(REQUIREMENTS));
    const result = strictVerify(
      [forged, ...allArtifacts().slice(1)],
      verifiedLedger(),
      policy,
      commits,
      "standard",
    );
    expect(result.result).toBe("FAIL");
    expect(result.approvals).toEqual({ satisfied: 2, total: 3 });
  });
});
