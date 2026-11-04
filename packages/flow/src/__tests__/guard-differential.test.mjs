/**
 * Figentra Flow file contract:
 * Purpose: core's differential test, ported (core 220f92c2, `.agents/hooks/__tests__/guard-differential.test.mjs`,
 *   STA-330 review round 4): every input of its corpus (a generated matrix of wrappers and guarded commands, a
 *   hand-written list of ordinary agent commands that must stay allowed) goes to the engine's `decide` with the
 *   stackra tables, the side doors included, and decides as core's hook did, within a time bound per decision (plan
 *   C4's parity proof, P-012). The one difference is Flow's own and listed (`FLOW_DENIES`): `commit -n` skips the
 *   hooks (FR-18), which core allowed. In-process in a temporary repository: main, the session's own linked worktree
 *   `a` (feature/x, the cwd) and another agent's `b` (feature/y). Test data holds no real secret, token or private
 *   path: `$MAIN`, `$WT`, `$OTHER` and `$SCRATCH` are filled in from the temporary repository. The OpenCode executor
 *   case holds the preset's moved `decideBash` (the OpenCode guard is STA-1945 T062); core's settings-floor check
 *   moves with the stackra settings surface (T061).
 * Boundary: test only; builds a temporary repository and calls `decide` in process.
 * Runtime: node (node:test)
 * Governing contract: ADR 0293; STA-330; ADR 0022 (tests live in tests folders); STA-1945.
 */
// @covers sta-1945:FR-7 sta-1945:FR-11 sta-1945:FR-18 sta-1945:AC-9 sta-1945:P-012
import { after, test } from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decide } from "../guard/engine.mjs";
import { loadTables } from "../guard/tables.mjs";
import { presetRoot, stackraGuard } from "./__fixtures__/guard.mjs";

const { WRAPPERS } = await stackraGuard("inbox.mjs");
const { bashRules, decideBash } = await stackraGuard("bash-rules.mjs");

/**
 * Every case decides in less than this of the guard's own time: the wall clock minus the time git takes to answer
 * its lookups, which a loaded machine stretches (the guard caps those at 48 and 2 s itself). One budget under the
 * hook's 5 s kill, as in guard-bash (STA-1693): a loaded gate box still passes, and a super-linear path in the reader,
 * the walk or the globbing still fails.
 */
const LIMIT_MS = 4000;
let gitMs = 0;
const { spawnSync } = childProcess;
/** @type {any} */ (childProcess).spawnSync = (/** @type {any[]} */ ...args) => {
  const t = performance.now();
  try {
    return /** @type {any} */ (spawnSync)(...args);
  } finally {
    gitMs += performance.now() - t;
  }
};
syncBuiltinESMExports(); // the guard's `spawnSync` binding now points at the timed one

const main = mkdtempSync(join(tmpdir(), "guard-differential-"));
const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t" };
Object.assign(env, { GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" });
spawnSync("git", ["init", "-q", "-b", "main"], { cwd: main });
spawnSync("git", ["commit", "-q", "--allow-empty", "-m", "x"], { cwd: main, env });
const wt = join(main, ".claude", "worktrees", "a");
const other = join(main, ".claude", "worktrees", "b");
spawnSync("git", ["worktree", "add", "-q", "-b", "feature/x", wt], { cwd: main });
spawnSync("git", ["worktree", "add", "-q", "-b", "feature/y", other], { cwd: main });
mkdirSync(join(wt, "dist"));
mkdirSync(join(wt, "packages", "a", "node_modules"), { recursive: true });
after(() => rmSync(main, { recursive: true, force: true }));

/** The scratch root and the session's scratchpad in it (it need not exist): the only scratch place for `rm -rf`. */
const scratchRoot = `/tmp/claude-${process.getuid?.() ?? 0}`;
const scratchpad = `${scratchRoot}/stackra-guard-differential/session/scratchpad`;
const fill = (c) =>
  c
    .replaceAll("$MAIN", main)
    .replaceAll("$WT", wt)
    .replaceAll("$OTHER", other)
    .replaceAll("$SCRATCH_ROOT", scratchRoot)
    .replaceAll("$SCRATCH", scratchpad);

const STACKRA = presetRoot();
after(() => rmSync(STACKRA, { recursive: true, force: true }));
/**
 * The stackra tables, core's rules deciding with core's in-process options: no deadline (the outcome, never TOO_SLOW
 * from box load), the scratchpad named directly (it need not exist) and no session role.
 */
const TABLES = {
  ...(await loadTables(STACKRA)),
  bash: bashRules({ deadlineMs: Infinity, scratchpad, role: "" }),
};
/** The engine's decision for a Bash `command` run in `cwd`. */
const bash = (/** @type {string} */ command, /** @type {string} */ cwd) =>
  decide(
    { event: "PreToolUse", tool: "Bash", input: { command }, cwd, root: main, payload: { cwd } },
    TABLES,
  );
await bash("git status", wt); // warm the modules before anything is timed

/** Every case `[command, want]` that decides otherwise or too slowly, as readable lines. */
async function wrong(cases, cwd = wt) {
  const out = [];
  for (const [c, want] of cases) {
    const [t, git] = [performance.now(), gitMs];
    const { decision, reason = "" } = await bash(fill(c), cwd);
    const ms = performance.now() - t - (gitMs - git);
    if (decision !== want) out.push(`${decision} (want ${want}) ${c}  [${reason.slice(0, 60)}]`);
    if (ms >= LIMIT_MS) out.push(`${ms.toFixed(0)} ms (limit ${LIMIT_MS}) ${c}`);
  }
  return out;
}

// ---- wrapper x guarded command ------------------------------------------------------------------------------

/** `c` as one single-quoted shell word. */
const sq = (c) => `'${c.replaceAll("'", `'\\''`)}'`;
/** `c` as one double-quoted shell word, filled first so no placeholder hides behind an escaped `$`. */
const dq = (c) => `"${fill(c).replaceAll(/[\\"$`]/g, "\\$&")}"`;
/** A typical option for a wrapper that takes one (`_inbox.mjs` `WRAPPER_VALUE`). */
const OPTION = {
  sudo: "sudo -u x",
  doas: "doas -u x",
  env: "env A=1",
  nice: "nice -n 5",
  timeout: "timeout 5",
  stdbuf: "stdbuf -oL",
  exec: "exec -a x",
};
/** Wrappers that run one quoted string, quoted with `q`. */
function quoted(q) {
  return [
    ["sh -c", (c) => `sh -c ${q(c)}`],
    ["bash -c", (c) => `bash -c ${q(c)}`],
    ["eval", (c) => `eval ${q(c)}`],
    // one quoted string that another program runs
    ["watch", (c) => `watch ${q(c)}`],
    ["watch -n 1", (c) => `watch -n 1 ${q(c)}`],
    ["script -c", (c) => `script -c ${q(c)} /dev/null`],
    ["su -c", (c) => `su -c ${q(c)}`],
    ["ssh", (c) => `ssh host ${q(c)}`],
    ["trap", (c) => `trap ${q(c)} EXIT`],
    ["tmux new -d", (c) => `tmux new -d ${q(c)}`],
    ["at now <<<", (c) => `at now <<< ${q(c)}`],
    ["parallel", (c) => `parallel ${q(c)} ::: a`],
    ["flock -c", (c) => `flock /tmp/l -c ${q(c)}`],
    // one quoted string inside another (STA-330 review round 5)
    ["ssh (tmux new -d)", (c) => `ssh host ${q(`tmux new -d ${q(c)}`)}`],
    ["ssh (su -c)", (c) => `ssh host ${q(`su -c ${q(c)}`)}`],
    ["tmux new -d (watch)", (c) => `tmux new -d ${q(`watch ${q(c)}`)}`],
    ["sh -c (sh -c)", (c) => `sh -c ${q(`sh -c ${q(c)}`)}`],
    // single-quoted text piped into a shell inside a quoted line (STA-351)
    ["ssh (echo | sh)", (c) => `ssh host ${q(`echo ${sq(c)} | sh`)}`],
    ["watch (echo | zsh)", (c) => `watch ${q(`echo ${sq(c)} | zsh`)}`],
    ["tmux new -d (printf | bash)", (c) => `tmux new -d ${q(`printf '%s\\n' ${sq(c)} | bash`)}`],
    ["node x.mjs (echo | bash)", (c) => `node x.mjs ${q(`echo ${sq(c)} | bash`)}`],
  ];
}
/** `[name, wrap, asks]`: `asks` when the wrapper itself is an ask (unreviewed registry code). */
const WRAPPED = [
  ["bare", (c) => c],
  ...[...WRAPPERS].flatMap((w) => [
    [w, (c) => `${w} ${c}`],
    ...(OPTION[w] ? [[OPTION[w], (c) => `${OPTION[w]} ${c}`]] : []),
  ]),
  ["caffeinate -i", (c) => `caffeinate -i ${c}`],
  ["arch -arm64", (c) => `arch -arm64 ${c}`],
  ["script -q /dev/null", (c) => `script -q /dev/null ${c}`],
  // runners
  ["pnpm exec", (c) => `pnpm exec ${c}`],
  ["pnpm --filter x exec", (c) => `pnpm --filter x exec ${c}`],
  ["pnpm <bin>", (c) => `pnpm ${c}`],
  ["mise exec --", (c) => `mise exec -- ${c}`],
  ["mise x node@22 --", (c) => `mise x node@22 -- ${c}`],
  ["npx", (c) => `npx ${c}`],
  ["npm exec --", (c) => `npm exec -- ${c}`],
  // shell structure
  ["( )", (c) => `(${c})`],
  ["{ }", (c) => `{ ${c}; }`],
  ["&&", (c) => `true && ${c}`],
  ["||", (c) => `false || ${c}`],
  ["if", (c) => `if true; then ${c}; fi`],
  ["for", (c) => `for i in 1; do ${c}; done`],
  ["$( )", (c) => `x=$(${c})`],
  ['"$( )"', (c) => `echo "$(${c})"`],
  ["<( )", (c) => `cat <(${c})`],
  ["backticks", (c) => `echo \`${c}\``],
  ...quoted(sq),
  // the same in double quotes, whose `\"`, `\\`, `\$` and escaped backtick the shell unescapes (round 6)
  ...quoted(dq).map(([name, wrap]) => [`${name} (dq)`, wrap]),
  ["ssh \"'…'\"", (c) => `ssh h "${sq(c)}"`],
  ["echo | sh", (c) => `echo ${sq(c)} | sh`],
  ["printf | bash", (c) => `printf '%s\\n' ${sq(c)} | bash`],
];
/** Guarded commands and their decision from the session's own worktree. */
const GUARDED = [
  ["rm -rf /", "deny"],
  ["rm -rf ~", "deny"],
  ["rm -rf $HOME", "deny"],
  ["rm -rf .git", "deny"],
  ["rm -rf $MAIN", "deny"],
  ["rm -rf $OTHER/src", "deny"],
  ["rm -rf $SCRATCH_ROOT/x", "deny"],
  ["rm -rf $SCRATCH/..", "deny"],
  ["find . -path './.git/*' -delete", "deny"],
  ["git -C $MAIN reset --hard", "deny"],
  ["git -C $MAIN checkout .", "deny"],
  ["git -C $MAIN clean -fd", "deny"],
  ["git push origin main", "deny"],
  ["pnpm bot:git -- push origin main", "deny"],
  ["pnpm bot:git -- push --force origin HEAD", "deny"],
  ["pnpm bot:git -- push -f origin HEAD", "deny"],
  ["pnpm bot:git -- push origin +HEAD:feature/x", "deny"],
  ["git stash pop", "deny"],
  ["git stash clear", "deny"],
  ["infisical export", "deny"],
  ["infisical secrets get FOO", "deny"],
  ["encore deploy", "deny"],
  ["encore secret set FOO", "deny"],
  ["wrangler secret put FOO", "deny"],
  ["changeset version", "deny"],
  ["drizzle-kit push", "deny"],
  ["git tag @stackra/logger@1.0.0", "deny"],
  ["psql -c 'DROP DATABASE app'", "deny"],
  ["cat .env", "deny"],
  ["cat apps/x/.dev.vars", "deny"],
  ["cat ~/.git-credentials", "deny"],
  ["cat tls.pem", "deny"],
  // STA-400: only deletes and deploys (`HUMAN_ASKS`) ask; the other categorical asks are allowed
  ["wrangler deploy", "ask"],
  ["encore db reset", "ask"],
  ["infisical run -- node x.js", "deny"],
  ["infisical --domain https://eu.infisical.com secrets get FOO", "deny"],
  ["infisical --domain https://eu.infisical.com run -- node x.js", "deny"],
  ["wrangler@3 pages deployment create dist", "ask"],
  ["eas workflow:run deploy.yml", "ask"],
  ["eas update:rollback", "ask"],
  ["eas-cli@latest channel:rollout production", "ask"],
  ["eas update:list", "allow"],
  ["git config user.email t@t", "allow"],
  ["rm -rf node_modules dist", "allow"],
  ["git reset --hard", "allow"],
  ["git checkout .", "allow"],
  ["git clean -fd", "ask"],
  ["rm -f a.txt", "ask"],
  ["rm -r src", "ask"],
  ["find . -name '*.tsbuildinfo' -delete", "ask"],
  ["wrangler@3.1.0 deploy", "ask"],
  ["eas-cli@latest submit", "ask"],
  ["npm publish", "ask"],
  ["pnpm bot:git -- push origin HEAD", "allow"],
  ["pnpm bot:git -- push --force-with-lease origin HEAD", "allow"],
];
/**
 * OpenCode executors (`executor`): the categorical asks STA-400 allows for Claude stay denied under every wrapper the
 * shared rules read through (STA-400 review: `env`, `timeout`, `mise exec --`, `pnpm exec`, `xargs`, node on the
 * import script).
 */
const EXECUTOR_DENIED = [
  "npx tsc",
  "pnpm dlx some-tool",
  "eas build --platform ios",
  "wrangler secret list",
  "wrangler d1 execute db --remote --command x",
  "encore env set prod",
  "infisical run -- node x.js",
  "infisical --log-level debug run -- node x.js",
  "./node_modules/.bin/eas build",
  "node tools/scripts/secrets-import.mjs X --env prod --confirm abc",
  "pnpm secrets:import X --env prod --confirm abc",
  "figentra secrets import X --env prod --confirm abc",
];
test("differential: an OpenCode executor is denied the categorical asks under every wrapper", () => {
  const out = [];
  for (const [name, wrap] of WRAPPED)
    for (const c of EXECUTOR_DENIED) {
      const { decision } = decideBash(fill(wrap(c)), { cwd: wt, scratchpad, executor: true });
      if (decision !== "deny") out.push(`${decision} ${name}: ${c}`);
    }
  for (const c of ["xargs npx tsc", "find . -name x | xargs npx tsc"])
    if (decideBash(c, { cwd: wt, executor: true }).decision !== "deny") out.push(`allow ${c}`);
  assert.deepEqual(out, []);
});

/** A wrapper the guard cannot read (a shell reading piped text) is a deny with the rewrite hint, whatever it runs. */
const tier = (want, asks) => (asks ? "deny" : want);

for (const [name, wrap, asks] of WRAPPED)
  test(`differential: ${name} x every guarded command`, async () =>
    assert.deepEqual(await wrong(GUARDED.map(([c, want]) => [wrap(c), tier(want, asks)])), []));

/** `c` wrapped `n` times in one-string wrappers, in turn, each quoting with `q`. */
const ONE_STRING = [
  (c, q) => `watch ${q(c)}`,
  (c, q) => `tmux new -d ${q(c)}`,
  (c, q) => `ssh host ${q(c)}`,
  (c, q) => `su -c ${q(c)}`,
];
const wrapped = (c, n, q = sq) =>
  Array.from({ length: n }).reduce((t, _, k) => ONE_STRING[k % 4](t, q), c);
// The docs say a quoted line is read eight levels deep. A secret file name is read in a line that holds a guarded
// command name, and in a quoted word's own words, so `cat .env` alone counts two levels deep (the rows above).
test("differential: a guarded command line wrapped eight times decides as it does bare", async () =>
  assert.deepEqual(
    await wrong(
      GUARDED.filter(([c]) => !c.startsWith("cat ")).map(([c, want]) => [wrapped(c, 8), want]),
    ),
    [],
  ));
test("differential: the same in double quotes, eight times", async () =>
  assert.deepEqual(
    await wrong(
      GUARDED.filter(([c]) => !c.startsWith("cat ")).map(([c, want]) => [wrapped(c, 8, dq), want]),
    ),
    [],
  ));

test("differential: a command nested in backslash-escaped double quotes denies (round 6)", async () =>
  assert.deepEqual(
    await wrong(
      [
        'sh -c "sh -c \\"rm -rf ~\\""',
        'ssh h "bash -c \\"rm -rf /\\""',
        'ssh h "tmux new -d \\"rm -rf ~\\""',
        'watch "watch \\"rm -rf ~\\""',
        'bash -c "bash -c \\"rm -rf $MAIN\\""',
      ].map((c) => [c, "deny"]),
    ),
    [],
  ));

test("differential: a program or a message flag never hides a secret file or a command beside it", async () =>
  assert.deepEqual(
    await wrong(
      [
        "awk '{print}' .env",
        "jq . .env",
        "jq -f prog.jq .env",
        "jq --rawfile k .env . x.json",
        "node -e 'x' .env",
        "python3 -c 'x' tls.pem",
        "perl -ne 'print' ~/.git-credentials",
        "sh -cm 'git stash pop'",
        "bash -cm 'rm -rf ~'",
        "ssh host \"tmux new -d 'rm -rf ~'\"",
        "ssh host \"su -c 'infisical export'\"",
        "tmux new -d \"watch 'infisical export'\"",
        "ssh h \"'infisical export'\"",
        // a search pattern or a jq option value is no file, but a file beside one still is (round 6)
        "grep -e x tls.pem",
        "grep -f .env x",
        "grep -- -x .env",
        "rg -g x foo .env",
        "jq --slurpfile k .env . x.json",
        "jq --arg a b . .env",
        "pnpm vitest run -t x .env",
        'ssh h "cat \\".env\\""',
      ].map((c) => [c, "deny"]),
    ),
    [],
  ));

test("differential: the matrix covers every wrapper _inbox.mjs knows", () => {
  for (const w of WRAPPERS)
    assert.ok(
      WRAPPED.some(([name]) => name === w),
      w,
    );
  assert.ok(WRAPPED.length * GUARDED.length > 1500);
});

// ---- ordinary agent work stays allowed ----------------------------------------------------------------------

const ALLOWED = [
  // reading git
  "git status",
  "git status --short",
  "git status -sb",
  "git diff",
  "git diff --stat",
  "git diff --cached",
  "git diff origin/main...HEAD",
  "git diff HEAD~1 -- .agents/hooks/_rules.mjs",
  "git diff -- '*.json'",
  "git log --oneline -10",
  "git log -1 --format=%H",
  "git log --oneline origin/main..HEAD",
  'git log --grep "push origin main" --oneline',
  "git show HEAD",
  "git show --stat HEAD",
  "git show HEAD:package.json",
  "git blame .agents/hooks/_rules.mjs",
  "git branch --show-current",
  "git branch -a",
  "git rev-parse HEAD",
  "git rev-parse --show-toplevel",
  "git merge-base HEAD origin/main",
  "git ls-files",
  "git ls-files '*.json'",
  "git ls-files -m",
  'git grep -n "git reset --hard"',
  "git worktree list",
  "git remote -v",
  "git config user.email",
  "git config --get remote.origin.url",
  "git stash list",
  "git shortlog -sn",
  "git describe --tags --always",
  "git reflog -5",
  "git cat-file -p HEAD",
  "git -C $WT status",
  "git -C $WT log -1",
  "git -C $MAIN status",
  "git -C $MAIN log --oneline -3",
  // substitutions and process substitutions (STA-330 review round 4)
  "diff <(git show HEAD:a.txt) a.txt",
  "cmp <(git diff A B) <(git diff C D)",
  "sort <(git ls-files) | head",
  'x=$(git log -1 --format="%an (%ae)")',
  "for p in $(git ls-files | grep -E '^(a|b)/'); do echo $p; done",
  "for f in $(find . \\( -name a \\)); do :; done",
  "y=$(find . -name '*(1)*')",
  "for f in $(git ls-files); do wc -l $f; done",
  "branch=$(git branch --show-current)",
  "echo `git rev-parse HEAD`",
  // local git writes in the session's own worktree
  "git add -A",
  "git add .agents/hooks/_rules.mjs",
  "git add *.json",
  'git commit -m "fix(hooks): read quoted command lines"',
  "git commit --amend --no-edit",
  "git commit -F - <<'EOF'\nfix(hooks): never rm -rf / or git push origin main\n\nRefs: STA-1\nEOF",
  "git commit -m \"$(cat <<'EOF'\nfix(hooks): x\n\nnever infisical export; never cat .env\nEOF\n)\"",
  "git rebase origin/main",
  "git rebase --continue",
  "git rebase --abort",
  "git cherry-pick abc123",
  "git merge --ff-only origin/main",
  "git switch -c feature/z",
  "git checkout -b feature/z",
  "git checkout feature/x",
  "git restore --staged .",
  "git restore .agents/hooks/_rules.mjs",
  "git reset --soft HEAD~1",
  "git reset HEAD~1",
  "git reset --hard",
  "git reset --hard origin/main",
  "git clean -n",
  "git checkout .",
  "git stash",
  "git stash push -m wip",
  "git stash apply stash@{0}",
  "git stash show -p stash@{1}",
  "git tag v1",
  "git branch -d feature/old",
  "git worktree add .claude/worktrees/sta-1 -b figentra/sta-1-x origin/main",
  'git config --worktree user.name "Stackra Agent"',
  "git -c core.editor=true rebase --continue",
  "git -c commit.gpgsign=false commit -m wip",
  "git apply fix.diff",
  "git format-patch -1",
  // GitHub, pushes and Linear through the wrappers
  "pnpm bot:gh pr view 113",
  "pnpm bot:gh pr checks 113",
  'pnpm bot:gh pr create --title "fix(hooks): x" --body "Refs STA-330; never git push origin main"',
  'pnpm bot:gh pr create --title "x" --body-file /tmp/body.md',
  "pnpm bot:gh pr list --state open",
  "pnpm bot:gh pr diff 113",
  "pnpm bot:gh pr edit 113 --body-file body.md",
  'pnpm bot:gh pr comment 113 --body "Addressed the findings"',
  "pnpm bot:gh run list --limit 5",
  "pnpm bot:gh run view 123 --log-failed",
  "pnpm bot:gh api repos/figentra/stackra/pulls/113",
  "pnpm --silent bot:gh pr view 113 --json headRefOid | jq -r .headRefOid",
  "pnpm bot:gh issue view 12",
  "pnpm bot:git -- fetch origin",
  "pnpm bot:git -- fetch origin main",
  "pnpm bot:git -- push origin HEAD",
  "pnpm bot:git -- push --force-with-lease origin HEAD",
  "pnpm bot:git -- -C $WT push origin HEAD",
  "pnpm bot:git -- -C $WT push --force-with-lease origin HEAD",
  "pnpm bot:git -- -C $WT fetch origin",
  'pnpm linear comment STA-330 "Round 4 fixed; never infisical export or git push origin main"',
  "pnpm linear start STA-330",
  "pnpm linear review STA-330 https://github.com/figentra/stackra/pull/113",
  "pnpm linear mine",
  'pnpm linear create --title "guard: x" --labels agent',
  'pnpm linear create --title x --description "never git stash pop or infisical export"',
  'git commit -am "docs: never git stash pop"',
  'git commit -sm "docs: never git stash pop"',
  // `git commit -nm …` is Flow's own deny (FR-18): `FLOW_DENIES` below
  "pnpm pr:merge 113",
  // the repository's scripts and tools
  "pnpm verify",
  "pnpm test",
  "pnpm test:hooks",
  "pnpm build",
  "pnpm lint",
  "pnpm typecheck",
  "pnpm format",
  "pnpm format:check",
  "pnpm validate",
  "pnpm boundaries",
  "pnpm knip",
  "pnpm install",
  "pnpm install --frozen-lockfile",
  "pnpm add -D vitest",
  "pnpm --filter @stackra/logger test",
  "pnpm -F @figentra/docs build",
  "pnpm run build",
  "pnpm exec oxfmt *.json",
  "pnpm exec oxfmt --check .",
  "pnpm exec oxfmt .agents/hooks/_rules.mjs",
  "pnpm exec oxlint .agents/hooks",
  "pnpm exec vitest run",
  "pnpm exec tsc --noEmit",
  "pnpm changeset",
  "pnpm agents:sync",
  "pnpm agents:check",
  "pnpm secrets:import --list",
  "pnpm docs",
  "mise exec -- pnpm verify",
  "mise exec -- pnpm test:hooks",
  "mise exec -- node --version",
  "mise install",
  "node --test .agents/hooks/__tests__/guard-bash.test.mjs",
  "node tools/scripts/validate-repository.mjs",
  'node -e "console.log(process.version)"',
  // program text is no file name (STA-330 review round 5)
  "node -e 'for (const a of m.actions) console.log(a.key ?? a.name)'",
  "node -e 'console.log(m.actions.find(x=>x.key===\"a\"))'",
  "node -pe 'require(\"./package.json\").version'",
  "jq -r '.actions[].key' .stackra/app-manifest.json",
  "jq '.data.key' x.json",
  "jq -r .key x.json",
  "python3 -c 'print(x.pem)'",
  "perl -ne 'print if /a.key/' list.txt",
  "pnpm bot:gh api repos/figentra/stackra/actions/secrets --jq '.secrets[].name'",
  // a search or test-name pattern and a jq option value are no file name (STA-330 review round 6)
  'grep -rn "action.key" packages/',
  'rg "def.key" src',
  'pnpm vitest run -t "reads action.key"',
  "jq --arg a b '.data.key' x.json",
  "jq --indent 2 '.a.key' x.json",
  'node -e \'console.log(check("rm -rf a[b"), check("encore secret set X"))\'',
  "timeout 600 pnpm verify",
  "turbo run build --filter=@stackra/logger",
  "encore run",
  "encore test",
  "encore check",
  "psql -c 'select 1'",
  "infisical secrets folders get --env=dev",
  "wrangler dev",
  "docker ps",
  // files and search
  "cat package.json",
  "cat src/*.json",
  "jq . *.json",
  "jq -r .version package.json",
  "ls *.json",
  "ls -la",
  "ls .*",
  "cat a*",
  "cat .env.example",
  "cat *.md",
  "head -50 .agents/hooks/_rules.mjs",
  "wc -l .agents/hooks/*.mjs",
  'grep -rn "infisical export" .agents',
  'rg -n "DROP DATABASE" apps/docs',
  "rg --files -g '*.json'",
  "find . -name '*.ts' -not -path './node_modules/*'",
  "find dist -delete",
  "sed -n '1,80p' .agents/hooks/_rules.mjs",
  "awk '/^worktree/ {print $2}' list.txt",
  "diff -u a.txt b.txt",
  "mkdir -p tmp/x && touch tmp/x/a",
  "cp README.md /tmp/readme.md",
  "mv a.txt b.txt",
  // removing your own build output
  "rm -rf node_modules",
  "rm -rf node_modules dist",
  "rm -rf .turbo .stackra coverage",
  "rm -rf */node_modules",
  "rm -rf **/node_modules",
  "rm -rf packages/*/node_modules",
  "rm -rf packages/a/node_modules",
  "rm -rf $SCRATCH/x",
  "rm -rf $SCRATCH",
  // prose, output and quoted lines that run nothing guarded
  'echo "rm -rf / is denied; so is git stash pop"',
  "printf '%s\\n' \"git push origin main\"",
  "cat > notes.md <<'EOF'\nrm -rf ~; infisical export; git push origin main; cat .env\nEOF",
  "tmux new -d 'pnpm test'",
  "watch 'git status'",
  "ssh host 'ls -la'",
  "sh -c 'pnpm test'",
  'bash -c "git status && git log -1"',
  "(cd packages && pnpm test)",
  "which node",
  "command -v gh",
  "curl -s https://docs.stackra.figentra.com | head",
  "ps aux",
  "pgrep -fl node",
  "du -sh node_modules",
  "date",
];

test("differential: at least 150 ordinary agent commands stay allowed", async () => {
  assert.ok(ALLOWED.length >= 150, `${ALLOWED.length} commands`);
  assert.equal(new Set(ALLOWED).size, ALLOWED.length);
  assert.deepEqual(await wrong(ALLOWED.map((c) => [c, "allow"])), []);
});

// ---- Flow's own rules ---------------------------------------------------------------------------------------

/**
 * What the engine's side doors deny although core's rules allow it (FR-13, FR-18), each naming the Flow command; and
 * the prose forms of the same commands, which stay allowed as core allows them.
 */
const FLOW_DENIES = [
  ['git commit -nm "docs: never rm -rf ~"', /fflow hooks run/],
  ["git commit --no-verify -m x", /fflow hooks run/],
  ["LEFTHOOK=0 git commit -m x", /fflow hooks run/],
  ["git worktree add $MAIN/../sibling", /fflow start/],
];
test("differential: the side doors deny what core allowed, under the stackra tables (FR-13, FR-18)", async () => {
  const out = [];
  for (const [c, why] of FLOW_DENIES) {
    const { decision, reason = "" } = await bash(fill(String(c)), wt);
    if (decision !== "deny" || !(/** @type {RegExp} */ (why).test(reason)))
      out.push(`${decision} ${c} [${reason.slice(0, 60)}]`);
  }
  assert.deepEqual(out, []);
  assert.deepEqual(
    await wrong([
      ["git commit -m 'docs: never git commit -n or LEFTHOOK=0'", "allow"],
      ["cat > notes.md <<'EOF'\ngit commit --no-verify -m x\nEOF", "allow"],
      ["git worktree add .claude/worktrees/sta-2 -b figentra/sta-2-x origin/main", "allow"],
    ]),
    [],
  );
});
