---
"@figentra-oss/flow": patch
---

`landOne` (the function behind `fflow land`) given a `refs` issue no longer reads a key from the branch name. Before,
a branch slug that only looked like a key, such as `adr/0008-sta-12-cleanup` for a reservation that refs STA-34, won:
the squash said `Refs: STA-12`, that issue's spec was checked and that issue was moved to Done. Now `refs` is the PR's
issue: the squash names it, no spec is read by the branch's key and nothing moves to Done, as `fflow adr reserve`
intends.
