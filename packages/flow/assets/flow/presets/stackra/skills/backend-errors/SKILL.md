---
name: backend-errors
description: Raise and handle errors the Stackra way - StackraError subclasses with one of the ten categories and a snake_case code, refusal codes, the ErrorEnvelope, generated transport mapping, the react, native and node entries of @stackra/errors, and the testing helpers. Use whenever code throws, catches, maps or displays an error, or a test asserts one.
---

# Errors

Every error in a package, app or service extends `StackraError` from `@stackra/errors` (ADR 0232). Code never throws a
raw `Error` or a string. The error serialises to one envelope (ADR 0140), and every transport mapping (HTTP status, MCP
error, CLI exit code) is generated from its category, never written by hand. Shapes follow the ADRs; the package docs win
once it ships.

## The envelope (ADR 0140)

```ts
interface ErrorEnvelope {
  code: string;             // snake_case machine code: STK code or domain code
  category: ErrorCategory;  // one of the ten below
  retryable: boolean;
  fieldErrors?: Record<string, string[]>;
  correlationId: string;
  action?: string;          // key@version, when an action raised it
}
```

| Category               | HTTP | Use for                                                       |
| ---------------------- | ---- | ------------------------------------------------------------- |
| `validation`           | 400  | Input failed its schema or a business rule on input           |
| `unauthenticated`      | 401  | No valid credential                                           |
| `forbidden`            | 403  | Authenticated, not permitted                                  |
| `entitlement_required` | 402  | The tenant's plan lacks the feature; carries an upgrade path  |
| `not_found`            | 404  | Absent **or in another tenant** (never reveal existence)       |
| `conflict`             | 409  | State or idempotency-key conflict                             |
| `precondition_failed`  | 412  | A required state was not met                                  |
| `rate_limited`         | 429  | Too many calls                                                |
| `unavailable`          | 503  | A dependency or capability is unavailable; usually retryable  |
| `internal`             | 500  | A bug                                                         |

Refusal codes from the pipeline are snake_case and fixed: `module_disabled`, `entitlement_missing`, `flag_off`,
`consent_missing`, `rate_limited`, `region_unsupported`, `maintenance`, `step_up_required`, `limit_reached` (ADR 0137).

## Worked example

```ts
// src/modules/invoices/errors/invoice-already-refunded.error.ts
import { StackraError } from "@stackra/errors";

export class InvoiceAlreadyRefundedError extends StackraError {
  constructor(invoiceId: string, cause?: unknown) {
    super({
      category: "conflict",
      code: "invoice_already_refunded",       // the i18n key derives from the code (ADR 0162)
      retryable: false,
      details: { invoiceId },
      cause,
    });
  }
}
```

```ts
if (invoice.status === "refunded") throw new InvoiceAlreadyRefundedError(invoice.id);
```

Catch only to add context or translate a foreign error, and keep the cause:

```ts
try {
  await this.gateway.refund(payment);
} catch (cause) {
  throw new PaymentProviderUnavailableError(payment.id, cause); // category "unavailable", retryable: true
}
```

## Clients

- **react**: `ErrorBoundary`, the React Router route `errorElement`, `useErrorHandler`, and the category-to-UX mapping
  (toasts; `entitlement_required` shows the upgrade path, ADR 0139).
- **native**: a React Native boundary, the `ErrorUtils` handler, unhandled rejections.
- **node**: process handlers for uncaught exceptions and unhandled rejections.
- Error tracking is a port with a Sentry driver; personal data is scrubbed before a report leaves the process (ADR 0134).

## Testing

```ts
import { expectStackraError } from "@stackra/errors/testing";
await expectStackraError(action.handle(input, ctx), { category: "conflict", code: "invoice_already_refunded" });
```

Assert category and code, never message text.

## Never

- `throw new Error(...)` or `throw "..."` (a house lint rule bans both).
- An HTTP status, `APIError` or response object built by hand.
- Personal data or a secret in `details`, a message or a log line.
- A kebab-case or camelCase code or category.

## Check

`pnpm --filter <member> test`, then `pnpm verify`. Review: `api-contract-reviewer`.
