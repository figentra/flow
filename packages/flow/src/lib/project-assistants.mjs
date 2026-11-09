/**
 * Figentra Flow file contract:
 * Purpose: `projectAssistants` (STA-2098 H6): projects `.agents/` into each assistant's own folders, the work a
 *   repository's `agents:sync` script did. Agents (`.agents/agents/<id>.md`) are generated per assistant in its own
 *   front matter dialect, the model from the agent's `tier` and `.agents/models.yaml` (or its own `model`): Claude Code
 *   in `.claude/agents/`, OpenCode in `.opencode/agents/` with its permissions derived from the tools. Skills, hooks and
 *   templates are linked entry by entry (Claude Code: skills, hooks, templates; OpenCode: templates, since it reads
 *   `.agents/skills` itself). `.agents/hooks/_reviewer-agents.mjs` lists the `reviewer: true` agents for the guard, and
 *   `.mcp.json` is rendered from `.mcp.yaml`, the only project MCP file Claude Code reads.
 * Boundary: writes only the links and generated files it owns; a real file in their place that it did not generate is
 *   a conflict and is never overwritten. With `check` it writes nothing and reports drift. An assistant is projected
 *   when its folder exists (`.claude/`, `.opencode/`). An invalid agent or models file is `broken`, never skipped.
 * Runtime: node
 * Governing contract: STA-2098 (H6: Flow owns rendering into every tool's folders, replacing a repository's own sync
 *   script); ADR 0510.
 * Secrets: none.
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";

import { NAME } from "./product.mjs";
import { parseYaml } from "./yaml.mjs";

/** Where every source lives. */
const SOURCE = ".agents";

/** Where each assistant keeps each kind; `null` is a kind it does not take. */
const ASSISTANTS = /** @type {const} */ ({
  claude: {
    dir: ".claude",
    map: { skills: "skills", agents: "agents", hooks: "hooks", templates: "templates" },
  },
  opencode: {
    dir: ".opencode",
    map: { skills: null, agents: "agents", hooks: null, templates: "templates" },
  },
});

/** The kinds that are the same bytes for every assistant, so linked. */
const LINKED = /** @type {const} */ (["skills", "hooks", "templates"]);

/** A Claude Code tool and the OpenCode permission action it needs; OpenCode has no tool grant, so a missing one is denied. */
const OPENCODE_ACTIONS = {
  Write: "edit",
  Edit: "edit",
  MultiEdit: "edit",
  NotebookEdit: "edit",
  Bash: "shell",
  WebFetch: "webfetch",
  WebSearch: "websearch",
  Task: "subagent",
  Agent: "subagent",
};

/** A neutral model alias and its Claude Code model; one missing here is left out. */
const CLAUDE_MODELS = { opus: "opus", sonnet: "sonnet", haiku: "haiku", inherit: "inherit" };

/** The keys an agent's front matter may set. */
const AGENT_KEYS = new Set([
  "name",
  "description",
  "tools",
  "model",
  "tier",
  "mode",
  "blocks",
  "permissions",
  "skills",
  "assistants",
  "reviewer",
]);

/**
 * One neutral agent.
 * @typedef {{ name: string, description: string, tools?: string[], model?: string, tier?: string,
 *   mode: string, permissions?: { action: string, resource: string, effect: string }[], skills?: string[],
 *   assistants?: string[], reviewer: boolean }} Agent
 * @typedef {{ tiers: string[], assistants: Record<string, Record<string, string | null>> }} ModelMap
 * @typedef {{ written: string[], linked: string[], pruned: string[], ok: number, drift: string[], conflict: string[],
 *   broken: string[] }} Projection
 */

/** `s` without one pair of matching outer quotes. */
const unquote = (/** @type {string} */ s) =>
  (s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))
    ? s.slice(1, -1)
    : s;

/** A front matter value: a boolean, a flow list or a scalar. */
function scalarOrList(/** @type {string} */ v) {
  if (v === "true") return true;
  if (v === "false") return false;
  if (v.startsWith("[") && v.endsWith("]")) {
    const inner = v.slice(1, -1).trim();
    return inner === ""
      ? []
      : inner
          .split(",")
          .map((s) => unquote(s.trim()))
          .filter((s) => s !== "");
  }
  return unquote(v);
}

/**
 * An agent file's front matter (the small YAML subset agents use) and body.
 * @param {string} raw
 * @returns {{ data: Record<string, any>, body: string } | string} a string names why it cannot be read
 */
function frontMatter(raw) {
  if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) return 'it must start with "---"';
  const open = raw.indexOf("\n");
  const close = raw.indexOf("\n---", open);
  if (close === -1) return 'its front matter has no closing "---"';
  const lines = raw.slice(open + 1, close).split(/\r?\n/);
  /** @type {Record<string, any>} */
  const data = {};
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    let value = m[2].trim();
    if (key === "permissions" && value === "") {
      /** @type {Record<string, any>[]} */
      const permissions = [];
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
        i += 1;
        /** @type {Record<string, any>} */
        const permission = {};
        let match = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[i].trim().replace(/^-\s+/, ""));
        if (match) permission[match[1]] = scalarOrList(match[2].trim());
        while (i + 1 < lines.length && /^\s+[A-Za-z_][\w-]*:\s*/.test(lines[i + 1])) {
          i += 1;
          match = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[i].trim());
          if (match) permission[match[1]] = scalarOrList(match[2].trim());
        }
        permissions.push(permission);
      }
      data.permissions = permissions;
      continue;
    }
    if (value.startsWith("[") && !value.endsWith("]")) {
      const parts = [value];
      while (i + 1 < lines.length && !parts.at(-1)?.trimEnd().endsWith("]")) {
        i += 1;
        parts.push(lines[i].trim());
      }
      value = parts.join(" ");
    } else if (value === "" && /^\s*-\s+/.test(lines[i + 1] ?? "")) {
      /** @type {string[]} */
      const items = [];
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
        i += 1;
        items.push(unquote(lines[i].trim().replace(/^-\s+/, "")));
      }
      data[key] = items;
      continue;
    }
    data[key] = scalarOrList(value);
  }
  return { data, body: raw.slice(close + 4).replace(/^\r?\n/, "") };
}

/**
 * `.agents/models.yaml`: the tiers, cheapest first, and each assistant's model per tier (`null` for its default).
 * @param {string} root
 * @returns {ModelMap | string | undefined} a string names why it is invalid; undefined when there is none
 */
function modelMapOf(root) {
  const file = join(root, SOURCE, "models.yaml");
  if (!existsSync(file)) return undefined;
  let data;
  try {
    data = parseYaml(readFileSync(file, "utf8"));
  } catch (error) {
    return `${SOURCE}/models.yaml: ${/** @type {Error} */ (error).message}`;
  }
  const tiers = data?.tiers;
  const assistants = data?.assistants ?? {};
  const errors = [];
  if (!Array.isArray(tiers) || tiers.length === 0 || tiers.some((t) => typeof t !== "string"))
    errors.push("'tiers' must be a non-empty list of tier names, cheapest first");
  for (const name of Object.keys(ASSISTANTS)) {
    const row = assistants[name];
    if (!row || typeof row !== "object") {
      errors.push(`'assistants.${name}' is missing`);
      continue;
    }
    for (const [tier, model] of Object.entries(row)) {
      if (!tiers?.includes?.(tier))
        errors.push(`'assistants.${name}.${tier}' is not a tier in 'tiers'`);
      else if (model !== null && typeof model !== "string")
        errors.push(`'assistants.${name}.${tier}' must be a model id or null`);
    }
  }
  for (const tier of Array.isArray(tiers) ? tiers : [])
    if (!Object.values(assistants).some((row) => row && typeof row === "object" && tier in row))
      errors.push(
        `tier '${tier}' is mapped for no assistant (use null for the assistant's default)`,
      );
  return errors.length ? `${SOURCE}/models.yaml: ${errors.join("; ")}` : { tiers, assistants };
}

/**
 * One agent source checked and resolved, or why it is invalid.
 * @param {string} root
 * @param {string} entry the file name
 * @param {ModelMap | undefined} models
 * @returns {{ agent: Agent, body: string } | string}
 */
function agentOf(root, entry, models) {
  const parsed = frontMatter(readFileSync(join(root, SOURCE, "agents", entry), "utf8"));
  if (typeof parsed === "string") return parsed;
  const { data, body } = parsed;
  const stem = entry.replace(/\.md$/, "");
  const errors = Object.keys(data)
    .filter((key) => !AGENT_KEYS.has(key))
    .map((key) => `unknown key '${key}'`);
  if (data.reviewer !== undefined && typeof data.reviewer !== "boolean")
    errors.push("'reviewer' must be true or false");
  if (data.name !== undefined && data.name !== stem)
    errors.push(`'name' is '${data.name}' but the file is ${entry}; they must match`);
  if (!data.description || typeof data.description !== "string")
    errors.push("missing or non-string 'description'");
  if (data.model !== undefined && typeof data.model !== "string")
    errors.push("'model' must be a string");
  if (data.tier !== undefined) {
    if (!models) errors.push(`'tier' needs ${SOURCE}/models.yaml, which does not exist`);
    else if (!models.tiers.includes(data.tier))
      errors.push(
        `'tier' is '${data.tier}'; ${SOURCE}/models.yaml defines: ${models.tiers.join(", ")}`,
      );
  }
  if (
    data.assistants !== undefined &&
    (!Array.isArray(data.assistants) || data.assistants.some((a) => !(a in ASSISTANTS)))
  )
    errors.push(`'assistants' must be a list of: ${Object.keys(ASSISTANTS).join(", ")}`);
  if (data.mode !== undefined && !["primary", "subagent", "all"].includes(data.mode))
    errors.push("'mode' must be one of: primary, subagent, all");
  if (data.skills !== undefined && !Array.isArray(data.skills))
    errors.push("'skills' must be a list of skill names");
  else
    for (const skill of data.skills ?? [])
      if (
        !String(skill).includes(":") &&
        !existsSync(join(root, SOURCE, "skills", String(skill), "SKILL.md"))
      )
        errors.push(`skill ${skill} is not at ${SOURCE}/skills/<name>/SKILL.md`);
  if (data.permissions !== undefined)
    for (const [i, p] of (Array.isArray(data.permissions)
      ? data.permissions
      : [undefined]
    ).entries())
      if (
        !p ||
        typeof p.action !== "string" ||
        typeof p.resource !== "string" ||
        !["allow", "ask", "deny"].includes(p.effect)
      )
        errors.push(
          `'permissions[${i}]' needs a string action and resource and an effect of allow, ask or deny`,
        );
  if (errors.length) return errors.join("; ");
  const tools =
    data.tools === undefined
      ? undefined
      : (Array.isArray(data.tools) ? data.tools : String(data.tools).split(","))
          .map((t) => String(t).trim())
          .filter(Boolean);
  return {
    agent: {
      name: stem,
      description: data.description,
      ...(tools === undefined ? {} : { tools }),
      ...(data.model === undefined ? {} : { model: data.model }),
      ...(data.tier === undefined ? {} : { tier: data.tier }),
      mode: data.mode ?? "subagent",
      ...(data.permissions === undefined ? {} : { permissions: data.permissions }),
      ...(data.skills === undefined ? {} : { skills: data.skills.map(String) }),
      ...(data.assistants === undefined ? {} : { assistants: data.assistants }),
      reviewer: data.reviewer === true,
    },
    body,
  };
}

/** Whether `agent` goes to `assistant`: its `assistants` list names it, and the models file maps its tier there. */
const projectsTo = (
  /** @type {Agent} */ agent,
  /** @type {string} */ assistant,
  /** @type {ModelMap | undefined} */ models,
) =>
  (!agent.assistants || agent.assistants.includes(assistant)) &&
  (agent.tier === undefined ||
    (models !== undefined && agent.tier in models.assistants[assistant]));

/**
 * The model `assistant` runs `agent` on: its own `model`, else its tier's; undefined for the assistant's default.
 * @param {Agent} agent
 * @param {"claude" | "opencode"} assistant
 * @param {ModelMap | undefined} models
 */
function modelFor(agent, assistant, models) {
  if (agent.model !== undefined) {
    if (assistant === "claude") {
      if (agent.model in CLAUDE_MODELS)
        return CLAUDE_MODELS[/** @type {keyof typeof CLAUDE_MODELS} */ (agent.model)];
      const [provider, ...rest] = agent.model.split("/");
      return provider === "anthropic" && rest.length ? rest.join("/") : undefined;
    }
    return agent.model.includes("/") ? agent.model : undefined;
  }
  return agent.tier === undefined
    ? undefined
    : (models?.assistants[assistant]?.[agent.tier] ?? undefined);
}

/** `value` as a deterministic YAML scalar. */
const yamlScalar = (/** @type {unknown} */ value) =>
  typeof value === "boolean" || typeof value === "number"
    ? String(value)
    : `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll(/\r?\n/g, " ")}"`;

/** Each assistant's front matter lines for an agent. */
const DIALECTS = {
  claude: (/** @type {Agent} */ agent, /** @type {ModelMap | undefined} */ models) => {
    const model = modelFor(agent, "claude", models);
    return [
      `name: ${agent.name}`,
      `description: ${yamlScalar(agent.description)}`,
      ...(agent.tools ? [`tools: ${agent.tools.join(", ")}`] : []),
      ...(model ? [`model: ${model}`] : []),
      ...(agent.skills?.length ? ["skills:", ...agent.skills.map((s) => `  - ${s}`)] : []),
    ];
  },
  opencode: (/** @type {Agent} */ agent, /** @type {ModelMap | undefined} */ models) => {
    const model = modelFor(agent, "opencode", models);
    // A full grant adds nothing: an agent-level allow would widen the project's own denies.
    const granted = new Set(
      (agent.tools ?? [])
        .map((t) => OPENCODE_ACTIONS[/** @type {keyof typeof OPENCODE_ACTIONS} */ (t)])
        .filter(Boolean),
    );
    const derived = agent.tools
      ? [...new Set(Object.values(OPENCODE_ACTIONS))]
          .filter((action) => !granted.has(action))
          .map((action) => ({ action, resource: "*", effect: "deny" }))
      : [];
    const permissions = agent.permissions ?? derived;
    return [
      `description: ${yamlScalar(agent.description)}`,
      `mode: ${agent.mode}`,
      ...(model ? [`model: ${yamlScalar(model)}`] : []),
      ...(permissions.length
        ? [
            "permissions:",
            ...permissions.flatMap((p) => [
              `  - action: ${yamlScalar(p.action)}`,
              `    resource: ${yamlScalar(p.resource)}`,
              `    effect: ${p.effect}`,
            ]),
          ]
        : []),
    ];
  },
};

/** The line a generated agent carries after its front matter, naming its source. */
const provenance = (/** @type {string} */ sourceRel) =>
  `<!-- generated from ${sourceRel} by ${NAME} sync — edit the source, not this file -->`;

/** Whether `content` is a generated agent of `sourceRel` (this module's, or a repository script's before it). */
const generatedFrom = (/** @type {string} */ content, /** @type {string} */ sourceRel) =>
  content.includes(`<!-- generated from ${sourceRel} by `);

/** The reviewer list module the guard reads. */
function reviewerModule(/** @type {string[]} */ names) {
  const oneLine = `export const REVIEWER_AGENTS = new Set([${names.map((n) => `"${n}"`).join(", ")}]);`;
  return [
    "/**",
    " * Figentra Flow file contract:",
    ` * Purpose: generated from ${SOURCE}/agents (reviewer: true) by ${NAME} sync; edit the sources, not this file.`,
    " * Boundary: data only; the agent types the guard lets run a review.",
    " * Runtime: node (agent hook)",
    " * Governing contract: STA-2098 (H6).",
    " */",
    "/** Agent types that may run a review; the guard denies every other caller. */",
    oneLine.length <= 100
      ? oneLine
      : ["export const REVIEWER_AGENTS = new Set([", ...names.map((n) => `  "${n}",`), "]);"].join(
          "\n",
        ),
    "",
  ].join("\n");
}

/** Entries under `.agents/<kind>/`, dotfiles and the README left out. */
const entriesOf = (/** @type {string} */ root, /** @type {string} */ kind) => {
  const dir = join(root, SOURCE, kind);
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => !name.startsWith(".") && name.toLowerCase() !== "readme.md")
        .sort()
    : [];
};

/** Whether `path` is a symbolic link. */
const isLink = (/** @type {string} */ path) => {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
};

/**
 * Projects `.agents/` into each assistant folder that exists under `root`.
 * @param {string} root
 * @param {{ check?: boolean }} [options] `check`: write nothing and report drift
 * @returns {Projection}
 */
export function projectAssistants(root, { check = false } = {}) {
  /** @type {Projection} */
  const out = { written: [], linked: [], pruned: [], ok: 0, drift: [], conflict: [], broken: [] };
  const models = modelMapOf(root);
  if (typeof models === "string") {
    out.broken.push(models);
    return out;
  }
  /** Writes `text` at `rel` unless it is already there; a file of someone else's is a conflict. */
  const write = (
    /** @type {string} */ rel,
    /** @type {string} */ text,
    /** @type {(current: string) => boolean} */ ours,
  ) => {
    const path = join(root, rel);
    const present = existsSync(path) && !isLink(path);
    if (present && readFileSync(path, "utf8") === text) return void (out.ok += 1);
    if (present && !ours(readFileSync(path, "utf8")))
      return void out.conflict.push(`${rel}: a file ${NAME} did not generate`);
    if (check) return void out.drift.push(`${rel}: ${present ? "stale" : "missing"}`);
    if (isLink(path)) rmSync(path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    out.written.push(rel);
  };

  const agents = entriesOf(root, "agents")
    .filter((entry) => /^[a-z][a-z0-9-]*\.md$/.test(entry))
    .flatMap((entry) => {
      const read = agentOf(root, entry, models);
      if (typeof read === "string") {
        out.broken.push(`${SOURCE}/agents/${entry}: ${read}`);
        return [];
      }
      return [{ entry, ...read }];
    });

  // Before the links, so the hooks folder links the list too.
  if (existsSync(join(root, SOURCE, "hooks")) && agents.length > 0)
    write(
      `${SOURCE}/hooks/_reviewer-agents.mjs`,
      reviewerModule(
        agents
          .filter((a) => a.agent.reviewer)
          .map((a) => a.agent.name)
          .sort(),
      ),
      (current) => current.includes(`generated from ${SOURCE}/agents (reviewer: true)`),
    );

  for (const [name, { dir, map }] of Object.entries(ASSISTANTS)) {
    if (!existsSync(join(root, dir))) continue;
    for (const kind of LINKED) {
      const dest = map[kind];
      if (dest === null) continue;
      for (const entry of entriesOf(root, kind)) {
        const rel = `${dir}/${dest}/${entry}`;
        const path = join(root, rel);
        const target = relative(dirname(path), join(root, SOURCE, kind, entry));
        if (isLink(path) && readlinkSync(path) === target) {
          out.ok += 1;
          continue;
        }
        if (existsSync(path) && !isLink(path)) {
          out.conflict.push(
            `${rel}: a real file where a link to ${SOURCE}/${kind}/${entry} belongs`,
          );
          continue;
        }
        if (check) {
          out.drift.push(`${rel}: ${isLink(path) ? "points elsewhere" : "missing"}`);
          continue;
        }
        if (isLink(path)) rmSync(path);
        mkdirSync(dirname(path), { recursive: true });
        symlinkSync(target, path);
        out.linked.push(rel);
      }
    }
    if (map.agents === null) continue;
    const dialect = DIALECTS[/** @type {keyof typeof DIALECTS} */ (name)];
    const projected = agents.filter((a) => projectsTo(a.agent, name, models));
    for (const { entry, agent, body } of projected) {
      const sourceRel = `${SOURCE}/agents/${entry}`;
      const text = [
        `---\n${dialect(agent, models).join("\n")}\n---`,
        provenance(sourceRel),
        body.replace(/^\n+/, "").replace(/\s+$/, "\n"),
      ].join("\n\n");
      write(`${dir}/${map.agents}/${entry}`, text, (current) => generatedFrom(current, sourceRel));
    }
    // A generated agent whose source is gone, or no longer goes to this assistant, is removed.
    const kept = new Set(projected.map((a) => a.entry));
    const agentDir = join(root, dir, map.agents);
    for (const file of existsSync(agentDir) ? readdirSync(agentDir) : []) {
      const path = join(agentDir, file);
      if (kept.has(file) || isLink(path) || !file.endsWith(".md")) continue;
      if (!readFileSync(path, "utf8").includes(`<!-- generated from ${SOURCE}/agents/`)) continue;
      if (check)
        out.drift.push(
          `${dir}/${map.agents}/${file}: stale, its source is gone or not projected here`,
        );
      else {
        rmSync(path);
        out.pruned.push(`${dir}/${map.agents}/${file}`);
      }
    }
  }

  mcpJson(root, check, out);
  return out;
}

/**
 * `.mcp.json` from `.mcp.yaml` (gitignored, rendered locally): with `check`, a missing one is fine (a fresh clone has
 * none) and only a stale one is drift.
 * @param {string} root
 * @param {boolean} check
 * @param {Projection} out
 */
export function mcpJson(root, check, out) {
  const source = join(root, ".mcp.yaml");
  if (!existsSync(source)) return;
  let config;
  try {
    config = parseYaml(readFileSync(source, "utf8"));
  } catch (error) {
    return void out.broken.push(`.mcp.yaml: ${/** @type {Error} */ (error).message}`);
  }
  const servers = config?.mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers))
    return void out.broken.push(".mcp.yaml: mcpServers must be a map of servers");
  for (const [name, server] of Object.entries(servers))
    if (
      !server ||
      typeof server !== "object" ||
      (typeof server.command !== "string" && typeof server.url !== "string")
    )
      return void out.broken.push(`.mcp.yaml: server '${name}' needs a string command or url`);
  const text = `${JSON.stringify(config, null, 2)}\n`;
  const target = join(root, ".mcp.json");
  const present = existsSync(target);
  if (present && readFileSync(target, "utf8") === text) return void (out.ok += 1);
  if (check) {
    if (present) out.drift.push(".mcp.json: stale");
    else out.ok += 1;
    return;
  }
  writeFileSync(target, text);
  out.written.push(".mcp.json");
}
