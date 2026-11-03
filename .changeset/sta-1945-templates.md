---
"@figentra-oss/flow": minor
---

The spec and plan templates of both presets ask for documents specific enough to check (STA-1945, A-3). A spec now
states its Discovery before its requirements (current behaviour, topology, dependencies, ownership, the constraints
already decided) and lists its `### Sources` as `SRC-###` lines that every requirement cites; it adds
non-functional requirements as `NFR-###` EARS lines, measurable success criteria, and, for the small tier, a one-page
`## Design` with its folder tree and interface declarations. A plan adds the key trade-off and research, an
applicable-standards table, Mermaid architecture and sequence diagrams, per-component folder trees, interfaces,
behaviour and failure modes, partial-failure ordering and open questions. Worked examples sit in comments, which the
gate ignores. `/flow-specify` asks for the Discovery and its Sources.
