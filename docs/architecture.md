# Architecture Overview

Vellum implements a layered architecture with strict dependency boundaries enforced by Turborepo.

## Dependency Graph

Arrows point from a package to what it may depend on (`turbo.json` boundaries):

```
@figentra/vellum  ->  @vellum/cli, @vellum/mcp
@vellum/cli       ->  protocol, engine, storage, renderers
@vellum/mcp       ->  protocol, engine, storage, renderers
@vellum/storage   ->  protocol, engine
@vellum/renderers ->  protocol, engine
@vellum/engine    ->  protocol            (pure: no I/O)
@vellum/protocol  ->  (nothing)           (types, schemas, canonical hashing)
```

## Package Boundaries

### @vellum/protocol

**Purpose**: Core types, schemas, and constants.

**Contains**:

- Branded types (SpecId, ArtifactPath, Checksum, etc.)
- Lifecycle state definitions
- Artifact schemas (frontmatter validation)
- Ledger entry types
- Diagnostic and finding types
- JSON Schema definitions

**Dependencies**: None (except tooling)

**Rules**:

- Zero runtime I/O
- Pure TypeScript types and Zod schemas
- All schemas exported for JSON Schema generation

### @vellum/engine

**Purpose**: Pure business logic engine.

**Contains**:

- State machine implementation
- Protocol validator
- Approval verifier
- Ledger integrity checker
- Coverage validation
- Evidence validation
- Per-task briefing (`buildTaskContext`)

**Dependencies**: @vellum/protocol

**Rules**:

- **Zero I/O** - no file system, network, or process operations
- Pure functions: `(input) => Result<output, Error>`
- All logic is testable without mocking
- Deterministic output

### @vellum/storage

**Purpose**: I/O adapters for filesystem and git.

**Contains**:

- File system operations (atomic writes)
- Git operations (log, show, verify)
- Spec directory scanner
- Artifact reader/writer
- Ledger persistence
- Cache adapter

**Dependencies**: @vellum/protocol, @vellum/engine

**Rules**:

- All I/O is isolated to this package
- Implements interfaces from engine
- Handles errors gracefully
- Atomic operations where possible

### @vellum/renderers

**Purpose**: The assistant dialects the plugins render (Claude Code, OpenCode, Kiro). The JSON,
Markdown and console formatters and the old context bundle were removed: nothing called them
(see `docs/removed-code.md`). Per ADR 0286 d6 this layer moves to `@stackra/renderers`.

**Contains**:

- Assistant projection renderer

**Dependencies**: @vellum/protocol, @vellum/engine

**Rules**:

- Pure functions
- Deterministic output (same input → same bytes)
- Multiple output formats from same data

### @vellum/cli

**Purpose**: Command-line interface.

**Contains**:

- Command router
- Individual command implementations
- Argument parsing
- Help generation

**Dependencies**: @vellum/protocol, @vellum/engine, @vellum/storage, @vellum/renderers

**Commands** (see [CLI reference](cli/README.md)):

- `vellum lint` - Validate spec artifacts
- `vellum status` - Show spec state (the Effective state is not computed yet)
- `vellum verify` - Strict verification
- `vellum approve` - Write an approval record for the approver's signed commit (human-only)
- `vellum doctor` - Diagnose environment
- `vellum task start` - Pre-execution check; record task binding
- `vellum task complete` - Run the verification command; record evidence
- `vellum check` - Check Mode for CI; writes nothing
- `vellum adopt` - Bring a legacy spec under management (frontmatter + adoption entry)
- `vellum stamp` - Re-stamp frontmatter after an artifact is written or edited
- `vellum sync` - not implemented; exit 2

### @vellum/mcp

**Purpose**: read-only MCP server for AI assistants, on stdio (bin `vellum-mcp`).

**Contains**:

- A JSON-RPC 2.0 / MCP stdio layer written with Node builtins (no MCP SDK)
- Tool definitions; each runs the same `@vellum/storage` query as the CLI

**Dependencies**: `@vellum/storage` (queries), `@vellum/protocol`

**Tools** (all read-only; each returns what the CLI's `--json` output holds for equal inputs):

- `vellum_status` - `vellum status --json`
- `vellum_lint` - `vellum lint --json`
- `vellum_verify` - `vellum verify --json`
- `vellum_check` - `vellum check --json`
- `vellum_trace` - a spec's most recent ledger entries
- `vellum_context` - `vellum context <spec> <task> --json`, one task's briefing
- `vellum_get_artifact` - one spec artifact by repository-relative path (paths leaving the root are refused)

Approve, task start/complete and evidence recording are refused by name: they are CLI-only.

### @figentra/vellum

**Purpose**: The ONE published package.

**Contains**:

- Re-exports from CLI and MCP packages
- `vellum` bin (the CLI) and `vellum-mcp` bin (the MCP server)
- Every `@vellum/*` package bundled into `dist/` by tsup, with source maps

**Dependencies**: none at runtime. `@vellum/cli` and `@vellum/mcp` are devDependencies, bundled at build.

**Checked** by `packages/vellum/tests/`: no `dependencies`, no `@vellum/` import left in the
bundle, only Node builtins imported, and a packed tarball that installs with `npm install
--offline` and runs both bins. Still `private: true`: publishing is a human decision.

**Not yet**: a single version number (the package is 0.0.0; the CLI and MCP server report 0.1.0).

Its `vellum` bin does not invoke the CLI yet.

## Specification Lifecycle

States flow through this progression:

```
DRAFT → IN_REVIEW → REQUIREMENTS_APPROVED
  ↓
DESIGN_IN_REVIEW → DESIGN_APPROVED
  ↓
PLAN_IN_REVIEW → PLAN_APPROVED
  ↓
IN_PROGRESS → VERIFICATION → VERIFIED → MERGED
  ↓
RELEASED → DONE

Terminal states:
- BLOCKED, REJECTED, SUPERSEDED, ABANDONED, INVALID
```

Each transition has preconditions:

- Required approvals
- Artifact checksums match
- References resolve
- Ledger integrity

## Ledger System

The ledger (`.sdlc/ledger.jsonl`) is an append-only log in the protocol's format:

```
Entry 1: ApprovalRecord   (predecessor_digest = null)
Entry 2: TaskBinding      (predecessor_digest = SHA-256 of Entry 1's canonical JSON)
Entry 3: EvidenceEntry    (predecessor_digest = SHA-256 of Entry 2's canonical JSON)
...
```

`computeLedgerEntryDigest` in `@vellum/protocol` is the one hashing function; storage's writer
and the engine's `checkLedgerIntegrity` both use it. `.sdlc/ledger.head.json` records the last
entry's id and digest.

**Detected**: an edited entry, a removed or reordered entry, a fork (duplicate predecessor),
and — through the head — a truncated tail or an edited last entry. Truncating the ledger and
rewriting the head in one change is visible only in git history.

## Approval System

An Approval Record counts when the commit that added it to the ledger:

1. changes only the spec's ledger files,
2. carries a signature that verifies against a public key the Approval Policy lists for the
   approving identity (not merely a key the verifying host trusts),
3. is not marked as an assistant session,

and the record names an approver the policy authorises for the artifact at the spec's risk
class, bound to the artifact's current checksum.

Invalidations cascade:

- Requirements invalidation → design + plan invalidations
- Design invalidation → plan invalidation
- Plan invalidation → standalone

## Testing Strategy

1. **Unit Tests**: Vitest in each package
2. **Property Tests**: fast-check (engine, protocol)
3. **Integration Tests**: `packages/cli` runs the CLI against a temporary git repository per
   test, with throwaway signing keys
4. **End-to-end Tests**: `packages/e2e` packs `@figentra/vellum`, installs the tarball offline and
   drives the installed `vellum` and `vellum-mcp` through the spec lifecycle in temp git
   repositories (see `packages/e2e/README.md`)
5. **Conformance fixtures**: negative/near-miss fixtures under `conformance/`; no test reads them
   yet
6. **Mutation Testing**: none. Stryker was listed as a dev dependency with no configuration, no
   threshold and no CI job, and was removed
7. **Coverage**: not collected in CI; no threshold is enforced

## CI/CD Pipeline

`.github/workflows/ci.yml`, on pushes and pull requests to `main`, with read-only permissions and
no secrets:

```
verify (Node 22 and 24): pnpm install --frozen-lockfile
                         pnpm turbo run build typecheck lint test
                           (lint runs scripts/check-boundaries.mjs;
                            test includes the bundle size budget and the e2e suite)
audit:                   pnpm audit --audit-level=moderate (the whole tree, dev tooling included)
```

`.github/workflows/release.yml` publishes on a human-pushed `vX.Y.Z` tag, after the same
build/typecheck/lint/test gate.

## Security Model

1. **Human-Only Approvals**: an approval counts only with a signature by the approver's policy
   key; an assistant without that key cannot produce one
2. **Signature Verification**: against the policy's public keys only
3. **Checksum Binding**: approvals bound to the artifact's canonical text
4. **Tamper Detection**: the ledger chain and head make edits, removals, reorders and forks
   detectable; git history is the final record
5. **CI**: these guarantees hold where `vellum verify` runs in CI on the full history

## Performance Characteristics

- **Deterministic**: Same input → same output (byte-identical)
- **Offline**: Zero network calls after installation
- **Fast**: Pure functions, no reflection, minimal allocations
- **Scalable**: O(n) for n artifacts, entries, or findings

## Extension Points

1. **Renderers**: Add new output formats
2. **Storage Adapters**: Implement for different backends
3. **CLI Plugins**: Add new commands
4. **MCP Tools**: Add new AI-facing capabilities

## Boundaries Enforcement

Turborepo enforces:

```json
{
  "protocol": { "allow": ["tooling"] },
  "engine": { "allow": ["protocol", "tooling"] },
  "storage": { "allow": ["protocol", "engine", "tooling"] },
  "cli": { "allow": ["protocol", "engine", "storage", "renderers", "tooling"] },
  "mcp": { "allow": ["protocol", "engine", "storage", "renderers", "tooling"] }
}
```

No circular dependencies. No backdoors. Enforced at build time.
