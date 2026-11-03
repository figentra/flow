---
"@figentra-oss/flow": minor
---

The guard engine, first part (STA-1945 PR 4): `bin/fflow-guard.mjs <event>` runs one neutral engine for every guard
hook (PreToolUse for Bash and the file tools, PostToolUse, UserPromptSubmit, SessionStart) against the repository's
preset tables in `guard/`, and `fflow guard --print-settings` prints the `.claude/settings.json` hooks that wire it.
The lifecycle's side doors are the neutral preset's Bash rules, and its path rules deny generic secret files to every
file tool. The stackra preset carries core's path rules unchanged (the secrets inbox, secret and owned files, the
generated AGENTS.md block), its plan gate (a write to a source path needs the branch's answered spec and a plan, or
the owner's hotfix marker), its prompt hints and its session invariants. A rule that throws asks; tables that fail to
load deny every tool call.
