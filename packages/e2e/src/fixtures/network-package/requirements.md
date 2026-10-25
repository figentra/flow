# Requirements Document

## Intake

- **Path:** full EARS
- **Why:** the first workspace member of the playground; every later package calls the network through it, so its failure modes must be specified before anything depends on them.

## Introduction

The playground repository has no shared way to call an HTTP API. Each script builds its own `fetch` call, handles errors differently, and none of them time out, cancel or retry. This spec introduces the Network Package: a small typed HTTP client, built only on the WHATWG `fetch` standard, that every later member of the workspace uses to reach the network.

**Users:** the engineers and agents writing later workspace members, who call the Network Client from their own code.

**Business outcome:** a failed network call in any member is reported the same way, can be timed out, cancelled and retried, and needs no runtime dependency.

**In scope:** request construction, response handling, error classification, timeouts, cancellation, retry of idempotent requests, and the typed public API.

**Out of scope:** caching (no member needs it yet), streaming bodies (no member sends one), authentication helpers (each API differs), and a browser build (the playground runs on Node.js only).

**Measurable success:** every criterion below is covered by a property-based or example-level test in `packages/network/test/`, and `npm test --workspaces` exits 0.

## Glossary

| Term                | Definition                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Network Package     | The npm workspace member `packages/network`, which exports the Network Client and its types.                                          |
| Network Client      | The object `createClient()` returns; it issues Requests through a Transport.                                                          |
| Consumer            | Code in the workspace that calls the Network Client.                                                                                  |
| Request             | One call a Consumer makes to the Network Client, possibly carried out as several Attempts.                                            |
| Prepared Request    | The immutable request built once per Request from client options and per-Request options: resolved URL, merged headers, encoded body. |
| Attempt             | One call to the Transport on behalf of a Request.                                                                                     |
| Attempt Count       | The number of Attempts a Request made before it resolved or rejected.                                                                 |
| Transport           | The function that performs the HTTP exchange; the global `fetch` unless the Consumer supplies another.                                |
| HTTP Response       | The value a Request resolves with: status, headers and body.                                                                          |
| Base URL            | The absolute URL a client resolves relative request paths against.                                                                    |
| Cancellation Signal | The `AbortSignal` a Consumer passes to cancel a Request.                                                                              |
| Retry Policy        | The Consumer's instruction to retry a failed Request: attempt budget, base delay and retryable methods.                               |
| Backoff Delay       | The wait between two Attempts of one Request.                                                                                         |
| Network Error       | The base class of every rejection; its `kind` names which of the six errors it is.                                                    |
| HTTP Error          | The Network Error for a response status of 400 or above.                                                                              |
| Transport Error     | The Network Error for a Transport rejection that is not an abort.                                                                     |
| Timeout Error       | The Network Error for a Request whose last Attempt was aborted by its timeout.                                                        |
| Cancellation Error  | The Network Error for a Request its Consumer cancelled.                                                                               |
| Parse Error         | The Network Error for a JSON response body that cannot be parsed.                                                                     |
| Configuration Error | The Network Error for a Request or client that cannot be built from its options.                                                      |

## Requirements

### Requirement 1: Send requests and receive responses

**User Story:** As a Consumer, I want to issue a request and get a typed response, so that I do not hand-build `fetch` calls in every member.

#### Acceptance Criteria

1. WHEN a Consumer issues a Request, THE Network Client SHALL pass exactly one Prepared Request per Attempt to the Transport, carrying the method, URL, headers and body that the Request specifies.
2. WHEN a Request names a relative path and the Network Client has a Base URL, THE Network Client SHALL resolve the path against the Base URL as the WHATWG URL Standard defines.
3. WHEN a Request carries a JSON body, THE Network Client SHALL encode the body as JSON and SHALL set `content-type: application/json` unless the merged headers already name a content type.
4. WHEN the Transport returns a response with a status from 200 to 399, THE Network Client SHALL resolve the Request with an HTTP Response carrying that status, its headers and its body.
5. WHEN a response's `Content-Type` denotes JSON, THE Network Client SHALL parse the response body as JSON before resolving or rejecting with it.
6. IF a response body whose `Content-Type` denotes JSON cannot be parsed, THEN THE Network Client SHALL reject the Request with a Parse Error carrying the response status.

### Requirement 2: Configure requests

**User Story:** As a Consumer, I want client-wide defaults that a single request can override, so that I configure an API once.

#### Acceptance Criteria

1. THE Network Client SHALL merge the client's default headers with a Request's headers case-insensitively, a Request header replacing a default header of the same name.
2. WHEN a Request carries no body, THE Network Client SHALL send no body and SHALL add no content-type header of its own.
3. WHEN a Request names an absolute URL, THE Network Client SHALL send it unchanged and SHALL ignore the Base URL.
4. IF a Request names a relative path and the Network Client has no Base URL, or its JSON body cannot be serialised, THEN THE Network Client SHALL reject the Request with a Configuration Error before any Attempt.

### Requirement 3: Report failures by kind

**User Story:** As a Consumer, I want every failure to name its kind, so that I can handle each one without inspecting messages.

#### Acceptance Criteria

1. IF the Transport returns a response with a status of 400 or above, THEN THE Network Client SHALL reject the Request with an HTTP Error carrying the status, headers and body.
2. IF the Transport rejects for a reason other than an abort, THEN THE Network Client SHALL reject the Attempt with a Transport Error whose `cause` is the original rejection.
3. THE Network Client SHALL reject a Request only with a Network Error whose `kind` is one of `http`, `transport`, `timeout`, `cancellation`, `parse` or `configuration`.

### Requirement 4: Time out slow requests

**User Story:** As a Consumer, I want a request that hangs to fail, so that a slow API cannot stall a script forever.

#### Acceptance Criteria

1. WHERE a Request specifies a timeout, THE Network Client SHALL apply that timeout to each Attempt of the Request, and otherwise the client's timeout.
2. WHERE neither the Request nor the Network Client specifies a timeout, THE Network Client SHALL apply a timeout of 30 000 milliseconds.
3. WHEN an Attempt is still pending at the moment its applied timeout elapses, THE Network Client SHALL abort that Attempt's Transport call.
4. IF the last Attempt of a Request was aborted by its timeout, THEN THE Network Client SHALL reject the Request with a Timeout Error carrying the applied timeout and the Attempt Count.

### Requirement 5: Cancel requests

**User Story:** As a Consumer, I want to cancel a request I no longer need, so that it stops using the network.

#### Acceptance Criteria

1. WHEN the Cancellation Signal fires during an Attempt, THE Network Client SHALL abort that Attempt's Transport call.
2. WHEN the Cancellation Signal fires before the Request settles, THE Network Client SHALL reject the Request with a Cancellation Error.
3. IF the Cancellation Signal has already fired when the Consumer issues a Request, THEN THE Network Client SHALL reject the Request with a Cancellation Error without calling the Transport.
4. WHEN the Cancellation Signal fires during a Backoff Delay, THE Network Client SHALL make no further Attempt of that Request.

### Requirement 6: Retry idempotent requests

**User Story:** As a Consumer, I want transient failures retried with backoff, so that one dropped connection does not fail a script.

#### Acceptance Criteria

1. WHERE the Consumer gives no Retry Policy, THE Network Client SHALL make exactly one Attempt per Request.
2. WHERE the Consumer gives a Retry Policy, THE Network Client SHALL make at most `maxAttempts` Attempts per Request.
3. THE Network Client SHALL retry a Request only after a Transport Error, a timeout abort, or a response status of 408, 429, 500, 502, 503 or 504.
4. WHERE a Retry Policy names no methods, THE Network Client SHALL retry only GET, HEAD, PUT, DELETE and OPTIONS Requests.
5. WHEN the Network Client retries after Attempt k, THE Network Client SHALL wait a Backoff Delay of `baseDelayMs` × 2^(k−1) milliseconds before Attempt k+1.
6. WHERE a Retry Policy gives no `baseDelayMs`, THE Network Client SHALL use a base delay of 200 milliseconds.
7. WHEN the Network Client stops retrying a Request, THE Network Client SHALL reject it with the last Attempt's error, carrying the Attempt Count.

### Requirement 7: Typed public API

**User Story:** As a Consumer writing TypeScript, I want response bodies typed, so that the compiler checks how I use them.

#### Acceptance Criteria

1. THE Network Package SHALL type the body of an HTTP Response as the type parameter the Consumer supplies, for `request` and for each verb shorthand.
2. THE Network Package SHALL emit a type declaration for every export of its public entry point.
3. THE Network Package SHALL compile with no error under TypeScript strict mode.

### Requirement 8: Standard platform only

**User Story:** As the maintainer, I want no runtime dependency, so that the package installs anywhere Node.js 20 runs.

#### Acceptance Criteria

1. THE Network Package SHALL declare no runtime dependency and SHALL run on Node.js 20 or later.
2. THE Network Package SHALL reach the network only through WHATWG globals: `fetch`, `Request`, `Response`, `Headers`, `AbortController` and `URL`.
