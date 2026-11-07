---
description: Run the gate across testbed boxes, one package shard per free slot, and post one fflow/gate status.
---

## Stackra: where the tests run

GitHub CI runs no tests (the owner, 2026-11-03): they run only on the testbed, through this gate, which posts
`fflow/gate`, the one required check. Nothing here runs a check on this machine.

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Outline

1. **Ready**: the head is committed and pushed (`fflow gate run` refuses a dirty tree or an unpushed head).
2. **Slots**: run `testbed status --json`. Add up `heavy.free` and `light.free` over the regions with
   `"reachable": true`: that is N, the shards to run, at least 1 and at most 12. A call over the cap waits inside
   `run`, so N is the fan-out, not a limit on correctness.
3. **Fan out**: run `fflow gate run --shards <N>` in the worktree. It deals the workspace's packages into N shards,
   makes one `testbed run "<session> <what>" <dir> "<cmd>" --json` call per shard, all at once, and posts one
   `fflow/gate` status: green only when every shard exited 0. The testbed picks the region, the box and the slot
   (heavy for encore test, Playwright, e2e, act and builds; light otherwise); never name them. The shard's check is
   `gate.shard` in `flow.config.json`, with `{filters}` for its packages; without it run `fflow gate run` (one job).
4. **Read the result**: each shard prints `shard i/N [packages]: exit <code> on <region> <box> (<slot>, waited …,
   ran …)`, and the job's own output streams to stderr unchanged.
   - Every shard 0: the status is green.
   - A job's own non-zero code: red. Report the shard's packages and the failing lines.
   - 124: the 3-hour limit; red. Run with more shards, or make the check faster.
   - 73 (no free slot) or 75 (no healthy box), still after the gate's one retry: an infrastructure failure, never a
     test failure, so nothing is posted, unless another shard failed (then the status is red). Wait, then start
     again at step 2; if 75 persists, report `testbed status`.
   - 2: the testbed refused the call (usage); report it.
5. **Ordering**: the testbed keeps no queue across calls, so the gate owns the order: one `gate run` per head at a
   time; a new push needs a new gate.
6. **Report**: the head, N, each shard's line and the status posted.

## Rules

- Never post `fflow/gate` yourself and never call the poster: only `fflow gate run` posts it.
- With `secrets.oidc` in `flow.config.json`, `fflow gate run` posts nothing either: `fflow/gate` and its report
  come only from the `verdict` job of main's `fflow-approve.yml` (GitHub OIDC, the Figentra Flow App), never under
  a user's login or token. It refuses (exit 2) unless the runner is `github-actions` with that job rendered, and
  with `--box`; report the refusal to the owner, never work around it.
- Never run the check set on this machine to stand in for the gate.
