# State of figentra/flow

Dated 2026-11-07. A snapshot written from the repository, its CI runs, releases and pull requests. It is not a policy
document: where it and another file disagree on a fact, check the evidence named here.

## 1. What this repo is

Figentra Flow (`fflow`) is a spec-driven development CLI for agent teams: specs, approval stops, tasks, a gate,
landing and releases, with presets (`neutral`, `stackra`) that render a repository's agent setup. It is one pnpm
workspace with one package, `packages/flow` (`@figentra-oss/flow`, MIT, public). AI agent lanes do the work; the owner
approves releases by merging the Changesets version pull request.

## 2. Current

| Item               | Value                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Package            | `@figentra-oss/flow` 0.6.5 (`packages/flow/package.json`); 0.6.6 is pending in PR #175                              |
| Binaries           | `fflow`; `figentra-flow` is a deprecated alias (`packages/flow/bin/figentra-flow.mjs`)                              |
| Default branch     | `main` at `29c1be5f59be9a95b687a1f2aa9ea09ad5c7fea2` (2026-11-07, STA-2106 folder move)                             |
| Toolchain          | Node 24.22.0, pnpm 12.16.1, oxfmt 0.71.0, oxlint 1.86.0 (`mise.toml`)                                               |
| Catalog highlights | turbo 2.11.9, TypeScript 6.0.3, `@stackra/console` and `@stackra/validation` 0.7.1, undici 8.12.2, Changesets 3.0.3 |
| Released Flow pin  | `flow-released` = `@figentra-oss/flow@0.2.3`, used only by the approval workflow                                    |
| Registry           | `https://npm.stackra.figentra.com/` (public read for `@figentra-oss`)                                               |

## 3. Proven by a real run

- **Main CI green at head.** Quality Gate run 42336876433 on `29c1be5`: jobs `verify`, `test` and `e2e` all
  succeeded. `e2e` packs the package and installs the tarball into a scratch repository, then runs `fflow`.
- **Release workflow green at head.** Release run 42336876705 on `29c1be5` succeeded (no new version: the version
  pull request #175 is open).
- **Published releases.** GitHub releases and tags `@figentra-oss/flow@0.2.3` through `@figentra-oss/flow@0.6.5`
  (latest: 0.6.5, 2026-11-07T00:15Z, published by Release run 42317002558). The registry lists versions up to
  0.6.5 with dist-tag `latest` = 0.6.5 (`npm view @figentra-oss/flow` against the registry above).
- **Registry answers.** `https://npm.stackra.figentra.com/@figentra-oss%2fflow` returns HTTP 200 without a token.

## 4. Not proven

- **1.0 and the repository rollout.** The README's status is "In progress"; nothing marks 1.0 done.
- **STA-1945 acceptance.** `docs/agent-context-pilot.md` (2026-11-05) lists remaining gates: tasks T120 to T122
  (acceptance and trace runs), the real-client Codex smoke test and the collection pilots. No run proves them.
- **`fflow-approve.yml` on a real approval.** The workflow and `src/lib/approve-*.mjs` exist and are unit-tested;
  this snapshot found no evidence of an approval it produced on a live pull request.
- **The box runner.** `flow.config.json` routes the gate to `testbed run`; its success lives in the testbed
  repository's runs, not here.
- **npmjs publication.** `release.yml` and `.npmrc` say the package goes to npmjs as `figentra-flow` "later"; it has
  not.
- **ADR 0001 (session names).** `docs/adr/0001-session-names.md` is "Proposed", not accepted.

## 5. Map

| Path                                                | What                                                                                   |
| --------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `packages/flow/bin`                                 | `fflow.mjs` dispatcher and the deprecated `figentra-flow.mjs` alias                    |
| `packages/flow/src/commands`                        | one module per command (39 files: `init`, `sync`, `gate`, `land`, `train`, `release`…) |
| `packages/flow/src/lib`                             | parsers, Linear and GitHub clients, worktrees, approval and required-check logic       |
| `packages/flow/src/adapters`                        | tracker, runner, credentials, secrets and harness adapters                             |
| `packages/flow/src/guard`                           | the guard (hook) engine                                                                |
| `packages/flow/assets/flow`                         | the `neutral` and `stackra` presets and base templates that `fflow sync` renders       |
| `packages/flow/schema`                              | the `flow.config.json` schema                                                          |
| `.agents/specs`                                     | six feature specs (STA-1729, 1746, 1856, 1871, 1942, 1945) with plans and tasks        |
| `.agents/skills`, `.agents/agents`, `.agents/rules` | rendered by `fflow sync` from the stackra preset; not hand-edited                      |
| `.flow`                                             | `lock.json`, `readme.yml` (README source) and `record/`                                |
| `docs`                                              | `adr/0001-session-names.md` and the STA-2123 evidence record                           |
| `.github/workflows`                                 | `ci.yml` (Quality Gate), `release.yml`, `fflow-approve.yml`                            |

Authoritative docs, in order: `AGENTS.md` (repo rules), `packages/flow/README.md` (the full command and
configuration reference, about 84 KB), `.agents/specs/sta-1945-flow-owns-everything/spec.md` (current scope and
amendments), `CONTRIBUTING.md`. The root `README.md` is generated from `.flow/readme.yml`; edit that file.

## 6. Open risks

- **Main CI:** green at `29c1be5` (run 42336876433).
- **Open pull requests:** 2. #175 (version packages, 0.6.6) and #141 (`refactor!: retire the approver fallback`,
  open since 2026-11-04, breaking).
- **Branches:** 62 besides `main`; 59 last committed before 2026-11-04 and 60 have no open pull request.
- **Infisical references:** `git grep -i -c infisical` totals 420 lines in 61 files. Most are the secrets adapter
  (`src/adapters/secrets.mjs`), the stackra preset's guard rules and their tests, and `flow.config.json`
  (`secrets.kind: infisical`). Any move off Infisical touches the adapter, preset and tests together.
- **Stale facts in docs:** the root README says "0.3.0 is published" (0.6.5 is); `AGENTS.md` lists 17 commands while
  `src/commands` has 39 modules; `.github/CODEOWNERS` still names `/figentra-flow.config.json` (the file is
  `flow.config.json`); `.agents/specs` cite `packages/figentra-flow/` 356 times (the folder is `packages/flow`).
- **Old name in live identifiers:** the gate GitHub App is `figentra-flow[bot]` (`flow.config.json`,
  `fflow-approve.yml`) and the `figentra-flow` binary alias still ships.
