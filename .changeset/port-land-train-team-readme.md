---
"@figentra-oss/flow": patch
---

`readme`, `team check`, `land` and the `train` steps (`open`, `add`, `close`, `build`, `eject`, `depart`, `status`)
are declared commands on the console engine instead of passthrough (STA-1945 SC-2), so their `--help` lists every
option and positional. Each still runs its own `run`, with the same flags: `readme --check`; `team check --tracker`;
`land [<pr>] --stack --dry-run --manual-ok --wait <minutes> --no-wait`; `train open [<version>]`, `train add <pr>`,
`train eject <pr>` and `--dry-run` on every step. `readme` and `team check` still refuse outside a git repository.
The engine now refuses an unknown flag or a surplus argument (exit 2) where the old parsers ignored it, and bare
`fflow train` or `fflow team` is an unknown command (exit 2) (bare `train` printed its usage and exited 0).
