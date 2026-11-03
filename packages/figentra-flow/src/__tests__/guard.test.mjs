/**
 * Figentra Flow file contract:
 * Purpose: hold `fflow guard` to its contract: a `git worktree add` whose path is outside the repository's
 *   `.claude/worktrees/` is denied, through `cd … &&`, `git -C`, relative paths and quotes; one inside, other git
 *   commands and commands outside a repository pass; the settings entry runs the guard before Bash. The lifecycle's
 *   other side doors (a push to the default branch, `gh pr merge`, `LEFTHOOK=0` set as a variable, `--no-verify`,
 *   `commit -n` and a `core.hooksPath` override) are denied, directly, by the program's path, behind
 *   `env`/`command`/`exec` or through a wrapper, each naming the Flow command to use instead; `LEFTHOOK=0` as an
 *   argument, `-n` as a message, `push -n` and a heredoc body pass. The side doors are engine rules: `fflow guard`
 *   and the hook entry run the engine on the repository's preset tables (the neutral preset's when the preset has
 *   none), and a preset whose tables are empty still has the side doors, the secret files and its own configuration
 *   denied (FR-5); a rule or the plan gate that throws asks, tables that fail to load (or a table that is not a list)
 *   deny every tool call, and a payload without `cwd` is decided in the hook's folder.
 * Boundary: temporary repositories; the hook entry runs as a child process; no network.
 * Runtime: node
 * Governing contract: ADR 0022; Stackra ADR 0503; STA-1729; STA-1945.
 */
// @covers sta-1729:FR-2 sta-1729:AC-003 sta-1729:P-002 sta-1945:FR-13 sta-1945:AC-38 sta-1945:P-018
// @covers sta-1945:FR-7 sta-1945:FR-5 sta-1945:AC-9 sta-1945:P-012
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { SETTINGS } from "../commands/guard.mjs";
import { decideBash, SIDE_DOORS } from "../guard/bash.mjs";
import { decide as decideEvent } from "../guard/engine.mjs";
import { loadTables } from "../guard/tables.mjs";
import { words } from "../guard/words.mjs";
import { CONFIG_FILE } from "../lib/product.mjs";
import { presetRoot, runHook } from "./__fixtures__/guard.mjs";
import { repo, sh } from "./__fixtures__/repo.mjs";

/** The side doors' denial reason for `command`, or undefined when they let it run. */
const decide = (/** @type {string} */ command, /** @type {string} */ cwd) => {
  const d = decideBash(command, cwd, SIDE_DOORS);
  return d.decision === "allow" ? undefined : d.reason;
};

const ENTRY = fileURLToPath(new URL("../../bin/fflow-guard.mjs", import.meta.url));

/**
 * Runs the hook entry for `event` on `payload` in `root`; the parsed answer, or undefined when it printed nothing.
 * @param {string} root
 * @param {string} event
 * @param {Record<string, unknown> | string} payload
 */
const hook = (root, event, payload) => {
  const r = spawnSync(process.execPath, [ENTRY, event], {
    input: typeof payload === "string" ? payload : JSON.stringify({ cwd: root, ...payload }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput : undefined;
};

test("guard: a push to the default branch is denied, naming fflow land (P-018)", (t) => {
  const r = repo();
  t.after(r.dispose);
  for (const command of [
    "git push origin main",
    "git push origin HEAD:main",
    "git push --force origin +topic:refs/heads/main",
    "git push",
    "git push --all origin",
    `cd ${r.root} && pnpm bot:git -- -C ${r.root} push origin main`,
    "GIT_TRACE=1 git push origin main",
    "/usr/bin/git push origin main",
    "env GIT_TRACE=1 git push origin main",
    "env -u HOME /usr/local/bin/git push origin main",
    "command git push origin main",
    "exec env git push origin main",
  ])
    assert.match(decide(command, r.root) ?? "", /Pushing to main .*fflow land/, command);
  sh(r.root, "switch", "-q", "-c", "figentra/sta-1-a");
  for (const command of [
    "git push -u origin HEAD",
    "git push",
    "git push origin figentra/sta-1-a",
    "pnpm bot:git -- push origin HEAD:refs/heads/figentra/sta-1-a",
    "echo git push origin main",
  ])
    assert.equal(decide(command, r.root), undefined, command);
});

test("guard: gh pr merge and LEFTHOOK=0 are denied, naming the Flow command (P-018)", (t) => {
  const r = repo();
  t.after(r.dispose);
  for (const command of [
    "gh pr merge 12 --squash",
    "pnpm bot:gh -- pr merge 12 --auto",
    "env /opt/homebrew/bin/gh pr merge 12",
  ])
    assert.match(decide(command, r.root) ?? "", /fflow land <pr>/, command);
  for (const command of [
    "LEFTHOOK=0 git commit -m x",
    "export LEFTHOOK=0 && git commit -m x",
    "env LEFTHOOK=false git commit -m x",
    "env -i PATH=/bin LEFTHOOK=off command git commit -m x",
  ])
    assert.match(decide(command, r.root) ?? "", /fflow hooks run/, command);
  for (const command of [
    "gh pr view 12",
    `git commit -m "LEFTHOOK=0 is refused"`,
    "git commit -m LEFTHOOK=0",
    "echo LEFTHOOK=0",
    "LEFTHOOK=1 git commit -m x",
    "grep -r LEFTHOOK=0 .",
  ])
    assert.equal(decide(command, r.root), undefined, command);
  assert.match(decide("X=1 git worktree add ../y", r.root) ?? "", /fflow start/);
});

test("guard: --no-verify, commit -n and a core.hooksPath override are denied: the hooks always run (FR-18)", (t) => {
  const r = repo();
  t.after(r.dispose);
  for (const command of [
    "git commit --no-verify -m x",
    "git commit --no-veri -m x",
    "git commit -n -m x",
    "git commit -anm x",
    "git commit -m x -n",
    "git push --no-verify origin figentra/sta-1-a",
    "git merge --no-verify topic",
    "/usr/bin/git -C . commit --no-verify -m x",
    "git -c core.hooksPath=/dev/null commit -m x",
    "git -c CORE.HOOKSPATH= push origin x",
    "git --config-env=core.hooksPath=HOOKS commit -m x",
    "git -c user.name=x -c core.hooksPath=/tmp status",
    "git config core.hooksPath /dev/null",
    "git config set --local core.hooksPath x",
  ])
    assert.match(decide(command, r.root) ?? "", /skips the hooks.*fflow hooks run/, command);
  for (const command of [
    "git commit -m n",
    "git commit -m -n",
    `git commit -m "fix -n parsing"`,
    "git commit -am x",
    "git commit -- -n",
    "git push -n origin figentra/sta-1-a",
    "git -c user.name=x commit -m x",
    "git config core.hooksPath",
    "git config --get core.hooksPath",
    "git config --unset core.hooksPath",
  ])
    assert.equal(decide(command, r.root), undefined, command);
});

// @covers sta-1945:FR-31
test("guard: dispatches before the console engine loads, so the hook path never imports @stackra/*", () => {
  const bin = new URL("../../bin/fflow.mjs", import.meta.url).pathname;
  const hooks = `import { registerHooks } from "node:module";
registerHooks({ resolve(s, c, next) { if (s.startsWith("@stackra/")) throw new Error("engine loaded: " + s); return next(s, c); } });`;
  const refuse = ["--import", `data:text/javascript,${encodeURIComponent(hooks)}`, bin];
  const guard = spawnSync(process.execPath, [...refuse, "guard", "--print-settings"], {
    encoding: "utf8",
  });
  assert.equal(guard.status, 0, guard.stderr);
  assert.deepEqual(JSON.parse(guard.stdout), SETTINGS);
  // The same hook does stop the engine, so the pass above is real.
  const doctor = spawnSync(process.execPath, [...refuse, "doctor", "--help"], { encoding: "utf8" });
  assert.match(doctor.stderr, /engine loaded: @stackra\/console/);
});

test("words: splits simple commands and honours quotes", () => {
  assert.deepEqual(words(`cd "a b" && git worktree add 'x y'; ls | wc`), [
    ["cd", "a b"],
    ["git", "worktree", "add", "x y"],
    ["ls"],
    ["wc"],
  ]);
});

test("words: a heredoc body is text, unless a shell reads it", (t) => {
  assert.deepEqual(words("cat > n.md <<'EOF'\ngit push origin main\nEOF\ngit status"), [
    ["cat", ">", "n.md", "<<EOF"],
    ["git", "status"],
  ]);
  const r = repo();
  t.after(r.dispose);
  for (const command of [
    "cat <<-EOF\n\tgit push origin main is prose\n\tEOF",
    'cat > notes.md <<"E_1"\ngit commit --no-verify -m x\nE_1',
    "cat <<A <<B\na\nA\ngh pr merge 1\nB",
  ])
    assert.equal(decide(command, r.root), undefined, command);
  for (const command of [
    "bash <<'EOF'\ngit push origin main\nEOF",
    "cat <<'EOF' | sh\ngh pr merge 1\nEOF",
    "cat <<EOF |\ngit commit -n -m x\nEOF\nsh",
    "cat <<EOF\ngit push origin main",
  ])
    assert.ok(decide(command, r.root), command);
});

test("guard: allows a worktree inside .claude/worktrees and denies one outside, however it is written", (t) => {
  const r = repo();
  t.after(r.dispose);
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "flow-guard-")));
  assert.equal(
    decide("git worktree add -b figentra/sta-1-a .claude/worktrees/sta-1-a origin/main", r.root),
    undefined,
  );
  assert.equal(
    decide(`git -C ${r.root} worktree add ${r.root}/.claude/worktrees/x`, outside),
    undefined,
  );
  assert.match(decide("git worktree add ../sibling", r.root) ?? "", /fflow start/);
  assert.match(decide(`git -C ${r.root} worktree add -b b ${outside}/x`, outside) ?? "", /outside/);
  assert.match(decide(`cd ${r.root} && git worktree add "${outside}/y"`, outside) ?? "", /outside/);
  assert.match(decide("git worktree add --detach /tmp/z HEAD", r.root) ?? "", /outside/);
});

test("guard: other git commands and commands outside a repository pass", (t) => {
  const r = repo();
  t.after(r.dispose);
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "flow-guard-")));
  assert.equal(decide("git worktree list", r.root), undefined);
  assert.equal(decide("git worktree remove ../sibling", r.root), undefined);
  assert.equal(decide("echo git worktree add ../x", r.root), undefined);
  assert.equal(decide("git worktree add ../x", outside), undefined);
});

test("guard: the settings wire every guard event to the hook entry, not pnpm exec", () => {
  assert.deepEqual(SETTINGS.hooks.PreToolUse[0], {
    matcher: "Bash|Write|Edit|MultiEdit|NotebookEdit|Read|Grep|Glob",
    hooks: [
      {
        type: "command",
        command:
          'node "$CLAUDE_PROJECT_DIR/node_modules/@figentra-oss/flow/bin/fflow-guard.mjs" PreToolUse',
        timeout: 5,
      },
    ],
  });
  for (const event of ["UserPromptSubmit", "SessionStart", "PostToolUse"])
    assert.match(
      SETTINGS.hooks[event][0].hooks[0].command,
      new RegExp(`fflow-guard\\.mjs" ${event}$`),
    );
});

test("engine: the hook entry denies a side door with the command, and allows the rest (P-012)", (t) => {
  const r = repo();
  t.after(r.dispose);
  const denied = hook(r.root, "PreToolUse", {
    tool_name: "Bash",
    tool_input: { command: "gh pr merge 12" },
  });
  assert.equal(denied?.permissionDecision, "deny");
  assert.match(
    denied?.permissionDecisionReason,
    /fflow land <pr>[^]*Blocked command: gh pr merge 12/,
  );
  assert.equal(
    hook(r.root, "PreToolUse", { tool_name: "Bash", tool_input: { command: "git status" } }),
    undefined,
  );
  assert.equal(hook(r.root, "PreToolUse", "not json{"), undefined, "unparseable input allows");
});

test("engine: a secret file is denied to every file tool; an example and other files pass (P-012)", (t) => {
  const r = repo();
  t.after(r.dispose);
  for (const [tool, input] of /** @type {[string, Record<string, string>][]} */ ([
    ["Read", { file_path: `${r.root}/.env` }],
    ["Write", { file_path: `${r.root}/apps/x/.env.local` }],
    ["Edit", { file_path: `${r.root}/certs/server.pem` }],
    ["Grep", { pattern: "x", path: `${r.root}/.dev.vars` }],
    ["Glob", { pattern: "keys/id_ed25519", path: r.root }],
    ["NotebookEdit", { notebook_path: `${r.root}/prod.secrets.json` }],
  ])) {
    const d = hook(r.root, "PreToolUse", { tool_name: tool, tool_input: input });
    assert.equal(d?.permissionDecision, "deny", `${tool} ${JSON.stringify(input)}`);
    assert.match(d?.permissionDecisionReason, /Secrets guard[^]*Blocked path: /);
  }
  for (const [tool, input] of /** @type {[string, Record<string, string>][]} */ ([
    ["Read", { file_path: `${r.root}/.env.example` }],
    ["Write", { file_path: `${r.root}/src/env.mjs` }],
    ["Grep", { pattern: "API_KEY", path: r.root }],
  ]))
    assert.equal(
      hook(r.root, "PreToolUse", { tool_name: tool, tool_input: input }),
      undefined,
      tool,
    );
});

test("engine: the preset's tables, the neutral ones in their place, an ask for a rule that throws (FR-5)", async (t) => {
  const r = repo();
  t.after(r.dispose);
  const neutral = await loadTables(r.root);
  assert.deepEqual(neutral.bash, [], "the side doors are the engine's, not table data");
  assert.equal(neutral.prompt, undefined);
  writeFileSync(join(r.root, CONFIG_FILE), JSON.stringify({ version: 1, preset: "stackra" }));
  const stackra = await loadTables(r.root);
  assert.deepEqual(
    stackra.bash.map((x) => x.id),
    ["stackra-deny", "stackra-ask"],
    "core's decision",
  );
  assert.ok(stackra.prompt && stackra.session, "stackra's hints");
  assert.equal(stackra.paths[0].id, "secrets-read", "stackra's own path rules first");
  assert.ok(
    stackra.paths.some((x) => x.id === "secret-file"),
    "and the neutral ones after (FR-5)",
  );
  assert.ok(stackra.planGated?.test("packages/a/src/a.ts"), "stackra's plan gate");
  assert.equal(neutral.planGated, undefined, "no plan gate in the neutral preset");
  const event = {
    event: /** @type {const} */ ("PreToolUse"),
    tool: "Bash",
    cwd: r.root,
    root: r.root,
  };
  const broken = {
    ...neutral,
    bash: [
      {
        id: "boom",
        decision: /** @type {const} */ ("deny"),
        reason: "",
        match: () => {
          throw new Error("x");
        },
      },
    ],
  };
  const d = await decideEvent({ ...event, input: { command: "ls" } }, broken);
  assert.equal(d.decision, "ask");
  assert.match(d.reason ?? "", /rule boom failed/);
  assert.equal(
    (await decideEvent({ ...event, input: { command: "ls" } }, neutral)).decision,
    "allow",
  );
});

test("engine: tables that fail to load deny every tool call, closed (FR-5)", (t) => {
  const r = repo();
  t.after(r.dispose);
  mkdirSync(join(r.root, "ours", "guard"), { recursive: true });
  writeFileSync(join(r.root, "ours", "guard", "bash-rules.mjs"), "export const BASH_RULES = {;\n");
  writeFileSync(join(r.root, CONFIG_FILE), JSON.stringify({ version: 1, preset: "ours" }));
  const d = hook(r.root, "PreToolUse", { tool_name: "Bash", tool_input: { command: "ls" } });
  assert.equal(d?.permissionDecision, "deny");
  assert.match(d?.permissionDecisionReason, /guard tables failed to load/);
  assert.equal(hook(r.root, "UserPromptSubmit", { prompt: "implement x" }), undefined);
});

/**
 * A repository whose preset is its own folder `ours/` holding `files` in `guard/`.
 * @param {Record<string, string>} files
 */
const ours = (files) => {
  const r = repo();
  mkdirSync(join(r.root, "ours", "guard"), { recursive: true });
  for (const [name, text] of Object.entries(files))
    writeFileSync(join(r.root, "ours", "guard", name), text);
  writeFileSync(join(r.root, CONFIG_FILE), JSON.stringify({ version: 1, preset: "ours" }));
  return r;
};

test("engine: a preset with empty tables still denies the side doors, secret files and its configuration (FR-5)", (t) => {
  const r = ours({
    "bash-rules.mjs": "export const BASH_RULES = [];\n",
    "path-rules.mjs": "export const PATH_RULES = [];\n",
  });
  t.after(r.dispose);
  const bash = (/** @type {string} */ command) =>
    hook(r.root, "PreToolUse", { tool_name: "Bash", tool_input: { command } });
  assert.match(bash("gh pr merge 12")?.permissionDecisionReason, /fflow land <pr>/);
  assert.match(bash("git worktree add ../x")?.permissionDecisionReason, /fflow start/);
  assert.match(bash("LEFTHOOK=0 git commit -m x")?.permissionDecisionReason, /fflow hooks run/);
  const file = (/** @type {string} */ tool, /** @type {string} */ path) =>
    hook(r.root, "PreToolUse", { tool_name: tool, tool_input: { file_path: path } });
  assert.match(file("Read", `${r.root}/.env`)?.permissionDecisionReason, /Secrets guard/);
  for (const tool of ["Write", "Edit"])
    assert.match(
      file(tool, `${r.root}/${CONFIG_FILE}`)?.permissionDecisionReason,
      /only the owner changes it[^]*Blocked path: /,
      tool,
    );
  assert.equal(file("Read", `${r.root}/${CONFIG_FILE}`), undefined, "reading it is fine");
  assert.equal(bash("git status"), undefined);
});

test("engine: a rule table that is not a list fails the load, so every tool call is denied (FR-5)", async (t) => {
  const r = ours({ "bash-rules.mjs": "export const BASH_RULES = {};\n" });
  t.after(r.dispose);
  await assert.rejects(loadTables(r.root), /BASH_RULES is not a list/);
  const d = hook(r.root, "PreToolUse", { tool_name: "Read", tool_input: { file_path: "a.md" } });
  assert.match(d?.permissionDecisionReason, /failed to load \(BASH_RULES is not a list\)/);
});

test("engine: a path rule or the plan gate that throws asks for that call (FR-5)", async (t) => {
  const r = repo();
  t.after(r.dispose);
  const tables = await loadTables(r.root);
  const boom = () => {
    throw new Error("x");
  };
  const event = { event: /** @type {const} */ ("PreToolUse"), cwd: r.root, root: r.root };
  const read = await decideEvent(
    { ...event, tool: "Read", input: { file_path: `${r.root}/a.md` } },
    { ...tables, paths: [{ id: "boom", reason: "", match: boom }] },
  );
  assert.equal(read.decision, "ask");
  assert.match(read.reason ?? "", /rule boom failed on .*a\.md/);
  const write = await decideEvent(
    { ...event, tool: "Write", input: { file_path: `${r.root}/src/a.mjs` } },
    { ...tables, planGated: /** @type {RegExp} */ (/** @type {unknown} */ ({ test: boom })) },
  );
  assert.equal(write.decision, "ask");
  assert.match(write.reason ?? "", /plan gate failed on .*src\/a\.mjs/);
});

test("engine: a payload without cwd is decided in the hook's own folder, so a relative glob resolves (P-012)", (t) => {
  const root = presetRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const glob = (/** @type {Record<string, unknown>} */ extra) => {
    const r = runHook(
      "PreToolUse",
      { tool_name: "Glob", tool_input: { pattern: "Secrets-in*/x" }, ...extra },
      { ...process.env, CLAUDE_PROJECT_DIR: root },
      homedir(),
    );
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  assert.match(glob({}), /"permissionDecision":"deny"[^]*Secrets-inbox/);
  assert.equal(glob({ cwd: "/" }), "", "the payload's cwd wins");
});
