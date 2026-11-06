/**
 * Figentra Flow file contract:
 * Purpose: the guard plugin for OpenCode (STA-1945 FR-7): every shell, edit, read, glob and grep call is put to the
 *   repository's guard bundle (`.agents/hooks/fflow-guard.mjs PreToolUse`, which `fflow sync` writes and which runs
 *   with no install, A-8) as the Claude Code hook puts it, so both assistants answer to one engine and one set of
 *   preset tables. An ask is a deny here: OpenCode runs unattended (`--auto` approves any ask). A shell command is
 *   decided again with its real working folder just before it runs. When the bundle cannot run (missing until
 *   `sync`), the call is allowed, as Claude Code allows on a hook that fails; the tables failing to load deny, as the
 *   engine itself does.
 * Boundary: runs `node` with the event on stdin; reads its answer; changes only the call's effect or command.
 * Runtime: OpenCode v2 plugin (default export `{ id, setup }`, https://opencode.ai/v2/docs/build/plugins).
 * Governing contract: STA-1945 (FR-5, FR-7, P-010, P-012).
 * Secrets: none.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";

/** OpenCode's action to the guard's tool and the input key its resource goes in. */
const TOOLS = {
  shell: ["Bash", "command"],
  edit: ["Write", "file_path"],
  read: ["Read", "file_path"],
  glob: ["Glob", "pattern"],
  grep: ["Grep", "pattern"],
};

/**
 * Why the guard refuses `action` on `resource` in `cwd`, or undefined when it allows it.
 * @param {string} root the project folder
 * @param {string} cwd
 * @param {string} action
 * @param {string} resource
 * @returns {string | undefined}
 */
export function refusal(root, cwd, action, resource) {
  const tool = TOOLS[/** @type {keyof typeof TOOLS} */ (action)];
  if (!tool) return undefined;
  const r = spawnSync(
    "node",
    [join(root, ".agents/hooks/fflow-guard.mjs"), "PreToolUse"],
    {
      cwd,
      input: JSON.stringify({ tool_name: tool[0], tool_input: { [tool[1]]: resource }, cwd }),
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
      timeout: 5000,
    },
  );
  if (r.status !== 0 || !r.stdout.trim()) return undefined;
  try {
    const out = JSON.parse(r.stdout).hookSpecificOutput ?? {};
    return ["deny", "ask"].includes(out.permissionDecision)
      ? out.permissionDecisionReason || "refused by the guard"
      : undefined;
  } catch {
    return undefined;
  }
}

export default {
  id: "fflow.guard",
  /** @param {any} ctx */
  async setup(ctx) {
    const root = ctx.location.directory;
    // Before a prompt or an auto-approve can let a call through.
    await ctx.permission.hook("evaluate", (/** @type {any} */ e) => {
      for (const resource of e.resources) {
        const reason = refusal(root, root, e.action, resource);
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
