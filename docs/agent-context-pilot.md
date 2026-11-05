# Agent context pilot and Flow completion evidence

Date: 2026-11-05. Work: STA-2123. This is a delivery/evidence record, not a policy amendment.

## Acceptance for this pilot

- `fflow context` and `fflow_context` use one read-only implementation, default to the current checkout, and use the
  existing workspace registry only with `--all`. Queries narrow paths/package metadata; no setup or network is run.
- Results retain applicable in-checkout ancestor instructions, revision/dirty state, bounds and explicit missing
  checkouts. No private document bodies, environment files or symlink targets are loaded.
- Native Codex skill output reuses the existing harness. Both built-in preset sources explain focused discovery and
  documentation boundaries. No duplicate adapter, component gallery, per-file documentation or dependency is added.
- Unit coverage and packed-tarball CLI/MCP coverage must pass in CI at the merged revision. Local syntax/format/lint
  checks do not satisfy this gate. A fresh Codex client loading smoke test remains separate from generated-file tests.
- Collection rollout needs a standalone clone, one shared package, one service/connector and a UI family pilot;
  record owner/consumer paths and examples, then compare navigation correctness/time/context against the baseline.

## What “100%” requires

The owner's 2026-11-05 criterion is working implementation, every required check green and end-to-end behavior
verified. STA-1945's current spec and amendments govern over the original proposed path-to-100 text. In particular,
SC-4 names Quality Gate verify plus the owner-pinned Flow gate; do not disable CI based on the older one-check plan.

| Gate                   | Current evidence                                                                                                                                       | Remaining acceptance                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Main CI                | b4a4e5b9524f28e8096b16f56000bb1ec9e8d9eb: verify, test, e2e successful in [run 41936165944](https://github.com/figentra/flow/actions/runs/41936165944) | Repeat at each merged change; this is not evidence for STA-2123                                                                             |
| Context pilot          | Implementation and regression tests in this change                                                                                                     | CI/packed e2e at its merged revision, then real-client smoke and collection pilots                                                          |
| CLI completeness, SC-2 | `help.test.mjs` deliberately pins 21 passthrough commands                                                                                              | Port the remaining commands and replay the owner's round-4 try-out; do not merely empty the assertion                                       |
| Baseline-aware merge   | [PR 83](https://github.com/figentra/flow/pull/83) is open and conflicts with main                                                                      | Resolve/review the FR-22 change and verify it; do not bypass checks                                                                         |
| Acceptance/trace       | STA-1945 tasks T120–T122 remain unchecked                                                                                                              | Revision-specific acceptance/trace results, including killed-session resume, stacks, ADR races, approval/evidence tampering and scope drift |
| Preset extraction      | STA-2097 P1/P2 have landed work; Flow still bundles `presets/stackra` and selects it                                                                   | P3 consumer switches and removal, P5 neutral outside-Stackra proof; marketplace is separately scoped                                        |
| Harness rollout        | Existing adapters and MCP/async implementation; Core still declares `agents:sync`, `agents:check` and prepare's sync script                            | STA-2098 H6 replacement plus client loading/tool capability smoke evidence                                                                  |
| End-to-end dogfood     | STA-298 is In Progress with no result recorded                                                                                                         | One real issue from spec through release/ship, with identified approval, gate, revision and allowed-runner evidence                         |
| Repository rollout     | STA-1945 T124–T127 remain unchecked                                                                                                                    | Core migration/ADR amendments, each repository's check/divergence evidence, then compatible alias cleanup                                   |
| Release/deployment     | A successful Release workflow is present for main                                                                                                      | Verify the intended version's registry artifact and consuming pins; verify deployment only where applicable                                 |

The review used the Flow client through the existing Infisical bot wrapper. STA-1945, STA-2038, STA-2097 and STA-2098
were reopened In Progress with `needs-testing` and concrete evidence comments; their previous Done state was based on
merge reconciliation. STA-298 remains open. This does not claim every historical Flow issue has been independently
re-verified. No Testbed, Runway, secrets, identity, cloud infrastructure or credential configuration was changed.

## Rollout boundary

Flow supplies navigation and generated instructions. Repository owners still supply accurate contracts, capability
entries and component examples through their existing manifests/catalogues. Adopt the proven pilot incrementally;
keep pinned standalone guidance, existing mandatory rules and private/public visibility boundaries. The proposed
30% navigation-time and 40% context-token improvements are unmeasured targets, not achieved results.
