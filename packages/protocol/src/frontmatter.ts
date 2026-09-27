/**
 * @vellum/protocol — Frontmatter parsing and validation
 *
 * Handles YAML frontmatter in artifacts with parsing, validation,
 * and checksum computation.
 */

import { createHash } from "node:crypto";
import type { LifecycleFrontmatter, LifecycleState, Checksum } from "./types";
import { parseChecksum } from "./types";
import { canonicalChecksumBody } from "./canonical-body.js";

// ============================================================================
// Checksum Computation
// ============================================================================

/**
 * Compute the Artifact Checksum: SHA-256 of the canonical form of the body.
 *
 * The frontmatter is excluded and formatting-only differences are normalised
 * (see canonicalChecksumBody), so an approval survives a reformat — including
 * a Markdown formatter's blank lines and re-wrapped prose — and a frontmatter
 * update, but not a content change.
 */
export function computeChecksum(body: string): Checksum {
  const content = canonicalChecksumBody(body);
  const hash = createHash("sha256").update(content, "utf8").digest("hex");
  return hash as Checksum;
}

// ============================================================================
// Frontmatter Parsing
// ============================================================================

/**
 * Parse frontmatter from an artifact body
 */
export function parseFrontmatter(
  content: string,
): { frontmatter: LifecycleFrontmatter; body: string } | null {
  // Match YAML frontmatter between --- markers
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!match) {
    return null;
  }

  const yamlContent = match[1];
  const body = match[2];

  // Validate required groups exist
  if (!yamlContent || body === undefined) {
    return null;
  }

  try {
    const parsed = parseYamlFrontmatter(yamlContent);

    if (!parsed) {
      return null;
    }

    // Every scalar is read as a string; only `version` is typed as a number
    // by the protocol, so only it is converted. Guessing a type from the
    // value's shape would turn an all-digit checksum ("0123…") into a number
    // and reject a valid artifact.
    const { version: versionText, checksum: checksumText, state, createdAt, updatedAt } = parsed;
    if (
      versionText === undefined ||
      !/^\d+$/.test(versionText) ||
      checksumText === undefined ||
      state === undefined ||
      createdAt === undefined ||
      updatedAt === undefined
    ) {
      return null;
    }
    const version = Number(versionText);

    // Validate checksum format
    const checksum = parseChecksum(checksumText);
    if (!checksum) {
      return null;
    }

    // Validate state
    const validStates: LifecycleState[] = [
      "DRAFT",
      "IN_REVIEW",
      "REQUIREMENTS_APPROVED",
      "DESIGN_IN_REVIEW",
      "DESIGN_APPROVED",
      "PLAN_IN_REVIEW",
      "PLAN_APPROVED",
      "IN_PROGRESS",
      "VERIFICATION",
      "VERIFIED",
      "MERGED",
      "RELEASED",
      "DONE",
      "BLOCKED",
      "REJECTED",
      "SUPERSEDED",
      "ABANDONED",
      "INVALID",
    ];

    if (!validStates.includes(state as LifecycleState)) {
      return null;
    }

    return {
      frontmatter: {
        version,
        checksum,
        state: state as LifecycleState,
        createdAt,
        updatedAt,
      },
      body,
    };
  } catch {
    return null;
  }
}

/**
 * Read the frontmatter's `key: value` lines. Values stay strings (one pair of
 * surrounding quotes removed); the caller converts the fields the protocol
 * types as something else. Returns null on a line that is not `key: value`.
 */
function parseYamlFrontmatter(yaml: string): Partial<Record<string, string>> | null {
  const result: Partial<Record<string, string>> = {};

  for (const line of yaml.split("\n")) {
    if (!line.trim()) continue;

    const match = line.match(/^(\w+):\s*(.+)$/);
    if (!match?.[1] || match[2] === undefined) {
      return null;
    }

    result[match[1]] = unquote(match[2].trim());
  }

  return result;
}

/** Remove one pair of matching surrounding quotes. */
function unquote(value: string): string {
  const quoted = /^(["'])(.*)\1$/.exec(value);
  return quoted?.[2] ?? value;
}

// ============================================================================
// Frontmatter Serialization
// ============================================================================

/**
 * Serialize frontmatter and body back to string
 */
export function serializeFrontmatter(frontmatter: LifecycleFrontmatter, body: string): string {
  const yaml = [
    "---",
    `version: ${frontmatter.version}`,
    `checksum: ${frontmatter.checksum}`,
    `state: ${frontmatter.state}`,
    `createdAt: ${frontmatter.createdAt}`,
    `updatedAt: ${frontmatter.updatedAt}`,
    "---",
    "",
  ].join("\n");

  return yaml + body;
}

// ============================================================================
// Frontmatter Validation
// ============================================================================

/**
 * Validate that frontmatter checksum matches computed checksum
 */
export function validateFrontmatterChecksum(
  frontmatter: LifecycleFrontmatter,
  body: string,
): boolean {
  const computed = computeChecksum(body);
  return frontmatter.checksum === computed;
}

/**
 * Create initial frontmatter for a new artifact
 */
export function createInitialFrontmatter(state: LifecycleState = "DRAFT"): LifecycleFrontmatter {
  const now = new Date().toISOString();
  return {
    version: 1,
    checksum: computeChecksum(""),
    state,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Update frontmatter for an amended artifact
 */
export function amendFrontmatter(
  frontmatter: LifecycleFrontmatter,
  newBody: string,
  newState?: LifecycleState,
): LifecycleFrontmatter {
  const now = new Date().toISOString();
  return {
    version: frontmatter.version + 1,
    checksum: computeChecksum(newBody),
    state: newState || frontmatter.state,
    createdAt: frontmatter.createdAt,
    updatedAt: now,
  };
}
