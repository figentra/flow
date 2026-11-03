/**
 * Figentra Flow file contract:
 * Purpose: the guard engine's path decision for the file tools, ported from core's `guard-paths.mjs`: every path a
 *   Read, Grep, Glob, Write, Edit, MultiEdit or NotebookEdit call names (a Grep's or Glob's pattern under its folder;
 *   a Grep's folder searched recursively) against a preset's path table, then the neutral preset's (generic secret
 *   files, `flow.config.json` written only by the owner), which every preset keeps whatever its table holds (FR-5);
 *   a rule marked `writes` applies to the write tools only.
 * Boundary: decides only; reads nothing.
 * Runtime: node
 * Governing contract: STA-1945 (FR-5, FR-7, P-012).
 * Secrets: none.
 */
import { PATH_RULES as MANDATORY } from "../../assets/flow/presets/neutral/guard/path-rules.mjs";
import { ALLOW } from "./bash.mjs";

/**
 * A path rule of a preset's table. `match` returns true for a hit, or a string that replaces `reason`; it is handed
 * whether the path is searched recursively (a Grep's folder) and the tool's whole input.
 * @typedef {{ id: string, reason: string, writes?: boolean,
 *   match: (path: string, cwd: string, how: { recursive: boolean, input: Record<string, any> }) => boolean | string | undefined }} PathRule
 */

/** The tools that write a file. */
export const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
/** The tools whose paths the guard reads. */
export const PATH_TOOLS = new Set([...WRITE_TOOLS, "Read", "Grep", "Glob"]);

/** `v` when it is a non-empty string. */
const str = (/** @type {unknown} */ v) => (typeof v === "string" && v ? v : undefined);
/** A glob relative to `dir`, unless it is absolute or under home. */
const under = (/** @type {string} */ dir, /** @type {string} */ glob) =>
  glob.startsWith("/") || glob.startsWith("~") ? glob : `${dir}/${glob}`;

/**
 * The decision for one file tool call: the first rule (of `rules`, then the neutral preset's, each once) a named path
 * hits denies it. A rule that throws makes the call an ask.
 * @param {string} tool
 * @param {Record<string, any>} input the tool's input
 * @param {string} cwd
 * @param {PathRule[]} rules the preset's table
 * @returns {import("./bash.mjs").Decision}
 */
export function decidePaths(tool, input, cwd, rules) {
  const all = [...new Set([...rules, ...MANDATORY])];
  const base = str(input.path) ?? cwd;
  // Grep searches its path recursively; its `glob` filter and Glob's `pattern` are relative to it.
  /** @type {[unknown, boolean][]} */
  const named = [
    [input.file_path, false],
    [input.notebook_path, false],
    [tool === "Grep" ? input.path : undefined, true],
    [tool === "Grep" && str(input.glob) ? under(base, input.glob) : undefined, false],
    [tool === "Glob" ? input.path : undefined, false],
    [tool === "Glob" && str(input.pattern) ? under(base, input.pattern) : undefined, false],
  ];
  const write = WRITE_TOOLS.has(tool);
  /** @type {string | undefined} */
  let asked;
  for (const [path, recursive] of named) {
    if (!str(path)) continue;
    const p = /** @type {string} */ (path);
    for (const rule of all) {
      if (rule.writes && !write) continue;
      try {
        const hit = rule.match(p, cwd, { recursive, input });
        if (hit)
          return {
            decision: "deny",
            reason: `${typeof hit === "string" ? hit : rule.reason}\nBlocked path: ${p}`,
          };
      } catch (error) {
        asked ??= `The guard rule ${rule.id} failed on ${p} (${/** @type {Error} */ (error)?.message}); confirm it by hand.`;
      }
    }
  }
  return asked === undefined ? ALLOW : { decision: "ask", reason: asked };
}
