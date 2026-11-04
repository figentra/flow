---
title: AI tools
always: true
description: Every AI tool, server or client, is generated from its own module's declarations; nobody writes or registers a tool by hand
---

# AI tools

Every module exposes its own AI tools, and gen only collects them (ADR 0490 decision 16, ADR 0155, ADR 0245 as
amended). This applies in Stackra, OS, Commerce and every product.

- **Server tools** come from the module's own actions and queries. Every query, and every action whose `actors`
  include a user, is a tool by default (ADR 0360 decision 4); `tool: false` opts out and needs a `// reason:` (above
  or trailing), or gen fails. Risk comes from the permission; approvals and the never-bypass floor come from ADR 0360. Never write an MCP tool, a tool list or a wrapper.
- **Client tools** come from the module's own routes, panel resources, action placements, anchors (`anchor="..."`),
  tours and cards (ADR 0490 decisions 1 to 4). `ai: false` opts a declaration out. A client tool only changes the
  viewer's screen; a write is a server action, or a `.prefill` the human submits.
- **Cards** are declared once per tool output schema, with a web component, a native component and a message
  projection; the same card serves the sidekick, `ui://` in MCP hosts and WhatsApp (ADR 0490 d14, ADR 0491 d2).
- **Ownership**: a tool carries its module key and ships with its module. A module never declares a tool for another
  module's capability, and nothing outside the module lists, wraps or edits its tools. Removing a module removes its
  tools.
- **No container per module**: isolation is the module boundary and the service boundary. The only containers this
  adds are the tools-stack images (ADR 0492): Python lives only in `packages/infrastructure/infra-tools/images/`.
- **Personalisation is actions** (saved views, dashboards, widgets, user settings) in the owning package's module
  (ADR 0490 d7). **Payments**: the shopper approves their own payment by step-up; an agent never confirms one (ADR 0491).

## Enforcement

- `ToolSource` is a closed enum (`packages/application/ai/src/core/enums/tool-source.enum.ts`).
- planned — STA-1631: gen refuses client tool collisions, a `.prefill` of an action that is `tool: false`, and an
  undeclared anchor.
- planned — STA-1637: `stackra validate --repository` refuses a `.py` file outside the tools-stack images.

## See Also

- ADR 0490, 0491, 0492; ADR 0155, 0245, 0360, 0398
- Spec: `.agents/specs/sta-1629-ai-everywhere`
