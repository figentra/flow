---
"@figentra-oss/flow": minor
---

Close the gaps a repository could not close through its own configuration (STA-2131). `claudeCode` in
`flow.config.json` carries Claude Code `enabledPlugins` and `extraKnownMarketplaces` into `.claude/settings.json`,
and nothing else: the hooks, permissions and environment stay Flow's. A marketplace must be a remote source (`github`,
`git` or `url`), because an enabled plugin brings its own hooks. `session.contextCommands` appends the output of
the repository's own commands to the SessionStart context (no shell, 4 seconds each, capped, failures silent).
`agentsMd.land` replaces the landing line of AGENTS.md's "How work flows". The Stop and SessionEnd hooks exit 0
silently on a checkout with no install. The stackra preset's OpenCode guard plugin fails closed: a missing bundle, a
timeout, a kill, a non-zero exit or no answer denies, naming why, and the guard bundle answers an unattended caller
(`FFLOW_GUARD_UNATTENDED=1`) with an explicit allow. A grep or glob from OpenCode now carries its searched folder and a
grep its `include` filter, so the secret-path rules apply to it as on Claude Code.
