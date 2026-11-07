/**
 * Stackra preset: the OpenCode executor layer, moved from core's `.opencode/plugins/guard/decide.ts` (STA-2136): what
 * only the lead does (owner-only CLIs, network git, the GitHub and Linear wrappers beyond the executor's own fetch and
 * push, Infisical, local data git cannot restore, `figentra bot|pr merge|linear|secrets`). It applies only when the
 * OpenCode guard plugin runs the guard (`STACKRA_EXECUTOR=1`, `isExecutor`), on top of `decideBash` with `executor`;
 * the edit half (outside the session's worktree, in the main checkout) is the `executor-worktree` path rule.
 * shortcut: commands are split on && || ; | and newlines without honouring quotes, as core's are; nested scripts come
 *   from the shared scanShell / scriptStrings; upgrade to a real shell parser if one slips through.
 * Boundary: decides only; reads nothing.
 * Runtime: node (agent hook)
 * Governing contract: ADR 0293 (agent permission tiers and executor pushes); ADR 0066 (unattended OpenCode); STA-400.
 */
import { rawSubstitutions, scanShell, scriptStrings, stripHeredocs } from "./inbox.mjs";
import { isSecretPath } from "./path-rules.mjs";

/** @typedef {{ decision: "allow" | "deny", reason: string }} Decision */
/** @type {Decision} */
const ALLOW = { decision: "allow", reason: "" };
const deny = (/** @type {string} */ reason) => ({ decision: "deny", reason });

const tokens = (/** @type {string} */ s) => s.split(/[\s=<>()'"`]+/).filter(Boolean);
const words = (/** @type {string} */ s) =>
  (s.match(/'[^']*'|"[^"]*"|\S+/g) ?? []).map((w) => w.replace(/^(['"])(.*)\1$/, "$2"));
const base = (/** @type {string} */ w) => w.split("/").pop() ?? w;

/** Drop leading VAR=x, env VAR=x, sudo, command, exec, time, nohup. */
function head(/** @type {string[]} */ ws) {
  let i = 0;
  while (
    i < ws.length &&
    (/^[A-Za-z_][A-Za-z0-9_]*=/.test(ws[i]) ||
      ["sudo", "command", "exec", "time", "nohup"].includes(ws[i]) ||
      (ws[i] === "env" && /=/.test(ws[i + 1] ?? "")))
  )
    i++;
  return ws.slice(i);
}

const subcommands = (/** @type {string} */ cmd) =>
  cmd
    .split(/&&|\|\||;|\||\n/)
    .map((s) => s.trim())
    .filter(Boolean);

/** Global options whose value is the next word (`--git-dir=x` carries its value and is skipped as a flag). */
const GIT_VALUE_OPTS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);
/**
 * git's subcommand and its arguments, skipping global options (`-C dir`, `-c k=v`, `--git-dir=…`).
 * @param {string[]} args
 * @returns {[string, string[]]}
 */
function gitSubcommand(args) {
  for (let i = 0; i < args.length; i++) {
    if (GIT_VALUE_OPTS.has(args[i])) i++;
    else if (!args[i].startsWith("-")) return [args[i], args.slice(i + 1)];
  }
  return ["", []];
}

/** CLIs that reach the network, a shared account or the keychain; executors never run them. */
const OWNER_ONLY_CLI = new Set(["gh", "curl", "wget", "infisical", "security"]);
// Network git (STA-208): on a private repo a fetch falls back to the owner's credential helper. STA-214: pack
// plumbing (bypasses the push checks) and `credential` (answers with the owner's token).
const GIT_OWNER_ONLY = new Set(
  "push fetch pull clone ls-remote submodule subtree send-pack receive-pack fetch-pack upload-pack credential".split(
    " ",
  ),
);
/** `git remote update|show|prune`, `git archive --remote` and `git credential-<helper>` reach a remote or a token. */
const networkGit = (/** @type {string} */ g, /** @type {string[]} */ args) =>
  g.startsWith("credential-") ||
  (g === "remote" && args.some((a) => ["update", "show", "prune"].includes(a))) ||
  (g === "archive" && args.some((a) => a.startsWith("--remote")));
/** Local data git cannot restore: branch -D, stash drop, worktree remove|prune, reflog expiry. */
const losesLocalData = (/** @type {string} */ g, /** @type {string[]} */ rest) =>
  (g === "branch" && rest.some((a) => /^-[a-zA-Z]*D/.test(a))) ||
  (g === "stash" && rest[0] === "drop") ||
  (g === "worktree" && ["remove", "prune"].includes(rest[0] ?? "")) ||
  (g === "reflog" && ["expire", "delete"].includes(rest[0] ?? ""));
/** The GitHub and Linear wrappers run under the full /agents set (STA-208): the lead's, except the executor push. */
const BOT_SCRIPT = /^(?:bot:\S+|pr:merge|linear|spec:linear)$/;
/**
 * ADR 0293: an executor fetches origin (one ref at most) and pushes its own HEAD through `pnpm bot:git`, as the whole
 * command: a prefix would run the executor's own code with every /agents value (STA-330 review).
 */
const EXECUTOR_BOT_GIT =
  /^pnpm bot:git (?:-- )?(?:fetch origin(?: [\w./-]+)?|push (?:--force-with-lease )?origin HEAD)$/;
/** The private CLI (ADR 0500) running what `BOT_SCRIPT` and `secrets:*` run, bare or after any runner. */
const FIGENTRA_LEAD =
  /(?:^|[\s/])(?:figentra(?:\.mjs)?|@figentra\/cli(?:@\S*)?)\s+(?:--\s+)?(?:bot|pr\s+merge|linear|secrets)\b/;

/**
 * Executors run unattended: anything that leaves the worktree, ships, or destroys local data is the lead's.
 * @param {string} cmd
 * @param {string[]} args
 * @param {boolean} exact
 * @returns {Decision}
 */
function denyExecutor(cmd, args, exact) {
  if (OWNER_ONLY_CLI.has(cmd) || cmd.startsWith("git-credential"))
    return deny(
      `\`${cmd}\` reaches the network, a shared account or a secret store; executors never run it.`,
    );
  if (cmd === "pnpm" && args.some((a) => BOT_SCRIPT.test(a)))
    return exact
      ? ALLOW
      : deny(
          "executors reach GitHub only as the whole command `pnpm bot:git -- fetch origin [<ref>]` or `pnpm bot:git -- push [--force-with-lease] origin HEAD`, with nothing before or after it; `pnpm bot:gh`, `bot:review`, `bot:token`, `pr:merge` and `linear` are the lead's.",
        );
  if (cmd === "encore" && ["deploy", "env", "secret"].includes(args[0] ?? ""))
    return deny(
      `\`encore ${args[0]}\` touches a shared environment or its secrets; the owner runs it.`,
    );
  if (cmd === "docker" && args.includes("down") && args.some((a) => a === "-v" || a === "--volumes"))
    return deny("`docker compose down -v` deletes volumes git cannot restore; the lead runs it.");
  if (cmd === "git") {
    const [g, rest] = gitSubcommand(args);
    const localSubmodule = g === "submodule" && ["status", "summary"].includes(rest[0] ?? "");
    if ((GIT_OWNER_ONLY.has(g) && !localSubmodule) || networkGit(g, args))
      return deny(`\`git ${g}\` reaches a remote; executors push only through \`pnpm bot:git\`.`);
    if (losesLocalData(g, rest))
      return deny(
        `\`git ${g} ${rest[0] ?? ""}\` deletes local data git cannot restore; the lead runs it.`,
      );
  }
  return ALLOW;
}

/**
 * @param {string} sub
 * @param {boolean} exact
 * @returns {Decision}
 */
function denySub(sub, exact) {
  const ws = head(words(sub));
  const executor = denyExecutor(base(ws[0] ?? ""), ws.slice(1), exact);
  if (executor.decision === "deny") return executor;
  if (FIGENTRA_LEAD.test(sub))
    return deny(
      "`figentra bot`, `pr merge`, `linear` and `secrets` run with the /agents values or move a secret; they are the lead's, as `pnpm bot:*`, `pr:merge`, `linear` and `secrets:*` are.",
    );
  for (const t of tokens(sub))
    if (isSecretPath(t)) return deny(`${t} holds secret values; never read, copy or print it.`);
  if (base(ws[0] ?? "") === "export" && ws[1] === "-p")
    return deny(
      "printing the environment leaks injected tokens. Echo the one variable you need (never a secret's value).",
    );
  for (const t of tokens(sub))
    if (/(^|\/)\d+-infisical-(setup|config)\.sh$/.test(t))
      return deny(
        `${base(t)} configures the vault with real credentials; owner-run only. Never run, trace (sh -x) or source it.`,
      );
  return ALLOW;
}

/**
 * Commands the shell also runs: substitution bodies and `sh -c` / `eval` strings at any depth (`scanShell`), plus
 * function, alias and piped script bodies.
 * @param {string} cmd
 * @returns {string[]}
 */
function nested(cmd) {
  const out = scanShell(cmd).bodies.flatMap((/** @type {string} */ b) => [b, ...nested(b)]);
  for (const s of scriptStrings(cmd)) out.push(s, ...nested(s));
  return out;
}

/**
 * The executor layer's decision for a shell command, after `decideBash` with `executor` allowed or asked.
 * @param {string} raw the command as the agent wrote it
 * @returns {Decision}
 */
export function decideExecutor(raw) {
  const exact = EXECUTOR_BOT_GIT.test(raw.trim());
  const cmd = stripHeredocs(raw);
  // Substitution bodies found with quotes ignored can only add denies (STA-254); `literal` splits a case pattern.
  for (const text of [
    cmd,
    scanShell(cmd).literal,
    ...nested(cmd),
    ...rawSubstitutions(cmd).flatMap((/** @type {string} */ b) => [b, ...nested(b)]),
  ])
    for (const s of subcommands(text)) {
      const d = denySub(s, exact);
      if (d.decision === "deny") return d;
    }
  return ALLOW;
}
