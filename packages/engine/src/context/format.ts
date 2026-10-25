/**
 * @vellum/engine — the per-task briefing as compact Markdown
 */

import type { TaskContext } from "./task-context.js";

/**
 * `vellum context <spec> <task>`'s Markdown: the task, then its criteria,
 * Properties, design sections and glossary terms in full, then what is
 * missing — the one section that tells the reader to open the full documents.
 */
export function formatTaskContextMarkdown(spec: string, context: TaskContext): string {
  const { task } = context;
  const out: string[] = [];
  out.push(`# Task ${task.id} — ${spec}`);
  out.push("");
  out.push(`- [${task.marker}]${task.optional ? "*" : ""} ${task.id} ${task.text}`);
  const facts: string[] = [];
  if (context.parent !== null) facts.push(`Parent: ${context.parent.id}. ${context.parent.text}`);
  if (context.wave !== null)
    facts.push(`Wave ${context.wave.id}: ${context.wave.tasks.join(", ")}`);
  if (task.subtasks.length > 0) facts.push(`Sub-tasks: ${task.subtasks.join(", ")}`);
  if (task.requirements.length > 0) facts.push(`Requirements: ${task.requirements.join(", ")}`);
  if (task.properties.length > 0) facts.push(`Properties: ${task.properties.join(", ")}`);
  if (facts.length > 0) {
    out.push("");
    for (const fact of facts) out.push(fact);
  }

  if (context.criteria.length > 0) {
    out.push("", "## Criteria", "");
    let requirement = "";
    for (const criterion of context.criteria) {
      if (criterion.requirement !== requirement) {
        requirement = criterion.requirement;
        out.push(`${requirement}`);
      }
      out.push(`- ${criterion.id} ${criterion.text}`);
    }
  }

  if (context.properties.length > 0) {
    out.push("", "## Properties");
    for (const property of context.properties) out.push("", property.text);
  }

  if (context.design.length > 0) {
    out.push("", "## Design");
    for (const section of context.design) {
      out.push("", `<!-- design.md line ${section.line} -->`, demote(section.text));
    }
  }

  if (context.glossary.length > 0) {
    out.push("", "## Glossary", "");
    for (const entry of context.glossary) out.push(`- **${entry.term}**: ${entry.definition}`);
  }

  out.push("", "## Missing", "");
  if (context.missing.length === 0) {
    out.push("None: every cited criterion and Property is above.");
  } else {
    for (const m of context.missing) out.push(`- ${m.kind} ${m.id}`);
    out.push("", "Open the full documents for what is missing.");
  }
  return `${out.join("\n")}\n`;
}

/** Headings nested under the briefing's `## Design`: at least level 3. */
function demote(text: string): string {
  const lines = text.split("\n");
  const top = /^(#{1,6})\s/.exec(lines[0] ?? "")?.[1]?.length ?? 3;
  const shift = Math.max(0, 3 - top);
  if (shift === 0) return text;
  let fenced = false;
  return lines
    .map((line) => {
      if (/^ {0,3}(`{3,}|~{3,})/.test(line)) fenced = !fenced;
      if (fenced) return line;
      const heading = /^(#{1,6})(\s.*)$/.exec(line);
      return heading?.[1] !== undefined
        ? `${"#".repeat(Math.min(6, heading[1].length + shift))}${heading[2] ?? ""}`
        : line;
    })
    .join("\n");
}
