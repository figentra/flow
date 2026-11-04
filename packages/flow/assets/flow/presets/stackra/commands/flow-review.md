---
description: Review a pull request with four parallel reviewers and one verifier per finding; a confirmed blocking finding stops land.
---

## Stackra: feature directory (runs first)

Specs live in `.agents/specs/sta-<n>-<slug>/` (ADR 0120 D1), never in `specs/`. Run this command in the task's
worktree, on its branch: `fflow review` reads the spec of the branch's Linear key. If the branch carries no key, STOP
and report it.

## User Input

```text
$ARGUMENTS
```

The pull request number. You **MUST** consider the user input before proceeding (if not empty).

## Outline

1. **Input**: run `fflow review <pr> --input`. It prints the PR, its head and base, the changed files, the spec's FRs
   and ACs, the spec documents and the four reviewers. If it fails, STOP and report it.
2. **Reviewers, in parallel**: start four subagents at once, one per reviewer, each with the input and the diff
   (`git diff <base>...HEAD`) and none of the others' work:
   - `correctness`: the change does what its FRs and ACs say; edge cases, errors, data loss, tests that prove it.
   - `simplicity`: the smallest change that works; dead code, needless layers, options nobody asked for.
   - `security-tenancy`: trust boundaries, secrets, injection, authorization, tenant isolation.
   - `contracts`: public interfaces, schemas, CLI flags and file formats against the plan's declared interfaces; a
     consumer-visible change carries a changeset.

   Each returns its findings as `{ "id": "<reviewer>-<n>", "reviewer": "<reviewer>", "blocking": true | false,
   "file": "<path>[:<line>]", "text": "<what is wrong and why>" }`. Blocking means the PR must not land as it is.
3. **One verifier per finding**: for each finding, in parallel, start a fresh subagent with only that finding, the
   input and the code. It reproduces or refutes the finding and answers `confirmed: true` or `false` with a one-line
   reason; a finding it cannot reproduce is `confirmed: false`.
4. **Record**: write every finding with its `confirmed` as one JSON list to a scratch file and run
   `fflow review <pr> --record <file>`. It refuses output that is not a list of findings and names each problem: fix
   the file and record again. Exit 1 means a confirmed blocking finding: `fflow land` refuses the PR, naming it,
   until a review of a fixed head records none.
5. **Report**: the verdict, the confirmed findings (blocking first) and the refuted ones with their reasons.

## Rules

- Reviewers and verifiers read; they never edit, commit or push.
- Never drop a finding or change its `confirmed` to get a pass.
- This review does not replace the independent `AI-REVIEW: PASS` verdict of the `stackra-reviewer` App (ADR 0230),
  which `land` also requires.
