---
description: Turn tasks.md into Linear sub-issues of the spec's issue (team STA), never GitHub issues.
strategy: replace
---


<!-- Source: stackra -->
## User Input

```text
$ARGUMENTS
```

## Stackra: tasks to Linear issues

Stackra tracks all work in Linear team `STA` (ADR 0065, ADR 0121). This command never creates GitHub issues and
never calls a GitHub issue tool.

1. Run `pnpm spec:gate dir` (add `--key STA-n` when the branch carries no key). It prints the spec
   folder `.agents/specs/sta-<n>-<slug>/`. If it fails, STOP and report it.
2. The spec's `spec.md` must carry a real `**Linear**: STA-n` key. If it does not, STOP and tell the user to run
   `pnpm spec:linear issue <spec.md>` first.
3. Preview: `pnpm spec:linear tasks <folder>/tasks.md --dry-run`. Show the user the list.
4. Create: `pnpm spec:linear tasks <folder>/tasks.md`. Each `T###` line without a key becomes a sub-issue of the
   spec's issue, labelled `agent`, in the spec's `**Linear project**` when one is set; the script appends
   ` [STA-m]` to the line. Lines that already carry a key are skipped, so a re-run is safe.
5. Report the `T### -> STA-m` lines it printed. If Linear fails, report the error and stop; a Linear failure never
   blocks a gate (ADR 0065 rule 7), and the task lines can be linked on a later run.

The token comes from Infisical through `pnpm spec:linear` only. Never print it.