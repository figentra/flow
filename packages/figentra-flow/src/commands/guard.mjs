/**
 * Figentra Flow file contract:
 * Purpose: `fflow guard [--print-settings]` — the PreToolUse hook through the dispatcher: it runs the guard engine
 *   (`src/guard/engine.mjs`) on the event on stdin: the preset's rules, then the engine's own (the side doors,
 *   FR-13, and the neutral path rules), which every preset keeps (FR-5). `--print-settings` prints the `.claude/settings.json` hooks that wire every guard event to
 *   `bin/fflow-guard.mjs` directly (NFR-2).
 * Boundary: reads stdin, writes the hook's JSON answer on a denial, an ask or context, and nothing otherwise. Wiring
 *   it into a repository is guard configuration, which the owner applies.
 * Runtime: node
 * Governing contract: Stackra ADR 0503 (decision 6); STA-1729; STA-1945 (FR-7, FR-13, AC-9, AC-38, P-012, P-018).
 * Secrets: none.
 */
import { main } from "../guard/engine.mjs";
import { NAME, PACKAGE } from "../lib/product.mjs";

/** One hook command: the guard entry for `event`, with a time limit in seconds. */
const hook = (/** @type {string} */ event, /** @type {number} */ timeout) => [
  {
    type: "command",
    command: `node "$CLAUDE_PROJECT_DIR/node_modules/${PACKAGE}/bin/${NAME}-guard.mjs" ${event}`,
    timeout,
  },
];

/** The `.claude/settings.json` hooks that wire every guard event (the timeouts are core's). */
export const SETTINGS = {
  hooks: {
    UserPromptSubmit: [{ hooks: hook("UserPromptSubmit", 5) }],
    SessionStart: [{ hooks: hook("SessionStart", 12) }],
    PreToolUse: [
      {
        matcher: "Bash|Write|Edit|MultiEdit|NotebookEdit|Read|Grep|Glob",
        hooks: hook("PreToolUse", 5),
      },
    ],
    PostToolUse: [{ matcher: "Write|Edit|MultiEdit", hooks: hook("PostToolUse", 10) }],
  },
};

/** `fflow guard [--print-settings]`. */
export async function run(/** @type {string[]} */ args) {
  if (args.includes("--print-settings")) {
    console.log(JSON.stringify(SETTINGS, null, 2));
    return 0;
  }
  return main("PreToolUse");
}
