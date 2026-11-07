---
title: Linear
always: true
description: Work is not done until its Linear issue is in the right state; agents use `pnpm linear`
---

# Linear

Team `STA` tracks all work (ADR 0065, ADR 0121 D14). **Work is not done until its Linear issue is in the right
state.** Every agent, including subagents and OpenCode executors without the Linear MCP, uses `pnpm linear`:

| When                       | Run                                                              |
| -------------------------- | ---------------------------------------------------------------- |
| Starting work              | `pnpm linear start STA-n` (In Progress, comment with the branch) |
| Opening the PR             | `pnpm linear review STA-n <pr-url>` (In Review, PR attached)     |
| Merged / finished          | `pnpm linear done STA-n <link>`                                  |
| Progress, findings, blocks | `pnpm linear comment STA-n "<text>"`                             |
| New work found             | `pnpm linear create --title "…" [--project p] [--labels a,b]`    |
| What is open               | `pnpm linear mine`, `pnpm linear open [--label owner]`           |

- Branch names are Linear's (`figentra/sta-<n>-<slug>`; `pnpm delegate` uses `delegate/sta-<n>-…`), checked by
  `check-pr`. A `feat`/`fix`/`refactor`/`perf` commit carries
  `Refs: STA-n`. The PR title or branch names the key, or the PR is labelled `chore-lane`.
- `pnpm delegate` needs `--issue STA-n`. Issues an agent creates get the `agent` label automatically.
- Actions run as the "Stackra Agent" app, which is the issue's delegate. The human assignee is never changed.
- Tokens come from the sops `agents` scope only: `pnpm linear` runs `node tools/scripts/secrets-exec.mjs --names
  LINEAR_… -- …`, which decrypts just those names into the command's environment (ADR 0525). Never print one.
- A Linear failure never blocks a gate (ADR 0065 rule 7). The nightly `Linear sync` workflow repairs drift.

## Enforcement

`.commitlintrc.yaml` (`refs-issue-key`, lefthook and the Quality Gate over the PR range); `figentra linear check-pr`
in the Quality Gate; `requireIssue` in `figentra delegate`; `.github/workflows/linear-sync.yml`
(`figentra linear reconcile`) moves states, closes decided ADR issues and labels stale work.
