# 0001 — Session names

**Status**: Proposed (part of spec STA-1945 amendment A-1; accepted when the owner approves A-1) · 2026-11-03

**Decider**: the owner, 2026-11-03 (relayed by the leader session); source `stackra/notes/handover/session-naming.md`

## Context

Many agent sessions work at once, across repositories and tracks. The owner switches between them by their titles, so a
title has to say, at a glance, which work it is, whether it is the current focus, and whether it is paused or finished.
Before this decision, titles were free text, often naming the job a session started with rather than the one it is
doing now. Figentra Flow owns how work moves (spec STA-1945, amendment A-1), so it owns this convention and reads it.

## Decision

1. **Pattern.** A session's title is `<state-or-TRACK> · <job> (<key>)`:

   | State                      | Form                  | Example                                                 |
   | -------------------------- | --------------------- | ------------------------------------------------------- |
   | Active or the focus        | the track in capitals | `FLOW · Flow to 100% and the console engine (STA-1966)` |
   | On hold                    | `hold · Track · job`  | `hold · Runway · completion plan (finishing 6d)`        |
   | Finished, ready to archive | `done · Track · job`  | `done · Rollout · every product to dev`                 |

2. **Tracks.** `LEADER`, `FLOW`, `TESTBED`, `GEN`, `BRAND`, `RUNWAY`, `DOCS`, `UI`, `OS`, `ENGINE`, `CLOUDFLARE`,
   `LANDING`. A new track is added here only when work fits none of them.
3. **Job text** says what the session is doing now, in under about 60 characters, with the Linear key or main PR when
   there is one.
4. **Who renames.** The leader renames a session when its job, state or focus changes (a hold becomes `hold · …`, a
   resume returns to the capital track). A terminal session is renamed by the owner with `/rename <title>`, since no
   session can rename a terminal. A new session gets its title in this pattern when it starts.
5. **Flow reads it.** Flow's record (spec FR-14) stores each session's title; `fflow status` shows live sessions by
   title, state, worktree and stage, and warns when a title breaks the pattern or disagrees with the record's state
   (spec FR-20).

## Consequences

- A paused or finished session is visible as such without opening it, and `fflow status` can flag a stale title.
- Tracks are a closed list; adding one is a change to this record.
- Enforcement: `fflow status` warns (FR-20); nothing refuses a title, since titles are set by people and the leader.
