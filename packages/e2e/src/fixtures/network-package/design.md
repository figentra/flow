# Design Document

## Overview

The Network Package is one npm workspace member, `packages/network`, holding a typed HTTP client over the WHATWG `fetch` standard. A Request flows through four layers: the build step turns options into a frozen Prepared Request, the Attempt Runner performs one Transport call under a Linked Signal, the Retry Loop repeats Attempts under a Retry Policy, and the client composes them behind the public `NetworkClient` interface. Nothing outside `src/index.ts` is exported.

## Glossary

| Term                 | Definition                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Linked Signal        | An `AbortSignal` that aborts when the Cancellation Signal fires or the applied timeout elapses, whichever comes first. |
| Attempt Runner       | `runAttempt()`: one Transport call and the classification of its outcome.                                              |
| Retry Loop           | `runWithRetry()`: repeats the Attempt Runner under a Retry Policy.                                                     |
| Timeout Abort Marker | The internal value the Attempt Runner throws when the Linked Signal aborted for the timeout, not the Consumer.         |

## Architecture

```
packages/network/
  package.json
  tsconfig.json
  src/
    types.ts      public types
    errors.ts     NetworkError and its six subclasses
    signals.ts    linkSignals()
    request.ts    buildRequest()
    attempt.ts    runAttempt()
    retry.ts      runWithRetry()
    client.ts     createClient()
    index.ts      public barrel
  test/
```

### Dependency direction

`types.ts` and `errors.ts` import nothing. `signals.ts` and `request.ts` import only them. `attempt.ts` imports `signals.ts`; `retry.ts` imports `attempt.ts`; `client.ts` imports `request.ts` and `retry.ts`; `index.ts` re-exports. No module imports one above it.

## Components

### Types (`types.ts`)

The Interface block below is the public contract; JSDoc on each field states its default.

```ts
export type HttpMethod = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";

export interface RetryPolicy {
  /** Attempts including the first; at least 1. */
  maxAttempts: number;
  /** Default 200. */
  baseDelayMs?: number;
  /** Default GET, HEAD, PUT, DELETE, OPTIONS. */
  methods?: readonly HttpMethod[];
}

export interface ClientOptions {
  baseUrl?: string;
  headers?: Record<string, string>;
  /** Default 30 000. */
  timeoutMs?: number;
  retry?: RetryPolicy;
  transport?: typeof fetch;
}

export interface RequestOptions {
  method: HttpMethod;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
  bodyKind?: "json" | "raw";
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type VerbOptions = Omit<RequestOptions, "method" | "path">;

export interface HttpResponse<T> {
  status: number;
  headers: Headers;
  body: T;
}

export interface NetworkClient {
  request<T>(options: RequestOptions): Promise<HttpResponse<T>>;
  get<T>(path: string, options?: VerbOptions): Promise<HttpResponse<T>>;
  post<T>(path: string, body: unknown, options?: VerbOptions): Promise<HttpResponse<T>>;
  put<T>(path: string, body: unknown, options?: VerbOptions): Promise<HttpResponse<T>>;
  patch<T>(path: string, body: unknown, options?: VerbOptions): Promise<HttpResponse<T>>;
  delete<T>(path: string, options?: VerbOptions): Promise<HttpResponse<T>>;
  head(path: string, options?: VerbOptions): Promise<HttpResponse<void>>;
}
```

### Signals (`signals.ts`)

`linkSignals(callerSignal, timeoutMs)` returns `{ signal, timedOut, dispose }`. The Linked Signal is a fresh `AbortController` aborted by a listener on the caller signal or by a `setTimeout` of `timeoutMs`; `timedOut()` says which fired first. `dispose()` clears the timer and removes the listener. `AbortSignal.any()` is not used: it retains listeners on Node.js 20 until the caller signal is collected.

### Request builder (`request.ts`)

`buildRequest(clientOptions, requestOptions)` returns a frozen Prepared Request `{ method, url, headers, body }`. It resolves a relative path with `new URL(path, baseUrl)`, throws `ConfigurationError` for a relative path with no Base URL or a JSON body `JSON.stringify` rejects, merges headers through a `Headers` object so names compare case-insensitively (per-Request wins), and adds `content-type: application/json` to a JSON body when the merged headers lack one.

### Attempt Runner (`attempt.ts`)

`runAttempt(prepared, timeoutMs, callerSignal, transport)` performs exactly one Transport call with the Linked Signal and calls `dispose()` in `finally`, so no timer outlives the Attempt.

- An abort is a `CancellationError` when the caller signal is aborted, and otherwise the Timeout Abort Marker; the Retry Loop turns the marker into a `TimeoutError` only when no Attempt follows.
- Any other Transport rejection becomes `TransportError` with the rejection as `cause`.
- A response whose `Content-Type` denotes JSON (`application/json` or any `+json` type) is parsed; a parse failure is `ParseError` carrying the status.
- A status of 400 or above is `HttpError`; anything else resolves as `HttpResponse`.

The runner touches only WHATWG globals.

### Retry Loop (`retry.ts`)

`runWithRetry(prepared, policy, timeoutMs, callerSignal, transport)` calls the Attempt Runner up to the attempt budget: 1 without a policy, `policy.maxAttempts` with one. It rethrows `CancellationError` at once. Only `TransportError`, the Timeout Abort Marker and statuses 408, 429, 500, 502, 503 and 504 are retryable, and only for the policy's methods. Before Attempt k+1 it sleeps `baseDelayMs × 2^(k−1)` on a sleep that rejects when the caller signal fires. The last error is finalised with `attemptCount`.

### Client (`client.ts`)

`createClient(options)` throws `ConfigurationError` when no Transport is available. Each call rejects a pre-aborted signal with `CancellationError` before any Transport call, applies `request.timeoutMs ?? client.timeoutMs ?? 30_000`, builds one Prepared Request and hands it to the Retry Loop. The verb shorthands fix only the method and body.

### Public barrel (`index.ts`)

Re-exports `createClient`, every type in `types.ts`, and every error class plus `isNetworkError` from `errors.ts`. Nothing else.

## Correctness Properties

Property 1: Request fidelity

For every Request and stub Transport, each Attempt passes the Transport one Prepared Request whose method, URL, headers and body are those the Request and client options determine.

**Validates: Requirements 1.1, 2.1**

Property 2: JSON body round-trip

For every JSON-serialisable body, the Transport receives a body that parses back to an equal value, with `content-type: application/json` unless the merged headers name one.

**Validates: Requirements 1.3, 2.2**

Property 3: Resolve/reject partition

For every status from 200 to 599, the Request resolves when the status is below 400 and rejects with `HttpError` otherwise, carrying the status, headers and body either way.

**Validates: Requirements 1.4, 3.1**

Property 4: JSON response parsing

For every response under a JSON content type, a parseable body resolves parsed and an unparseable one rejects with `ParseError` carrying the status.

**Validates: Requirements 1.5, 1.6**

Property 5: URL resolution

For every Base URL and relative path, the Transport receives the URL `new URL(path, baseUrl)` yields, and an absolute URL unchanged.

**Validates: Requirements 1.2, 2.3**

Property 6: Header merge precedence

For every pair of header maps differing only in name case, the merged headers hold the per-Request value.

**Validates: Requirements 2.1**

Property 7: Error-kind totality

For every rejection a Request produces, `isNetworkError` holds and `kind` is one of the six literals.

**Validates: Requirements 3.3**

Property 8: Applied timeout

For every combination of per-Request and client timeouts, the applied timeout is the per-Request value, else the client value, else 30 000 ms, and an Attempt pending at that instant is aborted.

**Validates: Requirements 4.1, 4.2, 4.3**

Property 9: Attempt-count bounds

For every scripted sequence of Attempt outcomes, the Attempt Count is 1 without a policy and at most `maxAttempts` with one.

**Validates: Requirements 6.1, 6.2, 6.3**

Property 10: Cancellation stops the Transport

For every point at which the Cancellation Signal fires, the Request rejects with `CancellationError` and the Transport call count never rises afterwards.

**Validates: Requirements 5.1, 5.2, 5.4**

Property 11: Idempotent-method gating

For every method outside the policy's methods, the Attempt Count is 1 whatever the failure.

**Validates: Requirements 6.4**

Property 12: Backoff schedule

For every retried Request, the k-th sleep lasts `baseDelayMs × 2^(k−1)`, with `baseDelayMs` 200 when the policy gives none.

**Validates: Requirements 6.5, 6.6**

Property 13: Terminal rejection fidelity

For every Request that stops retrying, the rejection is the last Attempt's error carrying the Attempt Count, and a `TimeoutError` when the last Attempt timed out.

**Validates: Requirements 4.4, 6.7**

### Requirement coverage

| Requirement | Criterion | Kind      | Covered by                                      |
| ----------- | --------- | --------- | ----------------------------------------------- |
| 1           | 1.1       | Universal | Property 1                                      |
| 2           | 2.4       | Example   | Testing Strategy, case config-error-no-base-url |
| 3           | 3.2       | Example   | Testing Strategy, case transport-error-mapping  |
| 5           | 5.3       | Example   | Testing Strategy, case pre-cancelled-signal     |
| 7           | 7.1       | Example   | Testing Strategy, types.test-d.ts               |

## Error Handling

Every rejection is a `NetworkError`. The rule for each: classify once, at the layer that observes the failure, and never re-wrap.

### Error hierarchy

| Class                | `kind`          | Fields                      | Raised by                          |
| -------------------- | --------------- | --------------------------- | ---------------------------------- |
| `HttpError`          | `http`          | `status`, `headers`, `body` | Attempt Runner                     |
| `TransportError`     | `transport`     | `cause`                     | Attempt Runner                     |
| `TimeoutError`       | `timeout`       | `timeoutMs`, `attemptCount` | Retry Loop                         |
| `CancellationError`  | `cancellation`  | —                           | Attempt Runner, Retry Loop, client |
| `ParseError`         | `parse`         | `status`, `cause`           | Attempt Runner                     |
| `ConfigurationError` | `configuration` | `message`                   | build step, client                 |

## Testing Strategy

Property-based tests use fast-check over a stub Transport; timing tests use Vitest fake timers. Test files live in `packages/network/test/`.

### Example-level test cases

`config-error-no-base-url`, `transport-error-mapping`, `pre-cancelled-signal`, `declarations-emitted`, `strict-mode-clean`, `node20-zero-deps`, `fetch-standard-only`, `default-timeout-30s`, `default-base-delay-200ms`.

## Open Questions

| #   | Question                                            | Assumed for now             |
| --- | --------------------------------------------------- | --------------------------- |
| 1   | Should 3xx responses the Transport surfaces reject? | They resolve like 2xx.      |
| 2   | Package name?                                       | `@playground/network`.      |
| 3   | Enforce the design's rules in CI and lint?          | Out of scope for this spec. |
| 4   | Verb shorthands in scope?                           | Yes.                        |
