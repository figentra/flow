---
version: 1
checksum: 92e6f23fc51c1b28144dd9dee2818a396da01fb1d3f7e6e4c85d3388b2e1894d
state: PLAN_IN_REVIEW
createdAt: 2026-09-27T11:51:24.397Z
updatedAt: 2026-09-27T11:59:03.716Z
---
# Design Document

## Overview

One module, `src/greet.mjs`, exporting `greet(name, { bye })`; a test file exercises it with node's test runner.

## Correctness Properties

Property 1: Greeting names the person

For all non-empty names, the output is exactly "Hello, " followed by the name and "!".

**Validates: Requirements 1.1**

Property 2: Empty names are refused

For every empty or whitespace-only name, the Greeter exits 2 and writes nothing to stdout.

**Validates: Requirements 1.2**

Property 3: Farewell replaces greeting

For all names with --bye, the output is "Goodbye, " followed by the name and "!".

**Validates: Requirements 2.1**

## Testing Strategy

Unit tests with `node --test`.
