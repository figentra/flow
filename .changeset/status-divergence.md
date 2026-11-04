---
"@figentra-oss/flow": minor
---

`fflow status --divergence` reports how far each repository of the workspace list (or `--repo <path>`) has moved from
its preset (STA-1945 FR-9, AC-11): the Flow version, the preset (name, version, digest) and the profile its
`.flow/lock.json` records, the preset lag (the locked version against the installed one), the overrides by kind with
each `replace` and `disable`'s owner and review date and those past it, and the drift `fflow check` finds against the
lock. A repository without a lock is "not synced", never skipped. It is read-only and makes no GitHub call; `--json`
writes `{ repos: [...] }`, and the exit code is 1 when a repository drifts or holds an override past its review date.
It refuses `--metrics`, `--web` and `--by`. The report is `divergence(root, options)` in `src/lib/divergence.mjs`.
