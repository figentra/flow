/**
 * Stackra preset: the reviewer agent types of the bash rules, moved unchanged from core's
 * `.agents/hooks/_reviewer-agents.mjs` (core 220f92c2; STA-1945 T057).
 * Stackra file contract:
 * Purpose: generated from .agents/agents (reviewer: true) by tools/scripts/agents-sync.mjs; edit the sources, not this file.
 * Boundary: data only; the agent types the bash guard lets run `pnpm bot:review`.
 * Runtime: node (agent hook)
 * Governing contract: ADR 0230; ADR 0293.
 */
/** Agent types that may run `pnpm bot:review` (ADR 0230, ADR 0293); `guard-bash` denies every other caller. */
export const REVIEWER_AGENTS = new Set([
  "accessibility-reviewer",
  "architecture-guardian",
  "code-reviewer",
  "design-brand-reviewer",
  "security-tenancy-reviewer",
]);
