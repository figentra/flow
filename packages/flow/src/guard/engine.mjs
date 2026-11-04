/**
 * Figentra Flow file contract:
 * Purpose: the guard engine's event dispatch: a hook event (PreToolUse for Bash and the file tools, with the plan
 *   gate after the path rules for a write, PostToolUse, UserPromptSubmit, SessionStart) decided against the
 *   repository's preset tables (the engine's side doors and the neutral path rules after them, for every preset), and
 *   `main`, which reads the payload on stdin and writes the hook's JSON answer.
 * Boundary: reads stdin, the repository's configuration and preset tables and git state; writes only the answer.
 *   Unparseable input and the engine's own errors allow (core's fail-open, kept for parity); a rule or the plan gate
 *   that throws asks; tables that fail to load deny every tool call (closed on the mandatory policies). A payload
 *   without `cwd` is decided in the hook's own folder (core resolved no relative path then; this resolves them, so
 *   it denies more, never less).
 * Runtime: node
 * Governing contract: STA-1945 (FR-5, FR-7, AC-9, P-012).
 * Secrets: none.
 */
import { git } from "../lib/git.mjs";
import { ALLOW, decideBash } from "./bash.mjs";
import { answer, readStdin } from "./io.mjs";
import { decidePaths, PATH_TOOLS, WRITE_TOOLS } from "./paths.mjs";
import { decidePlanGate } from "./plan-gate.mjs";
import { postWrite } from "./post-write.mjs";
import { promptHints } from "./prompt-hints.mjs";
import { sessionContext } from "./session-context.mjs";
import { loadTables } from "./tables.mjs";

/** @typedef {"PreToolUse" | "PostToolUse" | "UserPromptSubmit" | "SessionStart"} HookEventName */
/**
 * A hook event; `payload` is the whole hook payload, which Bash rules read (the agent type, the session).
 * @typedef {{ event: HookEventName, tool?: string, input: Record<string, any>, cwd: string, root: string,
 *   prompt?: string, source?: string, payload?: Record<string, any> }} HookEvent
 */
/** @typedef {import("./bash.mjs").Decision} Decision */

/** A context decision, or allow when there is nothing to say. */
const say = (/** @type {string | undefined} */ text) =>
  /** @type {Decision} */ (text ? { decision: "allow", context: text } : ALLOW);

/**
 * The decision for one hook event. Async because the plan gate loads its checks only for a gated path.
 * @param {HookEvent} event
 * @param {import("./tables.mjs").GuardTables} tables
 * @returns {Promise<Decision>}
 */
export async function decide(event, tables) {
  switch (event.event) {
    case "PreToolUse": {
      if (event.tool === "Bash") {
        const command = String(event.input.command ?? "");
        const d = decideBash(command, event.cwd, tables.bash, { payload: event.payload ?? {} });
        if (d.decision === "allow") return d;
        const label = d.decision === "deny" ? "Blocked command" : "Command";
        return { ...d, reason: `${d.reason}\n${label}: ${command.slice(0, 200)}` };
      }
      if (!event.tool || !PATH_TOOLS.has(event.tool)) return ALLOW;
      const d = decidePaths(event.tool, event.input, event.cwd, tables.paths);
      const target = String(event.input.file_path ?? event.input.notebook_path ?? "");
      if (d.decision !== "allow" || !tables.planGated || !WRITE_TOOLS.has(event.tool) || !target)
        return d;
      /** @type {Decision} */
      let g;
      try {
        g = await decidePlanGate(target, tables.planGated, { cwd: event.cwd });
      } catch (error) {
        // As for a rule that throws: a broken gate neither lets a write through silently nor blocks every agent.
        return {
          decision: "ask",
          reason: `The plan gate failed on ${target} (${/** @type {Error} */ (error)?.message}); confirm it by hand.`,
        };
      }
      return g.decision === "allow" ? g : { ...g, reason: `${g.reason}\nBlocked path: ${target}` };
    }
    case "PostToolUse":
      return say(postWrite(event.root, String(event.input.file_path ?? "")));
    case "UserPromptSubmit":
      return say(promptHints(event.prompt ?? "", tables.prompt));
    case "SessionStart":
      return say(sessionContext(event.root, event.source, tables.session));
    default:
      return ALLOW;
  }
}

/**
 * The hook: reads the payload on stdin, decides `name` and writes the answer. Always exits 0.
 * @param {string} name the hook event name
 * @returns {Promise<number>}
 */
export async function main(name) {
  const payload = await readStdin();
  const cwd = typeof payload.cwd === "string" && payload.cwd ? payload.cwd : process.cwd();
  const top = process.env.CLAUDE_PROJECT_DIR
    ? undefined
    : git(cwd, ["rev-parse", "--show-toplevel"]);
  const root = process.env.CLAUDE_PROJECT_DIR || (top?.ok ? top.out : cwd);
  const input =
    payload.tool_input && typeof payload.tool_input === "object" ? payload.tool_input : {};
  /** @type {HookEvent} */
  const event = {
    event: /** @type {HookEventName} */ (name),
    tool: typeof payload.tool_name === "string" ? payload.tool_name : undefined,
    input,
    cwd,
    root,
    prompt: String(payload.prompt ?? payload.user_input ?? ""),
    source: typeof payload.source === "string" ? payload.source : undefined,
    payload,
  };
  let tables;
  try {
    tables = await loadTables(root);
  } catch (error) {
    if (name === "PreToolUse")
      process.stdout.write(
        answer(name, {
          decision: "deny",
          reason: `The guard tables failed to load (${/** @type {Error} */ (error)?.message}), so every tool call is denied. Fix the preset's guard/ modules.`,
        }),
      );
    return 0;
  }
  try {
    process.stdout.write(answer(name, await decide(event, tables)));
  } catch {
    // Intentionally silent: a bug in the engine never blocks work (core's fail-open).
  }
  return 0;
}
