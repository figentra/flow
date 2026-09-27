/**
 * @vellum/protocol — Checksum forms
 *
 * The Artifact Checksum is the SHA-256 of a canonical form of the body, and
 * that form has changed once, so a recorded checksum says which form it
 * hashes (decision 14 in 002's design):
 *
 * - form 1 — canonicalBodyForm1, what Vellum 0.1.2 and earlier hashed. A
 *   ledger entry without a `checksum_form` field is form 1.
 * - form 2 — canonicalChecksumBody, which also normalises the layout a
 *   Markdown formatter owns (blank-line runs and soft wraps; decision 13).
 *   Approvals and Task Bindings written now record `checksum_form: 2`, and
 *   Lifecycle Frontmatter carries the form-2 checksum.
 *
 * A recorded checksum binds an artifact exactly when it equals the artifact's
 * checksum in the recorded form (checksumBindsBody). Accepting form 1 for an
 * old record weakens nothing: form 2 is computed from the form-1 body, so two
 * bodies with equal form-1 checksums have equal form-2 checksums — form 1
 * notices every edit form 2 notices, and more.
 */

import { createHash } from "node:crypto";
import type { Checksum } from "./types";
import { canonicalChecksumBody } from "./canonical-body.js";
import { canonicalBodyForm1 } from "./canonical-body-form-1.js";

/** A canonical form an Artifact Checksum can hash. */
export type ChecksumForm = 1 | 2;

/** The form new checksums are computed in. */
export const CHECKSUM_FORM = 2 as const satisfies ChecksumForm;

/** The SHA-256 of `body`'s canonical form `form`. */
export function computeChecksumInForm(body: string, form: ChecksumForm): Checksum {
  const content = form === 1 ? canonicalBodyForm1(body) : canonicalChecksumBody(body);
  return createHash("sha256").update(content, "utf8").digest("hex") as Checksum;
}

/**
 * The form a ledger entry's `checksum_form` field names: 1 when the field is
 * absent (every entry Vellum 0.1.2 wrote), the form when it is 1 or 2, and
 * null for anything else — a form this version does not know, whose checksum
 * therefore binds nothing.
 */
export function readChecksumForm(value: unknown): ChecksumForm | null {
  if (value === undefined) return 1;
  return value === 1 || value === 2 ? value : null;
}

/**
 * Does a checksum recorded in `form` bind `body` as it is now? True exactly
 * when it equals `body`'s checksum in that form. A null form binds nothing.
 * This is the one comparison every approval, Task Binding and frontmatter
 * check makes.
 */
export function checksumBindsBody(
  recorded: string,
  form: ChecksumForm | null,
  body: string,
): boolean {
  return form !== null && recorded === computeChecksumInForm(body, form);
}

/**
 * A recorded checksum as the current form sees it: `body`'s current-form
 * checksum when the record binds `body` (checksumBindsBody), else the recorded
 * checksum unchanged — which then equals no current-form checksum, so every
 * comparison against the current checksum reads it as bound to other content.
 */
export function checksumInCurrentForm(
  recorded: Checksum,
  form: ChecksumForm | null,
  body: string,
): Checksum {
  if (form === CHECKSUM_FORM) return recorded;
  return checksumBindsBody(recorded, form, body)
    ? computeChecksumInForm(body, CHECKSUM_FORM)
    : recorded;
}

/**
 * Is `checksum` the checksum of `body` in an earlier form, but not the current
 * one? Then the body is unchanged since it was recorded; only the form is
 * behind (`npx vellum stamp` brings Lifecycle Frontmatter up to date).
 */
export function isEarlierFormChecksum(checksum: string, body: string): boolean {
  return (
    checksum !== computeChecksumInForm(body, CHECKSUM_FORM) && checksumBindsBody(checksum, 1, body)
  );
}
