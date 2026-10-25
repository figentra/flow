# CLI Reference

`vellum <command> [arguments] [options]`. `vellum --help` prints the same list.

Exit status: **0** PASS or done, **1** FAIL or refused, **2** INCONCLUSIVE (nothing to examine,
an input that could not be read), a usage error, or a command that is not implemented. An
option a command does not declare is a usage error, never ignored.

Every command runs inside a git work tree and reads specs from `.agents/specs/<NNN>-<slug>/`.
A spec is _managed_ when it has a `.sdlc/` machine folder or artifacts with Lifecycle
Frontmatter; otherwise it is _legacy_: listed, not validated.

## Files Vellum reads and writes

| Path                                              | Written by  | Contents                                                                                      |
| ------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------- |
| `.sdlc/policy.json` (repository root)             | a human     | The Approval Policy: approvers, their signing keys, required counts per risk class            |
| `<spec>/requirements.md`, `design.md`, `tasks.md` | authors     | Lifecycle Frontmatter (`version`, `checksum`, `state`, `createdAt`, `updatedAt`) and the body |
| `<spec>/.sdlc/ledger.jsonl`                       | Vellum only | Hash-chained ledger entries                                                                   |
| `<spec>/.sdlc/ledger.head.json`                   | Vellum only | The last entry's id and digest                                                                |

The Artifact Checksum is the SHA-256 of the body's canonical form: frontmatter, line endings,
trailing whitespace, table padding and Task Markers do not change it; any word does.

### Approval Policy

```json
{
  "schema_version": "1.0",
  "repository": "my-repo",
  "approval": {
    "schema_version": "1.0",
    "approvers": [
      {
        "email": "alice@example.com",
        "authorised_for": ["standard"],
        "keys": [
          {
            "type": "ssh",
            "fingerprint": "SHA256:…",
            "public_key": "ssh-ed25519 AAAA… alice"
          }
        ]
      }
    ],
    "requirements": { "standard": { "count": 1 } },
    "spec_risk_classes": { "016-payments": "high" }
  }
}
```

Every key needs its `public_key` (an OpenSSH public key line, or an ASCII-armored GPG key);
an SSH key's `fingerprint` must be the one `ssh-keygen -lf` prints for that key, or the policy
is refused. A spec not listed in `spec_risk_classes` is `standard`.

On a merge request, approvals are judged by the target branch's policy, not the one in the
working tree (criterion 7.10), so a change cannot add the key that approves it, raise an
approver's rights or lower its spec's risk class. The target branch comes from
`VELLUM_TARGET_BRANCH`, else `GITHUB_BASE_REF` (GitHub Actions), else
`CI_MERGE_REQUEST_TARGET_BRANCH_NAME` (GitLab CI), and is read as `origin/<name>`, else
`<name>`. A target branch that is not in the clone makes every command that reads the policy
INCONCLUSIVE; one with no policy file counts no approval. So the policy itself, and every
change to it, lands through a merge reviewed under the policy already on the target branch.

## Commands

### `vellum status [spec] [--json]`

Per spec: the Recorded Lifecycle State (from `requirements.md`), each artifact's version and
whether its frontmatter checksum is current, valid approvals against the policy, required tasks
with passing evidence and failed attempts, ledger integrity, and the Effective Lifecycle State
with the precondition that stopped it short of the recorded state. A legacy spec (documents
without frontmatter) is reported with `legacy: true` and `next`, the `vellum adopt` command
that brings it under management (or `adoptionProblem`, why it cannot be adopted yet); an
adopted spec with a document lacking frontmatter is INCONCLUSIVE with `next` naming
`vellum stamp`. Exit 0; 2 when a spec cannot be read or the fragment matches no spec or
several.

### `vellum lint [spec] [--type=requirements|design|tasks] [--json]`

The Protocol Validator: the spec folder holds only the three artifacts and `.sdlc/`; each
artifact's frontmatter parses and its checksum matches its body; task markers are one of
`[ ]`, `[~]`, `[-]`, `[x]`; a task's `<!-- criteria: … -->` references exist in
`requirements.md`; and, without `--type`, every ledger entry passes its schema and the chain
and head are intact. Output ends with what was examined. Exit 1 on any finding; 2 when no
managed artifact was examined.

Not checked yet: the Markdown Protocol rules of criteria 11.2, 11.5 and 11.6.

### `vellum verify [spec] [--strict] [--json]`

The Strict Verifier. `--strict` is accepted; there is no lenient mode. Per spec:

- the ledger chain and the Ledger Head;
- each approval: the commit that added its ledger line must change only the spec's ledger
  files and carry a signature that verifies against a key the policy lists for the approving
  identity, from a human session, and the approval must bind the artifact's current checksum;
- every criterion is covered by a task and every property is cited by one;
- every required (non-optional) task has an Evidence Entry with exit status 0 at HEAD or an
  ancestor of it.

Without a spec argument it verifies each managed spec whose Recorded state is `IN_PROGRESS` or
later. Exit 0 PASS, 1 FAIL, 2 INCONCLUSIVE (nothing to verify, or an unreadable input or
invalid policy).

### `vellum doctor [--json]`

Evaluates Node.js (>= 22), git (>= 2.34), the repository, the Approval Policy and the signing
tools its keys need, each managed spec's ledger integrity, and untracked documents under
`.agents/specs/`. Reports _Assistant plugin version_, _Repository hooks_, _Stale markers_,
_ADR supersession_ and _Disposable cache_ as `NOT_CHECKED` — not implemented, never PASS.
Exit 1 when an evaluated diagnostic fails.

### `vellum approve <spec> <requirements|design|tasks> [--reject --rationale=<text>]`

Writes an Approval Record (or a Rejection Record) for the artifact's current version and
checksum under `git config user.email`. It refuses outside an interactive terminal, in CI, in
a detected assistant session, without a policy, for an identity the policy does not authorise
or lists no key for, and on a damaged ledger.

The record is **not valid when the command finishes**. It becomes valid when the approver
commits it — a commit changing only `.sdlc/ledger.jsonl` and `.sdlc/ledger.head.json`, signed
with their policy key:

```bash
git add .agents/specs/016-x/.sdlc/ledger.jsonl .agents/specs/016-x/.sdlc/ledger.head.json
git commit -S -m "approve: 016-x requirements" -- .agents/specs/016-x/.sdlc/
```

The terminal and assistant checks are a courtesy. The guarantee is `vellum verify`'s signature
check, which nobody without the approver's signing key can satisfy.

### `vellum task start <spec> <task-id>`

The pre-execution check: the three artifacts exist and hold the approvals the policy requires,
bound to their current checksums, and the task's criterion and property references resolve.
On success it appends a Task Binding to the ledger and sets the task's marker to `[-]`; on
failure it writes nothing. Exit 0 started, 1 refused. When the content supports it, it also
records `IN_PROGRESS` as the spec's state (only the `state:` frontmatter line changes, so no
approval does).

### `vellum task complete <spec> <task-id> --command=<cmd> [--timeout=<seconds>]`

Requires a Task Binding for the task whose checksums still match the artifacts (otherwise the
marker is reset to `[ ]` and the command refuses). Refuses a command text that matches a secret
pattern. Then it runs `<cmd>` through `/bin/sh -c` at the repository root — Vellum runs it; the
caller reports nothing — stopping it after `--timeout` seconds (default 600). It appends an
Evidence Entry with the real exit status (124 on timeout), start and finish timestamps,
duration, HEAD commit, a SHA-256 of the output and whether the working tree differed from HEAD
outside the spec directory. The output's tail is shown on stderr and never stored.

The marker becomes `[x]` only when the command exited 0 and the tree was clean. Exit 0 then;
exit 1 when the command failed (a failed attempt is recorded, the marker unchanged) or the
evidence was recorded as uncommitted.

There is no `--exit` option.

After a verified task it records `VERIFIED` as the spec's state when the Strict Verifier would
pass, else `IN_PROGRESS` when the content supports it, in the same way. `verify` and `check`
never write.

### `vellum context <spec> <task-id> [--json]`

The briefing an executor reads instead of the whole spec (decision 17 in 002's design): the
task, the full text of every criterion and Property it cites, the design sections and glossary
terms it uses, its parent, sub-tasks and wave, and a `missing` list naming anything cited that
the documents do not define. Writes nothing. Exit 0 printed, 1 when `tasks.md` defines no such
task, 2 on a usage error, an unmatched spec or a spec with no `tasks.md`. The MCP tool
`vellum_context` returns the `--json` document.

### `vellum adopt <spec> [--json]`

Brings a legacy spec — Markdown with no Lifecycle Frontmatter, no `.sdlc/` — under management
(requirement 14). Each artifact present gets a frontmatter block above its unchanged body:
version 1, the body's checksum, and the in-review state of the latest artifact present
(`IN_REVIEW` for requirements.md alone, `DESIGN_IN_REVIEW` with design.md, `PLAN_IN_REVIEW`
with tasks.md). Then `.sdlc/` is created and an `adoption` entry is appended as the ledger's
first entry. No approval is recorded.

Exit 0 when adopted, or when the spec is already adopted and its frontmatter is current (it
writes nothing then). Exit 1 when a later artifact exists without an earlier one (naming the
missing one), when a frontmatter block has a key Lifecycle Frontmatter does not define, when
the spec is already adopted but an artifact's frontmatter is missing or stale (run `stamp`),
or when the ledger cannot be read.

### `vellum stamp <spec> [--json]`

Keeps an adopted spec's frontmatter true after an artifact is written or edited: frontmatter
for an artifact added after adoption, the missing fields of a partial block, and for a body
whose canonical form changed the next version, the new checksum and a new `updatedAt`. It
raises the Recorded Lifecycle State to the in-review state of the latest artifact present when
the recorded state is behind it on the main chain, and never lowers it. A Task Marker change is
not an edit. It appends nothing to the ledger, and it never makes an approval count: approvals
are checked against the checksum of the body itself. Exit 0 (whether or not it wrote
anything); 1 for a spec that is not adopted (run `adopt`), a later artifact without an earlier
one, or a frontmatter block it cannot complete.

`vellum approve` refuses while an artifact's frontmatter checksum is stale, naming
`vellum stamp`, so an Approval Record never carries the previous version's number.

### Not implemented

`vellum sync` exits 2 with `not implemented: …`.

## Running the CLI

Nothing is published yet. In this repository, build and run the CLI package's entry:

```bash
pnpm build
node packages/cli/dist/cli.js status
```

Or run the bundle's bin, which is the same CLI: `node packages/vellum/dist/cli.js status`.
`packages/vellum/tests/pack.test.ts` packs that package, installs the tarball offline into a
temp directory and runs `vellum` and `vellum-mcp` from it.

In CI, run `lint` and `verify`. `verify` needs the full history (`fetch-depth: 0`) to resolve
approval commits and evidence ancestry, and the signing tools the policy's keys use. On a pull
request it also needs the target branch fetched (`fetch-depth: 0` fetches it), whose
Approval Policy it uses.
