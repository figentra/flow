# @vellum/e2e

End-to-end scenarios for Vellum, run against the package a consumer installs —
never the workspace sources.

A vitest `globalSetup` (`src/global-setup.ts`) runs `npm pack` on
`packages/vellum` once per run and installs the tarball with
`npm install --offline` into a temp consumer directory (the helper is shared
with `@figentra/vellum`'s own pack test: `@vellum/vitest-config/pack`). npm
runs with an empty user config and a cache inside the temp directory, so no
registry is contacted and no credential in `~/.npmrc` is read. Every scenario
runs the `vellum` and `vellum-mcp` bins installed there.

## Isolation

Each scenario works in a fresh git repository under `os.tmpdir()`
(`src/support/repo.ts`), with its own `HOME`, `GNUPGHOME`,
`GIT_CONFIG_GLOBAL` (and `GIT_CONFIG_NOSYSTEM=1`), and two throwaway ed25519
SSH keys generated for that repository: `human`, which the Approval Policy
lists for `human@example.test`, and `intruder`, which it does not. Commands
get an environment built from scratch — `PATH`, `TMPDIR` and those paths — so
the machine's `CI` flag, assistant-session variables, ssh-agent and signing
configuration do not leak in.

Spec documents (`src/support/spec.ts`) are shaped the way
`packages/method/templates` shape them: EARS criteria under
`### Requirement N:`, Correctness Properties with `**Validates: …**`, and a plan
with parent tasks, leaf tasks carrying Kiro `_Requirements: …_` trailers,
optional `1.3*` and `3.2*` test tasks citing every Property with
`_Properties: …_`, a checkpoint, a Task Dependency Graph and an Execution
Log. The suite writes each document as bare Markdown, as the method's skills
do, and the installed CLI adds the Lifecycle Frontmatter: `vellum adopt`
after requirements.md, `vellum stamp` after each later document and after
every edit. Nothing in the suite writes frontmatter or re-implements the
protocol's canonical form.

## Human approval

`vellum approve` refuses unless stdin and stdout are a terminal, no assistant
session is detected and `CI` is unset. The suite does not bypass that: it runs
the command inside a pseudo-terminal with `script(1)` (BSD `script` on macOS,
util-linux `script` on Linux), the way a person at a terminal runs it, then
commits the ledger files signed with the `human` key (`git commit -S`,
`gpg.format=ssh`).

## Scenarios

| File                          | What it proves                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01-lifecycle.e2e.test.ts`    | Full lifecycle: a template-shaped draft lints clean; each document is approved from a terminal and a signed commit, reaching REQUIREMENTS_APPROVED, DESIGN_APPROVED, PLAN_APPROVED; every Required Task — the leaves 1.1, 1.2, 1.3, 3.1, 3.2 and checkpoint 2, not the parents 1 and 3 — is started and completed by `vellum task complete` running `node --test`; `verify --strict` PASS; `status --json` shows VERIFIED with full evidence; `check` and `doctor` exit 0. |
| `02-approval.e2e.test.ts`     | An agent cannot approve: five assistant-session variables, a pipe and `CI=true` are each refused (exit 1) with the ledger and repository unchanged; an approval committed unsigned fails verify with `UNSIGNED_COMMIT`; one signed by a key the policy does not list fails with `SIGNER_NOT_AUTHORIZED`.                                                                                  |
| `03-evidence.e2e.test.ts`     | Evidence is engine-recorded: `--command "exit 3"` exits 1, leaves the marker and records the failed attempt; `--exit 0` is a usage error (exit 2) that writes nothing; a hand-written `[x]` with no evidence is the single verify finding `TASK_NOT_VERIFIED`, while the plan approval still counts.                                                                                      |
| `04-tamper.e2e.test.ts`       | On copies of one fully verified repository: an edited, deleted, truncated or reordered ledger fails verify and check with `LEDGER_INTEGRITY`; editing an approved document's content voids its approval (`APPROVAL_INVALID: … CHECKSUM_MISMATCH`, naming the artifact and both checksums); CRLF, table padding and trailing spaces keep it; a flipped task marker keeps the plan approval.                                        |
| `05-inconclusive.e2e.test.ts` | Exit 2 with the input named: an unparseable artifact (verify, status, check), an unparseable policy, no spec at all (verify, lint, check). A missing policy is a FAIL naming it (verify, check; criterion 19.6 treats an absent input as FAIL, not INCONCLUSIVE) and `approve` refuses (criterion 7.4).                                                                                   |
| `06-mcp.e2e.test.ts`          | `vellum-mcp` over stdio: handshake; `tools/list` all `readOnlyHint`; `vellum_status`, `vellum_lint`, `vellum_verify` and `vellum_check` equal the CLI's `--json` for the same repository; `vellum_approve` / `vellum_task_complete` refused by name; a path escaping the repository refused; repository bytes unchanged.                                                                  |
| `07-plugins.e2e.test.ts`      | The built Claude Code, Kiro and OpenCode plugins: manifests, MCP config, steering, skills and agents re-checked on disk with the renderers' frontmatter checks; `claude plugin validate --strict` when the `claude` binary is on `PATH` (skipped with a printed reason otherwise); every `vellum <command>` in shipped Markdown exists in the installed `vellum --help`.                  |
| `08-frontmatter.e2e.test.ts`  | A frontmatter checksum that is all digits, or digits around an `e`, is read as a string: `status` reports it stale rather than the artifact unparseable, `lint` reports `CHECKSUM_MISMATCH`, and `verify --strict` still passes because approvals bind the computed body checksum.                                                                                                        |
| `09-properties.e2e.test.ts` | Property citation: `vellum approve <spec> tasks` refuses (exit 1, ledger and tree unchanged) a plan that cites no task for `Property 3`, naming it (criterion 20.4); a plan approved before design.md gained Property 3, fully evidenced, fails `verify --strict` with the single finding `PROPERTY_NOT_CITED` (properties 2/3); a `_Properties: 4_` citation of an undefined property is `TASK_PROPERTY_UNDEFINED` from `lint`; the same repository's plan amended to cite Property 3 fails verify until the human approves it again, then passes with properties 3/3 and the earlier design and plan approvals reported as superseded. |
| `10-required-tasks.e2e.test.ts` | Which tasks need evidence: `task start` refuses parent task 1 (exit 1) naming its sub-tasks and changes nothing; starting a sub-task marks its parent `[-]`; `task complete` marks parent 1 `[x]` with its last required sub-task 1.3 (not before) and parent 3 with 3.2; with every leaf evidenced but checkpoint 2 not, verify names exactly `TASK_NOT_VERIFIED: Task 2`; evidence for the checkpoint makes it pass with no evidence ever recorded for parents 1 and 3. |
| `11-reapproval.e2e.test.ts` | Requirements amended the way spec-clarify amends them (a criterion reworded, a `## Clarifications` session appended) after verification: verify fails with `APPROVAL_INVALID: … CHECKSUM_MISMATCH` naming both checksums, status counts 0 of 1, check fails; after `vellum approve` and a signed commit, verify passes with the old approval superseded (not a finding, not counted), status counts 1 of 1 and check exits 0. |
| `12-managed-specs.e2e.test.ts` | Specs the method writes come under management: a bare spec-new-shaped requirements.md is reported legacy with `next: npx vellum adopt …`, approve refuses it naming adopt, `vellum adopt` adds frontmatter with the body byte-identical, IN_REVIEW, one adoption entry and no approval (check and lint pass; a second adopt writes nothing); an approved requirements.md edited under its old frontmatter makes approve refuse naming `vellum stamp`, stamp records version 2 without lowering VERIFIED, verify still fails `CHECKSUM_MISMATCH`, and a signed re-approval of version 2 passes; stamp after task completion writes nothing. |
| `15-parent-markers.e2e.test.ts` | Parent markers (decision 15): a parent turns `[-]` when a sub-task starts; parent 3, with required 3.1 and 3.2 and optional 3.3, is `[x]` once 3.1 and 3.2 are verified with 3.3 still `[ ]`; all-optional parent 4 stays `[-]` after 4.1 and turns `[x]` only when 4.2 is verified too; verify --strict still passes, the plan approval unaffected by the marker writes. |

## Running

```bash
pnpm turbo run test --filter=@vellum/e2e
```

The turbo `test` task depends on `@figentra/vellum#build` and the three plugin
builds. Needs `git`, `ssh-keygen`, `script` and `npm` on `PATH` (all present on
macOS and `ubuntu-latest`). Scenario files run in parallel, one forked process
each; the tests inside a file run in order and share that file's repository.

Measured when the suite was added: vitest reported a Duration of 9.9 s to
12.0 s for the whole suite across runs (each scenario file 0.5 s to 8 s,
files in parallel). Timeouts (`vitest.config.ts`) are budgets for a heavily
loaded machine, not expectations.

## Not covered here

- GPG-signed approvals (the SSH path is exercised end to end; GPG signing is
  covered by `packages/storage`'s signature tests).
- Windows: the pseudo-terminal comes from `script(1)`.
- `sync`, which the CLI does not implement.
