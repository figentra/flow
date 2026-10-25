// Content checks for @vellum/method. Data-only package: these tests read the Markdown and JSON as
// data with Node builtins and import nothing from the workspace.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const METHOD = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI_SOURCE = join(METHOD, "..", "cli", "src", "run.ts");

const EXPECTED_SKILLS = [
  "durable-findings",
  "failure-loop",
  "spec",
  "spec-clarify",
  "spec-converge",
  "spec-design",
  "spec-implement",
  "spec-new",
  "spec-run",
  "spec-tasks",
  "spec-verify",
];
const EXPECTED_TEMPLATES = ["design.md", "requirements.md", "tasks.md"];
const AGENT_KEYS = new Set(["name", "description", "tools", "tier", "mode", "permissions", "skills"]);
// Claude Code tool names the renderers know how to map to every assistant.
const KNOWN_TOOLS = new Set([
  "Read", "Grep", "Glob", "LS", "Write", "Edit", "MultiEdit", "NotebookEdit", "Bash",
  "WebFetch", "WebSearch", "TodoWrite", "Task", "Agent", "Skill",
]);

/** Every method data file (Markdown and JSON), excluding the tests and the manifest. */
function dataFiles(dir = METHOD) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (name === "node_modules" || name === "test" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...dataFiles(path));
    else if (/\.(md|json)$/.test(name) && name !== "package.json" && name !== "turbo.json")
      out.push(path);
  }
  return out;
}

const read = (path) => readFileSync(path, "utf8");
const rel = (path) => relative(METHOD, path);

function frontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return null;
  const data = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv) data[kv[1]] = kv[2].trim();
  }
  return data;
}

/** Inline code spans and fenced blocks: the only places a command is an instruction. */
function codeText(markdown) {
  const fenced = [...markdown.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const withoutFences = markdown.replace(/```[^\n]*\n[\s\S]*?```/g, "");
  const inline = [...withoutFences.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
  return [...fenced, ...inline];
}

/**
 * The CLI's implemented command list, read as data from run.ts's IMPLEMENTED
 * array. Commands the CLI names as not implemented (they exit 2) are not in
 * it, so a method file instructing one is reported.
 */
function cliCommands() {
  const source = read(CLI_SOURCE);
  const list = /const IMPLEMENTED = \[([^\]]*)\]/.exec(source);
  assert.ok(list, "run.ts no longer has the IMPLEMENTED list this test reads");
  const names = [...list[1].matchAll(/"([a-z][\w -]*)"/g)].map((m) => m[1]);
  const commands = new Set(names.map((n) => n.split(" ")[0]));
  const taskSubcommands = new Set(
    names.filter((n) => n.startsWith("task ")).map((n) => n.slice("task ".length)),
  );
  return { commands, taskSubcommands };
}

test("the method ships the eleven skills, three templates and twelve agents", () => {
  const skills = readdirSync(join(METHOD, "skills")).filter((n) => !n.startsWith(".")).sort();
  assert.deepEqual(skills, EXPECTED_SKILLS);
  for (const s of skills) assert.ok(existsSync(join(METHOD, "skills", s, "SKILL.md")), `${s}/SKILL.md`);
  assert.deepEqual(readdirSync(join(METHOD, "templates")).sort(), EXPECTED_TEMPLATES);
  const agents = readdirSync(join(METHOD, "agents")).filter((n) => n.endsWith(".md"));
  assert.equal(agents.length, 12);
});

test("no method file contains CLAUDE_PLUGIN_ROOT", () => {
  const offenders = dataFiles().filter((f) => read(f).includes("CLAUDE_PLUGIN_ROOT")).map(rel);
  assert.deepEqual(offenders, []);
});

test("the CLI command list read from packages/cli is the one the method was written against", () => {
  const { commands, taskSubcommands } = cliCommands();
  // Guards against a parse that silently finds nothing and makes the next test vacuous.
  for (const c of ["status", "lint", "verify", "approve", "task", "doctor", "adopt", "stamp"])
    assert.ok(commands.has(c), `run.ts has no '${c}' command`);
  assert.deepEqual([...taskSubcommands].sort(), ["complete", "start"]);
});

test("every vellum subcommand a method file names exists in the CLI", () => {
  const { commands, taskSubcommands } = cliCommands();
  const unknown = [];
  let seen = 0;
  for (const file of dataFiles().filter((f) => f.endsWith(".md"))) {
    for (const code of codeText(read(file))) {
      for (const m of code.matchAll(/(?:^|[\s(;&|])vellum\s+([a-z][\w-]*)(?:\s+([a-z][\w-]*))?/g)) {
        seen++;
        const [, command, next] = m;
        if (!commands.has(command)) unknown.push(`${rel(file)}: vellum ${command}`);
        else if (command === "task" && !taskSubcommands.has(next ?? ""))
          unknown.push(`${rel(file)}: vellum task ${next ?? "(none)"}`);
      }
    }
  }
  assert.deepEqual(unknown, []);
  assert.ok(seen > 0, "no vellum command found in any method file; the scan is broken");
});

test("the skills call the stage detector and validator through the CLI", () => {
  const all = EXPECTED_SKILLS.map((s) => read(join(METHOD, "skills", s, "SKILL.md"))).join("\n");
  assert.match(all, /vellum status/);
  assert.match(all, /vellum lint/);
  assert.match(all, /vellum task complete/);
  assert.doesNotMatch(all, /spec-(status|lint)\.mjs/);
});

test("a skill that restricts Bash may run the vellum commands it tells the reader to run", () => {
  for (const name of EXPECTED_SKILLS) {
    const text = read(join(METHOD, "skills", name, "SKILL.md"));
    const allowed = /^allowed-tools:\s*(.+)$/m.exec(text)?.[1];
    if (allowed === undefined || !/```bash\n[^`]*\bvellum\b/.test(text)) continue;
    assert.match(allowed, /Bash\(vellum:\*\)/, `${name}: runs vellum but allowed-tools does not grant Bash(vellum:*)`);
    assert.match(allowed, /Bash\(npx vellum:\*\)/, `${name}: runs vellum but allowed-tools does not grant Bash(npx vellum:*)`);
  }
});

test("no method file claims vellum status --json reports a stage or root field", () => {
  const claims = [];
  for (const file of dataFiles()) {
    const text = read(file);
    if (/reports? (it as )?`root`|resolved `root`|root it reports|each spec's stage \(|its stage\s*\(`empty`/.test(text)) {
      claims.push(relative(METHOD, file));
    }
  }
  assert.deepEqual(claims, []);
});

test("no method file carries a product, repository or plugin specific", () => {
  const forbidden = [
    [/basalt/i, "basalt"],
    [/figentra/i, "figentra"],
    [/academorix/i, "academorix"],
    [/stackra/i, "stackra"],
    [/\bsdlc\b/i, "the sdlc plugin name"],
    [/\bADR-?\d{3,4}\b/i, "an ADR number"],
    [/adr\/\d{4}-/i, "an ADR file"],
    [/packages\/os\b/, "packages/os"],
    [/apps\/docs\b/, "apps/docs"],
  ];
  const hits = [];
  // The package README records where the method came from; everything shipped must be neutral.
  for (const file of dataFiles().filter((f) => rel(f) !== "README.md")) {
    read(file).split("\n").forEach((line, i) => {
      for (const [re, label] of forbidden) if (re.test(line)) hits.push(`${rel(file)}:${i + 1} ${label}`);
    });
  }
  assert.deepEqual(hits, []);
});

test("agents and skills name tiers, never models", () => {
  const hits = dataFiles()
    .filter((f) => f.endsWith(".md"))
    .filter((f) => /\b(opus|sonnet|haiku)\b/i.test(read(f)))
    .map(rel);
  assert.deepEqual(hits, []);
});

test("every skill has frontmatter whose name is its directory and a description", () => {
  for (const s of EXPECTED_SKILLS) {
    const fm = frontmatter(read(join(METHOD, "skills", s, "SKILL.md")));
    assert.ok(fm, `${s}: no frontmatter`);
    assert.equal(fm.name, s);
    assert.ok(fm.description && fm.description.length > 20, `${s}: description`);
  }
});

test("every template a skill names exists in templates/", () => {
  const named = new Set();
  for (const s of EXPECTED_SKILLS)
    for (const m of read(join(METHOD, "skills", s, "SKILL.md")).matchAll(/templates\/([a-z-]+\.md)/g))
      named.add(m[1]);
  assert.ok(named.size > 0);
  for (const t of named) assert.ok(EXPECTED_TEMPLATES.includes(t), `skills name templates/${t}`);
});

test("models.json maps every tier for every assistant", () => {
  const models = JSON.parse(read(join(METHOD, "models.json")));
  assert.deepEqual(models.tiers, ["economy", "standard", "frontier"]);
  for (const assistant of ["claude", "kiro", "opencode"]) {
    const row = models.assistants[assistant];
    assert.ok(row, assistant);
    for (const tier of models.tiers) {
      assert.ok(tier in row, `${assistant}.${tier}`);
      assert.ok(row[tier] === null || typeof row[tier] === "string", `${assistant}.${tier}`);
    }
  }
});

test("every agent carries neutral frontmatter only", () => {
  const models = JSON.parse(read(join(METHOD, "models.json")));
  const dir = join(METHOD, "agents");
  for (const file of readdirSync(dir).filter((n) => n.endsWith(".md"))) {
    const fm = frontmatter(read(join(dir, file)));
    assert.ok(fm, `${file}: no frontmatter`);
    for (const key of Object.keys(fm)) assert.ok(AGENT_KEYS.has(key), `${file}: unknown key '${key}'`);
    assert.equal(fm.name, file.replace(/\.md$/, ""), `${file}: name must equal the file stem`);
    assert.ok(fm.description, `${file}: description`);
    assert.ok(models.tiers.includes(fm.tier), `${file}: tier '${fm.tier}'`);
    for (const tool of (fm.tools ?? "").split(",").map((t) => t.trim()).filter(Boolean))
      assert.ok(KNOWN_TOOLS.has(tool), `${file}: tool '${tool}'`);
    if (fm.skills) {
      const skills = fm.skills.replace(/^\[|\]$/g, "").split(",").map((s) => s.trim()).filter(Boolean);
      for (const s of skills) assert.ok(EXPECTED_SKILLS.includes(s), `${file}: skill '${s}'`);
    }
  }
});

const skill = (name) => read(join(METHOD, "skills", name, "SKILL.md"));

test("spec-clarify and spec-converge exist with frontmatter naming them", () => {
  for (const name of ["spec-clarify", "spec-converge"]) {
    assert.ok(existsSync(join(METHOD, "skills", name, "SKILL.md")), `${name}/SKILL.md`);
    const fm = frontmatter(skill(name));
    assert.ok(fm, `${name}: no frontmatter`);
    assert.equal(fm.name, name);
    assert.ok(fm.description && fm.description.length > 20, `${name}: description`);
  }
});

test("spec-clarify caps a session at five questions and resolves clarification markers", () => {
  const clarify = skill("spec-clarify");
  assert.match(clarify, /\*\*Ask at most 5 questions per invocation\.\*\*/);
  assert.match(clarify, /Never ask more than five questions in one invocation/);
  assert.match(clarify, /\[NEEDS CLARIFICATION: /);
  assert.match(clarify, /## Clarifications/);
  // The approval is bound to the checksum; a clarified document needs a human to re-approve it.
  assert.match(clarify, /`npx vellum approve <NNN> requirements`/);
  assert.match(clarify, /Never run `npx vellum approve`/);
  // spec-new is the producer of the marker spec-clarify resolves; spec-design stops on one.
  assert.match(skill("spec-new"), /\[NEEDS CLARIFICATION: /);
  assert.match(skill("spec-design"), /NEEDS CLARIFICATION/);
});

test("spec-converge treats [x] without evidence as a gap and never marks a task done", () => {
  const converge = skill("spec-converge");
  assert.match(converge, /a completion claim is not evidence/);
  assert.match(converge, /A `\[x\]` with no such entry is an \*\*unverified completion\*\*, and it is a gap/);
  assert.match(converge, /Never mark a task done, and never write `\[x\]`/);
  assert.match(converge, /Never treat `\[x\]` as evidence/);
  assert.match(converge, /Never edit `requirements\.md` or `design\.md`/);
  assert.match(converge, /Never delete, reorder, renumber or reword an existing task/);
  // Evidence is read through the CLI, with flags the CLI accepts.
  assert.match(converge, /vellum verify <NNN> --strict --json/);
  assert.match(converge, /vellum status <NNN> --json/);
  assert.match(converge, /`npx vellum approve <NNN> tasks`/);
  for (const cls of ["missing", "partial", "contradicts", "unrequested", "unverified completion"])
    assert.match(converge, new RegExp(`\\*\\*${cls}\\*\\*`), cls);
});

test("the flag each new skill passes to the CLI is one the CLI accepts", () => {
  const source = read(join(METHOD, "..", "cli", "src", "run.ts"));
  const verify = /case "verify": \{[\s\S]*?checkOptions\(ctx, args, command, \[([^\]]*)\]\)/.exec(source);
  assert.ok(verify, "run.ts no longer declares verify's options where this test reads them");
  assert.match(verify[1], /"strict"/);
  assert.match(verify[1], /"json"/);
});

test("the lifecycle names both new skills where it hands off", () => {
  assert.match(skill("spec"), /spec-clarify/);
  assert.match(skill("spec"), /spec-converge/);
  assert.match(skill("spec-new"), /spec-clarify/);
  assert.match(skill("spec-run"), /spec-converge/);
  assert.match(skill("spec-implement"), /spec-converge/);
  const roster = read(join(METHOD, "ROSTER.md"));
  assert.match(roster, /`spec-author`\s*\|[^\n]*`spec-clarify`/);
  assert.match(roster, /`spec-planner`\s*\|[^\n]*`spec-converge`/);
});

test("each new skill names the persona agent that lists it", () => {
  for (const [name, agent] of [["spec-clarify", "spec-author"], ["spec-converge", "spec-planner"]]) {
    assert.match(skill(name), new RegExp(`\\*\\*Persona:\\*\\* this contract is run by the \`${agent}\` agent`));
    const fm = frontmatter(read(join(METHOD, "agents", `${agent}.md`)));
    assert.match(fm.skills, new RegExp(`\\b${name}\\b`), `${agent} does not list ${name}`);
  }
});

test("skills and agents invoke the CLI through npx, which finds the project's local install", () => {
  // @figentra/vellum is a project dev dependency, so a bare `vellum` is not on PATH
  // inside an assistant's shell; `npx vellum` resolves the local bin (or a global one).
  const bare = /(?<![\w@/.\-])(?<!npx )vellum (?:status|lint|verify|check|doctor|approve|task|trace|adopt|stamp)\b/;
  const offenders = [];
  for (const file of dataFiles().filter((f) => f.endsWith(".md"))) {
    const text = readFileSync(file, "utf8");
    text.split("\n").forEach((line, i) => {
      if (bare.test(line)) offenders.push(`${rel(file)}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, []);
});

/** The fenced bash blocks of a skill: the commands it instructs the reader to run. */
const bashBlocks = (name) =>
  [...skill(name).matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]).join("\n");

test("spec-new adopts the requirements it writes, and stamps every rewrite", () => {
  // A bare requirements.md is a legacy spec: status says legacy and approve refuses it.
  const commands = bashBlocks("spec-new");
  assert.match(commands, /^\s*npx vellum adopt <NNN>$/m);
  assert.match(commands, /^\s*npx vellum stamp <NNN>$/m);
  assert.ok(
    skill("spec-new").indexOf("npx vellum adopt <NNN>") < skill("spec-new").indexOf("## Step 6"),
    "spec-new adopts before it reports and hands off",
  );
});

test("every other skill that writes or edits a document stamps it with the CLI", () => {
  for (const name of ["spec-design", "spec-tasks", "spec-clarify", "spec-converge", "spec-implement"]) {
    assert.match(bashBlocks(name), /^\s*npx vellum stamp <NNN>$/m, `${name} does not run npx vellum stamp`);
    assert.doesNotMatch(bashBlocks(name), /vellum adopt/, `${name} adopts; only spec-new creates a spec`);
  }
  // The read-only skills never write frontmatter.
  for (const name of ["spec-verify", "spec-run"]) {
    assert.doesNotMatch(bashBlocks(name), /vellum (adopt|stamp)/, `${name} is read-only`);
  }
});

test("no skill tells the reader to write Lifecycle Frontmatter by hand", () => {
  for (const name of ["spec-new", "spec-design", "spec-tasks"]) {
    assert.match(skill(name), /[Nn]ever write (or repair )?frontmatter by hand/, name);
  }
});

test("each approval hand-off says what to do when approve refuses a stale checksum", () => {
  for (const name of ["spec-new", "spec-design", "spec-tasks", "spec-clarify", "spec-converge"]) {
    assert.match(
      skill(name),
      /refuses because the frontmatter checksum of the document is\s+stale[\s\S]{0,120}`npx vellum stamp <NNN>`\s+first/,
      name,
    );
  }
});

test("the parent-completion rule is decision 15's wherever the method states it", () => {
  // A parent is complete when its required sub-tasks are, or, all optional, when every one is.
  const rule = /complete when its required sub-tasks are, or, when all\s+(its\s+)?sub-tasks are\s+optional, when every one of them is/;
  for (const name of ["spec-tasks", "spec-implement"]) assert.match(skill(name), rule, name);
  assert.match(readFileSync(join(METHOD, "templates", "tasks.md"), "utf8"), rule, "templates/tasks.md");
});
