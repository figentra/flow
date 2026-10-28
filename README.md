# Vellum — Specification Lifecycle Enforcement

**Vellum** keeps a specification's requirements, design and tasks honest while AI assistants
help implement them: an approval counts only when a human's signing key made it, task
completion is recorded from a command Vellum ran itself, and the record of both is a
hash-chained ledger in git beside the spec.

The monorepo is pre-release. Nothing is published to npm yet (`@figentra/vellum` is
`private`), and several capabilities the specs describe are not built. This README lists what
works today; any other command exits 2 with `not implemented`.

## What works

- **Signed approvals.** `vellum approve` writes an Approval Record bound to the artifact's
  current checksum. It counts only once the commit that adds it to the ledger changes nothing
  but the ledger and is signed by a key the Approval Policy (`.sdlc/policy.json`) lists for the
  approver. SSH and GPG signatures are verified against the policy's own public keys, not the
  host's keyring. Editing the artifact afterwards voids the approval.
- **Evidence Vellum records itself.** `vellum task complete <spec> <task> --command=<cmd>` runs
  the command, records its real exit status, timestamps, duration, HEAD commit and an output
  digest (never the output), and marks the task `[x]` only on exit 0 at a clean HEAD.
- **A tamper-evident ledger.** `.sdlc/ledger.jsonl` is hash-chained (ids from 1, each entry
  carrying the SHA-256 of its predecessor's canonical JSON); `.sdlc/ledger.head.json` records
  the last entry, so truncating the tail or editing the last entry is detected too.
- **Strict verification.** `vellum verify` fails on a broken ledger; an approval that is
  unsigned, signed by a key the policy does not list for the approver, or bound to changed
  text; an uncovered criterion; an uncited property; or a required task without passing
  evidence.
- **A read-only MCP server.** `vellum-mcp` serves `vellum_status`, `vellum_lint`,
  `vellum_verify` and `vellum_check` (the documents the CLI's `--json` output holds), `vellum_trace` and
  `vellum_get_artifact` over stdio. It refuses approvals and task completion by name; those
  stay with the CLI.

- **Managed specs from plain Markdown.** The method's skills write each document as bare
  Markdown; `vellum adopt <spec>` adds the Lifecycle Frontmatter (bodies unchanged, no
  approval) and the first ledger entry, and `vellum stamp <spec>` records the next version and
  checksum after every edit. A stamp never makes an approval of earlier text count.

Not implemented: `vellum sync` (projection) and the doctor categories reported as
`NOT_CHECKED`. See the [CLI reference](docs/cli/README.md).

## Architecture

```
@figentra/vellum        # The bundle to be published: bins vellum and vellum-mcp, no runtime deps
├── @vellum/cli         # Command-line interface
├── @vellum/mcp         # MCP server for AI assistants
├── @vellum/engine      # Pure logic engine (no I/O)
├── @vellum/protocol    # Type definitions, schemas, canonical hashing
├── @vellum/storage     # File system, git, ledger and signature adapters
└── @vellum/renderers   # Output formatters
```

Principles: one version for the bundle; the engine is pure (it imports only
`@vellum/protocol`); deterministic output; git is the database.

## Documentation

- [Getting started](docs/guides/getting-started.md) — the approve, start, complete, verify loop
- [CLI reference](docs/cli/README.md)
- [Architecture overview](docs/architecture.md)
- [Troubleshooting](docs/troubleshooting.md)

## Installing

`@figentra/vellum` is published to Figentra's private npm registry, `https://npm.figentra.com/`
(npflared), never to the public npm registry. Route the scope there and authenticate in your
user-level `~/.npmrc`:

```ini
@figentra:registry=https://npm.figentra.com/
//npm.figentra.com/:_authToken=${NPFLARED_AUTH_TOKEN}
```

The file names the variable, never the token; npm expands it from the environment. Keep the
token in your secret vault and inject it into the environment (for example
`infisical run --path=/agents -- <command>`); never write the value into a file.

```bash
npm install --save-dev @figentra/vellum
npx vellum doctor
```

The package has no runtime dependencies and needs Node.js 22 or later. It provides two bins:
`vellum` (the CLI) and `vellum-mcp` (the read-only MCP server the assistant plugins start).

Releases: the owner or an agent pushes a `vX.Y.Z` tag, and `.github/workflows/release.yml` runs the full
gate, waits for the owner's one approval of the GitHub `release` Environment, and publishes that version,
taking the registry token from Infisical over GitHub OIDC.

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
pnpm typecheck
```

## Requirements

- Node.js >= 22.0.0
- Git >= 2.34 (to verify SSH-signed commits); `ssh-keygen` for SSH keys, `gpg` for GPG keys

## License

MIT
