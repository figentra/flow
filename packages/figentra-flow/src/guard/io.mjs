/**
 * Figentra Flow file contract:
 * Purpose: the hook protocol of the guard engine, ported from core's `_io.mjs`: the payload the harness writes on
 *   stdin, and the JSON answer for a decision (deny, ask, or context for the agent).
 * Boundary: reads stdin; formats the answer, which the caller writes.
 * Runtime: node
 * Governing contract: STA-1945 (FR-7, P-012).
 * Secrets: none.
 */

/**
 * The hook payload on stdin, JSON-parsed; `{}` when it is empty or not a JSON object. Never throws.
 * @param {AsyncIterable<string | Buffer>} [stream]
 * @returns {Promise<Record<string, any>>}
 */
export async function readStdin(stream = process.stdin) {
  let raw = "";
  for await (const chunk of stream) raw += chunk;
  try {
    const value = JSON.parse(raw || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

/**
 * The hook's answer for `decision`: a permission decision for a deny or an ask, additional context for the agent, or
 * "" (allow, nothing to add).
 * @param {string} event the hook event name
 * @param {{ decision: "allow" | "deny" | "ask", reason?: string, context?: string }} d
 * @returns {string}
 */
export function answer(event, d) {
  if (d.decision === "deny" || d.decision === "ask")
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: event,
        permissionDecision: d.decision,
        permissionDecisionReason: d.reason ?? "",
      },
    });
  if (d.context)
    return JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: d.context } });
  return "";
}
