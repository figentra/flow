---
"@figentra-oss/flow": patch
---

A product's first update no longer changes what it did not ask for:

- `.claude/settings.json` (permissions and the guard's per-call hooks) and `lefthook.yml` are opt-in, under the
  config's new `surfaces.settings` and `surfaces.lefthook`. Unset, a repository keeps only what its lock already
  records, so core and the template keep theirs and a product gets neither.
- `sync` and `update` refuse to replace an `AGENTS.md` or `README.md` the repository wrote, one its lock does not list.
  Move what it says into `agentsMd.facts`, delete it, and sync again.
- The vendored `.agents/reference/**` Markdown opens with `cspell:disable`, and its body sits in a Prettier ignore
  range, so a product's format and spell checks pass on text the lock pins.
- The releaser, secret-manager and vault-keeper agents lose OpenCode permission blocks that only `allow`ed. They never
  render for OpenCode, and validate refuses an agent `allow`.
- The compiler-engineer, frontend-builder and service-builder agents no longer name `packages/developer`,
  `apps/console` or `services/example`.
