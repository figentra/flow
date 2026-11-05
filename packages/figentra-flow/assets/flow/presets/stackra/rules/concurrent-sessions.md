---
title: Concurrent Sessions
always: true
description: Managing multiple concurrent AI agent sessions
---

# Concurrent Sessions

Multiple AI agents can work on Stackra simultaneously with worktrees.

## Preconditions

Before starting concurrent work:

1. **Clean working tree** - Commit or stash all changes
2. **Green CI** - All checks passing on main
3. **Sync dependencies** - `pnpm install`
4. **Understand conflicts** - Agents touching the same files will conflict

## Worktree Strategy

Create a worktree per agent **inside the repository**, under `.claude/worktrees/<name>` (gitignored). Never create
one next to the repository (`../<name>`): sibling folders pile up in `~/Projects` and outlive their branch.

```bash
# From the repository root
git worktree add .claude/worktrees/sta-123 -b figentra/sta-123-slug origin/main
cd .claude/worktrees/sta-123
pnpm install
# Agent works here; another agent works in the main checkout or its own worktree

# After the PR merges
git worktree remove .claude/worktrees/sta-123
git branch -D figentra/sta-123-slug
```

## Coordination Rules

### File Ownership

Each agent claims a file boundary:

- Agent A: `packages/foundation/*`
- Agent B: `packages/security/*`
- Agent C: `services/auth/*`

Never cross boundaries without explicit handoff.

### Shared Files

Some files are shared (read-only for all but one agent):

- `pnpm-workspace.yaml` - One agent at a time: the round's integration batch, or the batch that owns it (ADR 0468)
- `turbo.jsonc` - One agent at a time: the round's integration batch, or the batch that owns it (ADR 0468)
- `.agents/rules/*` - Only one agent at a time

### Communication

Agents must:

1. **Announce intent** - "I'm modifying `packages/foundation/logger`"
2. **Claim files** - Create `.agents/locks/<agent-id>` with file list
3. **Release files** - Delete lock file when done

## Phased Work

Large refactors run in phases:

1. **Phase 1** - Foundation (Agent A)
2. **Phase 2** - Depends on Phase 1 (Agent B)
3. **Phase 3** - Depends on Phase 2 (Agent C)

Never start Phase N+1 until Phase N is merged to main.

## Merge Conflicts

If two agents conflict:

1. **Don't force merge** - Creates tech debt
2. **Coordinate** - One agent rebases, the other waits
3. **Gate check** - `pnpm verify` must pass after merge

## Enforcement

- Planned: `guard-paths.mjs` does not read `.agents/locks/` yet; lock files are a convention, not a check
- Planned: nothing records or enforces agent boundaries yet; `session-context.mjs` re-states the repo invariants and branch, not file ownership
- `pnpm verify` after a merge is the only coordination check

## Best Practices

- Prefer small, focused tasks over large refactors
- Test in isolation before merging
- Document the change in the PR description
- Run full gate after merge

## See Also

- Constitution: delegation
- Agents: concurrent-sessions (docs page)
