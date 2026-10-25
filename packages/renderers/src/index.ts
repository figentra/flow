/**
 * @vellum/renderers — Deterministic output projections
 *
 * The assistant dialects: pure, deterministic functions that render the
 * method's neutral agents, skills and commands for Claude Code, OpenCode and
 * Kiro, and check what they render. No I/O.
 */

// ============================================================================
// Assistant Renderer
// ============================================================================

export {
  ASSISTANT_TYPES,
  AssistantSourceError,
  KIRO_TOOLS,
  KIRO_CAPABILITIES,
  OPENCODE_ACTIONS,
  parseFrontmatter,
  parseNeutralAgent,
  modelFor,
  deriveOpenCodePermissions,
  yamlScalar,
  provenanceLine,
  renderAgent,
  renderOpenCodeCommand,
  checkAgentFrontmatter,
  checkSkillFrontmatter,
  checkOpenCodeCommand,
} from "./assistant.js";

export type {
  AssistantType,
  AgentMode,
  AgentSourceContext,
  FrontmatterValue,
  ModelMap,
  NeutralAgent,
  NeutralPermission,
  ParsedDocument,
  PermissionEffect,
  RenderAgentOptions,
} from "./assistant.js";

// ============================================================================
// Version
// ============================================================================

export const VERSION = "0.0.0" as const;
