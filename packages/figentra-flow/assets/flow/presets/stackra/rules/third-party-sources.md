---
title: Third-party sources
description: What an agent may read, port or copy from another project, and what must travel with ported code.
always: false
applies_to: ["apps/**", "packages/**", "services/**", "workers/**", "tools/**"]
manual: false
---

# Third-party sources

Porting or copying code from another project follows ADR 0291. Read this before opening a source the repository did not write.

1. A repository with no licence is never opened: not read, not ported, not used as a model.
2. Copyleft code (OSL, GPL, AGPL, LGPL) is read for behaviour only. Its code is never copied, translated or paraphrased into Stackra.
3. MIT, Apache-2.0 and BSD code may be ported. Each ported file keeps the upstream header, and `THIRD_PARTY_NOTICES.md` lists it.
4. First-party ports (earlier repositories of ours) get no per-file header. Each package gets one `ORIGIN.md` line naming the source repository and commit.
5. No port merges before the written IP assignment of ADR 0291 is signed.
6. Ported code passes the licence allow-list of ADR 0174, as dependencies do.
7. Medusa's Enterprise paths are never ported, copied or read for porting (ADR 0102).

Enforcement: planned — `pnpm validate` checks that each ported package has an `ORIGIN.md` line naming a source repository and a commit, and that its third-party code is listed in `THIRD_PARTY_NOTICES.md` (ADR 0291). The membership check against the assigned list runs outside CI and is planned too. Rules 1, 2 and 5 rely on review until a check exists.
