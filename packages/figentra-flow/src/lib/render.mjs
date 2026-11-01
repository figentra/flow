/**
 * Figentra Flow file contract:
 * Purpose: the `flow-*` skills and commands a repository carries (ADR 0510): rendered from its preset's command
 *   documents either as neutral skill documents for the repository's own projector (`.agents/skills/flow-<verb>/`) or,
 *   with `direct`, as Claude Code skills and OpenCode commands; the preset's agent definitions (`agents/`, as
 *   `.agents/agents/<id>.md` or, with `direct`, `.claude/agents/<id>.md`) and the approval workflow, whose secret
 *   names come from `preset.yml`'s `approve` (STA-1856); `.flow/lock.json` records the Flow version, the preset
 *   and each rendered file's hash; `installProblems` is the check that replaces spec-kit's tripwire: no hand edit, no
 *   forgotten `sync`, and no spec-kit leftover.
 * Boundary: `render` and `installProblems` read; `writeRendered` writes the rendered files and the lock and removes
 *   spec-kit's rendered `speckit-*` skills and commands. Nothing here deletes `.specify/` (that is `migrate`).
 * Runtime: node
 * Governing contract: ADR 0510; STA-1729 (F3).
 * Secrets: none.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { approveWorkflow } from "./approve-workflow.mjs";
import { loadConfig } from "./config.mjs";
import { LOCK, OVERRIDES, presetDir } from "./flow-dir.mjs";
import { APPROVE_WORKFLOW, ENV_PREFIX, NAME, VERSION } from "./product.mjs";
import { parseYaml, YamlError } from "./yaml.mjs";

/** The eight commands, in workflow order. */
export const VERBS = [
  "specify",
  "clarify",
  "plan",
  "tasks",
  "analyze",
  "checklist",
  "implement",
  "converge",
];

/** Where spec-kit left files; any of them after `migrate` is a finding. */
const LEFTOVER_DIRS = [".specify", ".agents/speckit"];
/** Folders whose `speckit-*` or `speckit.*` entries spec-kit rendered. */
const SKILL_DIRS = [".claude/skills", ".opencode/commands", ".agents/skills", ".agents/commands"];

const sha = (/** @type {string} */ text) => createHash("sha256").update(text).digest("hex");

/**
 * A command document's front matter fields and body.
 * @param {string} text
 */
function parse(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  const meta = Object.fromEntries(
    [...(m?.[1] ?? "").matchAll(/^([\w-]+):\s*(.*)$/gm)].map(([, k, v]) => [k, v.trim()]),
  );
  return { meta, body: (m ? text.slice(m[0].length) : text).replace(/^\n+/, "") };
}

/**
 * The repository's rendered files, path to text.
 * @param {string} root
 * @param {{ direct?: boolean }} [options]
 * @returns {Map<string, string>}
 */
export function render(root, { direct = false } = {}) {
  const dir = join(presetDir(root), "commands");
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const verb of VERBS) {
    const own = join(root, OVERRIDES, "commands", `flow-${verb}.md`);
    const file = existsSync(own) ? own : join(dir, `flow-${verb}.md`);
    if (!existsSync(file)) continue;
    const { meta, body } = parse(readFileSync(file, "utf8"));
    const name = `flow-${verb}`;
    const description = JSON.stringify(meta.description ?? name);
    const provenance = [
      "metadata:",
      `  generated-by: ${NAME}`,
      ...(meta["derived-from"] ? [`  derived-from: ${meta["derived-from"]}`] : []),
    ];
    const skill = [
      "---",
      `name: ${name}`,
      `description: ${description}`,
      ...provenance,
      "---",
      "",
      body,
    ].join("\n");
    if (direct) {
      out.set(`.claude/skills/${name}/SKILL.md`, skill);
      out.set(
        `.opencode/commands/${name}.md`,
        [
          "---",
          `description: ${description}`,
          "---",
          "",
          `<!-- ${provenance
            .slice(1)
            .map((l) => l.trim())
            .join("; ")} -->`,
          "",
          body,
        ].join("\n"),
      );
    } else out.set(`.agents/skills/${name}/SKILL.md`, skill);
  }
  for (const [id, text] of agents(root))
    out.set(direct ? `.claude/agents/${id}.md` : `.agents/agents/${id}.md`, text);
  out.set(`.github/workflows/${APPROVE_WORKFLOW}`, approveWorkflow(approveSecrets(root)));
  return out;
}

/**
 * The preset's agent definitions, id to text; `.flow/overrides/agents/<id>.md` replaces one.
 * @param {string} root
 * @returns {Map<string, string>}
 */
function agents(root) {
  const dir = join(presetDir(root), "agents");
  /** @type {Map<string, string>} */
  const out = new Map();
  if (!existsSync(dir)) return out;
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .toSorted()) {
    const own = join(root, OVERRIDES, "agents", file);
    out.set(file.slice(0, -3), readFileSync(existsSync(own) ? own : join(dir, file), "utf8"));
  }
  return out;
}

/**
 * The approval workflow's secret names: `preset.yml`'s `approve.app_id` and `approve.private_key`, else
 * `<PREFIX>APPROVE_APP_ID` and `<PREFIX>APPROVE_PRIVATE_KEY`.
 * @param {string} root
 */
export function approveSecrets(root) {
  const file = join(presetDir(root), "preset.yml");
  /** @type {{ app_id?: string, private_key?: string } | undefined} */
  let approve;
  try {
    approve = existsSync(file) ? parseYaml(readFileSync(file, "utf8"))?.approve : undefined;
  } catch (error) {
    // A repository's own preset.yml outside the YAML subset keeps the default names.
    if (!(error instanceof YamlError)) throw error;
  }
  return {
    appId: approve?.app_id ?? `${ENV_PREFIX}APPROVE_APP_ID`,
    privateKey: approve?.private_key ?? `${ENV_PREFIX}APPROVE_PRIVATE_KEY`,
  };
}

/**
 * spec-kit's files still in `root`: its folders, and `speckit-*` skills and `speckit.*` commands.
 * @param {string} root
 */
export function leftovers(root) {
  return [
    ...LEFTOVER_DIRS.filter((d) => existsSync(join(root, d))),
    ...SKILL_DIRS.flatMap((d) =>
      existsSync(join(root, d))
        ? readdirSync(join(root, d))
            .filter((n) => /^speckit[-.]/.test(n))
            .map((n) => `${d}/${n}`)
        : [],
    ),
  ];
}

/**
 * Writes the rendered files and `.flow/lock.json`, and removes the rendered `speckit-*` skills and commands.
 * @param {string} root
 * @param {Map<string, string>} files
 * @returns {string[]} the spec-kit files it removed
 */
export function writeRendered(root, files) {
  const removed = leftovers(root).filter((p) => !LEFTOVER_DIRS.includes(p));
  for (const p of removed) rmSync(join(root, p), { recursive: true, force: true });
  for (const [path, text] of files) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const lock = {
    version: VERSION,
    preset: loadConfig(root).config.preset ?? "neutral",
    files: Object.fromEntries([...files].map(([path, text]) => [path, sha(text)])),
  };
  mkdirSync(join(root, dirname(LOCK)), { recursive: true });
  writeFileSync(join(root, LOCK), `${JSON.stringify(lock, null, 2)}\n`);
  return removed;
}

/**
 * The install check `gate ci` runs (ADR 0510 decision 7): every file `.flow/lock.json` lists is unchanged, the lock
 * names the installed Flow version, and no spec-kit file remains. A repository with neither `.flow/lock.json` nor a
 * spec-kit leftover has nothing to check.
 * @param {string} root
 * @param {string} [version] the installed Flow version
 * @returns {string[]}
 */
export function installProblems(root, version = VERSION) {
  const problems = leftovers(root).map(
    (p) => `${p} is spec-kit's (run \`${NAME} migrate\`; ADR 0510)`,
  );
  const file = join(root, LOCK);
  if (!existsSync(file)) return problems;
  /** @type {{ version?: string, files?: Record<string, string> }} */
  let lock;
  try {
    lock = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return [...problems, `${LOCK} is not valid JSON (run \`${NAME} sync\`)`];
  }
  if (lock.version !== version)
    problems.push(
      `${LOCK} was written by ${NAME} ${lock.version ?? "(none)"}, ${version} is installed (run \`${NAME} sync\`)`,
    );
  for (const [path, hash] of Object.entries(lock.files ?? {})) {
    const at = join(root, path);
    if (!existsSync(at)) problems.push(`${path} is missing (run \`${NAME} sync\`)`);
    else if (sha(readFileSync(at, "utf8")) !== hash)
      problems.push(
        `${path} differs from what \`${NAME} sync\` rendered (change the preset or .flow/overrides/, then sync)`,
      );
  }
  return problems;
}
