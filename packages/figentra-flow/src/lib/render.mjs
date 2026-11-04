/**
 * Figentra Flow file contract:
 * Purpose: the `flow-*` skills and commands a repository carries (ADR 0510): rendered from its preset's command
 *   documents either as neutral skill documents for the repository's own projector (`.agents/skills/flow-<verb>/`) or,
 *   with `direct`, as Claude Code skills and OpenCode commands; the preset's agent definitions (`agents/`, as
 *   `.agents/agents/<id>.md` or, with `direct`, `.claude/agents/<id>.md`), the approval workflow (its secret names
 *   from `preset.yml`'s `approve`) and, with `apps.owner`, a CODEOWNERS for the owner-only paths (STA-1856); the
 *   preset's own skills (`skills/<name>/**`, beside the `flow-*` ones) and, with `renderReference`, its agent
 *   reference, routing and models under `.agents/` (STA-1945, C6); a preset skill folder named `flow-*` or a preset
 *   file that is not UTF-8 is refused. Only the skills and agents the config's profile selects are rendered, the lock
 *   records the profile, and `profileGaps` names what a profile selects that the preset lacks (STA-1945 FR-6). Then
 *   the repository's overrides apply (FR-4, `overrides.mjs`), except one that breaks a mandatory policy (FR-5), which
 *   `validate` and `check` name instead. Each written file carries its provenance header, naming the overrides that
 *   shaped it, and `.flow/lock.json` v2 records the Flow version, the preset with its digest and version (a package
 *   preset's own, STA-2097), the profile, the overrides' digest and each written file's digest (STA-1945 FR-2,
 *   FR-3); `installProblems`, reading a v1 or v2 lock, is the check that replaces spec-kit's tripwire: no hand edit,
 *   no forgotten `sync`, and no spec-kit leftover.
 *   With a `.flow/readme.yml`, `README.md` is rendered too (STA-1879). The lock pins the third-party skills the profile
 *   selects, which `sync` installs into the git-ignored `.agents/skills/.vendor/` (STA-1945 FR-8).
 * Boundary: `render` and `installProblems` read; `writeRendered` writes the rendered files and the lock and removes
 *   spec-kit's rendered `speckit-*` skills and commands, and the `flow-*` ones the lock lists, it no longer renders
 *   and nobody edited (`flow-tasks`, STA-1945 FR-15, and those a narrower profile deselects, FR-6). Nothing here
 *   deletes `.specify/` (that is `migrate`), nor, yet, another owned file (an agent, rule, surface or hook) a
 *   narrower profile or preset no longer renders (STA-1945 T068).
 * Runtime: node
 * Governing contract: ADR 0510; STA-1729 (F3); STA-1945 (FR-2, FR-3, FR-4, FR-5, FR-6, FR-8); STA-2097.
 * Secrets: none.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, sep } from "node:path";

import { approveWorkflow } from "./approve-workflow.mjs";
import { baselineWorkflow } from "./baseline-workflow.mjs";
import { ConfigError, gateLogins, loadConfig } from "./config.mjs";
import { FLOW_ASSETS, LOCK, OVERRIDES, presetDir, presetSource } from "./flow-dir.mjs";
import {
  digestOf,
  driftOf,
  LockError,
  NewerLockError,
  overridesDigest,
  readLock,
  treeDigest,
  writeLock,
} from "./lock.mjs";
import { applyOverrides, loadOverrides, shapedBy } from "./overrides.mjs";
import { codeowners } from "./owner-only.mjs";
import { policyProblems } from "./policies.mjs";
import { resolveProfile, selects } from "./profiles.mjs";
import {
  APPROVE_WORKFLOW,
  BASELINE_WORKFLOW,
  CONFIG_FILE,
  ENV_PREFIX,
  LEGACY_CONFIG_FILE,
  LEGACY_NAME,
  NAME,
  PACKAGE,
  STATUS_CONTEXT,
  VERSION,
} from "./product.mjs";
import { withHeader } from "./provenance.mjs";
import { renderReadme } from "./readme.mjs";
import { loadThirdParty, pinsOf } from "./skills.mjs";
import { parseYaml, YamlError } from "./yaml.mjs";

/** @typedef {import("./overrides.mjs").Override} Override */

/**
 * What a surface renderer (`render-*.mjs`) reads: the repository, its configuration and its preset's folder. Each one
 * returns its files, path to text, and nothing when the preset has no such surface (STA-1945 C5).
 * @typedef {{ root: string, config: Record<string, any>, presetDir: string }} RenderContext
 */

/** The commands, in workflow order; `plan` writes tasks.md too, so there is no `tasks` (STA-1945 FR-15). */
export const VERBS = [
  "specify",
  "clarify",
  "plan",
  "analyze",
  "checklist",
  "implement",
  "build",
  "converge",
  "gate",
  "review",
];

/** Where spec-kit left files; any of them after `migrate` is a finding. */
const LEFTOVER_DIRS = [".specify", ".agents/speckit"];
/** Folders whose `speckit-*` or `speckit.*` entries spec-kit rendered. */
const SKILL_DIRS = [".claude/skills", ".opencode/commands", ".agents/skills", ".agents/commands"];

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
 * The overrides `sync` applies: each valid one that keeps every mandatory policy; `skipped` says why each other one is
 * left out (`validate` and `check` refuse them).
 * @param {string} root
 * @returns {{ overrides: Override[], skipped: string[] }}
 */
export function appliedOverrides(root) {
  const loaded = loadOverrides(root);
  /** @type {Override[]} */
  const overrides = [];
  const skipped = [...loaded.problems];
  for (const o of loaded.overrides) {
    const broken = policyProblems([o]);
    if (broken.length) skipped.push(...broken);
    else overrides.push(o);
  }
  return { overrides, skipped };
}

/**
 * The owner-only globs a repository adds to `OWNER_ONLY`: its `approve.ownerOnly` and each `extend` of `owner-only`
 * (FR-5). `land`, the approval workflow and CODEOWNERS all read these.
 * @param {string} root
 * @param {Override[]} [overrides] defaults to `appliedOverrides`
 * @returns {string[]}
 */
export function ownerOnlyExtra(root, overrides = appliedOverrides(root).overrides) {
  return [
    ...(loadConfig(root).config.approve?.ownerOnly ?? []),
    ...overrides.flatMap((o) =>
      o.kind === "extend" && o.target === "owner-only" ? (o.items ?? []) : [],
    ),
  ];
}

/**
 * The repository's rendered files, path to text, with `overrides` applied (FR-4).
 * @param {string} root
 * @param {{ direct?: boolean, overrides?: Override[] }} [options] `overrides` defaults to `appliedOverrides`
 * @returns {Map<string, string>}
 */
export function render(
  root,
  { direct = false, overrides = appliedOverrides(root).overrides } = {},
) {
  return applyOverrides(renderPreset(root, direct, overrides), overrides, root);
}

/**
 * The preset's outputs before the output overrides: each source a `replace` names read from its file instead, and the
 * owner-only list with each `extend` of `owner-only`.
 * @param {string} root
 * @param {boolean} direct
 * @param {Override[]} overrides
 * @returns {Map<string, string>}
 */
function renderPreset(root, direct, overrides) {
  /** The file `target` (a preset source) is read from: its replacement's (a `.yml` one before a legacy one), else `preset`. */
  const source = (/** @type {string} */ target, /** @type {string} */ preset) => {
    const swap = overrides.find((o) => o.kind === "replace" && o.target === target);
    return swap ? join(root, OVERRIDES, swap.file) : preset;
  };
  const dir = join(presetDir(root), "commands");
  /** @type {Map<string, string>} */
  const out = new Map();
  // FR-6: only what the profile selects; hooks are selected the same way once the preset ships them (PR 4).
  const profile = selectedProfile(root);
  for (const verb of VERBS) {
    const name = `flow-${verb}`;
    if (!selects(profile, "skills", name)) continue;
    const file = source(`commands/${name}.md`, join(dir, `${name}.md`));
    if (!existsSync(file)) continue;
    const { meta, body } = parse(readFileSync(file, "utf8"));
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
  for (const [id, text] of presetDocs(root, "agents", source))
    if (selects(profile, "agents", id))
      out.set(direct ? `.claude/agents/${id}.md` : `.agents/agents/${id}.md`, text);
  // STA-1871: the preset's agent rules (the worktree rule among them).
  for (const [id, text] of presetDocs(root, "rules", source))
    out.set(direct ? `.claude/rules/${id}.md` : `.agents/rules/${id}.md`, text);
  // STA-1945 (D2): the preset's own skills ship in the package, file for file, each folder as the profile selects it.
  const skills = join(presetDir(root), "skills");
  for (const [path, text] of presetTree(skills, (path) =>
    source(`skills/${path}`, join(skills, path)),
  )) {
    const name = path.split("/")[0];
    // A preset folder named like a rendered `flow-*` skill would silently replace it.
    if (name.startsWith("flow-"))
      throw new ConfigError(
        `${join(skills, name)}: flow-* is the commands' name; rename the skill`,
      );
    if (selects(profile, "skills", name))
      out.set(`${direct ? ".claude" : ".agents"}/skills/${path}`, text);
  }
  for (const [path, text] of renderReference({ presetDir: presetDir(root), source }))
    out.set(path, text);
  const readme = renderReadme(root);
  if (readme !== undefined) out.set("README.md", readme);
  const { apps, approve, baseline } = loadConfig(root).config;
  // STA-1942: only a repository whose main is red asks for the baseline gate.
  if (baseline) out.set(`.github/workflows/${BASELINE_WORKFLOW}`, baselineWorkflow(baseline));
  const ownerOnly = ownerOnlyExtra(root, overrides);
  // No owner, no approval path: GitHub must be able to ask someone for the owner-only paths (CODEOWNERS).
  if (!apps?.owner) return out;
  const gate = gateLogins(apps);
  out.set(
    `.github/workflows/${APPROVE_WORKFLOW}`,
    approveWorkflow({
      version: VERSION,
      integrity: lockedIntegrity(root, PACKAGE, VERSION),
      ...approveSecrets(root),
      // The gate's status counts only from the gate App; a repository adds its own sources in `approve.checks`.
      trusted: { ...(gate ? { [STATUS_CONTEXT]: gate } : {}), ...approve?.checks },
      ownerOnly,
    }),
  );
  // GitHub asks the owner for owner-only paths itself (with `require_code_owner_review`); no owner, no file.
  out.set(".github/CODEOWNERS", codeowners(apps.owner, ownerOnly));
  return out;
}

/**
 * The integrity the repository's lockfile records for `pkg@version` (`pnpm-lock.yaml`, else `package-lock.json`), or
 * "" when it records none; the approval workflow then refuses to run.
 * @param {string} root
 * @param {string} pkg
 * @param {string} version
 */
export function lockedIntegrity(root, pkg, version) {
  const pnpm = join(root, "pnpm-lock.yaml");
  if (existsSync(pnpm)) {
    const key = `${pkg}@${version}`.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    const m = readFileSync(pnpm, "utf8").match(
      new RegExp(`^ {2}'?${key}'?:\\n {4}resolution: \\{integrity: (sha512-[A-Za-z0-9+/]+=*)`, "m"),
    );
    if (m) return m[1];
  }
  const npm = join(root, "package-lock.json");
  if (existsSync(npm)) {
    const entry = JSON.parse(readFileSync(npm, "utf8")).packages?.[`node_modules/${pkg}`];
    if (entry?.version === version && String(entry.integrity).startsWith("sha512-"))
      return entry.integrity;
  }
  return "";
}

/**
 * The preset's documents in `folder` (`agents` or `rules`), id to text; a `replace` of `<folder>/<id>.md` replaces one.
 * @param {string} root
 * @param {string} folder
 * @param {(target: string, preset: string) => string} source the file a preset source is read from
 * @returns {Map<string, string>}
 */
function presetDocs(root, folder, source) {
  const dir = join(presetDir(root), folder);
  /** @type {Map<string, string>} */
  const out = new Map();
  if (!existsSync(dir)) return out;
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .toSorted())
    out.set(file.slice(0, -3), readFileSync(source(`${folder}/${file}`, join(dir, file)), "utf8"));
  return out;
}

/**
 * What an override may target besides a rendered output: the preset's sources (`commands/`, `agents/`, `rules/`
 * and `templates/` `<name>.md`, Flow's base templates among them; a command or agent only when the profile selects
 * it, since `sync` reads no other; each file of `skills/<name>/` the profile selects and of `reference/`, and
 * `routing.yaml` and `models.yaml`) and the parameter blocks `preset.yml` declares.
 * @param {string} root
 * @returns {{ sources: Set<string>, params: Record<string, any> }}
 * @throws {ConfigError} when the profile is unresolved or `preset.yml` is outside the YAML subset (`selectedProfile`)
 */
export function presetTargets(root) {
  const dir = presetDir(root);
  const profile = selectedProfile(root);
  /** @type {Set<string>} */
  const sources = new Set();
  /** @type {[string, string, import("./profiles.mjs").ProfileKind?][]} */
  const folders = [
    ["commands", dir, "skills"],
    ["agents", dir, "agents"],
    ["rules", dir],
    ["templates", dir],
    ["templates", FLOW_ASSETS],
  ];
  for (const [folder, base, kind] of folders)
    if (existsSync(join(base, folder)))
      for (const f of readdirSync(join(base, folder)))
        if (f.endsWith(".md") && (!kind || selects(profile, kind, f.slice(0, -3))))
          sources.add(`${folder}/${f}`);
  for (const [path] of presetTree(join(dir, "skills")))
    if (selects(profile, "skills", path.split("/")[0])) sources.add(`skills/${path}`);
  for (const [path] of presetTree(join(dir, "reference"))) sources.add(`reference/${path}`);
  for (const file of REFERENCE_FILES) if (existsSync(join(dir, file))) sources.add(file);
  return { sources, params: presetManifest(root)?.parameters ?? {} };
}

/**
 * The preset's parsed `preset.yml`, or undefined when it has none.
 * @param {string} root
 * @returns {Record<string, any> | undefined}
 * @throws {ConfigError} when it is outside the YAML subset (a repository's own preset.yml may be): its profiles
 *   cannot be read, and falling back to selecting all would fail open
 */
export function presetManifest(root) {
  const file = join(presetDir(root), "preset.yml");
  try {
    return existsSync(file) ? parseYaml(readFileSync(file, "utf8")) : undefined;
  } catch (error) {
    if (!(error instanceof YamlError)) throw error;
    throw new ConfigError(`${file}: ${error.message}`);
  }
}

/**
 * The profile `sync` renders (FR-6): the config's `profile`, else the preset's default.
 * @param {string} root
 * @throws {ConfigError} when the config names a profile the preset lacks, or `preset.yml` cannot be read
 */
export function selectedProfile(root) {
  return resolveProfile(presetManifest(root), loadConfig(root).config.profile);
}

/**
 * Why `sync` would refuse the config's profile, or undefined: what `validate` and `check` report.
 * @param {string} root
 */
export function profileProblem(root) {
  try {
    selectedProfile(root);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    return error.message;
  }
  return undefined;
}

/**
 * The agents and skills the config's profile names that its preset does not carry (STA-1945 C6): `sync` renders
 * nothing for them, so `validate` names each one.
 * @param {string} root
 * @returns {string[]}
 * @throws {ConfigError} as `selectedProfile` does; call it only once `profileProblem` found none
 */
export function profileGaps(root) {
  const profile = selectedProfile(root);
  const skills = join(presetDir(root), "skills");
  const carried = {
    agents: [...presetDocs(root, "agents", (_, preset) => preset).keys()],
    skills: [
      ...VERBS.map((verb) => `flow-${verb}`),
      ...(existsSync(skills) ? readdirSync(skills) : []),
      ...loadThirdParty(presetDir(root)).map((s) => s.id),
    ],
  };
  return /** @type {const} */ (["agents", "skills"]).flatMap((kind) =>
    profile[kind]
      .filter((id) => id !== "*" && !carried[kind].includes(id))
      .map((id) => `profile "${profile.name}" selects ${kind} "${id}", which the preset lacks`),
  );
}

/**
 * Every file under `dir`, its `/`-separated path relative to `dir` and its text, sorted by path; none when `dir` is
 * missing.
 * @param {string} dir
 * @param {(path: string) => string} [from] the file a path's text is read from (its replacement's, FR-4)
 * @returns {[string, string][]}
 * @throws {ConfigError} on a file that is not UTF-8 text: rendered as text it would be corrupted, and the lock with it
 */
function presetTree(dir, from = (path) => join(dir, path)) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((path) => statSync(join(dir, path)).isFile())
    .map((path) => path.split(sep).join("/"))
    .toSorted()
    .map((path) => {
      const file = from(path);
      const bytes = readFileSync(file);
      const text = bytes.toString("utf8");
      if (!Buffer.from(text, "utf8").equals(bytes))
        throw new ConfigError(`${file} is not UTF-8 text; a preset ships text files only`);
      return /** @type {[string, string]} */ ([path, text]);
    });
}

/**
 * The preset's agent reference, routing and models, as they are in the preset (STA-1945, C6), each read through
 * `ctx.source` so a `replace` of `reference/<path>`, `routing.yaml` or `models.yaml` swaps it (FR-4). They always go
 * under `.agents/`: agents read them by that path, whichever assistant runs them.
 * @param {{ presetDir: string, source?: (target: string, preset: string) => string }} ctx the render context; only
 *   its preset folder (and the replacements `source` names) is read
 * @returns {Map<string, string>} `.agents/reference/*`, `.agents/routing.yaml`, `.agents/models.yaml`
 */
export function renderReference({ presetDir, source = (_, preset) => preset }) {
  /** @type {Map<string, string>} */
  const out = new Map();
  const reference = join(presetDir, "reference");
  for (const [path, text] of presetTree(reference, (path) =>
    source(`reference/${path}`, join(reference, path)),
  ))
    out.set(`.agents/reference/${path}`, text);
  for (const file of REFERENCE_FILES) {
    const at = join(presetDir, file);
    if (existsSync(at)) out.set(`.agents/${file}`, readFileSync(source(file, at), "utf8"));
  }
  return out;
}

/** The preset's top-level files `renderReference` renders under `.agents/`. */
const REFERENCE_FILES = ["routing.yaml", "models.yaml"];

/**
 * The preset's third-party skills the profile selects (FR-6, FR-8): what `sync` installs and the lock pins.
 * @param {string} root
 * @throws {ConfigError} as `selectedProfile` and `loadThirdParty` do
 */
export function selectedSkills(root) {
  const profile = selectedProfile(root);
  return loadThirdParty(presetDir(root)).filter((s) => selects(profile, "skills", s.id));
}

/** A secret name GitHub accepts. */
const SECRET_NAME = /^[A-Z_][A-Z0-9_]*$/;

/**
 * The approving App's secret names: `preset.yml`'s `approve.app_id` and `approve.private_key`, else
 * `<PREFIX>APPROVER_APP_ID` and `<PREFIX>APPROVER_PRIVATE_KEY`. They name an App of their own, never a bot that pushes.
 * @param {string} root
 */
export function approveSecrets(root) {
  const file = join(presetDir(root), "preset.yml");
  /** @type {{ app_id?: string, private_key?: string } | undefined} */
  const approve = presetManifest(root)?.approve;
  const names = {
    appId: approve?.app_id ?? `${ENV_PREFIX}APPROVER_APP_ID`,
    privateKey: approve?.private_key ?? `${ENV_PREFIX}APPROVER_PRIVATE_KEY`,
  };
  for (const name of Object.values(names))
    if (!SECRET_NAME.test(name))
      throw new Error(
        `${file}: approve names "${name}", not a secret name (${SECRET_NAME.source})`,
      );
  return names;
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
 * The files `.flow/lock.json` lists, path to digest; none without a lock or with one this Flow cannot read.
 * @param {string} root
 * @returns {Record<string, string>}
 */
function lockedFiles(root) {
  try {
    return readLock(root)?.files ?? {};
  } catch (error) {
    if (!(error instanceof LockError)) throw error;
    return {};
  }
}

/**
 * Why `migrateLegacy` would refuse, or undefined: both config files at once. `sync` asks before it writes anything.
 * @param {string} root
 */
export function legacyConflict(root) {
  if (existsSync(join(root, LEGACY_CONFIG_FILE)) && existsSync(join(root, CONFIG_FILE)))
    return `${CONFIG_FILE} and ${LEGACY_CONFIG_FILE} both exist: keep ${CONFIG_FILE} and delete the other`;
  return undefined;
}

/**
 * The 0.2.2 rename (`figentra-flow` → `fflow`, owner 2026-11-02), once: the config file takes its new name (its
 * `$schema` with it) and the workflows rendered under the old name go. Both config files at once is an error.
 * @param {string} root
 * @returns {{ error?: string, done: string[] }}
 */
export function migrateLegacy(root) {
  const current = join(root, CONFIG_FILE);
  const legacy = join(root, LEGACY_CONFIG_FILE);
  /** @type {string[]} */
  const done = [];
  const error = legacyConflict(root);
  if (error) return { error, done };
  if (existsSync(legacy)) {
    const schema = (/** @type {string} */ f) => f.replace(".json", ".schema.json");
    writeFileSync(
      current,
      readFileSync(legacy, "utf8").replaceAll(schema(LEGACY_CONFIG_FILE), schema(CONFIG_FILE)),
    );
    rmSync(legacy);
    done.push(`renamed ${LEGACY_CONFIG_FILE} to ${CONFIG_FILE}`);
  }
  for (const kind of ["approve", "baseline"]) {
    const old = `.github/workflows/${LEGACY_NAME}-${kind}.yml`;
    if (!existsSync(join(root, old))) continue;
    rmSync(join(root, old));
    done.push(`removed ${old}`);
  }
  return { done };
}

/**
 * Writes the rendered files with their provenance headers, then `.flow/lock.json` v2 (the third-party skills `sync`
 * installed first pinned in it, STA-1945 FR-8), and removes the rendered `speckit-*` skills and commands and the
 * unedited `flow-*` ones it no longer renders.
 * @param {string} root
 * @param {Map<string, string>} files
 * @param {Override[]} [overrides] the overrides `files` were rendered with (the headers name them)
 * @returns {string[]} the files it removed
 */
export function writeRendered(root, files, overrides) {
  const removed = removable(root);
  for (const p of removed) rmSync(join(root, p), { recursive: true, force: true });
  for (const p of dropped(root, files)) {
    const at = join(root, p);
    rmSync(at);
    removed.push(p);
    if (!readdirSync(dirname(at)).length) rmSync(dirname(at), { recursive: true });
  }
  const written = withHeaders(root, files, overrides);
  for (const [path, text] of written) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  // The lock goes last: a failed write leaves the old lock, and `check` names what differs.
  writeLock(root, lockOf(root, written));
  return removed;
}

/**
 * The `flow-*` skills and commands the lock lists that `files` no longer holds (`flow-tasks`, FR-15, or one a narrower
 * profile deselects, FR-6) and nobody edited since: what `writeRendered` removes besides spec-kit's. Nothing else the
 * lock lists goes.
 * @param {string} root
 * @param {Map<string, string>} files
 */
export function dropped(root, files) {
  return Object.entries(lockedFiles(root))
    .filter(
      ([p, digest]) =>
        !files.has(p) &&
        SKILL_DIRS.some((d) => p.startsWith(`${d}/flow-`)) &&
        !p.includes("..") &&
        existsSync(join(root, p)) &&
        digestOf(readFileSync(join(root, p), "utf8")) === digest,
    )
    .map(([p]) => p);
}

/**
 * The spec-kit files `writeRendered` removes: its rendered skills and commands, not its folders (that is `migrate`).
 * @param {string} root
 */
export function removable(root) {
  return leftovers(root).filter((p) => !LEFTOVER_DIRS.includes(p));
}

/**
 * The provenance of what `sync` renders in `root`: the configured preset at its version, a package preset's own
 * (STA-2097), else the installed Flow's.
 * @param {string} root
 * @returns {import("./provenance.mjs").Provenance}
 */
export function provenanceOf(root) {
  const { name, version } = presetSource(root);
  return { preset: name, version };
}

/**
 * The rendered files as `sync` writes them: each comment-capable one with its provenance header (FR-3).
 * @param {string} root
 * @param {Map<string, string>} files
 * @param {Override[]} [overrides] the overrides `files` were rendered with; defaults to `appliedOverrides`
 * @returns {Map<string, string>}
 */
export function withHeaders(root, files, overrides = appliedOverrides(root).overrides) {
  const meta = provenanceOf(root);
  return new Map(
    [...files].map(([path, text]) => {
      const override = shapedBy(overrides, path).join(", ") || undefined;
      return [path, withHeader(path, text, { ...meta, override })];
    }),
  );
}

/**
 * The v2 lock for the files as written, with the installed preset and the overrides as they are now.
 * @param {string} root
 * @param {Map<string, string>} written
 * @returns {import("./lock.mjs").Lock}
 */
export function lockOf(root, written) {
  const { preset, version } = provenanceOf(root);
  return {
    lockVersion: 2,
    flow: VERSION,
    preset: { name: preset, version, digest: treeDigest(presetDir(root)) },
    profile: selectedProfile(root).name,
    overrides: overridesDigest(root),
    files: Object.fromEntries([...written].map(([path, text]) => [path, digestOf(text)])),
    // The pins of what `sync` installed (machine-only skills are never recorded); `diff` reads them without a fetch.
    skills: pinsOf(selectedSkills(root)),
  };
}

/**
 * Why `sync` must not adopt the installed preset: its folder is missing, or its name or digest differs from the
 * lock's. Only a missing folder counts without a lock or with a v1 lock (it recorded no digest; the next `sync`
 * records one).
 * @param {string} root
 * @param {import("./lock.mjs").Lock | undefined} lock
 * @returns {string | undefined}
 */
export function presetDrift(root, lock) {
  const dir = presetDir(root);
  if (!existsSync(dir))
    return `the preset ${CONFIG_FILE} names has no folder at ${dir} (fix \`preset\` in ${CONFIG_FILE})`;
  if (!lock?.preset.digest) return undefined;
  const { preset, version } = provenanceOf(root);
  if (lock.preset.name === preset && lock.preset.digest === treeDigest(dir)) return undefined;
  return `the installed ${preset} preset ${version} differs from the ${lock.preset.name} preset ${lock.preset.version} ${LOCK} records (run \`${NAME} update\` to adopt it)`;
}

/**
 * Whether the lock's files were rendered with `--direct` (Claude Code skills rather than neutral skill documents).
 * @param {import("./lock.mjs").Lock | undefined} lock
 */
export function syncedDirect(lock) {
  return Object.keys(lock?.files ?? {}).some((p) => p.startsWith(".claude/skills/"));
}

/**
 * The install check `gate ci` runs (ADR 0510 decision 7): every file `.flow/lock.json` lists is unchanged, the lock
 * names the installed Flow version and the config's profile (FR-6), and no spec-kit file remains. A repository with
 * neither `.flow/lock.json` nor a spec-kit leftover has nothing to check.
 * @param {string} root
 * @param {string} [version] the installed Flow version
 * @returns {string[]}
 */
export function installProblems(root, version = VERSION) {
  const problems = leftovers(root).map(
    (p) => `${p} is spec-kit's (run \`${NAME} migrate\`; ADR 0510)`,
  );
  let lock;
  try {
    lock = readLock(root);
  } catch (error) {
    if (!(error instanceof LockError)) throw error;
    // A newer Flow's lock already names the fix; `sync` would refuse it.
    const fix = error instanceof NewerLockError ? "" : ` (run \`${NAME} sync\`)`;
    return [...problems, `${error.message}${fix}`];
  }
  if (!lock) return problems;
  if (lock.flow !== version)
    problems.push(
      `${LOCK} was written by ${NAME} ${lock.flow || "(none)"}, ${version} is installed (run \`${NAME} update\`)`,
    );
  // A lock from before profiles records "*", which its next sync replaces; an unknown profile is `check`'s problem.
  const profile =
    lock.profile === "*" || profileProblem(root) ? undefined : selectedProfile(root).name;
  if (profile && profile !== lock.profile)
    problems.push(
      `the profile is "${profile}" but ${LOCK} records "${lock.profile}" (run \`${NAME} sync\`)`,
    );
  for (const { path, kind } of driftOf(root, lock))
    problems.push(
      kind === "missing"
        ? `${path} is missing (run \`${NAME} sync\`)`
        : `${path} differs from what \`${NAME} sync\` rendered (change the preset or .flow/overrides/, then sync)`,
    );
  // A v1 lock recorded neither digest; the next `sync` records both.
  if (lock.preset.digest && lock.overrides !== overridesDigest(root))
    problems.push(`${OVERRIDES}/ differs from what ${LOCK} records (run \`${NAME} sync\`)`);
  return problems;
}
