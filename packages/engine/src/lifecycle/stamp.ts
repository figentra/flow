/**
 * @vellum/engine — Adoption and re-stamping of Lifecycle Frontmatter
 *
 * Two plans, both pure: the caller reads the artifact texts and the number of
 * ledger entries, supplies the time, and performs the writes.
 *
 * Adoption (criterion 14) brings a Legacy Spec under management: it adds
 * Lifecycle Frontmatter to each artifact present, leaving each Artifact Body
 * byte-identical (14.1); records the in-review state of the latest artifact
 * present (14.2); records no approval (14.3); and refuses, naming the missing
 * artifact, when a later artifact exists without an earlier one (14.5).
 * Every Artifact Version starts at 1 — adoption is the one reset the
 * Artifact Version allows. It proceeds while the ledger has no entries, which
 * also finishes an adoption interrupted before its ledger entry was written;
 * once entries exist it changes nothing.
 *
 * Stamping keeps an adopted spec's frontmatter true after its artifacts are
 * written or edited: frontmatter for an artifact added later, the missing
 * fields of a partial block, and — for a body whose canonical form changed —
 * the next version, the new checksum and a new `updatedAt`; for a checksum in
 * an earlier form of the unchanged body, the current-form checksum and the
 * same version. It raises the
 * Recorded Lifecycle State to the in-review state of the latest artifact
 * present when the recorded state is behind it on the main chain, and never
 * lowers it. A Task Marker flip is not a change: the canonical body reads
 * every marker as `[ ]`.
 *
 * Neither plan decides anything about approvals. An approval is checked
 * against the checksum of the body itself, never against the frontmatter, so
 * a stamp cannot make a stale approval valid again.
 */

import type {
  ArtifactKind,
  LifecycleFrontmatter,
  LifecycleState,
} from "@vellum/protocol";
import {
  CHECKSUM_FORM,
  computeChecksum,
  isEarlierFormChecksum,
  serializeFrontmatter,
} from "@vellum/protocol";
import { chainIndex, isLifecycleState, type EffectiveState } from "./effective-state.js";

const ORDER: readonly ArtifactKind[] = ["requirements", "design", "tasks"];

/** The in-review state each artifact's presence puts a spec in (criterion 14.2). */
export const IN_REVIEW_STATE: Readonly<Record<ArtifactKind, LifecycleState>> = {
  requirements: "IN_REVIEW",
  design: "DESIGN_IN_REVIEW",
  tasks: "PLAN_IN_REVIEW",
};

const FIELDS = ["version", "checksum", "state", "createdAt", "updatedAt"] as const;
type Field = (typeof FIELDS)[number];

/** What a plan reads. */
export interface FrontmatterPlanInput {
  /** The spec's directory name, for messages */
  readonly spec: string;
  /** The raw text of each artifact file that exists */
  readonly texts: ReadonlyMap<ArtifactKind, string>;
  /** How many entries the spec's ledger holds (0 when there is none) */
  readonly ledgerEntries: number;
  /** The current time as an ISO 8601 UTC timestamp, from the caller's clock */
  readonly now: string;
}

/** One artifact file to rewrite. */
export interface ArtifactRewrite {
  readonly kind: ArtifactKind;
  /** The complete new file text: the frontmatter, then the unchanged body */
  readonly text: string;
  readonly frontmatter: LifecycleFrontmatter;
  /** What changed, in words */
  readonly changes: readonly string[];
}

/** A plan: the files to rewrite (possibly none) and the recorded state after. */
export interface FrontmatterPlan {
  readonly kind: "plan";
  readonly writes: readonly ArtifactRewrite[];
  readonly recordedState: LifecycleState;
}

/** A refusal: nothing is written. */
export interface FrontmatterRefusal {
  readonly kind: "refused";
  readonly message: string;
}

/** Adoption's result: a plan, a refusal, or nothing to do (already adopted and current). */
export type AdoptionPlan = FrontmatterPlan | FrontmatterRefusal | { readonly kind: "current" };

/** Stamping's result. */
export type StampPlan = FrontmatterPlan | FrontmatterRefusal;

/** An artifact's text split at its frontmatter block. */
interface SplitArtifact {
  readonly kind: ArtifactKind;
  /** The block's fields; null when the text has no block */
  readonly fields: ReadonlyMap<Field, string> | null;
  /** Everything after the block, byte for byte */
  readonly body: string;
}

const BLOCK = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** Split `text` at a leading frontmatter block; a message when the block cannot be read. */
function split(kind: ArtifactKind, text: string): SplitArtifact | string {
  const match = BLOCK.exec(text);
  if (match === null) return { kind, fields: null, body: text };
  const fields = new Map<Field, string>();
  const lines = (match[1] ?? "").split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (line.trim() === "") continue;
    const kv = /^(\w+):[ \t]*(.*?)[ \t]*$/.exec(line);
    if (kv === null) {
      return `${kind}.md: line ${index + 2} of its frontmatter block is not 'key: value'`;
    }
    const key = kv[1]!;
    if (!(FIELDS as readonly string[]).includes(key)) {
      return `${kind}.md: its frontmatter block has the key '${key}', which Lifecycle Frontmatter does not define (${FIELDS.join(", ")}); remove it`;
    }
    if (fields.has(key as Field)) {
      return `${kind}.md: its frontmatter block sets '${key}' twice`;
    }
    const value = /^(["'])(.*)\1$/.exec(kv[2]!)?.[2] ?? kv[2]!;
    if (value !== "") fields.set(key as Field, value);
  }
  const version = fields.get("version");
  if (version !== undefined && !/^[1-9]\d*$/.test(version)) {
    return `${kind}.md: its frontmatter version '${version}' is not a positive whole number`;
  }
  const state = fields.get("state");
  if (state !== undefined && !isLifecycleState(state)) {
    return `${kind}.md: its frontmatter state '${state}' is not a Lifecycle State`;
  }
  return { kind, fields, body: text.slice(match[0].length) };
}

/** Read every artifact present, in lifecycle order, or the first reason one cannot be. */
function readAll(input: FrontmatterPlanInput): SplitArtifact[] | FrontmatterRefusal {
  const present = ORDER.filter((kind) => input.texts.has(kind));
  if (present.length === 0) {
    return { kind: "refused", message: `${input.spec} has no requirements.md` };
  }
  // Criterion 14.5 (and 5.12): a later artifact without an earlier one.
  for (const [i, kind] of ORDER.entries()) {
    if (!input.texts.has(kind)) continue;
    const missing = ORDER.slice(0, i).filter((earlier) => !input.texts.has(earlier));
    if (missing.length > 0) {
      return {
        kind: "refused",
        message: `${input.spec}: ${kind}.md exists without ${missing.map((m) => `${m}.md`).join(" and ")}; write ${missing[0]}.md first`,
      };
    }
  }
  const artifacts: SplitArtifact[] = [];
  for (const kind of present) {
    const result = split(kind, input.texts.get(kind)!);
    if (typeof result === "string") return { kind: "refused", message: result };
    artifacts.push(result);
  }
  return artifacts;
}

function rewrite(
  artifact: SplitArtifact,
  frontmatter: LifecycleFrontmatter,
  changes: readonly string[],
): ArtifactRewrite {
  return {
    kind: artifact.kind,
    text: serializeFrontmatter(frontmatter, artifact.body),
    frontmatter,
    changes,
  };
}

/** Is `fields` a complete block whose checksum is the body's? */
function isCurrent(artifact: SplitArtifact): boolean {
  const { fields } = artifact;
  return (
    fields !== null &&
    FIELDS.every((field) => fields.has(field)) &&
    fields.get("checksum") === computeChecksum(artifact.body)
  );
}

/**
 * Plan the adoption of a spec (criterion 14).
 *
 * With no ledger entries: frontmatter for every artifact present — version 1,
 * the body's checksum, the in-review state of the latest artifact, `createdAt`
 * kept from an earlier interrupted adoption or else now, `updatedAt` now — and
 * the caller then appends the adoption entry. With entries: `current` when
 * every artifact already carries complete, current frontmatter, else a
 * refusal naming `vellum stamp`.
 */
export function planAdoption(input: FrontmatterPlanInput): AdoptionPlan {
  const artifacts = readAll(input);
  if (!Array.isArray(artifacts)) return artifacts;

  if (input.ledgerEntries > 0) {
    if (artifacts.every(isCurrent)) return { kind: "current" };
    const stale = artifacts.filter((a) => !isCurrent(a)).map((a) => `${a.kind}.md`);
    return {
      kind: "refused",
      message: `${input.spec} is already adopted (its ledger has entries) and the frontmatter of ${stale.join(", ")} is missing, incomplete or stale; run npx vellum stamp ${input.spec}`,
    };
  }

  const state = IN_REVIEW_STATE[artifacts[artifacts.length - 1]!.kind];
  const writes = artifacts.map((artifact) =>
    rewrite(
      artifact,
      {
        version: 1,
        checksum: computeChecksum(artifact.body),
        state,
        createdAt: artifact.fields?.get("createdAt") ?? input.now,
        updatedAt: input.now,
      },
      [
        artifact.fields === null ? "frontmatter added" : "frontmatter reset for adoption",
        `state ${state}`,
      ],
    ),
  );
  return { kind: "plan", writes, recordedState: state };
}

/**
 * Plan re-stamping an adopted spec's frontmatter. Refuses a spec whose ledger
 * has no entries (it is adopted first), a block with a key Lifecycle
 * Frontmatter does not define, and a later artifact without an earlier one.
 * Appends nothing to the ledger.
 */
export function planStamp(input: FrontmatterPlanInput): StampPlan {
  if (input.ledgerEntries === 0) {
    return {
      kind: "refused",
      message: `${input.spec} is not adopted (it has no ledger entries); run npx vellum adopt ${input.spec}`,
    };
  }
  const artifacts = readAll(input);
  if (!Array.isArray(artifacts)) return artifacts;

  // The Recorded Lifecycle State is requirements.md's (readAll guarantees it exists).
  const recorded = artifacts[0]!.fields?.get("state") as LifecycleState | undefined;
  const target = IN_REVIEW_STATE[artifacts[artifacts.length - 1]!.kind];
  const behind =
    recorded === undefined ||
    (chainIndex(recorded) >= 0 && chainIndex(recorded) < chainIndex(target));
  const state = behind ? target : recorded;
  const raised = state !== recorded;

  const writes: ArtifactRewrite[] = [];
  for (const artifact of artifacts) {
    const checksum = computeChecksum(artifact.body);
    const fields = artifact.fields;
    if (fields === null) {
      writes.push(
        rewrite(
          artifact,
          { version: 1, checksum, state, createdAt: input.now, updatedAt: input.now },
          ["frontmatter added", `state ${state}`],
        ),
      );
      continue;
    }

    const changes: string[] = [];
    const missing = FIELDS.filter((field) => !fields.has(field));
    if (missing.length > 0) changes.push(`added ${missing.join(", ")}`);

    const previousVersion = Number(fields.get("version") ?? "1");
    const previousChecksum = fields.get("checksum");
    // A checksum in an earlier form of the unchanged body (frontmatter stamped
    // by Vellum 0.1.2) is not a body change: the form moves on, the version
    // does not (decision 14 in 002's design).
    const earlierForm =
      previousChecksum !== undefined && isEarlierFormChecksum(previousChecksum, artifact.body);
    const bodyChanged =
      previousChecksum !== undefined &&
      /^[0-9a-f]{64}$/.test(previousChecksum) &&
      previousChecksum !== checksum &&
      !earlierForm;
    const version = bodyChanged ? previousVersion + 1 : previousVersion;
    if (bodyChanged)
      changes.push(`body changed: version ${previousVersion} -> ${version}, checksum ${checksum}`);
    else if (earlierForm)
      changes.push(`checksum form ${CHECKSUM_FORM}: ${checksum} (body unchanged, version ${version} kept)`);
    else if (previousChecksum !== undefined && previousChecksum !== checksum)
      changes.push(`checksum ${checksum}`);

    const ownState = fields.get("state") as LifecycleState | undefined;
    const newState = raised || ownState === undefined ? state : ownState;
    if (ownState !== undefined && newState !== ownState)
      changes.push(`state ${ownState} -> ${newState}`);

    if (changes.length === 0) continue;
    writes.push(
      rewrite(
        artifact,
        {
          version,
          checksum,
          state: newState,
          createdAt: fields.get("createdAt") ?? input.now,
          updatedAt: input.now,
        },
        changes,
      ),
    );
  }
  return { kind: "plan", writes, recordedState: state };
}

/** What `planRecordState` reads. */
export interface RecordStateInput {
  /** The spec's directory name, for messages */
  readonly spec: string;
  /** The raw text of each artifact file that exists */
  readonly texts: ReadonlyMap<ArtifactKind, string>;
  /** The state to record: a state on Table 5.A's main chain */
  readonly target: LifecycleState;
  /**
   * The Effective Lifecycle State computed with `target` as the Recorded
   * Lifecycle State: the engine walks towards it and stops at the first
   * unmet precondition, so it equals `target` only when every precondition
   * on the way holds.
   */
  readonly effective: EffectiveState;
}

/** A state-only rewrite of each artifact's frontmatter, or why nothing changes. */
export type RecordStatePlan =
  | {
      readonly kind: "record";
      readonly from: LifecycleState;
      readonly to: LifecycleState;
      /** The complete new text of each artifact: only its `state:` line differs */
      readonly writes: readonly { readonly kind: ArtifactKind; readonly text: string }[];
    }
  | { readonly kind: "unchanged"; readonly reason: string };

/**
 * Plan recording `target` as the Recorded Lifecycle State (criterion 5.3;
 * decision 16 in 002's design). Records only forward along the main chain,
 * and only a state the Effective Lifecycle State supports (criterion 5.10):
 * unchanged when the recorded state is off the main chain (BLOCKED, a
 * terminal state, INVALID), already at or past `target`, or when the
 * effective state computed for `target` is not `target`. The rewrite changes
 * the `state:` line of each artifact's frontmatter and nothing else — no
 * version, checksum or `updatedAt` — and appends no ledger entry: Table 5.A's
 * main-chain transitions record none. The frontmatter is outside the Artifact
 * Checksum, so no approval changes.
 */
export function planRecordState(input: RecordStateInput): RecordStatePlan {
  if (chainIndex(input.target) < 0) {
    return { kind: "unchanged", reason: `${input.target} is not on the main chain` };
  }
  const artifacts = readAll({ spec: input.spec, texts: input.texts, ledgerEntries: 0, now: "" });
  if (!Array.isArray(artifacts)) return { kind: "unchanged", reason: artifacts.message };
  const recorded = artifacts[0]!.fields?.get("state") as LifecycleState | undefined;
  if (recorded === undefined) {
    return { kind: "unchanged", reason: `${input.spec}: requirements.md records no state; run npx vellum stamp ${input.spec}` };
  }
  if (chainIndex(recorded) < 0) {
    return { kind: "unchanged", reason: `the Recorded Lifecycle State ${recorded} is off the main chain` };
  }
  if (chainIndex(recorded) >= chainIndex(input.target)) {
    return { kind: "unchanged", reason: `the Recorded Lifecycle State is already ${recorded}` };
  }
  const { effective } = input;
  if (effective.kind !== "computed" || effective.state !== input.target) {
    const reached = effective.kind === "computed" ? effective.state : effective.holdsThrough;
    const why = effective.kind === "computed" ? effective.failedPrecondition : effective.reason;
    return {
      kind: "unchanged",
      reason: `the Effective Lifecycle State reaches ${reached}, not ${input.target}${why ? ` (${why})` : ""}`,
    };
  }

  const writes: { kind: ArtifactKind; text: string }[] = [];
  for (const artifact of artifacts) {
    const text = input.texts.get(artifact.kind)!;
    const block = BLOCK.exec(text);
    if (block === null || !artifact.fields?.has("state")) continue;
    const rewritten = block[0].replace(/^state:[ \t]*.*$/m, `state: ${input.target}`);
    if (rewritten !== block[0]) writes.push({ kind: artifact.kind, text: rewritten + text.slice(block[0].length) });
  }
  return { kind: "record", from: recorded, to: input.target, writes };
}
