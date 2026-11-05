---
"@figentra-oss/flow": patch
---

The stackra preset's agents, skills and task-vocabulary rule now run one member's tests with
`pnpm turbo run test --filter=<name>` (and `typecheck`/`build` the same way), since turbo runs `stackra gen` first and
a bare `pnpm --filter <name> test` skips it, leaving vitest without `.stackra/vitest.config`. The rule also says a pull
request's `Needs testing:` line names that command. The OpenCode surface allows `pnpm turbo run *`, which its
`pnpm *` deny otherwise blocked. Run `fflow sync` after upgrading.
