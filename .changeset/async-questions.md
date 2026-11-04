---
"@figentra-oss/flow": minor
---

Asynchronous questions through the tracker (STA-2098, PLAN section 10 H5). `fflow spec ask <key> --async` posts the
spec's open questions (its `[NEEDS CLARIFICATION: …]` markers) as one numbered comment on the issue through the tracker
adapter, Linear or GitHub Issues, and adds `> Waiting on clarification: <comment link>` to the spec without touching
its status. `fflow spec resume <key>` reads the comments after it, records each `Q<n>: <answer>` into the spec (the
marker becomes the answer and `## Clarifications` gets the `- Q: … → A: …` bullet), removes the waiting line once
every asked question is answered, and prints what it recorded and what remains. Without `--async`, `ask` lists the
questions. The tracker adapters' `comment` now resolves to the comment's link, and both gain `comments(key)`, oldest
first; the Linear adapter takes an injected `fetch` for tests.
