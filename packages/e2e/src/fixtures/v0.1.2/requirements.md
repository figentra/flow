---
version: 1
checksum: 84bd0c6ae620d80f5adcd601f7f90dba2440e22eed07e8da4726ef695000e274
state: PLAN_IN_REVIEW
createdAt: 2026-09-27T11:51:24.397Z
updatedAt: 2026-09-27T11:59:03.716Z
---
# Requirements Document

## Introduction

A command-line greeter that prints a greeting for a name
and refuses an empty one.


## Glossary

- **Greeter**: the command-line program this spec describes.

## Requirements

### Requirement 1: Greet a person by name

**User Story:** As a user, I want a greeting that names me, so that the output is personal.

#### Acceptance Criteria

1. WHEN the Greeter receives a non-empty name, THE Greeter SHALL print "Hello, <name>!" on one line.
2. IF the Greeter receives an empty name, THEN THE Greeter SHALL exit with status 2 and print nothing to stdout.

### Requirement 2: Say goodbye

**User Story:** As a user, I want a farewell, so that the program can close a session.

#### Acceptance Criteria

1. WHEN the Greeter receives the --bye option, THE Greeter SHALL print "Goodbye, <name>!" instead of the greeting.
