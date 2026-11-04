---
name: test-infra
description: Run heavy work on the shared testbed instead of the Mac - stackra testbed run, status and unlock, what "every box busy" and each refusal mean, the fallback for a pushed ref, and what an agent must never do to a box. Use whenever a task needs an install, build, gen, typecheck, test, e2e or integration run, or a box looks stuck, full or unhealthy.
---

# The testbed

The Mac runs only oxfmt and oxlint. Everything else runs on the testbed: install, build, gen, typecheck, unit tests,
the playground e2e and the integration tests. The job image has Playwright's Chromium, Firefox and WebKit, `xvfb-run`
for a desktop (Electron) test that needs a display, and ffmpeg. iOS simulators and Android emulators stay on the Mac.
The design is ADR 0484 and the runbook is `apps/docs/src/docs/runbooks/test-infrastructure.mdx`. While the migration
runs, `ci-box` is a shim with the same verbs.

## Run a job

```bash
stackra testbed run "<session> <what>" <project-dir> "<command>"
```

- Name the session and what runs (`"commerce-frontend typecheck"`). `status` shows that string as the holder.
- `<project-dir>` is your worktree. Only the diff is uploaded.
- The command runs in a fresh container with a clean workspace. Nothing you leave there survives the job.
- Heavy jobs (`encore test`, `playwright`, `e2e`, `act `, `build`) take the heavy slot. Everything else takes the
  light slot. A light job may land on a spot box. If that box is taken back, the job is retried once on another box.
- The exit code is the command's own: 0 is green, anything else is a real failure. Read the output.
- The testbed spans several regions. The CLI tries its enabled regions in order and starts a box where there is room,
  so you never pick a region or a box. `--regions a,b` or `STACKRA_TESTBED_REGIONS` overrides the list only for a
  deliberate test of one region.
- A tool that runs jobs (`fflow gate`) adds `--json`. The job's output then goes to stderr, and stdout gets one line:
  `{"region","box","slot","waitSeconds","runSeconds","exitCode"}`. `stackra testbed status --json` gives each region's
  free and startable slots.

## Exit codes and messages

| You see                                   | Means                                    | Do                                                         |
| ----------------------------------------- | ---------------------------------------- | ---------------------------------------------------------- |
| `every box busy, waiting`                 | every slot of that kind is taken          | wait. The command adds a box after 2 minutes. Never start a second copy |
| exit 2, "must not call ci-box"            | your command calls the testbed itself     | run the inner command directly                             |
| `unhealthy: disk` (the CLI moves on)      | that box is draining                      | nothing. The CLI picks another box                         |
| exit 73 (with `--no-wait`)                | no free slot right now                    | retry later, or run without `--no-wait` to wait            |
| exit 75                                   | no healthy box could be reached           | wait and retry; if it persists, tell the leader            |
| exit 124                                  | the job hit its 3-hour timeout            | split the job, or find the hang                            |
| "no healthy box"                          | the whole testbed is down                 | a pushed ref: use the fallback below. Otherwise wait and tell the leader |

## Look and unstick

```bash
stackra testbed status
stackra testbed unlock --box N --slot heavy
```

Only unlock a job you own, or one that `status` shows has held its slot for hours with no output. Unlocking stops its
container and the containers it started.

## Fallback

If no box is healthy and your work is on a pushed ref:

```bash
stackra testbed run --preset verify --ref <ref>
```

The presets are `verify`, `e2e` and `integration`. They run on a GitHub-hosted runner. Arbitrary commands and
unpushed worktrees have no fallback, and nothing ever falls back to the Mac.

## Never

- Never install, patch or reconfigure anything on a box. Boxes are replaced, not repaired. A missing tool belongs in
  the image (`packages/infrastructure/infra-testbed`).
- Never free disk by hand. The guard cleans at 70% and drains the box at 85%.
- Never copy a token to a box, and never use `put-env`: it is retired. Jobs get tokens from Infisical. A missing token
  is the owner's to add.
- Never `pulumi up`, mark a box unhealthy, start an instance refresh or change a group's size beyond
  `stackra testbed scale`: those need the owner.
