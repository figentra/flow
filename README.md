# Figentra Flow

Figentra Flow (`figentra-flow`, alias `fflow`) is the spec CLI for Stackra repositories: it owns spec-driven
development end to end (ADR 0510), from `/flow-specify` to the landed change. The package, its commands and its
configuration are documented in [`packages/figentra-flow/README.md`](packages/figentra-flow/README.md).

```sh
pnpm add -D @figentra-oss/flow             # from the Figentra registry: @figentra-oss:registry in .npmrc
pnpm exec figentra-flow init               # .flow/ and the flow-* skills
```

## Develop

`pnpm install`, then `pnpm verify` (format, lint, typecheck, test, build). Release notes go in `.changeset/`. See
[AGENTS.md](AGENTS.md).

MIT licence.
