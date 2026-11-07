---
name: ai-mcp-tools
description: Expose Stackra capabilities to AI agents in the programming model v3 - which queries become MCP tools automatically, opting writes in with tool true, risk from the permission and human approval, intents for the command palette and AI triggers, Facts, Skill and Prompt kinds in the module's ai/ folder, plans that run as workflows, and the entitlement refusal. Use when an action or query should be callable by an agent, or when building agent-facing context, skills or prompts.
---

# AI and MCP tools

AI and MCP are in every package and service from the start, and all of it is free code (ADR 0155). An agent is a
principal: it acts through the same actions, the same pipeline and the same permissions as a human, as an agent actor
on behalf of the user (ADR 0098). Tools are **generated** from actions and queries, never hand-written (ADR 0245).

This is the v3 shape (ADR 0294, 0155 and 0245 as amended) that `@stackra/ai` and gen implement; the package docs win
where they differ.

## What becomes a tool (ADR 0155 as amended)

| Declaration                                  | MCP exposure                                                 |
| -------------------------------------------- | ------------------------------------------------------------ |
| `extends Query({ key })` (permission L0, L1) | A tool automatically, under the caller's own permissions     |
| `extends Action({ key })` (any write)        | Only with `tool: true` in its options                        |
| Any action whose permission is L3 or above   | Always needs a named human approval, even as a tool          |
| Plan steps at L2 and above                   | The user approves the plan before it runs (ADR 0245)         |

Risk lives on the permission (`static readonly refund = Permission.L3` on `InvoicePermissions`), so an action declares
no level and the MCP hints follow from the permission (ADR 0099 as amended).

One MCP gateway in the `ai` service serves one server per tenant over Streamable HTTP, authenticates with OAuth through
ZITADEL, filters tools by IAM and entitlements, and audits each call. A tenant that is not entitled gets
`entitlement_required` with an upgrade path, not a missing tool.

## Worked example

```ts
// src/modules/billing/queries/list-invoices.query.ts — billing.invoice.list@1, a tool automatically
/** Lists invoices visible to the caller, newest first, cursor-paginated. */
export class ListInvoicesQuery extends Query({
  key: "invoice.list",
  actors: [ActorKind.User, ActorKind.Agent, ActorKind.Service],
  intents: ["show unpaid invoices", "which invoices are overdue"], // the intent router and the command palette
}) {
  async handle(input: ListInvoicesInput, ctx: QueryContext): Promise<ListInvoicesOutput> {
    // ...
  }
}

// src/modules/billing/actions/refund-invoice.action.ts — opt in; L3 on the permission means a human approves each call
export class RefundInvoiceAction extends Action({
  key: "invoice.refund",
  actors: [ActorKind.User, ActorKind.Agent],
  tool: true,
}) {
  // ...
}
```

The class TSDoc is the tool description: say what it does, what it returns and when not to use it. The input schema is
compiled from the `handle` parameter type, so field TSDoc reaches the model.

## Facts, skills and prompts (ADR 0245 as amended)

Each is a kind class in the module's `ai/` folder:

```ts
// ai/invoice.facts.ts — facts about one invoice, permission-checked
export class InvoiceFacts extends Facts(Invoice) {
  async provide(invoice: Invoice, ctx: FactsContext): Promise<InvoiceFactsData> {
    // ...
  }
}

// ai/refunds.skill.ts
export class RefundsSkill extends Skill({
  instructions: "billing::ai/refunds.md", // loaded on demand: progressive disclosure
  tools: [ListInvoicesQuery, RefundInvoiceAction],
}) {}

// ai/explain-invoice.prompt.ts — a versioned prompt with its evaluations
export class ExplainInvoicePrompt extends Prompt({ template: "billing::ai/explain.md", version: 1 }) {}
```

`defineSkill`, `definePrompts` and `@ContextProvider` are retired.

- A **plan** is a list of actions with inputs that an agent proposes; it runs as an ephemeral workflow (ADR 0152);
  the runner refuses a step the approving user lacks permission for.
- Guardrails (ADR 0156): tool and retrieved content are untrusted; no injected tool chaining; confirmation for L2+
  writes; allow-listed URLs; personal data redacted for third-party models where configured; budgets per tenant, agent
  and user.

## Never

- A hand-written MCP tool, a tool that bypasses an action, or `@AsTool` (retired: use `tool: true`).
- A risk level on an action; it comes from the permission.
- A tool that reads tenant or user identity from its input.
- A secret or credential visible to the model; credentials are secret refs resolved by the runtime (ADR 0267, 0107).
- Asking in a spec "does this need AI?": the answer is always yes (ADR 0155).

## Check

`pnpm turbo run test --filter=<member>`, then `pnpm verify`. Review: `api-contract-reviewer`, and `security-tenancy-reviewer` for
any tool whose permission is L2 or above.
