---
"@figentra-oss/flow": patch
---

A repository's first `fflow sync --direct` no longer fails with ENOENT when its own projector had linked
`.claude/skills/<name>` to `.agents/skills/<name>`. The direct sync moves those renders to `.claude/` and removes the
`.agents/` copies, which left the links dangling where it writes; it now replaces a dangling link on a rendered file's
path. A link that still resolves is left alone.
