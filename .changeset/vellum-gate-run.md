---
"@stackra/vellum": minor
---

`vellum gate run` checks the pushed head on a testbed box (`stackra testbed run`) or on `--box <ssh host>`, and the box posts the `vellum/gate` commit status and one PR comment as the Stackra Gate GitHub App. It refuses a dirty tree, an unpushed or detached head and a non-GitHub origin, posts only while the checked commit is the branch tip, never posts `success` unless the check passed, and keeps the App key, its tokens and every secret-looking environment value out of the comment and the log.
