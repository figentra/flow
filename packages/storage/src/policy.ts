/**
 * Policy Loader - reads and validates Consumer Configuration.
 *
 * @see requirements.md Requirement 7.4
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ApprovalPolicy,
  ApproverIdentity,
  ArtifactKind,
  RiskClass,
  SigningKey,
} from "@vellum/protocol";
import type { ApproverConfig, ConsumerConfiguration, PolicyError } from "./domain/policy/types";
import { sshPublicKeyFingerprint } from "./signature.js";

/**
 * Schema version supported by this Platform version.
 */
const SUPPORTED_SCHEMA_VERSION = "1.0";

/**
 * Default policy file location.
 */
export const DEFAULT_POLICY_PATH = ".sdlc/policy.json";

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

  return parsePolicy(content, policyPath);
}

/**
 * Parse and validate Consumer Configuration text; `policyPath` names where
 * it came from in errors.
 *
 * @throws {PolicyError} on invalid or unsupported policy
 */
export function parsePolicy(
  content: string,
  policyPath: string = DEFAULT_POLICY_PATH,
): ConsumerConfiguration {
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
 * Type guard for Authorised Approver: an email, the risk classes it is
 * authorised for, and at least one key — either `keys` or the single-key
 * `key_type` / `key_fingerprint` / `public_key` form.
 */
function isAuthorisedApprover(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const approver = value as Record<string, unknown>;
  if (typeof approver.email !== "string" || !Array.isArray(approver.authorised_for)) {
    return false;
  }
  if (Array.isArray(approver.keys)) {
    return approver.keys.every(
      (key) =>
        typeof key === "object" &&
        key !== null &&
        ((key as Record<string, unknown>).type === "gpg" ||
          (key as Record<string, unknown>).type === "ssh") &&
        typeof (key as Record<string, unknown>).fingerprint === "string",
    );
  }
  return (
    (approver.key_type === "gpg" || approver.key_type === "ssh") &&
    typeof approver.key_fingerprint === "string"
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

const RISK_CLASSES: readonly RiskClass[] = ["low", "standard", "high", "critical"];
const ARTIFACT_KINDS: readonly ArtifactKind[] = ["requirements", "design", "tasks"];

/** The keys an approver entry lists, in either the `keys` or the single-key form. */
function approverKeyConfigs(approver: ApproverConfig): readonly {
  readonly type: "gpg" | "ssh";
  readonly fingerprint: string;
  readonly public_key?: string | undefined;
}[] {
  if (approver.keys) return approver.keys;
  if (approver.key_type && approver.key_fingerprint) {
    return [
      { type: approver.key_type, fingerprint: approver.key_fingerprint, public_key: approver.public_key },
    ];
  }
  return [];
}

/**
 * Convert a Consumer Configuration into the protocol's ApprovalPolicy.
 *
 * Every key must carry its public key, and an SSH key's fingerprint must be
 * the fingerprint of that public key: a policy whose keys cannot verify a
 * signature, or whose fingerprints disagree with its keys, is refused
 * (POLICY_INVALID) rather than silently accepting nothing or the wrong key.
 */
export function toApprovalPolicy(config: ConsumerConfiguration, policyPath = DEFAULT_POLICY_PATH): ApprovalPolicy {
  const invalid = (message: string): PolicyError => ({ code: "POLICY_INVALID", message, path: policyPath });

  const identities: ApproverIdentity[] = config.approval.approvers.map((approver) => {
    const keys: SigningKey[] = approverKeyConfigs(approver).map((key) => {
      if (typeof key.public_key !== "string" || key.public_key.trim() === "") {
        throw invalid(`Approver ${approver.email}: key ${key.fingerprint} has no public_key`);
      }
      if (key.type === "ssh") {
        const actual = sshPublicKeyFingerprint(key.public_key);
        if (actual !== key.fingerprint) {
          throw invalid(
            `Approver ${approver.email}: SSH key fingerprint ${key.fingerprint} does not match its public_key (${actual ?? "unparseable"})`,
          );
        }
      }
      return { type: key.type, fingerprint: key.fingerprint, publicKey: key.public_key };
    });
    return { identity: approver.email, keys };
  });

  const approvers = new Map<RiskClass, Map<ArtifactKind, readonly string[]>>();
  const requiredCount = new Map<RiskClass, Map<ArtifactKind, number>>();
  for (const riskClass of RISK_CLASSES) {
    const requirement = config.approval.requirements?.[riskClass];
    if (!requirement) continue;
    const named = requirement.approvers ?? [];
    const allowed =
      named.length > 0
        ? named
        : config.approval.approvers
            .filter((a) => a.authorised_for?.includes(riskClass))
            .map((a) => a.email);
    approvers.set(riskClass, new Map(ARTIFACT_KINDS.map((kind) => [kind, allowed] as const)));
    requiredCount.set(
      riskClass,
      new Map(ARTIFACT_KINDS.map((kind) => [kind, requirement.count] as const)),
    );
  }

  return { approvers, requiredCount, identities };
}

/** The risk class the policy assigns a spec directory; `standard` when unlisted. */
export function riskClassForSpec(config: ConsumerConfiguration, specSlug: string): RiskClass {
  const listed = config.approval.spec_risk_classes?.[specSlug];
  return RISK_CLASSES.find((rc) => rc === listed) ?? "standard";
}
