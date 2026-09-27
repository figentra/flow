/**
 * @vellum/storage — Policy Domain Types
 *
 * Type definitions for policy configuration.
 */

/** Consumer configuration for approval policy */
export interface ConsumerConfiguration {
  readonly schema_version: string;
  readonly approval: ApprovalConfiguration;
}

/** Approval configuration */
export interface ApprovalConfiguration {
  readonly approvers: readonly ApproverConfig[];
  readonly requirements?: ApprovalRequirements;
}

/** Approval requirements */
export interface ApprovalRequirements {
  readonly standard?: StandardRequirements;
}

/** Standard requirements */
export interface StandardRequirements {
  readonly default?: DefaultApproval;
}

/** Default approval configuration */
export interface DefaultApproval {
  readonly count: number;
}

/** Approver configuration */
export interface ApproverConfig {
  readonly email: string;
  readonly name: string;
  readonly risk_classes?: readonly string[];
  readonly artifacts?: readonly string[];
  readonly authorised_for?: readonly string[];
  readonly requirements?: readonly string[];
}

/** Policy validation error */
export interface PolicyError {
  readonly path: string;
  readonly message: string;
  readonly code: string;
  readonly context?: Record<string, unknown>;
}
