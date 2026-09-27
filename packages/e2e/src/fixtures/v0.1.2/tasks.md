---
version: 1
checksum: f5b9f350fe39ceef57c3b956e6acad92f9dec2455b2544330dd3c669139af013
state: PLAN_IN_REVIEW
createdAt: 2026-09-27T11:51:24.397Z
updatedAt: 2026-09-27T11:59:03.716Z
---
# Implementation Plan

## Overview

Build the greeting, then the
farewell. Two waves.


**Source documents:** `requirements.md`, `design.md` (both in this spec directory)

**Total leaf tasks:** 5 · **Optional leaf tasks:** 2 · **Waves:** 4

## Tasks

- [ ] 1. Greeting core
  - [ ] 1.1 Implement greet() in src/greet.mjs _Requirements: 1.1_
  - [ ] 1.2 Refuse an empty name in src/greet.mjs _Requirements: 1.2_
  - [ ] 1.3* Unit tests for greet() in test/greet.test.mjs _Requirements: 1.1, 1.2_ _Properties: 1, 2_

- [ ] 2. Checkpoint: ensure all tests pass

- [ ] 3. Farewell
  - [ ] 3.1 Farewell option in src/greet.mjs _Requirements: 2.1_
  - [ ] 3.2* Unit test for --bye in test/greet.test.mjs _Requirements: 2.1_ _Properties: 3_

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3", "3.1"] },
    { "id": 3, "tasks": ["3.2"] }
  ]
}
```

## Execution Log

| Task | Criteria | Command | Exit | Evidence |
| ---- | -------- | ------- | ---- | -------- |
