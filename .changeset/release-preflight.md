---
"@figentra-oss/flow": minor
---

`fflow release --preflight` (STA-1945): whether the owner may merge the version PR now. It reads only and fails (exit
1, each failed item named with its fix) unless the checkout is on the default branch, clean and at its GitHub head;
the Quality Gate's `verify` and `test` and the ruleset's required checks are green on main's head and on the version
PR's head; changesets are pending; the version PR is based on main's head and carries the versions the changesets
imply; each package publishes to the Release workflow's registry, which does not have the next version yet; and
`pnpm-lock.yaml`'s importers match the `package.json` files. With `--offline` the network rows are skipped, not
passed; `--json` prints the rows.
