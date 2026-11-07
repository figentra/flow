/**
 * Figentra Flow file contract:
 * Purpose: `fflow guard [--print-settings]` — the PreToolUse hook through the dispatcher: it runs the guard engine
 *   (`src/guard/engine.mjs`) on the event on stdin: the preset's rules, then the engine's own (the side doors,
 *   FR-13, and the neutral path rules), which every preset keeps (FR-5). `--print-settings` prints
 *   the `.claude/settings.json` hooks `sync` renders (`render-settings.mjs`): every guard event wired to
 *   the repository's guard bundle, `.agents/hooks/fflow-guard.mjs`, which runs with no install (NFR-2, A-8), and the session's Stop and SessionEnd hooks (FR-19).
 * Boundary: reads stdin, writes the hook's JSON answer on a denial, an ask or context, and nothing otherwise. `sync`
 *   wires it into a repository whose preset has `surfaces/settings.json`.
 * Runtime: node
 * Governing contract: Stackra ADR 0503 (decision 6); STA-1729; STA-1945 (FR-7, FR-13, FR-19, AC-9, AC-38, P-012,
 *   P-018).
 * Secrets: none.
 */
import { main } from "../guard/engine.mjs";
import { hookSettings } from "../lib/render-settings.mjs";

/** The `.claude/settings.json` hooks `sync` renders for a profile selecting all (the guard's events among them). */
export const SETTINGS = { hooks: hookSettings() };

/** `fflow guard [--print-settings]`. */
export async function run(/** @type {string[]} */ args) {
  if (args.includes("--print-settings")) {
    console.log(JSON.stringify(SETTINGS, null, 2));
    return 0;
  }
  return main("PreToolUse");
}
