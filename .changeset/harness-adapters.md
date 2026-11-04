---
"@figentra-oss/flow": minor
---

Flow asks questions through each tool's own question UI (STA-2098 H1 to H4). The `flow-*` commands name a step's
capability instead of a tool: the question step of `flow-clarify` and `flow-specify` is an `ask` block. The new
`harnesses` key in `flow.config.json` names the tools `sync --direct` renders the commands for, each through its
harness adapter: `claude-code` (`.claude/skills/`, the `AskUserQuestion` tool: up to 4 questions, 2 to 4 options, the
recommended one first and labelled "(Recommended)"), `opencode` (`.opencode/commands/`, its `question` tool),
`copilot` (VS Code prompt files in `.github/prompts/`), `cursor` (`.cursor/commands/`) and `codex`
(`.agents/skills/`), the last three with the text table. A tool's question tool keeps the text table for when it is
unavailable. Without `harnesses` every file renders byte for byte as before. `fflow mcp` gains
`fflow_questions_list` and `fflow_docs_lookup` (read-only) and `fflow_clarification_record`, its only writer, which
records an answer in the spec's Clarifications section, replaces the matching `[NEEDS CLARIFICATION]` marker, and
asks through MCP elicitation when the client supports it and no answer was given; each tool carries `readOnlyHint`.
