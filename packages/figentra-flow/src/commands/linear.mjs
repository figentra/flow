/**
 * Figentra Flow file contract:
 * Purpose: `fflow linear` (core's `spec-linear`, moved unchanged) — link a spec and its tasks to Linear (team STA).
 * Boundary: creates Linear issues and writes only the `**Linear**` key and task ` [STA-n]` suffixes into the spec
 *           files.
 * Runtime: node
 * Governing contract: ADR 0121 (SDLC tooling roles and Linear); ADR 0065.
 *
 *   fflow linear issue <spec.md>  [--dry-run]   create the spec's issue (labelled `agent` when an agent runs it), write `**Linear**: STA-n`
 *   fflow linear tasks <tasks.md> [--dry-run]   one sub-issue per `T###` task, appends ` [STA-n]`
 *
 * The token comes from the environment only, through the vendored client in ../lib/linear.mjs
 * (LINEAR_AGENT_TOKEN, else LINEAR_API_KEY; the repo's `spec:linear` script wraps it in `infisical run`).
 * It is never read from a file or printed. `--dry-run` needs no token
 * and calls nothing. When an agent runs this flow it uses the Linear MCP instead and edits the
 * same fields by hand. `**Linear project**` (optional) names the project to file issues under.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { client, isAgent, linear, TEAM } from "../lib/linear.mjs";
import { NAME } from "../lib/product.mjs";

/** The spec's `**Linear**` key and optional project name. */
export function specLinks(text) {
  return {
    key: text.match(/^\*\*Linear\*\*:\s*(STA-\d+)\b/m)?.[1],
    project: text.match(/^\*\*Linear project\*\*:\s*(.+?)\s*$/m)?.[1],
    title: text.match(/^# Feature Specification:\s*(.+?)\s*$/m)?.[1] ?? "Untitled spec",
  };
}

/** Task lines (`- [ ] T001 ...`) that have no ` [STA-n]` yet. */
export function unlinkedTasks(text) {
  return text
    .split("\n")
    .map((line, i) => ({ line, i, m: line.match(/^- \[[ xX]\] (T\d+)\s+(.*)$/) }))
    .filter(({ m, line }) => m && !/\[STA-\d+\]\s*$/.test(line))
    .map(({ m, i }) => ({ index: i, id: m[1], title: m[2].trim() }));
}

/** The longest Linear title a task gets; Linear refuses long titles ("Argument Validation Error"). */
export const TITLE_LIMIT = 120;

/**
 * A task's Linear title: its id and the first clause of its text (up to the first `. `, `; `, `: `, ` — ` or ` (`),
 * cut at a word to `TITLE_LIMIT` characters with `…`. The whole line goes in the description.
 */
export function taskTitle(/** @type {string} */ id, /** @type {string} */ text) {
  const clause = text.split(/[.;:]\s|\s—\s|\s\(/)[0].trim() || text.trim();
  const title = `${id} ${clause}`;
  if (title.length <= TITLE_LIMIT) return title;
  const cut = title.slice(0, TITLE_LIMIT - 1);
  const space = cut.lastIndexOf(" ");
  return `${space > id.length ? cut.slice(0, space) : cut}…`;
}

/** Issues this script creates carry `agent` when an agent runs it (ADR 0121 D14), like `pnpm linear create`. */
export const labelsFor = (env = process.env) => (isAgent(env) ? ["agent"] : []);

function createIssue(L, links, title, description, parentId) {
  const project =
    links.project && links.project.toLowerCase() !== "none" ? links.project : undefined;
  return L.create({ title, project, labels: labelsFor(), description, parentId });
}

async function main([mode, file, ...flags]) {
  const dry = flags.includes("--dry-run");
  if (!["issue", "tasks"].includes(mode) || !file) {
    console.error(`usage: ${NAME} linear issue <spec.md> | tasks <tasks.md> [--dry-run]`);
    return 2;
  }
  const specPath = mode === "issue" ? file : join(dirname(file), "spec.md");
  const links = specLinks(readFileSync(specPath, "utf8"));

  if (mode === "issue") {
    if (links.key) return (console.log(`${specPath} already linked to ${links.key}`), 0);
    if (dry) return (console.log(`[dry-run] would create ${TEAM} issue "${links.title}"`), 0);
    const issue = await createIssue(linear(client()), links, links.title, `Spec: ${specPath}`);
    const text = readFileSync(specPath, "utf8").replace(
      /^\*\*Linear\*\*:.*$/m,
      `**Linear**: ${issue.identifier}`,
    );
    writeFileSync(specPath, text);
    console.log(`linked ${specPath} to ${issue.identifier}`);
    return 0;
  }

  if (!links.key) {
    console.error("spec has no **Linear** key; run `issue` first");
    return 1;
  }
  const lines = readFileSync(file, "utf8").split("\n");
  const todo = unlinkedTasks(lines.join("\n"));
  if (dry) {
    for (const t of todo)
      console.log(`[dry-run] would create sub-issue of ${links.key}: ${taskTitle(t.id, t.title)}`);
    return 0;
  }
  const L = linear(client());
  const parent = (await L.issue(links.key))?.id;
  if (!parent) throw new Error(`${links.key} not found in Linear`);
  for (const t of todo) {
    const description = `${t.id} ${t.title}\n\nSpec ${links.key}`;
    const issue = await createIssue(L, links, taskTitle(t.id, t.title), description, parent);
    lines[t.index] += ` [${issue.identifier}]`;
    writeFileSync(file, lines.join("\n"));
    console.log(`${t.id} -> ${issue.identifier}`);
  }
  return 0;
}

/** `fflow linear …`: an error becomes one `spec-linear:` line and exit 1. */
export const run = (argv) =>
  main(argv).catch((error) => {
    console.error(`spec-linear: ${error.message}`);
    return 1;
  });
