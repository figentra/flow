/**
 * Policy Loader - reads and validates Consumer Configuration.
 *
 * @see requirements.md Requirement 7.4
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ConsumerConfiguration, PolicyError } from "./domain/policy/types";

/**
 * Schema version supported by this Platform version.
 */
const SUPPORTED_SCHEMA_VERSION = "1.0";

/**
 * Default policy file location.
 */
const DEFAULT_POLICY_PATH = ".sdlc/policy.json";

/**
 * Load and validate Consumer Configuration.
 *
 * @param repoPath - Path to the repository root
 * @param policyPath - Optional custom policy path (relative to repo root)
 * @returns Consumer Configuration or error
 *
 * @throws {PolicyError} on missing, invalid, or unsupported policy
 */
export async function loadPolicy(
  repoPath: string,
  policyPath: string = DEFAULT_POLICY_PATH,
): Promise<ConsumerConfiguration> {
  const fullPath = join(repoPath, policyPath);

  // Attempt to read policy file
  let content: string;
  try {
    content = await readFile(fullPath, "utf-8");
  } catch (error) {
    const code =
      error instanceof Error && "code" in error && error.code === "ENOENT"
        ? "POLICY_MISSING"
        : "POLICY_INVALID";

    const policyError: PolicyError = {
      code,
      message:
        code === "POLICY_MISSING"
          ? "Approval Policy is missing"
          : `Failed to read policy file: ${error instanceof Error ? error.message : "Unknown error"}`,
      path: policyPath,
    };

    throw policyError;
  }

  // Parse JSON
  let config: unknown;
  try {
    config = JSON.parse(content);
  } catch (error) {
    const policyError: PolicyError = {
      code: "POLICY_INVALID",
      message: `Failed to parse policy JSON: ${error instanceof Error ? error.message : "Unknown error"}`,
      path: policyPath,
    };

    throw policyError;
  }

  // Validate schema version
  if (!isConsumerConfiguration(config)) {
    const policyError: PolicyError = {
      code: "POLICY_INVALID",
      message: "Policy does not conform to Consumer Configuration schema",
      path: policyPath,
    };

    throw policyError;
  }

  if (config.schema_version !== SUPPORTED_SCHEMA_VERSION) {
    const policyError: PolicyError = {
      code: "POLICY_UNSUPPORTED_VERSION",
      message: `Policy schema version ${config.schema_version} is not supported. Expected ${SUPPORTED_SCHEMA_VERSION}`,
      path: policyPath,
      context: { expected: SUPPORTED_SCHEMA_VERSION, actual: config.schema_version },
    };

    throw policyError;
  }

  return config;
}

/**
 * Type guard for Consumer Configuration.
 */
function isConsumerConfiguration(value: unknown): value is ConsumerConfiguration {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const config = value as Record<string, unknown>;

  // Check required fields
  if (typeof config.schema_version !== "string") return false;
  if (typeof config.repository !== "string") return false;

  // Check approval policy
  if (typeof config.approval !== "object" || config.approval === null) {
    return false;
  }

  const approval = config.approval as Record<string, unknown>;

  if (typeof approval.schema_version !== "string") return false;
  if (!Array.isArray(approval.approvers)) return false;
  if (typeof approval.requirements !== "object" || approval.requirements === null) {
    return false;
  }

  // Validate approvers array
  for (const approver of approval.approvers) {
    if (!isAuthorisedApprover(approver)) {
      return false;
    }
  }

  return true;
}

/**
 * Type guard for Authorised Approver.
 */
function isAuthorisedApprover(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const approver = value as Record<string, unknown>;

  return (
    typeof approver.email === "string" &&
    (approver.key_type === "gpg" || approver.key_type === "ssh") &&
    typeof approver.key_fingerprint === "string" &&
    Array.isArray(approver.authorised_for)
  );
}

/**
 * Get Authorised Approver by email.
 */
export function getApproverByEmail(
  config: ConsumerConfiguration,
  email: string,
): ConsumerConfiguration["approval"]["approvers"][number] | undefined {
  return config.approval.approvers.find((a) => a.email === email);
}

/**
 * Check if an approver is authorised for a risk class.
 */
export function isAuthorisedForRiskClass(
  config: ConsumerConfiguration,
  email: string,
  riskClass: string,
): boolean {
  const approver = getApproverByEmail(config, email);

  if (!approver) {
    return false;
  }

  return !!approver.authorised_for?.includes(riskClass as string);
}

/**
 * Get approval requirements for a risk class.
 */
export function getRequirementsForRiskClass(
  config: ConsumerConfiguration,
  riskClass: string,
): { count: number; approvers: string[] } | undefined {
  const requirements = config.approval.requirements as Record<string, unknown>;
  const classRequirements = requirements[riskClass];

  if (typeof classRequirements === "object" && classRequirements !== null) {
    const req = classRequirements as Record<string, unknown>;
    return {
      count: typeof req.count === "number" ? req.count : 0,
      approvers: Array.isArray(req.approvers)
        ? req.approvers.filter((a): a is string => typeof a === "string")
        : [],
    };
  }

  return undefined;
}
