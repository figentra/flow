/**
 * @vellum/storage — Spec Discovery
 *
 * Scans repository for spec directories and reads their metadata.
 */

import { join, basename } from "node:path";
import type { SpecMetadata, ArtifactKind, LifecycleState } from "@vellum/protocol";
import { brand } from "@vellum/protocol";
import { createFilesystem } from "./fs.js";

/** Default spec directory location */
export const SPEC_DIR = ".agents/specs";

/** Permitted artifact files */
export const ARTIFACT_FILES = ["requirements.md", "design.md", "tasks.md"] as const;

/**
 * Discover all specs in a repository.
 */
export async function discoverSpecs(repoPath: string): Promise<SpecMetadata[]> {
  const fs = createFilesystem(repoPath);
  const specsPath = SPEC_DIR;

  if (!(await fs.exists(specsPath))) {
    return [];
  }

  const specDirs = await fs.readdir(specsPath);
  const specs: SpecMetadata[] = [];

  for (const specDir of specDirs) {
    const specPath = join(specsPath, specDir);
    const stat = await fs.stat(specPath);

    if (!stat.isDirectory) {
      continue;
    }

    const metadata = await readSpecMetadata(repoPath, specPath);
    if (metadata) {
      specs.push(metadata);
    }
  }

  return specs;
}

/**
 * Read metadata for a single spec directory.
 */
export async function readSpecMetadata(
  repoPath: string,
  specPath: string,
): Promise<SpecMetadata | null> {
  const fs = createFilesystem(repoPath);
  const specId = basename(specPath);

  // Check for required files
  const artifacts: Record<ArtifactKind, { exists: boolean; path: string }> = {
    requirements: { exists: false, path: join(specPath, "requirements.md") },
    design: { exists: false, path: join(specPath, "design.md") },
    tasks: { exists: false, path: join(specPath, "tasks.md") },
  };

  for (const [, info] of Object.entries(artifacts)) {
    if (await fs.exists(info.path)) {
      info.exists = true;
    }
  }

  // Determine state from frontmatter if present
  let state: LifecycleState = "DRAFT";

  // Check if requirements.md has frontmatter
  if (artifacts.requirements.exists) {
    const content = await fs.readFile(artifacts.requirements.path);
    const frontmatter = parseFrontmatter(content);

    if (frontmatter && frontmatter.frontmatter.state) {
      state = frontmatter.frontmatter.state as LifecycleState;
    }
  }

  // Derive spec number from directory name (e.g., "001-feature" -> 1)
  const specNumber = parseSpecNumber(specId);

  return {
    slug: brand<string, "SpecSlug">(specId), // Using specId as slug for now
    specId: brand<string, "SpecId">(specId),
    specNumber: brand<number, "SpecNumber">(specNumber),
    path: specPath,
    state,
  };
}

/**
 * Find a spec by ID or number.
 */
export async function findSpec(
  repoPath: string,
  query: string | number,
): Promise<SpecMetadata | null> {
  const specs = await discoverSpecs(repoPath);

  if (typeof query === "number") {
    return specs.find((s) => s.specNumber === query) ?? null;
  }

  // Try exact match first
  const exact = specs.find((s) => s.specId === query);
  if (exact) return exact;

  // Try numeric prefix (e.g., "001" matches "001-feature")
  const num = parseInt(query, 10);
  if (!isNaN(num)) {
    return specs.find((s) => s.specNumber === num) ?? null;
  }

  // Try slug match (partial match on spec ID)
  const lower = query.toLowerCase();
  return specs.find((s) => s.specId.toLowerCase().includes(lower)) ?? null;
}

/**
 * Check if a directory is a valid spec directory.
 */
export async function isValidSpecDirectory(repoPath: string, specPath: string): Promise<boolean> {
  const fs = createFilesystem(repoPath);

  // Must have at least one artifact
  const hasRequirements = await fs.exists(join(specPath, "requirements.md"));
  const hasDesign = await fs.exists(join(specPath, "design.md"));
  const hasTasks = await fs.exists(join(specPath, "tasks.md"));

  return hasRequirements || hasDesign || hasTasks;
}

/**
 * Determine legacy stage from artifact presence.
 */
// Legacy stage determination - not currently used
/*
function determineLegacyStage(
  artifacts: Record<ArtifactKind, { exists: boolean; path: string }>,
): "empty" | "requirements" | "design" | "tasks" | "in-progress" | "verification" | "invalid" {
  const hasReqs = artifacts.requirements.exists;
  const hasDesign = artifacts.design.exists;
  const hasTasks = artifacts.tasks.exists;

  if (!hasReqs && !hasDesign && !hasTasks) {
    return "empty";
  }

  if (hasReqs && !hasDesign && !hasTasks) {
    return "requirements";
  }

  if (hasReqs && hasDesign && !hasTasks) {
    return "design";
  }

  if (hasReqs && hasDesign && hasTasks) {
    return "tasks";
  }

  // Design without requirements, or tasks without design
  if ((hasDesign && !hasReqs) || (hasTasks && !hasDesign)) {
    return "invalid";
  }

  return "invalid";
}
*/

/**
 * Parse spec number from directory name.
 */
function parseSpecNumber(specId: string): number {
  const match = specId.match(/^(\d+)/);
  return match && match[1] ? parseInt(match[1], 10) : 0;
}

// Re-export parseFrontmatter for use here
import { parseFrontmatter } from "./fs.js";
