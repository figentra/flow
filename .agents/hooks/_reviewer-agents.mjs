/**
 * Figentra Flow file contract:
 * Purpose: generated from .agents/agents (reviewer: true) by fflow sync; edit the sources, not this file.
 * Boundary: data only; the agent types the guard lets run a review.
 * Runtime: node (agent hook)
 * Governing contract: STA-2098 (H6).
 */
/** Agent types that may run a review; the guard denies every other caller. */
export const REVIEWER_AGENTS = new Set([
  "accessibility-reviewer",
  "architecture-guardian",
  "code-reviewer",
  "design-brand-reviewer",
  "security-tenancy-reviewer",
]);
