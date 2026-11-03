---
"@figentra-oss/flow": minor
---

The guard engine (STA-1945 PR 4): `bin/fflow-guard.mjs <event>` runs one neutral engine for every guard hook
(PreToolUse for Bash and the file tools, PostToolUse, UserPromptSubmit, SessionStart) against the repository's preset
tables in `guard/`, and `fflow guard --print-settings` prints the `.claude/settings.json` hooks that wire it. The
lifecycle's side doors and the neutral path rules (generic secret files, and `flow.config.json`, which only the owner
writes) are the engine's own: they hold for every preset, whatever its tables say. The stackra preset carries core's
guard unchanged: its Bash rules (the secrets inbox and secret values, destructive git outside the session's own
worktree, pushes, deploys, `changeset version`, `figentra bot|linear|secrets` and the rest of ADR 0293's tiers), its
path rules, its plan gate, its prompt hints and its session invariants. A rule or the plan gate that throws asks;
tables that fail to load deny every tool call.
