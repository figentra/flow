/**
 * Figentra Flow file contract:
 * Purpose: the harness port (STA-2098 H1, PLAN section 10): a `flow-*` command names a step's capability, not a
 *   tool, as a block `<!-- flow:<capability> -->` … `<!-- /flow:<capability> -->` on lines of their own
 *   (`CAPABILITIES`: `ask`, `todo`, `docs`, `subagent`). A harness adapter says where one tool reads a command and
 *   fills each block in for it. The fallback fill keeps the block's own words, today's text table, so a repository
 *   with no harness configured renders byte for byte what it rendered before the blocks. Claude Code (`AskUserQuestion`)
 *   and OpenCode (`question`) ask through their own question tool, the text table kept for when it is unavailable;
 *   VS Code (Copilot) prompt files, Cursor commands and Codex skills carry the text table (H3).
 * Boundary: pure text functions; `render.mjs` writes nothing through here, it only asks for paths and texts.
 * Runtime: node
 * Governing contract: STA-2098 (PLAN section 10, H1, H2, H3).
 * Secrets: none.
 */
import { CONFIG_FILE } from "../../lib/product.mjs";

/** The step capabilities a command may mark; only `ask` is filled differently by a harness so far. */
export const CAPABILITIES = Object.freeze(["ask", "todo", "docs", "subagent"]);

/** One capability block, its marker lines included (a marker may be indented, to sit inside a list). */
const BLOCK = new RegExp(
  `^[ \\t]*<!-- flow:(${CAPABILITIES.join("|")}) -->\\n([\\s\\S]*?)^[ \\t]*<!-- /flow:\\1 -->\\n`,
  "gm",
);

/**
 * One `flow-*` command as `render` read it: its name, its JSON-quoted description, its provenance front matter lines
 * (`metadata:` first) and its body with the blocks already filled.
 * @typedef {{ name: string, description: string, provenance: string[], body: string }} Command
 * @typedef {(capability: string, inner: string) => string} Fill
 * @typedef {{ path: (name: string) => string, file: (command: Command) => string, fill: Fill }} Harness
 */

/**
 * `text` with each capability block replaced by what `fill` makes of its inner lines.
 * @param {string} text
 * @param {Fill} fill
 */
export function fillCapabilities(text, fill) {
  return text.replace(BLOCK, (_, capability, inner) => fill(capability, inner));
}

/** @type {Fill} Today's text: the block's own words, the marker lines dropped. */
export const fallbackFill = (_capability, inner) => inner;

/**
 * A fill that asks through a tool's own question UI: the `ask` block opens with `how`, at the block's indent, and
 * keeps its text table as the way to ask when the tool is unavailable. Every other capability keeps its words.
 * @param {string} how
 * @returns {Fill}
 */
const askThrough = (how) => (capability, inner) =>
  capability === "ask" ? `${inner.match(/^[ \t]*(?=\S)/m)?.[0] ?? ""}${how}\n${inner}` : inner;

/**
 * Claude Code's `AskUserQuestion` (its tools reference; the limits are the tool's own input schema): 1 to 4
 * questions a call, 2 to 4 options each, and an "Other" answer the tool always adds itself.
 */
export const CLAUDE_CODE_ASK =
  "Ask with the `AskUserQuestion` tool: 1 to 4 questions per call, each with a short header and 2 to 4 options; " +
  'put the recommended option first and end its label with "(Recommended)"; never add an "Other" option, ' +
  "since the tool always lets the user type their own answer. Record that answer as given. Only when the tool is " +
  "unavailable, ask in text as below.";

/**
 * OpenCode's built-in `question` tool (opencode.ai/docs/tools: a header, the question and its options, and a custom
 * answer the user can always type; its docs state no limits, so Claude Code's are kept).
 */
export const OPENCODE_ASK =
  "Ask with the `question` tool: each question with a short header, its text and 2 to 4 options; put the " +
  'recommended option first and end its label with "(Recommended)"; the user can always type their own answer ' +
  "instead. Record that answer as given. Only when the tool is unavailable, ask in text as below.";

/** @param {Command} c the command as a skill document (`SKILL.md`). */
const skill = (c) =>
  [
    "---",
    `name: ${c.name}`,
    `description: ${c.description}`,
    ...c.provenance,
    "---",
    "",
    c.body,
  ].join("\n");

/** @param {Command} c the provenance front matter as one HTML comment, for a tool whose front matter has no `metadata`. */
const provenanceComment = (c) =>
  `<!-- ${c.provenance
    .slice(1)
    .map((l) => l.trim())
    .join("; ")} -->`;

/** @type {Harness} The neutral skill documents the repository's own projector reads. */
export const NEUTRAL = {
  path: (name) => `.agents/skills/${name}/SKILL.md`,
  file: skill,
  fill: fallbackFill,
};

/** @type {Record<string, Harness>} Each tool `sync --direct` can render the commands for, by its id. */
export const HARNESSES = {
  "claude-code": {
    path: (name) => `.claude/skills/${name}/SKILL.md`,
    file: skill,
    fill: askThrough(CLAUDE_CODE_ASK),
  },
  opencode: {
    path: (name) => `.opencode/commands/${name}.md`,
    file: (c) =>
      ["---", `description: ${c.description}`, "---", "", provenanceComment(c), "", c.body].join(
        "\n",
      ),
    fill: askThrough(OPENCODE_ASK),
  },
  // VS Code's prompt files (its docs: `.github/prompts/<name>.prompt.md`, front matter `description` and `agent`).
  copilot: {
    path: (name) => `.github/prompts/${name}.prompt.md`,
    file: (c) =>
      [
        "---",
        `description: ${c.description}`,
        "agent: agent",
        "---",
        "",
        provenanceComment(c),
        "",
        c.body,
      ].join("\n"),
    fill: fallbackFill,
  },
  // Cursor's commands: plain Markdown in `.cursor/commands/` (its docs name no front matter).
  cursor: {
    path: (name) => `.cursor/commands/${name}.md`,
    file: (c) => [provenanceComment(c), "", c.body].join("\n"),
    fill: fallbackFill,
  },
  // Codex reads a repository's skills from `.agents/skills/` (its skills docs); its custom prompts live only in
  // `~/.codex/prompts/` and are deprecated for skills, so its file is the neutral skill document.
  codex: NEUTRAL,
};

/** The ids `harnesses` in the configuration may name. */
export const HARNESS_IDS = Object.freeze(Object.keys(HARNESSES));

/** What `sync --direct` renders when the configuration names no harness: today's two tools, with today's text. */
export const DEFAULT_DIRECT = Object.freeze(["claude-code", "opencode"]);

/**
 * The files one command renders to, path to text. Without `direct`: the neutral skill document, with today's text.
 * With it: one file per harness `harnesses` names, each block filled by that harness; with none named, Claude Code's
 * and OpenCode's files with today's text (`DEFAULT_DIRECT`).
 * @param {Command} command its `body` still holds the capability blocks
 * @param {{ direct: boolean, harnesses?: string[] }} options
 * @returns {[string, string][]}
 */
export function commandFiles(command, { direct, harnesses }) {
  /** @type {[Harness, Fill][]} */
  const targets = !direct
    ? [[NEUTRAL, fallbackFill]]
    : (harnesses ?? DEFAULT_DIRECT).map((id) => {
        const harness = HARNESSES[id];
        if (!harness)
          throw new Error(
            `${CONFIG_FILE}: harnesses names "${id}"; known: ${HARNESS_IDS.join(", ")}`,
          );
        return [harness, harnesses ? harness.fill : fallbackFill];
      });
  return targets.map(([harness, fill]) => [
    harness.path(command.name),
    harness.file({ ...command, body: fillCapabilities(command.body, fill) }),
  ]);
}
