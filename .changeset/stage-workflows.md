---
"@figentra-oss/flow": minor
---

Stage workflows (STA-1945 FR-15). Three stages now run a Claude workflow that the stage command hands its input and
whose output it validates and records in Flow's record.

- **Plan.** `/flow-plan` also splits the approved spec into PR-sized tasks and writes tasks.md; `/flow-tasks` is gone,
  and `sync` removes its rendered skill and command when they are unedited. `fflow plan <key> --input` prints the FRs
  and ACs to cover, the documents to read and the size budget (the most files a task may name: the preset's
  `plan.maxFilesPerTask`, default 10). `fflow plan <key> --record <tasks.md>` writes tasks.md into the spec folder
  only when `gate tasks` passes, every FR and AC is covered and each task holds its budget, and records the plan
  stage; otherwise it names each problem and writes nothing. A draft, an unapproved feature or big spec, or a small
  spec (its tasks stay in spec.md) is refused.
- **Review.** New `/flow-review`: four parallel reviewers (correctness, simplicity, security and tenancy, contracts),
  then one verifier per finding. `fflow review <pr> --input` prints what they read;
  `fflow review <pr> --record <findings.json>` refuses output that is not a list of findings, else records the
  verdict and the confirmed blocking findings. `fflow land` refuses a PR whose newest recorded review has a
  confirmed blocking finding, and names it.
- **Gate.** New `/flow-gate`, and `fflow gate run --shards <n>` (a `command` runner, such as the testbed): the
  workspace's packages (`pnpm-workspace.yaml`) are dealt into at most n shards (up to 12), one
  `stackra testbed run … --json` call per shard runs all at once with `gate.shard`'s `{filters}`, and one
  `fflow/gate` status is posted, green only when every shard exited 0. A shard that finds no free slot or healthy box
  (73, 75) is tried once more; if it still fails, nothing is posted, since that is never a test failure. New
  configuration key `gate.shard`: the shard's check command, with `{filters}` for its `--filter=./<package>` flags.

The record's `review` entries gain `pr` and `blocking`.
