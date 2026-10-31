# Implementation Plan: Vellum runs the whole development workflow

**Spec**: `.agents/specs/sta-1729-vellum-workflow/spec.md` · **Linear**: STA-1729 · **Date**: 2026-10-31

**Input**: the spec, approved at its stop by the leader on 2026-10-31. This plan is the design of **phase 1** (the
worktree rule); each later phase adds its own design section here and stops for approval before its tasks.

## Summary

Phase 1 makes `<repo>/.claude/worktrees/<name>` the only place a worktree lives: `vellum start` creates it (branch and
Linear), `vellum clean` removes the finished ones, adopts the stray ones and fixes `.gitignore`, and `vellum guard` is
the hook check that refuses `git worktree add` anywhere else. Then the six repositories without the ignore line get it.

## Technical Context

- **Language**: plain ESM JavaScript with JSDoc, checked by `tsc` (`checkJs`); Node 24; no runtime dependencies
- **Members**: figentra/vellum `packages/vellum` (`@stackra/vellum`, binary `vellum`)
- **Testing**: `node:test` in `src/__tests__/`, against temporary git repositories with a local bare remote; no
  network, no real Linear call (the client is injected)
- **Storage**: none (git and `~/.config/vellum/workspace.yaml`)
- **Runtime target**: the `vellum` CLI, run in the repository it acts on

## Architecture overview

Three new commands on the existing dispatcher (`bin/vellum.mjs`): `start`, `clean` and `guard`. They share two small
libraries: `lib/git.mjs` (run git, parse `git worktree list --porcelain`, find the repository's main checkout, the
default branch and whether a commit is on a remote) and `lib/workspace.mjs` (read and write the workspace list).
Network git goes through the repository's own wrapper when it has one (`pnpm bot:git -- …`, the Figentra guard's
rule), else plain `git`. Linear goes through the vendored client in `lib/linear.mjs`; a Linear failure is reported and
never blocks (ADR 0065 rule 7).

## Components and responsibilities

- **`vellum start <STA-n> [--slug s] [--install] [--dry-run]`**: resolve the main checkout (also when run inside a
  worktree), fetch, read the default branch (`origin/HEAD`), derive the slug from the Linear title (lower-case words,
  at most 5 words and 40 characters) unless `--slug`, refuse when the folder or the branch (local or remote) exists,
  then `git worktree add <repo>/.claude/worktrees/sta-n-<slug> -b figentra/sta-n-<slug> origin/<default>`, move STA-n
  to In Progress with a comment naming the branch, and run `pnpm install` only with `--install`.
- **`vellum clean [--dry-run] [--adopt] [--fix-ignore] [--all]`**: for each worktree of the repository (or of every
  workspace repository with `--all`), the leader's revisions of 2026-10-31 included:
  - **skip** a tester worktree (`g-*`, `*-gate`, `land-*`, `tpl-core`, `c6-lock*`, `template-wt-lean`);
  - **clean**: `git status --porcelain` is empty (untracked files count);
  - **saved**: the head is on a remote ref (`git branch -r --contains`, or an ancestor of `origin/<default>`), or every
    commit is landed (`git cherry origin/<default> HEAD` lists no `+`), since core builders never push and stackra-f4
    lands by cherry-pick;
  - **finished**: with an issue key in the branch (`sta-n`), the issue is Done or Canceled; without one (a detached HEAD,
    or a builder sub-agent tree such as `agent-*`, `wf_*` or a random name), the tree has been idle for at least
    2 hours, from the modification time of its HEAD reflog (`<gitdir>/logs/HEAD`), not the index, which `git status`
    touches;
  - **no precious ignored files**: `git status --ignored --porcelain` lists nothing outside the usual caches
    (`node_modules`, `dist`, `build`, `coverage`, `.turbo`, `.cache`, `.stackra`, `.next`, `.expo`, `*.tsbuildinfo`,
    `.DS_Store`); a tree with anything else (`.env`, `ios/`, `android/`, …) is kept and the files are named;
  - a tree that passes every test is removed (`git worktree remove`), with its local branch when it has one, and its
    size (`du -sk` before removal) is added to the space freed, which the command reports;
  - every kept tree is reported with its reason (tester, dirty, unsaved, issue open, idle for less than 2 hours, precious
    ignored files, Linear unavailable);
  - `--adopt`: move each clean, non-tester worktree outside `.claude/worktrees/` inside with `git worktree move`, and
    list the tester ones for stackra-f4 and the dirty ones for their owner;
  - `--fix-ignore`: add `.claude/worktrees/` to `.gitignore` when missing and say a commit is needed.
- **`vellum guard [--print-settings]`**: read the agent's PreToolUse JSON from stdin; for a Bash command with
  `git … worktree add <path>` (including `-C <dir>` and `cd <dir> &&`), resolve the path against the command's
  directory and deny unless it is under that repository's `.claude/worktrees/`; anything else passes with no output.
  `--print-settings` prints the exact `.claude/settings.json` hook entry.
- **`vellum init --workspace <dir>…`**: find the git repositories under the given folders and write
  `~/.config/vellum/workspace.yaml` (path and GitHub slug per repository).

## Files and folders

- `packages/vellum/bin/vellum.mjs`: add `start`, `clean` and `guard` to the commands
- `packages/vellum/src/commands/start.mjs`, `clean.mjs`, `guard.mjs` (new); `init.mjs` (the `--workspace` option)
- `packages/vellum/src/lib/git.mjs`, `workspace.mjs` (new)
- `packages/vellum/src/__tests__/start.test.mjs`, `clean.test.mjs`, `guard.test.mjs`, `workspace.test.mjs` (new)
- `packages/vellum/README.md`, `AGENTS.md`; `.changeset/vellum-worktree-rule.md`; `.gitignore` (`.claude/worktrees/`)
- In billing, invoicing, brand, stackra/notes and stackra/pro: `.gitignore` gains `.claude/worktrees/` (one trivial
  commit each, after the commands land)

## Data models and migrations

none

## Contracts

- CLI: `vellum start`, `vellum clean`, `vellum guard`, `vellum init --workspace`, with the options above; exit 0 on
  success, 1 on a refusal or a failed step, 2 on a usage error.
- The guard's output is Claude Code's PreToolUse hook contract: `{ "hookSpecificOutput": { "hookEventName":
"PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": … } }` on a denial, nothing otherwise.
- `~/.config/vellum/workspace.yaml`: a `repos:` list of `{ path, github }`.

## Error handling

Every refusal names what blocked it and changes nothing (an existing folder or branch, an unknown issue without
`--slug`, a dirty worktree). A failed git step stops the command with git's message. A Linear failure is printed as a
warning after the worktree exists. The guard fails open on input it cannot parse, as every hook does, and never on a
`worktree add` it can read.

## Security and tenancy

No secret is read or printed: the Linear token comes from the calling wrapper's environment, network git from the
repository's bot wrapper. `vellum clean` never deletes a worktree with uncommitted or unpushed work, nor a tester's.

## Testing strategy

`node:test` against temporary repositories with a bare remote: start (folder, branch, refusals, slug, injected Linear),
clean (each keep reason, saved by remote and by cherry, detached and keyless trees with the idle time, precious ignored files, space freed, tester names, adopt, fix-ignore), guard (allowed and denied paths, `-C`, `cd &&`,
non-matching commands, unreadable input) and the workspace file. Run on a box by stackra-f4 (`pnpm verify`), never on
the Mac. Each test carries `@covers sta-1729:AC-###`.

## Rollout

1. Land the commands in Vellum and publish with the next Vellum release.
2. The leader takes the printed guard entry to the owner, who wires it into each repository's `.claude/settings.json`
   (and core's `_rules.mjs`).
3. Add `.claude/worktrees/` to the six repositories' `.gitignore`.
4. Run `vellum clean --adopt --dry-run --all`, review the list with the leader and stackra-f4, then run it for real.

## Constitution Check

| Law                                   | Result | Note                                                    |
| ------------------------------------- | ------ | ------------------------------------------------------- |
| Boundaries (tier direction, ADR 0003) | N/A    | Vellum is its own repository with one package           |
| Secrets (ADR 0009)                    | PASS   | tokens only from the wrapper's environment, never read  |
| Security                              | PASS   | never deletes unpushed or dirty work; tester trees kept |
| HTTP and events                       | N/A    | a CLI, no endpoint or event                             |
| Tenancy                               | N/A    | no tenant data                                          |
| Delegation                            | PASS   | one builder session, stackra-f4 gates                   |
| Not built yet (ADR 0011)              | PASS   | nothing on the list                                     |
| Test placement (ADR 0022)             | PASS   | `src/__tests__/` beside the subjects                    |
| Versions and catalogs                 | PASS   | no dependency                                           |
| Deploy modes (ADR 0076)               | PASS   | a developer tool, same everywhere                       |
| Licence tier (ADR 0077)               | PASS   | free                                                    |
| Docs and ADRs                         | PASS   | ADR 0503 in core; Vellum README and AGENTS.md           |

## Deploy modes

| Mode       | Behaviour         |
| ---------- | ----------------- |
| SaaS       | same (a dev tool) |
| On-prem    | same (a dev tool) |
| Air-gapped | same (a dev tool) |

## Correctness properties

- **P-001**: `vellum start` creates exactly one branch and one worktree under `.claude/worktrees/`, or changes nothing — Validates: FR-1
- **P-002**: the guard denies a `worktree add` path outside `.claude/worktrees/` and passes every other command — Validates: FR-2
- **P-003**: `--fix-ignore` leaves every repository ignoring `.claude/worktrees/` exactly once — Validates: FR-3
- **P-004**: `vellum clean` removes a tree only when it is clean, saved (on a remote or landed by patch), finished (issue closed, or idle 2 hours without a key) and free of precious ignored files, and never a tester tree — Validates: FR-4
- **P-005**: the gate posts `vellum/gate` only on the commit it checked, only while that commit is still the branch tip, only from the box with the gate App, and never `success` unless the check command exited 0 (phase 2) — Validates: FR-5
- **P-006**: phase 3's land merges only on a green gate and recorded approvals (designed in phase 3) — Validates: FR-6
- **P-007**: phase 4's status lists every workspace repository (designed in phase 4) — Validates: FR-7
- **P-008**: phase 5's release publishes only to the Stackra registry and ship never reaches production (designed in phase 5) — Validates: FR-8
- **P-009**: no phase adds a check that runs on the Mac beyond oxfmt and oxlint — Validates: FR-9
- **P-010**: the sessions phase shows each spec's assigned session and never treats a peer message as an approval (designed in its phase) — Validates: FR-10
- **P-011**: the core names no vendor, team or organisation outside the adapters and presets named after them, and no command falls back to a Figentra choice when the configuration is silent (phase A) — Validates: FR-11

## Phase 2: the gate (design, for the leader's plan stop)

Phase 2 makes one result count: `vellum gate run` checks the exact head of a branch on a testbed box and the box posts
the `vellum/gate` commit status on that head. Covers FR-5, FR-9, AC-008, AC-009 and P-005.

### Architecture overview

`vellum gate` already holds the spec gate (`plan`, `check`, `tasks`, `lane`, `branch`, `ci`, `dir`). Phase 2 adds two
modes beside them, so nothing existing moves:

1. `vellum gate run [--ref <branch>] [--no-wait]` on the builder's Mac (or any caller). It resolves the head, exports
   exactly that commit, and hands it to `stackra testbed run` with the box command. It never runs a check itself.
2. `vellum gate post` runs **on the box**, inside the testbed job container, after the checks. It posts the status
   and the report with the gate App's token, which only the box can read.

```text
builder ── vellum gate run ──► git archive <sha> ─► temp dir ─► stackra testbed run "<session> gate" <dir> "<box cmd>"
                                                                     │  (box: container per job, Infisical secrets)
                                                                     ▼
                       pnpm install --frozen-lockfile && <verify> ; node .vellum-gate/post.mjs <exit> <sha> <branch>
                                                                     │
                                                                     ▼
                                     GitHub: commit status `vellum/gate` on <sha> + PR comment (gate App)
```

The status is unforgeable because of who can post it, not where Vellum runs. The poster is a GitHub App, the
"Stackra Gate" App. Its key lives only in Infisical `/ci/gate`, which only the testbed's gate identity reads (ADR 0484
decision 7). Phase 6's branch rule requires `vellum/gate` **from that App** (a ruleset's required check bound to the
App's integration id), so a status posted with any other token, the agents' `bot:gh` one included, does not count.

### Components and responsibilities

- `src/commands/gate-run.mjs`, the `run` mode, on the caller's side:
  - resolves the head with `git rev-parse HEAD`;
  - refuses a dirty tree, and a head that is not the remote branch tip (`git ls-remote origin <branch>`, through the
    repository's `bot:git` when it has one), because a status may only describe a pushed commit (AC-009);
  - exports the commit with `git archive <sha>` into a temp folder, so untracked, ignored and uncommitted files never
    reach the box;
  - writes `.vellum-gate/post.mjs` and `.vellum-gate/job.json` (sha, branch, repository slug, PR number when there is
    one) into that folder;
  - calls `stackra testbed run "<session> gate <repo>@<short sha>" <dir> "<box cmd>"` and passes its exit code
    through: 0 green, 1 red, 73 busy, 75 no healthy box.
- `src/lib/gate-post.mjs`, a dependency-free Node script that `run` copies into the job (the box has no Vellum
  installed, so this needs no publish):
  - reads `job.json` and the verify exit code;
  - mints an installation token from `VELLUM_GATE_APP_ID` and `VELLUM_GATE_PRIVATE_KEY` (environment only, from
    `infisical run`; never printed or written);
  - checks the branch tip again and posts only if it is still `<sha>`; otherwise it reports "stale" and posts nothing
    (AC-009);
  - posts `vellum/gate` with `success` or `failure`, plus a description (the failing step, or the counts);
  - posts or updates one PR comment holding the report: each step, its duration, and the tail of a failing step's
    log, with secrets masked by Infisical.
- The box command: `pnpm install --frozen-lockfile && pnpm verify && vellum-spec; node .vellum-gate/post.mjs $?`.
  `vellum-spec` is `pnpm exec vellum gate ci` when the repository has Vellum, and skipped otherwise. The repository
  can name its own check command in `package.json` `"vellum": { "gate": "<cmd>" }`; the default is `pnpm verify`.

### Files and folders

- `packages/vellum/src/commands/gate-run.mjs`: the `run` mode, wired in `gate.mjs`'s `run([mode, ...])` switch.
- `packages/vellum/src/lib/gate-post.mjs`: the box-side poster; no imports outside `node:`.
- `packages/vellum/src/lib/github-app.mjs`: the App JWT (RS256 with `node:crypto`), the installation token, and the
  status and comment calls over `fetch`. Used only by `gate-post.mjs`, which inlines it when copied.
- Tests in `packages/vellum/src/__tests__/gate-run.test.mjs` and `gate-post.test.mjs`.

### Data models and migrations

None. The gate keeps no state: the commit status is the record, and the PR comment is the report. `job.json` is
`{ sha, branch, repository, pr?, startedAt }`, written per run and deleted with the job folder.

### Contracts

- CLI:
  - `vellum gate run [--ref <branch>] [--no-wait] [--on-demand]`: exit 0 green, 1 red, 2 usage or refused, 73 every
    box busy (with `--no-wait`), 75 no healthy box.
  - `vellum gate post <exit-code>`: box-only. It refuses unless `VELLUM_GATE_APP_ID` is set.
- GitHub: commit status context `vellum/gate`, with state `success` or `failure`. `pending` is never left behind: the
  box posts once, at the end. The description is at most 140 characters, and the target URL is the PR comment.
- Testbed: `stackra testbed run` from `@stackra/cli` (ADR 0484) on the caller's PATH or as `pnpm exec stackra`.
  Vellum does not depend on the package; a missing `stackra` is a refusal that names it.

### Error handling

- A dirty tree, an unpushed head, or no `stackra`: refused before any box is claimed (exit 2), naming the fix.
- Testbed busy or unhealthy: its exit code passes through (73 or 75), and nothing is posted.
- Verify fails: `failure` is posted with the failing step. The poster's own failure (a token, the network) exits
  non-zero and posts nothing, so the head has no status and stays unmergeable; it never posts `success` on doubt.
- The head moves during the run: nothing is posted; "stale: <branch> is now <new sha>" is printed.

### Security and tenancy

- The App key is read only on the box through `infisical run` with the job's named paths (ADR 0484 decision 7). The
  caller's Mac never holds it, and Vellum never prints, logs or passes it on a command line. The installation token
  lives in memory for one run.
- The App needs only `statuses: write` and `pull_requests: write` on the repositories it gates.
- The exported tree is `git archive` of a pushed commit, so the box checks exactly what will merge.
- No tenancy: this is developer tooling.

### Testing strategy

- `gate-run`: a temporary repository with a local bare origin and an injected testbed runner, covering:
  - the refusals: dirty, unpushed, stale, no `stackra`;
  - the archive holds only committed files, plus `.vellum-gate/`;
  - exit codes pass through.
- `gate-post`: an injected `fetch`, covering:
  - `success` and `failure` bodies on the right sha;
  - nothing posted when the tip moved;
  - nothing posted when the token mint fails;
  - one comment updated, not duplicated;
  - the JWT signed with a throwaway test key generated in the test.
- No network, no real App and no box in tests. The first real run is f4's acceptance on vellum itself.

### Rollout

1. Owner:
   - creates the "Stackra Gate" App (statuses and pull requests: write) and installs it on the gated repositories;
   - puts `VELLUM_GATE_APP_ID` and `VELLUM_GATE_PRIVATE_KEY` in Infisical `/ci/gate`;
   - adds `/ci/gate` to the testbed's allowed job paths in `infra-testbed`.
2. Depends on `stackra testbed` landing in core (branch `figentra/sta-1626-testbed`, ADR 0484). Until it does, f4
   gates by hand as today.
3. f4's acceptance: `vellum gate run` on a vellum PR posts `vellum/gate` from the App on its head, green and then
   red on a deliberately broken commit.
4. Phase 6 makes it required per repository, bound to the App.

### Phase 2 correctness properties

P-005 (above, made concrete for phase 2) and P-009's part: `vellum gate run` runs no check on the caller's machine.

### Decisions at the plan stop (leader, 2026-10-31)

1. **A new "Stackra Gate" App**, used only to post `vellum/gate`. The ruleset trusts only that App.
2. **`vellum gate ci` runs wherever Vellum is installed.** Phase 6 installs Vellum in every repository, so the
   "when present" branch only covers the transition.
3. **`--box <ssh host>` ships now** as f4's manual path. Once `stackra testbed` lands (STA-1626), testbed is the
   default and `--box` stays as the override. On a `--box` host the poster runs under
   `infisical run --path=/ci/gate`, so the host needs the gate identity logged in.
4. **The poster logs nothing secret.** The App key, the JWT, the installation token and every value from the
   environment whose name looks secret are kept out of the PR comment and the box log. A log tail is redacted
   before it is posted.

The box command is POSIX `sh`. The check runs in a group whose output is written to `.vellum-gate/log.txt` and
whose exit code goes to `.vellum-gate/exit`. The poster reads both. Its exit code is 0 when it posted green, 1 when
it posted red, 4 when it could not post, and 5 when the head went stale. So `vellum gate run` exits with the gate's
result.

The exported tree is a local clone of the repository at `<sha>`, not a `git archive`. It carries
`refs/remotes/origin/<default>` and the GitHub `origin` URL, because `vellum gate ci` diffs against the default
branch. Nothing uncommitted or untracked is in it.

## Phase 3: land (design, for the leader's plan stop)

Phase 3 turns the lander's checklist, done by hand by stackra-f4 today, into `vellum land`. It covers FR-6, AC-010,
AC-011, AC-017 and P-006, and adds AC-029.

### Architecture overview

`vellum land [<pr>] [--stack] [--dry-run]` runs where the lander runs: the tester's session, or any session the
leader names. Its guarantee rests on GitHub, not on who runs it:

1. **Check:** every rule below is checked against GitHub's live state. Every failing rule is reported, not only the
   first (AC-011).
2. **Squash-merge** through the API, with `sha` set to the gated head. GitHub refuses the merge if the head moved
   after the check.
3. **After the merge:**
   - Linear Done;
   - record the merge commit on the branch;
   - remove the worktree through `clean`'s rules;
   - delete the remote branch;
   - comment on the PR.

```text
vellum land ──► GitHub: PR, statuses, mergeability ──► rules ──► PUT /pulls/{n}/merge {squash, sha: head}
                                     ▲                                │
                     spec on disk (tier, approvals)                   ├─► Linear Done (key from the branch)
                                                                      ├─► git config branch.<b>.vellumLanded <merge sha>
                                                                      ├─► clean (that worktree only, AC-027 applies)
                                                                      └─► DELETE refs/heads/<b>; PR comment
```

GitHub calls go through `gh api`, through the repository's own `bot:gh` wrapper when it has one, the same way network
git goes through `bot:git`. Vellum never handles a token.

### Components and responsibilities

- `src/commands/land.mjs`: `vellum land`:
  - `landRules(pr, ctx)`: a pure function from the PR, the head's statuses and the spec text to a list of problems;
  - `land()`: the merge and the steps after it;
  - `landStack()`: the `--stack` loop.
- **Rules**, each one line in the refusal:
  1. The PR is open, not a draft, and not conflicting (`mergeable_state` is not `dirty`).
  2. Its base is the default branch. Otherwise: "stacked on `<base>`: land that first, or use `--stack`".
  3. `vellum/gate` on the **head** sha is `success`, is the newest status of that context, and was posted by the gate
     App (the status creator equals `vellum.gateApp`, default `stackra-gate[bot]`). Each failure is named: "no
     gate", "gate red", "gate on an older commit", or "gate posted by `<login>`, not the gate App" (AC-011).
  4. The PR title is a conventional commit header (`type(scope)?: subject`, at most 100 characters). It becomes the
     squash commit's title.
  5. The spec (from the branch's key, `.agents/specs/sta-<n>-*`), when there is one:
     - `checkApproval` passes (ADR 0502);
     - its status is Tasked or later (a feature or big spec needs its last stop approved).
     - A branch without a spec relies on the gate's lane check, which already refuses a `feat` without one.
- **Merge:** squash with `commit_title` "`<title> (#<n>)`".
  - `commit_message` carries one `Refs: STA-n` and the `Co-authored-by` trailers collected from the PR's commits.
  - `sha` is the checked head.
- **After the merge.** Each step warns on failure and never undoes the merge:
  - Linear Done, with a comment naming the merge commit (ADR 0065 rule 7);
  - `git config branch.<b>.vellumLanded <merge sha>` in the main checkout;
  - `clean({ only: [worktree] })`, so the in-use, dirty and precious-file rules still hold. A kept tree is printed
    with its reason, and a later `vellum clean` takes it;
  - delete the remote branch;
  - a PR comment: "Landed by vellum land as `<merge sha>`".
- **`clean` change (AC-029):** a tree whose branch carries `vellumLanded`, with that commit on `origin/<default>`,
  counts as saved. A squash commit has a different patch id from the branch's commits, so `git cherry` alone would
  call a landed multi-commit branch unsaved forever.
- **`--stack` (AC-017):**
  - From the given PR, it walks the bases down to the default branch.
  - It lands the bottom PR by the rules.
  - It then brings the next PR up to date by **merging** `origin/<default>` into its branch in its own worktree and
    pushing normally (no rebase, no force: the owner's rule). GitHub retargets it to the default branch when the
    landed branch is deleted.
  - It runs `vellum gate run` there, and continues only on green.
  - It stops at the first PR that fails a rule, or has no local worktree, and names it.

### Files and folders

- `packages/vellum/src/commands/land.mjs`, with `land` on the dispatcher in `bin/vellum.mjs`.
- `packages/vellum/src/lib/github.mjs`: `gh(root, args)` through `bot:gh` when present, and `api(root, method, path, body?)`
  returning parsed JSON.
- `packages/vellum/src/commands/clean.mjs`: the `only` option and the `vellumLanded` saved rule.
- `packages/vellum/src/lib/git.mjs`: `isSaved` reads `branch.<b>.vellumLanded`.
- Tests: `land.test.mjs` (the rules, the merge request and the steps after it, with the GitHub calls injected),
  `land-stack.test.mjs`, and a `clean.test.mjs` case for AC-029.

### Data models and migrations

None. The one piece of state is the git config key `branch.<b>.vellumLanded`, in the main checkout. It is removed with
the branch when `clean` deletes the branch.

### Contracts

- CLI: `vellum land [<pr>] [--stack] [--dry-run]`.
  - Exit codes: 0 landed (or would land, with `--dry-run`), 1 refused (every reason printed), 2 usage or no PR, 3
    merged with a follow-up step that only warned.
- `package.json` `"vellum": { "gateApp": "<login>" }` overrides the trusted status creator.
- GitHub calls:
  - `GET /repos/{r}/pulls/{n}` and `/pulls/{n}/commits`;
  - `GET /repos/{r}/commits/{sha}/statuses`;
  - `PUT /repos/{r}/pulls/{n}/merge`;
  - `DELETE /repos/{r}/git/refs/heads/{b}`;
  - `POST /repos/{r}/issues/{n}/comments`.

### Error handling

- Rules: all failures are collected and printed, then exit 1. Nothing changes.
- Merge refused by GitHub (head moved, a branch rule, or a conflict found late): exit 1, with GitHub's message.
  Nothing after the merge runs.
- After the merge, each step's failure is a warning: exit 3, with the steps left to do. The merge is never undone.
- `--stack`:
  - a merge conflict when updating the next PR aborts that merge (`git merge --abort`) and stops, naming the PR;
  - a red gate stops the stack;
  - the landed PRs stay landed.

### Security and tenancy

- **No new trust:** branch protection's required `vellum/gate`, bound to the gate App in phase 6, is what GitHub
  enforces. `land`'s own check of the status creator is the same rule, applied before the merge.
- **No token handling:** `gh` gets its token from the `bot:gh` wrapper (Infisical). Vellum never reads, prints or
  stores it.
- **Owner-only stops:** `land` never records an approval, and refuses a spec whose stop is not recorded. Production
  promote stays `runway promote`, owner-only (phase 5).

### Testing strategy

- `landRules` is pure, with one case per rule:
  - draft, conflict, stacked base;
  - no gate, red gate, stale gate, gate from another creator;
  - bad title;
  - a feature spec missing `Approved by`, a big spec at Planned;
  - a green PR, which has no problems.
- `land()` with an injected `api`:
  - the merge body (`squash`, `sha`, the title with `(#n)`, the `Refs` and co-author trailers);
  - the order of the steps after the merge;
  - a failed Linear call gives exit 3 and still deletes the branch;
  - a GitHub 405 on the merge gives exit 1 with no steps after it.
- `--stack` over a temporary repository with a local bare origin, with the gate and the API injected:
  - the bottom PR lands;
  - the next PR is updated by a merge commit, never a rewrite;
  - a red gate stops the stack.
- `clean`: a branch with `vellumLanded` on `origin/main` is removed even though `git cherry` shows `+`.

### Rollout

1. Land after phase 2. `land` trusts only what the phase 2 poster writes.
2. f4's acceptance on vellum PRs:
   - a scratch PR with no gate, a red gate and a stale gate is refused, each with its reason;
   - a feature spec missing `Approved by` is refused;
   - a green PR lands as one squash commit, and its worktree is gone.
3. Then f4 uses `vellum land` instead of hand landing, one repository at a time. Phase 6 makes the required check bind
   to the gate App.

### Decisions at the plan stop (leader, 2026-10-31)

1. **Stacks are updated by merge.** The no-force rule wins, and the squash on land flattens the history anyway.
2. **`stackra-gate[bot]` is the trusted creator.** GitHub reserves the `[bot]` suffix for Apps. This check is defence in
   depth only; the guarantee is the ruleset requiring `vellum/gate` from the App's integration id (phase 6).
3. **Any session may run `land`.** There is no `VELLUM_LANDER` convention: the required check plus `checkApproval` is
   the guarantee.
4. **Before phase 6** switches a repository's ruleset, `land` refuses there unless `--manual-ok` is passed (AC-030).
   It reads `GET /repos/{r}/rules/branches/{default}` and looks for a `required_status_checks` rule naming
   `vellum/gate`. Only stackra-f4 passes `--manual-ok`, during the transition. The flag is printed in the PR comment.
5. AC-029 stays.
6. **The AI review is a land rule** (added 2026-10-31, AC-031). Every change with a spec (small, feature or big) needs
   the counted ADR 0230 verdict on its head; trivial work has no spec and is exempt. The verdict is
   `AI-REVIEW: PASS <40-hex head> base=<base>` from the `stackra-reviewer` App, matched by App identity, unedited and
   not by the PR's author or the head commit's author or committer; a FAIL for the head beats a PASS. The owner's
   APPROVED review with `owner-approval` on the head also counts. It is ported from core's `pr-merge.mjs` without its
   patch-id survival, because land merges the exact head. `vellum review`, run by a different agent than the builder
   and posting through `pnpm bot:review`, is designed after land (T035).

## Phase A: a neutral core with adapters (design, for the leader's plan stop)

Owner direction of 2026-10-31: Vellum becomes a product anyone can use, with no Stackra or Figentra coupling in its
core. Every Figentra choice moves into a `vellum.config` file in our repositories. The product is being renamed (the
new name comes later), so its name lives in one module. Phase A comes after the credentials fix (AC-034) and before
phase 4, whose GitHub and tracker reads go through these adapters. It covers FR-11 and AC-035 to AC-042.

### Architecture overview

The core keeps the workflow: specs and their gates, worktrees, the gate, land, status and release. It reaches the
outside world only through six ports. A repository chooses an adapter for each port in `vellum.config.json`.

```text
                    ┌────────────── vellum core (no vendor names) ──────────────┐
 vellum.config.json │ spec gates · worktrees · gate · land · status · release │
   (per repo)       └──┬────────┬──────────┬──────────┬──────────┬──────────┬──┘
                       │        │          │          │          │          │
                  credentials  tracker   runner     apps      secrets    preset
                  env | gh-user linear   github-     gate and  env |      neutral |
                  | wrapper     github-  actions |   review    infisical  stackra |
                                issues   ssh |       identities           a path
                                jira     local |     (from config)
                                         command
```

Today's code becomes adapters in place:

- `lib/linear.mjs` becomes the `linear` tracker.
- `bot:gh` and `bot:git` become a `wrapper` credentials adapter.
- `--box` becomes the `ssh` runner.
- `stackra testbed run` becomes a `command` runner in our configuration. The core does not depend on it, and no
  plug-in system is needed for it.
- `infisical run --path=/ci/gate` becomes the `infisical` secrets adapter.
- `assets/presets/stackra` becomes the `stackra` preset, beside a new `neutral` one.

### Components and responsibilities

- **The product module, `src/lib/product.mjs`.** It is the one place the product's name appears:
  - the CLI name and the binary;
  - the config file name (`vellum.config.json`);
  - the status context (`vellum/gate`);
  - the comment markers;
  - the environment prefix (`VELLUM_`);
  - the user config folder (`~/.config/vellum`).

  Every other file imports from it. A rename then touches this module, `package.json` and the docs (AC-042).

- **The config module, `src/lib/config.mjs`.**
  - `loadConfig(root)` reads `vellum.config.json` from the repository root, validates it against the shipped JSON
    schema (`schema/vellum.config.schema.json`), and refuses an unknown key or a wrong type, naming the path (AC-035).
  - Each port's adapter is built from its block.
  - A port with no block refuses when a command needs it, naming the key to set. There are no Figentra defaults: with
    no config, `start` asks for a tracker, `land` asks for credentials, and `gate run` asks for a runner (AC-036).
  - JSON keeps the package free of dependencies, and editors validate it through `$schema`.
- **Credentials port** (AC-034, generalised):
  - The interface is `gh(args)` for GitHub API calls and `git(args)` for network git, with no silent fallback.
  - `env`: `gh` with `GH_TOKEN` from the environment, which must be set.
  - `gh-user`: the caller's own `gh` login, chosen on purpose.
  - `wrapper`: separate command prefixes for `gh` and `git`. Ours is `["pnpm","bot:gh","--"]` and
    `["pnpm","bot:git","--"]`.
  - `fetch`, `remoteTip` and `land` all use the port. Today's `remote()` fallback to plain `git` goes away.
- **Tracker port:**
  - The interface is `keyPattern`, `branchFor(key, slug)`, `issue(key) → { title, state, url }`,
    `setState(key, state)` and `comment(key, body)`.
  - `linear` takes `team`, `branchPrefix` and the token's environment names. It is today's client, with `STA` and
    `figentra/` moved into config.
  - `github-issues` uses keys `#123` and branches `<prefix>/123-<slug>`, through the credentials port.
  - `jira` takes `site`, `project` and the token's environment names, and uses REST with a token from the environment.
  - The spec folder name follows the key (`.agents/specs/<key>-<slug>/`). The gate's key and branch checks read the
    adapter's patterns instead of `STA-` and `figentra/` (AC-037).
- **Runner port** (`run({ dir, command, label, sha }) → exit code`, AC-038):
  - `github-actions` is the default for outside users. `vellum init --runner github-actions` writes
    `.github/workflows/vellum-gate.yml`, a `workflow_dispatch` with `sha` and `branch` inputs that checks out the
    commit, runs the check and then the poster with the gate App's key from repository secrets. `gate run` dispatches
    it through the credentials port, follows the run, and passes its conclusion through.
  - `ssh` takes `host` and is today's `--box`.
  - `local` runs on the caller's machine. Our config never chooses it (FR-9).
  - `command` takes an argument list with `{label}`, `{dir}` and `{command}` placeholders. Ours is
    `["stackra","testbed","run","{label}","{dir}","{command}"]`.
- **Apps, gate and review identities** (AC-039):
  - `apps.gate` holds `{ slug, login }` and `apps.review` holds `{ slug }`. Ours are `figentra-gate` /
    `figentra-gate[bot]` and `figentra-review`.
  - `apps.owner` names the owner login whose `owner-approval` review counts.
  - `land` matches the gate status creator by `apps.gate.login`, and `aiReview` matches the reviewer by
    `apps.review.slug`. Nothing is hard-coded: `stackra-gate[bot]`, `stackra-reviewer` and `figentra-usr` leave the
    code.
  - The poster reads `<PREFIX>GATE_APP_ID` and `<PREFIX>GATE_PRIVATE_KEY`.
  - `vellum app create gate|review` runs GitHub's App-manifest flow, for a human only. It refuses when stdin is not a
    terminal or an agent environment is detected.
    1. It serves a one-page form on `127.0.0.1` that POSTs the manifest (name, permissions: statuses and pull requests
       write for the gate, issues write for review, no webhook) to GitHub.
    2. It receives the `code` on the local callback and exchanges it at `POST /app-manifests/{code}/conversions`.
    3. It hands the private key straight to the secrets port's `store`, never to the screen or a log. With the `env`
       adapter, that is a 0600 file at a path the human names.
    4. It prints the App id and login to paste into `vellum.config.json`.
- **Secrets port** (AC-040). It never reads a value into Vellum.
  - The interface is `wrap(command, scope) → command`, for the runner and poster side, and `store(name, value)`, for
    `app create` only.
  - `env`: `wrap` returns the command unchanged, so values come from the environment the caller set; `store` writes
    a 0600 file.
  - `infisical` takes `paths` per scope, such as `gate: /ci/gate`. `wrap` returns
    `infisical run --silent --path=<path> -- <command>`, and `store` runs `infisical secrets set` interactively, by
    a human.
- **Preset port** (AC-041):
  - `preset: "neutral" | "stackra" | "<path>"`.
  - `neutral` is new: spec-kit's commands with only the wrap the gates need (the spec location, the `plan` gate call,
    the tier and approval fields). It mentions no ADR, team or product.
  - `stackra` is today's preset, unchanged.
  - A path names a repository's own preset folder, which replaces today's `.agents/speckit/presets` detection.
- **Other keys:**
  - `clean.keep` holds the tester's worktree name patterns (today's `TESTER` regex).
  - `gate.check` holds the check command (today's `package.json` `vellum.gate`).
  - `review.required` holds the tiers that need the AI review (default `small, feature, big`).

### Files and folders

- New:
  - `src/lib/product.mjs` and `src/lib/config.mjs`;
  - `src/adapters/credentials.mjs`, `tracker/{linear,github-issues,jira}.mjs`,
    `runner/{github-actions,ssh,local,command}.mjs`, `secrets/{env,infisical}.mjs` and `apps.mjs`;
  - `src/commands/app.mjs`;
  - `schema/vellum.config.schema.json`;
  - `assets/presets/neutral/`;
  - `assets/workflows/vellum-gate.yml`.
- Changed: every command reads `loadConfig(root)` and the product module, instead of a constant or `package.json`'s
  `vellum` key. `lib/linear.mjs` moves to `adapters/tracker/linear.mjs`.
- Our repositories gain `vellum.config.json` (W9). Core's carries the Figentra choices below.

### Data models and migrations

`vellum.config.json` is versioned as `{ "$schema": "…/vellum.config.schema.json", "version": 1, … }`. Today's
`package.json` `"vellum"` keys (`credentials`, `gate`, `gateApp`) are read once more with a deprecation warning, then
dropped in the next minor version. There is no other state.

Figentra's configuration, as core will carry it:

```json
{
  "version": 1,
  "preset": "stackra",
  "tracker": {
    "kind": "linear",
    "team": "STA",
    "branchPrefix": "figentra",
    "token": ["LINEAR_AGENT_TOKEN", "LINEAR_API_KEY"]
  },
  "credentials": {
    "kind": "wrapper",
    "gh": ["pnpm", "bot:gh", "--"],
    "git": ["pnpm", "bot:git", "--"]
  },
  "runner": {
    "kind": "command",
    "run": ["stackra", "testbed", "run", "{label}", "{dir}", "{command}"]
  },
  "secrets": { "kind": "infisical", "paths": { "gate": "/ci/gate" } },
  "apps": {
    "gate": { "slug": "figentra-gate", "login": "figentra-gate[bot]" },
    "review": { "slug": "figentra-review" },
    "owner": "figentra-usr"
  },
  "gate": { "check": "pnpm verify" },
  "clean": { "keep": ["g-*", "*-gate", "land-*", "tpl-core", "c6-lock*", "template-wt-lean"] }
}
```

### Contracts

- CLI:
  - `vellum config check` validates the file and prints the resolved adapters, never a secret.
  - `vellum init --runner <kind> --tracker <kind>` writes a starter config, plus the gate workflow for
    `github-actions`.
  - `vellum app create gate|review` is described above.
- Adapters are plain ES modules exporting a factory `(block, context) → port`. The core imports only built-ins;
  external plug-ins are a later decision.
- The status context, the comment markers and the `AI-REVIEW:` line stay byte-compatible, so PRs gated before the
  change still land.

### Error handling

- A config that is invalid fails every command with each error, before anything runs.
- A port that is not configured refuses only the commands that need it, and names the key.
- The `github-actions` runner treats a dispatch it cannot follow (cancelled, timed out) as not posted (exit 4), never
  as green.
- `app create` interrupted before the conversion leaves nothing behind. A key the secrets port cannot store is shown
  only as the instruction to rerun it; it is never printed.

### Security and tenancy

- Secret values never enter Vellum's memory except in `app create`'s one hand-off from GitHub to the secrets port.
  Everywhere else the secrets port wraps commands.
- `app create` refuses in a non-interactive or agent session, because creating an identity is the owner's act.
- Credentials never fall back to a personal login (AC-034 carries over).
- Trust is by identity from config: the gate's login and the review App's slug. The ruleset's integration id (phase 6) remains the real guarantee.
- The neutral core contains no Figentra name, path, team or login. A test greps the published package's files for
  them, outside the `stackra` preset (AC-036).

### Testing strategy

- **Config:**
  - the schema accepts the Figentra example and a minimal outside example (`github-actions` and `github-issues`);
  - it rejects an unknown key, a wrong kind and a missing required field, each with its path;
  - the deprecated `package.json` keys still work, with a warning.
- **Each adapter**, with injected spawn and fetch:
  - `wrapper`, `env` and `gh-user` command lines;
  - the `linear` (today's tests, moved), `github-issues` and `jira` request shapes, key patterns and branch names;
  - the `github-actions` dispatch, the run following and the conclusion mapping;
  - `ssh` and `command` placeholder expansion;
  - `infisical` `wrap`.
- **`app create`**: the manifest JSON and the conversion call, with an injected `fetch` and HTTP server. The key goes
  only to an injected store, and the test asserts it is absent from stdout and stderr.
- **Neutrality**: no `stackra`, `figentra`, `STA-` or `infisical` outside `assets/presets/stackra` and the adapters
  named after them, checked over `npm pack --dry-run`'s file list.
- **Rename cost**: a test asserts that the product's name appears only in `product.mjs` among `src/**`.

### Rollout

1. **A1**: the product and config modules, the credentials and secrets ports, and the deprecation path.
2. **A2**: the tracker port: `linear` moved, `github-issues` added, `jira` added.
3. **A3**: the runner port: `ssh`, `local` and `command`, then `github-actions` with its workflow.
4. **A4**: apps from config, and `vellum app create`.
5. **A5**: the `neutral` preset.
6. **A6**: our repositories get `vellum.config.json` (core first, then vellum itself, os, the products), and our Apps
   are created as Figentra Gate and Figentra Review by the owner with `vellum app create`.

Each step lands green on f4's box. Phase 4 follows A6.

### Phase A decisions to confirm at the plan stop

1. **`vellum.config.json` (JSON with a shipped schema, no dependency) or `vellum.config.mjs`** (code, more power,
   harder to validate)?
2. **The testbed is a `command` runner in our config, not a plug-in package.** That keeps the core free of a plug-in
   loader. Are plug-ins wanted later?
3. **`github-actions` as the outsiders' default runner**, via the dispatched workflow that `vellum init` writes. Is
   that acceptable, given ADR 0503's "GitHub keeps only Release plus `vellum/gate`" for us? We keep `command`.
4. **`app create` is human-only**, refusing agents. With Infisical as our secrets adapter, the key goes to
   `infisical secrets set`, run by the owner, which matches ADR 0257's rule that nobody but the owner sets a value.
5. **Jira in A2, or later?** It is untested without a Jira site.
6. **Deprecation window:** keep reading `package.json` `"vellum"` keys for one minor version.

A finding outside this design: `gate.mjs` calls `pnpm --silent linear …`, and pnpm 12 refused `-s` (37f62ef). The
tracker port removes the call. Until then, Linear stage comments from `vellum gate plan` may fail quietly, because
they are best-effort.
