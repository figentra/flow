---
version: 1
checksum: 49e04a6490e370be4a0f526de0ac6964a2cb70d15ac6aac9af2b7bcce6341df3
state: PLAN_IN_REVIEW
createdAt: 2026-09-27T11:59:03.716Z
updatedAt: 2026-09-27T11:59:03.716Z
---

# Implementation Plan

## Overview

This plan builds the Network Package as the first npm workspace member,
`packages/network`, in the dependency order the design fixes: workspace and
package scaffold first (root `workspaces`, member `package.json`, strict
`tsconfig.json`), then the two leaf modules (`types.ts`, `errors.ts`), then the
pure build layer (`signals.ts`, `request.ts`), then the single Attempt Runner
(`attempt.ts`), the Retry Loop (`retry.ts`), the stateful client (`client.ts`)
and finally the public barrel (`index.ts`). The first runnable artefact is task
1.3: after it, `tsc --noEmit` runs against the package. Every property-based and
example-level test is an optional sub-task, placed after the barrel exists so
each test imports the public surface. Test files are grouped exactly as the
design's folder tree names them. The graph has 9 waves; the chain is long
because each module imports the one before it, and only the tests fan out in
parallel.

**Source documents:** `requirements.md`, `design.md` (both in this spec
directory)

**Total leaf tasks:** 18 · **Optional leaf tasks:** 7 · **Waves:** 9

## Tasks

- [ ] 1. Workspace member scaffold and leaf modules
  - [ ] 1.1 Add `"workspaces": ["packages/*"]` to the root `package.json` and
        point its `test` script at `npm test --workspaces`, adding no runtime
        dependency _Requirements: 8.1_
  - [ ] 1.2 Create `packages/network/package.json`: name `@playground/network`,
        private, `"type": "module"`, `exports` and `types` pointing at `dist/`,
        scripts `build` (`tsc`) and `test` (`tsc --noEmit && vitest run`),
        devDependencies `typescript`, `vitest`, `fast-check`, and no
        `dependencies` field _Requirements: 7.2, 8.1_
  - [ ] 1.3 Create `packages/network/tsconfig.json` with `strict: true`,
        `declaration: true`, ESM module settings, `lib` covering DOM fetch
        types, `rootDir` `src` and `outDir` `dist` _Requirements: 7.2, 7.3_
  - [ ] 1.4 Create `packages/network/src/types.ts` with `ClientOptions`,
        `RetryPolicy`, `NetworkClient`, `RequestOptions`, `VerbOptions`,
        `HttpMethod` and `HttpResponse<T>` exactly as the design's Interface
        block declares them, including the JSDoc defaults _Requirements: 7.1,
        7.2_
  - [ ] 1.5 Create `packages/network/src/errors.ts` with the abstract
        `NetworkError` (readonly `kind` discriminant) and its six subclasses
        `HttpError`, `TransportError`, `TimeoutError`, `CancellationError`,
        `ParseError`, `ConfigurationError` carrying the fields the design's
        Error Handling section lists, plus `isNetworkError()` _Requirements:
        3.3_

- [ ] 2. Request pipeline: signals, build step and Attempt Runner
  - [ ] 2.1 Create `packages/network/src/signals.ts` exporting
        `linkSignals(callerSignal, timeoutMs)` that returns a Linked Signal and
        a `dispose()` clearing the timer, composed with plain `AbortController`
        listeners and `setTimeout` rather than `AbortSignal.any()`
        _Requirements: 4.3, 5.1, 8.1_
  - [ ] 2.2 Create `packages/network/src/request.ts` exporting
        `buildRequest(clientOptions, requestOptions)` returning a frozen
        Prepared Request: WHATWG URL resolution of relative paths against
        `baseUrl`, `ConfigurationError` for a relative path with no base URL or
        an unserialisable JSON body, case-insensitive header merge with
        per-Request headers winning, JSON encoding of `bodyKind: "json"` bodies
        and a `content-type: application/json` default when the merged headers
        lack one _Requirements: 1.2, 1.3, 2.1, 2.2, 2.3, 2.4_
  - [ ] 2.3 Create `packages/network/src/attempt.ts` exporting
        `runAttempt(prepared, timeoutMs, callerSignal, transport)`: one
        transport call under the Linked Signal with `dispose()` in `finally`,
        abort classified as `CancellationError` when the caller signal is
        aborted and otherwise as an internal timeout-abort marker, other
        transport rejections wrapped in `TransportError` with `cause`, JSON body
        parsing when the response `Content-Type` denotes JSON with `ParseError`
        carrying the status on failure, `HttpError` for status ≥ 400 and
        `HttpResponse` otherwise, using only WHATWG globals _Requirements: 1.1,
        1.4, 1.5, 1.6, 3.1, 3.2, 4.3, 5.1, 5.2, 8.2_
  - [ ] 2.4* Write `packages/network/test/request.property.test.ts`: fast-check
        properties over a stub Transport for request fidelity, JSON body
        round-trip with the `Content-Type` default, URL resolution against
        random base URLs, and case-insensitive header merge precedence
        _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3_ _Properties: 1, 2, 5, 6_
  - [ ] 2.5* Write `packages/network/test/response.property.test.ts`: fast-check
        properties over statuses 200–599 for the resolve/reject partition
        carrying status, headers and body; JSON parsing and `ParseError` under
        JSON content types; and error-kind totality via `isNetworkError` and the
        six `kind` literals across every rejection generated _Requirements: 1.4,
        1.5, 1.6, 3.1, 3.3_ _Properties: 3, 4, 7_

- [ ] 3. Retry Loop, client and public barrel
  - [ ] 3.1 Create `packages/network/src/retry.ts` exporting
        `runWithRetry(prepared, policy, timeoutMs, callerSignal, transport)`:
        attempt budget of 1 without a policy and `policy.maxAttempts` with one,
        `CancellationError` rethrown unconditionally, retryability limited to
        `TransportError`, timeout aborts and statuses 408/429/500/502/503/504,
        method gating to GET/HEAD/PUT/DELETE/OPTIONS unless `policy.methods` is
        given, a caller-signal-aware `sleep` of `baseDelayMs` (default 200) ×
        2^(k−1) before attempt k+1, and finalisation of the last error with
        `attemptCount`, converting a timeout abort into
        `TimeoutError(timeoutMs, attemptCount)` _Requirements: 4.4, 5.4, 6.1,
        6.2, 6.3, 6.4, 6.5, 6.6, 6.7_
  - [ ] 3.2 Create `packages/network/src/client.ts` exporting
        `createClient(options)` and the `NetworkClient` implementation:
        `ConfigurationError` at creation when no transport is available,
        `CancellationError` before any transport call for a pre-aborted signal,
        applied timeout of `request.timeoutMs ?? client.timeoutMs ?? 30_000`,
        one `buildRequest` per Request handed to `runWithRetry`, the generic
        `request<T>()` and the `get`/`post`/`put`/`patch`/`delete`/`head`
        shorthands fixing only method and body _Requirements: 1.1, 4.1, 4.2,
        5.3, 7.1_
  - [ ] 3.3 Create `packages/network/src/index.ts` re-exporting `createClient`,
        every type from `types.ts` and every error class plus `isNetworkError`
        from `errors.ts`, and nothing internal _Requirements: 7.2_

- [ ] 4. Checkpoint: ensure all tests pass

- [ ] 5. Timing, retry, cancellation and example-level tests
  - [ ] 5.1* Write `packages/network/test/timeout.property.test.ts` under Vitest
        fake timers: applied timeout equals the per-Request value when supplied
        and the client value otherwise, an attempt still pending at that instant
        is aborted, and the `default-timeout-30s` case fires at exactly 30 000
        ms when nothing is configured _Requirements: 4.1, 4.2, 4.3_ _Properties:
        8_
  - [ ] 5.2* Write `packages/network/test/retry.property.test.ts` under fake
        timers with recorded sleeps: attempt-count bounds over scripted failure
        sequences with and without a policy, idempotent-method gating for
        non-idempotent methods, the backoff schedule B × 2^(k−1), terminal
        rejection fidelity with `attemptCount` and `TimeoutError` on a final
        timeout, and the `default-base-delay-200ms` case _Requirements: 4.4,
        6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_ _Properties: 9, 11, 12, 13_
  - [ ] 5.3* Write `packages/network/test/cancellation.property.test.ts`: the
        Cancellation Signal fired at a random point mid-attempt or mid-backoff
        aborts the in-flight attempt, rejects with `CancellationError`, and the
        stub Transport call count never rises afterwards _Requirements: 5.1,
        5.2, 5.4_ _Properties: 10_
  - [ ] 5.4* Write `packages/network/test/examples.test.ts` with the cases
        `config-error-no-base-url`, `transport-error-mapping`,
        `pre-cancelled-signal`, `declarations-emitted` (a `tsc` build into a
        temporary `outDir` yields a `.d.ts` for each export),
        `strict-mode-clean` (`tsc --noEmit` exits 0), `node20-zero-deps`
        (`package.json` has no `dependencies`) and `fetch-standard-only` (a scan
        of `src/` finds only WHATWG globals) _Requirements: 2.4, 3.2, 5.3, 7.2,
        7.3, 8.1, 8.2_
  - [ ] 5.5* Write `packages/network/test/types.test-d.ts` asserting with
        `expectTypeOf` that `request<Athlete>()` and each verb shorthand resolve
        to `HttpResponse<Athlete>` with `body` typed `Athlete`, and that
        `head()` resolves to `HttpResponse<void>` _Requirements: 7.1_

- [ ] 6. Checkpoint: ensure all tests pass

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["1.4", "1.5"] },
    { "id": 3, "tasks": ["2.1", "2.2"] },
    { "id": 4, "tasks": ["2.3"] },
    { "id": 5, "tasks": ["3.1"] },
    { "id": 6, "tasks": ["3.2"] },
    { "id": 7, "tasks": ["3.3"] },
    { "id": 8, "tasks": ["2.4", "2.5", "5.1", "5.2", "5.3", "5.4", "5.5"] }
  ]
}
```

## Execution Log

| Task | Criteria | Command | Exit | Evidence |
| ---- | -------- | ------- | ---- | -------- |

`Evidence` is the commit sha on success. On a failure row it carries the
one-line diagnosis after `no commit — `, so a twice-failed task is
distinguishable from one nobody attempted — otherwise a resume replays the
identical failure against a fresh executor with no memory of the first.

## Notes

### Wave rationale

- Task 1.1 changes what the workspace resolves (the root `workspaces` field), so
  it sits alone in wave 0 below everything else. Tasks 1.2 and 1.3 introduce the
  devDependencies and the compiler settings that every later task's `tsc`
  verification runs against, so they precede the source modules.
- The source chain `types`/`errors` → `signals`/`request` → `attempt` → `retry`
  → `client` → `index` follows the design's Dependency direction section: each
  module imports the one before it, so each is in a strictly higher wave than
  its imports. No two tasks in one wave write the same file.
- Every test file imports the public barrel (`src/index.ts`), so all seven test
  tasks share wave 8 after task 3.3. They touch seven distinct files and can run
  concurrently.
- Root `test` script delegation in task 1.1 is the only wiring outside
  `packages/network`; per design Open Question 3, CI and lint enforcement stay
  out of this spec's scope.

### Deferrals

None. Every criterion 1.1–8.2 appears in at least one trailer, and every
Property 1–13 is cited by a test task. Design Open Questions 1, 2 and 4 are
non-blocking and are taken as their "Assumed for now" column: 3xx statuses
surfaced by the Transport resolve like 2xx, the member is named
`@playground/network`, and verb shorthands are in scope (task 3.2).

### Checkbox states

| Marker | Meaning                                               | Who sets it                                                   |
| ------ | ----------------------------------------------------- | ------------------------------------------------------------- |
| `[ ]`  | Not started                                           | initial state, written by `spec-tasks`                        |
| `[~]`  | Queued — selected for the current wave, not yet begun | the orchestrator (`spec-run`), before dispatching the wave    |
| `[-]`  | In progress                                           | the executing agent, on starting the task                     |
| `[x]`  | Completed                                             | the executing agent, after the task's own verification passes |

The file is the single source of truth for progress. Do not track progress
anywhere else, and do not reformat the task lines — the parser regex is exact.

### Optional tasks

A `*` marks a task the plan can ship without: unit tests, property-based tests,
extra fixtures, nice-to-haves. It may sit immediately after the closing bracket
(`- [ ]* 1.3 …`) or after the task id (`- [ ] 1.3* …`); the parser accepts both
and treats them identically. Prefer the second — it is what every example in
this template uses, and it attaches the marker to the thing that is optional.

Optional tasks are still real work and still carry a `_Requirements:_` trailer.

**A top-level task is never optional.** If a whole top-level task could be
skipped, it does not belong in the plan.

### Traceability

Every leaf task ends with `_Requirements: <n>.<m>, …_`, referring to numbered
acceptance criteria in `requirements.md`. Numeric references only — no titles,
no quoted criterion text, no links. Union of every leaf trailer must cover every
criterion in `requirements.md`; a criterion no task references is either an
oversight or a documented deferral in `design.md` Open Questions.

A leaf that tests a Correctness Property cites it with a second trailer after
the first: `_Properties: <N>, …_`, the Property numbers from `design.md`. Every
Property must be cited by at least one task: `npx vellum verify` reports each
one no task cites as `PROPERTY_NOT_CITED`, and `npx vellum lint` reports a
citation of a Property `design.md` does not define as `TASK_PROPERTY_UNDEFINED`.

### Checkpoints

A `Checkpoint` task appears every few top-level tasks, and always before a task
that builds on a large batch of prior work. Its body is `Ensure all tests pass`
or a similarly concrete verification. Checkpoints have no sub-tasks, no
`_Requirements:_` trailer, and no entry in the dependency graph. A checkpoint is
still a Required Task: its verification run is recorded with
`npx vellum task complete`, and `npx vellum verify` requires that evidence. A
parent task needs none of its own; it is complete when its required sub-tasks
are.

### What is NOT in this plan

This plan contains coding tasks only — writing, modifying, and testing code in
this repository. The following are out of scope by rule and must never appear as
tasks:

- user acceptance testing, sign-off sessions, stakeholder demos
- deployment, release, environment provisioning, rollout, feature-flag flips
- gathering performance metrics, load testing in a live environment,
  benchmarking runs
- manual end-to-end runs, manual QA passes, exploratory testing
- training, onboarding, writing user documentation or runbooks
- business process changes, policy updates, vendor negotiation
- marketing, launch communication, pricing
