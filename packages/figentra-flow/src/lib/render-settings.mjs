/**
 * Figentra Flow file contract:
 * Purpose: `.claude/settings.json` (STA-1945 FR-7, FR-19): the preset's `surfaces/settings.json` (its permissions,
 *   environment and the like) with Flow's hooks first under `hooks`, each event's preset entries after them. Flow's
 *   hooks run the installed package's entries through `node`, never `pnpm exec` (NFR-2): the guard (`PreToolUse`),
 *   its post-write checks, prompt hints and session context, and the session's record (`Stop`, `--save-only`) and,
 *   only when the config's `session.pushAtEnd` is true, its WIP commit and push (`SessionEnd`; STA-2131). The
 *   profile's `hooks` selects them by id; the guard is mandatory (FR-5), so every profile gets it. Strict JSON
 *   carries no provenance header; the lock's digest identifies the file.
 * Boundary: reads the preset's file; returns text, writes nothing (`sync` writes).
 * Runtime: node
 * Governing contract: STA-1945 (FR-5, FR-6, FR-7, FR-19, AC-6, AC-7, AC-18, P-009, P-010); STA-2131.
 * Secrets: none.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ConfigError } from "./config.mjs";
import { NAME, PACKAGE } from "./product.mjs";
import { selects } from "./profiles.mjs";

/** The rendered file. */
export const SETTINGS_FILE = ".claude/settings.json";

/** A command running one of the installed package's entries. */
const bin = (/** @type {string} */ entry, /** @type {string} */ args) =>
  `node "$CLAUDE_PROJECT_DIR/node_modules/${PACKAGE}/bin/${entry}.mjs" ${args}`;
const guard = (/** @type {string} */ event) => bin(`${NAME}-guard`, event);

/**
 * Flow's hooks by the id a profile selects them by, in the order they are written (the guard's timeouts are core's).
 * @type {Record<string, { event: string, matcher?: string, command: string, timeout: number }>}
 */
export const HOOKS = {
  guard: {
    event: "PreToolUse",
    matcher: "Bash|Write|Edit|MultiEdit|NotebookEdit|Read|Grep|Glob",
    command: guard("PreToolUse"),
    timeout: 5,
  },
  "post-write": {
    event: "PostToolUse",
    matcher: "Write|Edit|MultiEdit",
    command: guard("PostToolUse"),
    timeout: 10,
  },
  "prompt-hints": { event: "UserPromptSubmit", command: guard("UserPromptSubmit"), timeout: 5 },
  "session-context": { event: "SessionStart", command: guard("SessionStart"), timeout: 12 },
  "session-save": { event: "Stop", command: bin(NAME, "session stop --save-only"), timeout: 10 },
  // A commit runs the repository's hooks and a push may merge once: room for both.
  "session-stop": { event: "SessionEnd", command: bin(NAME, "session stop"), timeout: 120 },
};

/** The hooks every profile gets (FR-5). */
const MANDATORY = ["guard"];
/** The hooks that commit or push, rendered only when the config's `session.pushAtEnd` opts in (STA-2131). */
const PUSHING = ["session-stop"];

/**
 * The `hooks` block for the hook ids `profile` selects, the mandatory ones always; the pushing ones only when
 * `config.session.pushAtEnd` is true.
 * @param {import("./profiles.mjs").Profile} [profile] defaults to selecting all
 * @param {import("./config.mjs").Config} [config]
 * @returns {Record<string, { matcher?: string, hooks: { type: "command", command: string, timeout: number }[] }[]>}
 */
export function hookSettings(
  profile = { name: "*", agents: [], skills: [], hooks: ["*"] },
  config = {},
) {
  /** @type {ReturnType<typeof hookSettings>} */
  const out = {};
  for (const [id, { event, matcher, command, timeout }] of Object.entries(HOOKS)) {
    if (PUSHING.includes(id) && config.session?.pushAtEnd !== true) continue;
    if (MANDATORY.includes(id) || selects(profile, "hooks", id))
      (out[event] ??= []).push({
        ...(matcher ? { matcher } : {}),
        hooks: [{ type: "command", command, timeout }],
      });
  }
  return out;
}

/**
 * `.claude/settings.json`, or nothing when the preset has no `surfaces/settings.json`.
 * @param {import("./render.mjs").RenderContext} ctx
 * @returns {Map<string, string>}
 */
export function renderSettings(ctx) {
  const file = join(ctx.presetDir, "surfaces", "settings.json");
  if (!existsSync(file)) return new Map();
  /** @type {Record<string, any>} */
  let preset;
  try {
    preset = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new ConfigError(`${file}: ${/** @type {Error} */ (error).message}`);
  }
  const hooks = hookSettings(ctx.profile, ctx.config);
  for (const [event, entries] of Object.entries(preset.hooks ?? {}))
    hooks[event] = [...(hooks[event] ?? []), ...entries];
  return new Map([[SETTINGS_FILE, `${JSON.stringify({ ...preset, hooks }, null, 2)}\n`]]);
}
