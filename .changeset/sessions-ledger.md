---
"@figentra-oss/flow": minor
---

Live sessions, the owner's to-do and the ledger (STA-1945 FR-20, FR-21). `fflow status` (and `--web`) now lists each
running Claude Code or OpenCode session working in a repository or one of its worktrees, by its title (Claude Code's
`sessions/<pid>.json`; an OpenCode session carries the note `title not readable for opencode`), state (`TRACK · …`,
`hold · …`, `done · …`), worktree and stage (the worktree's record), and warns (exit 1) when a title breaks Flow ADR
0001's pattern or disagrees with the record; with no process listing it shows the records' last sessions with a note.
New `fflow todo [--repo <path>] [--json]` lists every open owner ask in the records across the workspace, each with the
command or link that clears it. New `fflow ledger [--since <YYYY-MM-DD>] [--repo <path>] [--json]` lists what landed,
released and shipped, by day and track, from the records' new optional `history` (`{ stage, state, at }[]`), which
every record update now appends to when the stage or state changes. Both read each key's newest record from the
checkouts, the local and origin branches and the default branch, and list an unreadable record or a missing repository
as a problem (exit 1).
