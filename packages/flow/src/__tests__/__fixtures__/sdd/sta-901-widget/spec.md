# Feature Specification: Widget fixture

**Status**: Done

**Linear**: STA-901

**Clarifications status**: complete

**Input**: User description: "a fixture for spec-gate and spec-trace tests"

## Impact

- **Apps touched**: none
- **Services touched**: none
- **Packages touched**: `packages/foundation/widget`
- **Public contract change**: additive
- **Cross-service events**: none
- **Tenancy and data**: none
- **Security and privacy**: none
- **Secrets**: none
- **ADR needed**: no
- **New dependencies**: none
- **Deploy modes**: same in all three
- **Licence tier**: free (MIT, this repo)
- **UI surfaces**: none
- **Docs to update**: `apps/docs/src/docs/guides/widget.mdx`
- **Lane**: lite
- **Change risk**: R1

## Requirements

- **FR-001**: WHEN a widget is built THE builder SHALL return it.
- **FR-002**: WHEN a widget is empty THE builder SHALL refuse it.
- ~~**FR-003**~~: (A-001) struck.

## Success Criteria

- **SC-001**: Builds finish in 1 s — verified by: unit
- **SC-002**: The guide shows the widget — verified by: manual

## Status history

- 2026-10-20 · — → Draft · fixture · created
- 2026-10-20 · Draft → Clarified · fixture · owner go
- 2026-10-20 · Clarified → Planned · fixture
- 2026-10-20 · Planned → Tasked · fixture
- 2026-10-20 · Tasked → Implementing · fixture
- 2026-10-20 · Implementing → Done · fixture
