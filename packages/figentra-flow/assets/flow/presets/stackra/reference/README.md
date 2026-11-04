# `.agents/reference/`

Upstream material an agent reads **on purpose**, never by description match. Nothing here is projected into
`.claude/` or read by OpenCode, so no session loads it as a skill (ADR 0258).

| Folder    | Holds                                                                                              | Read by                                                       |
| --------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `encore/` | 14 `encore-*` skills from `encoredev/skills` (Apache-2.0; licence files stay in each folder)       | `compiler-engineer`; guardians judging generated output only |

## Why fenced

The Encore skills teach hand-written Encore.ts: `api()`, `encore.service.ts`, `~encore/clients`, `APIError`. In this
repository services and packages are plain TypeScript and Encore exists only as the output of `stackra gen` in
`.stackra/encore/` (ADR 0091, ADR 0124). The skills stay useful as the reference for what the Encore emitter must
produce, and wrong for anyone authoring a member.

## Refresh

Re-vendor deliberately, never edit in place: install the upstream skill into a scratch directory with
`npx skills add encoredev/skills -s <skill>`, then replace the folder here. Retired and not kept:
`encore-getting-started`, `encore-migrate`, `encore-frontend`.
