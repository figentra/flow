/**
 * Figentra Flow file contract:
 * Purpose: the guard plugin for OpenCode (STA-1945 FR-7): every shell, edit, read, glob and grep call is put to the
 *   repository's guard bundle (`.agents/hooks/fflow-guard.mjs PreToolUse`, which `fflow sync` writes and which runs
 *   with no install, A-8) as the Claude Code hook puts it, so both assistants answer to one engine and one set of
 *   preset tables. An ask is a deny here: OpenCode runs unattended (`--auto` approves any ask). A shell command is
 *   decided again with its real working folder just before it runs. The call runs with `STACKRA_EXECUTOR=1`, so the
 *   stackra tables hold it to core's executor layer (lead-only commands, edits only inside the session's worktree,
 *   none in the main checkout). The plugin fails closed (STA-2131): it asks the bundle with
 *   `FFLOW_GUARD_UNATTENDED=1`, so every answer is explicit, and denies, naming why, when the bundle is missing
 *   (`sync` writes it beside this plugin, and it needs no install, so a missing one is a broken checkout, not the
 *   install-free contract), times out, is killed, exits non-zero, prints nothing or prints what is not its answer.
 *   A grep or glob carries its searched folder (OpenCode's `path`, and grep's `include` as the Grep `glob`) from
 *   the evaluation's metadata, so the path rules (secret files, the secrets inbox) apply to it as on Claude Code.
 * Boundary: runs `node` with the event on stdin; reads its answer; changes only the call's effect or command.
 * Runtime: OpenCode v2 plugin (default export `{ id, setup }`, https://opencode.ai/v2/docs/build/plugins).
 * Governing contract: STA-1945 (FR-5, FR-7, P-010, P-012).
 * Secrets: none.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** How long one decision may take. */
export const TIMEOUT_MS = 5000;

/** OpenCode's action to the guard's tool and the input key its resource goes in. */
const TOOLS = {
  shell: ["Bash", "command"],
  edit: ["Write", "file_path"],
  read: ["Read", "file_path"],
  glob: ["Glob", "pattern"],
  grep: ["Grep", "pattern"],
};

/** `v` when it is a non-empty string. */
const str = (/** @type {unknown} */ v) => (typeof v === "string" && v ? v : undefined);

/**
 * The searched folder and file filter of a grep or glob, from OpenCode's tool arguments (`path`, `include`), as the
 * guard's Grep and Glob inputs name them (`path`, `glob`).
 * @param {string} action
 * @param {Record<string, unknown> | undefined} args
 * @returns {Record<string, string>}
 */
export function searched(action, args) {
  const path = str(args?.path);
  const glob = action === "grep" ? str(args?.include) : undefined;
  return { ...(path ? { path } : {}), ...(glob ? { glob } : {}) };
}

/**
 * Why the guard refuses `action` on `resource` in `cwd`, or undefined when it allows it. Closed: a bundle that is
 * missing or does not answer refuses.
 * @param {string} root the project folder
 * @param {string} cwd
 * @param {string} action
 * @param {string} resource
 * @param {Record<string, string>} [extra] more of the tool's input (a grep's or glob's `path`, see `searched`)
 * @param {number} [timeout]
 * @returns {string | undefined}
 */
export function refusal(root, cwd, action, resource, extra = {}, timeout = TIMEOUT_MS) {
  const tool = TOOLS[/** @type {keyof typeof TOOLS} */ (action)];
  if (!tool) return undefined;
  const bundle = join(root, ".agents/hooks/fflow-guard.mjs");
  const closed = (/** @type {string} */ why) =>
    `fflow-guard: ${why}, so the call is denied (OpenCode runs unattended)`;
  if (!existsSync(bundle)) return closed(`${bundle} is missing; \`fflow sync\` writes it`);
  const r = spawnSync("node", [bundle, "PreToolUse"], {
    cwd,
    input: JSON.stringify({
      tool_name: tool[0],
      tool_input: { ...extra, [tool[1]]: resource },
      cwd,
    }),
    encoding: "utf8",
    // An OpenCode session is an unattended executor: core's executor rules and layer apply (STA-2136), and the
    // bundle answers every call explicitly (STA-2131).
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: root,
      STACKRA_EXECUTOR: "1",
      FFLOW_GUARD_UNATTENDED: "1",
    },
    timeout,
  });
  // A timeout is an error with the signal that killed the child.
  if (/** @type {NodeJS.ErrnoException | undefined} */ (r.error)?.code === "ETIMEDOUT")
    return closed(`the guard timed out after ${timeout} ms`);
  if (r.error) return closed(`the guard could not run (${r.error.message})`);
  if (r.signal) return closed(`the guard was killed (${r.signal})`);
  if (r.status !== 0) return closed(`the guard exited ${r.status}`);
  if (!r.stdout.trim()) return closed("the guard printed nothing");
  /** @type {Record<string, any>} */
  let out;
  try {
    out = JSON.parse(r.stdout).hookSpecificOutput ?? {};
  } catch {
    return closed("the guard's answer is not JSON");
  }
  if (["deny", "ask"].includes(out.permissionDecision))
    return out.permissionDecisionReason || "refused by the guard";
  return out.permissionDecision === "allow" ? undefined : closed("the guard gave no decision");
}

export default {
  id: "fflow.guard",
  /** @param {any} ctx */
  async setup(ctx) {
    const root = ctx.location.directory;
    // Before a prompt or an auto-approve can let a call through.
    await ctx.permission.hook("evaluate", (/** @type {any} */ e) => {
      const extra = searched(e.action, e.metadata);
      for (const resource of e.resources) {
        const reason = refusal(root, root, e.action, resource, extra);
        if (reason) {
          e.effect = "deny";
          e.message = reason;
          return;
        }
      }
    });
    // Again with the command's real working folder.
    await ctx.shell.hook("create.before", (/** @type {any} */ e) => {
      const reason = refusal(root, e.cwd, "shell", e.command);
      // Single quotes: the reason quotes the refused command, which must not run inside it.
      if (reason) e.command = `printf '%s\\n' '${reason.replaceAll("'", "'\\''")}' >&2; exit 126`;
    });
  },
};
