/**
 * Figentra Flow file contract:
 * Purpose: the `flow-*` skills and commands a repository carries (ADR 0510): rendered from its preset's command
 *   documents either as neutral skill documents for the repository's own projector (`.agents/skills/flow-<verb>/`) or,
 *   with `direct`, as Claude Code skills and OpenCode commands; the preset's agent definitions (`agents/`, as
 *   `.agents/agents/<id>.md` or, with `direct`, `.claude/agents/<id>.md`), the approval workflow (its secret names
 *   from `preset.yml`'s `approve`) and, with `apps.owner`, a CODEOWNERS for the owner-only paths (STA-1856). Each
 *   written file carries its provenance header and `.flow/lock.json` v2 records the Flow version, the preset with its
 *   digest and each written file's digest (STA-1945 FR-2, FR-3); `installProblems`, reading a v1 or v2 lock, is the check that replaces spec-kit's tripwire: no hand edit, no
 *   forgotten `sync`, and no spec-kit leftover. With a `.flow/readme.yml`, `README.md` is rendered too (STA-1879).
 * Boundary: `render` and `installProblems` read; `writeRendered` writes the rendered files and the lock and removes
 *   spec-kit's rendered `speckit-*` skills and commands. Nothing here deletes `.specify/` (that is `migrate`).
 * Runtime: node
 * Governing contract: ADR 0510; STA-1729 (F3); STA-1945 (FR-2, FR-3).
 * Secrets: none.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { approveWorkflow } from "./approve-workflow.mjs";
import { baselineWorkflow } from "./baseline-workflow.mjs";
import { loadConfig } from "./config.mjs";
import { LOCK, OVERRIDES, presetDir } from "./flow-dir.mjs";
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
import { codeowners } from "./owner-only.mjs";
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
import { parseYaml, YamlError } from "./yaml.mjs";

/**
 * What a surface renderer (`render-*.mjs`) reads: the repository, its configuration and its preset's folder. Each one
 * returns its files, path to text, and nothing when the preset has no such surface (STA-1945 C5).
 * @typedef {{ root: string, config: Record<string, any>, presetDir: string }} RenderContext
 */

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
  for (const [id, text] of presetDocs(root, "agents"))
    out.set(direct ? `.claude/agents/${id}.md` : `.agents/agents/${id}.md`, text);
  // STA-1871: the preset's agent rules (the worktree rule among them).
  for (const [id, text] of presetDocs(root, "rules"))
    out.set(direct ? `.claude/rules/${id}.md` : `.agents/rules/${id}.md`, text);
  const readme = renderReadme(root);
  if (readme !== undefined) out.set("README.md", readme);
  const { apps, approve, baseline } = loadConfig(root).config;
  // STA-1942: only a repository whose main is red asks for the baseline gate.
  if (baseline) out.set(`.github/workflows/${BASELINE_WORKFLOW}`, baselineWorkflow(baseline));
  const ownerOnly = approve?.ownerOnly ?? [];
  // No owner, no approval path: GitHub must be able to ask someone for the owner-only paths (CODEOWNERS).
  if (!apps?.owner) return out;
  out.set(
    `.github/workflows/${APPROVE_WORKFLOW}`,
    approveWorkflow({
      version: VERSION,
      integrity: lockedIntegrity(root, PACKAGE, VERSION),
      ...approveSecrets(root),
      // The gate's status counts only from the gate App; a repository adds its own sources in `approve.checks`.
      trusted: { ...(apps?.gate ? { [STATUS_CONTEXT]: apps.gate.login } : {}), ...approve?.checks },
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
 * The preset's documents in `folder` (`agents` or `rules`), id to text; `.flow/overrides/<folder>/<id>.md` replaces one.
 * @param {string} root
 * @param {string} folder
 * @returns {Map<string, string>}
 */
function presetDocs(root, folder) {
  const dir = join(presetDir(root), folder);
  /** @type {Map<string, string>} */
  const out = new Map();
  if (!existsSync(dir)) return out;
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .toSorted()) {
    const own = join(root, OVERRIDES, folder, file);
    out.set(file.slice(0, -3), readFileSync(existsSync(own) ? own : join(dir, file), "utf8"));
  }
  return out;
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
  let approve;
  try {
    approve = existsSync(file) ? parseYaml(readFileSync(file, "utf8"))?.approve : undefined;
  } catch (error) {
    // A repository's own preset.yml outside the YAML subset keeps the default names.
    if (!(error instanceof YamlError)) throw error;
  }
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
  if (existsSync(legacy)) {
    if (existsSync(current))
      return {
        error: `${CONFIG_FILE} and ${LEGACY_CONFIG_FILE} both exist: keep ${CONFIG_FILE} and delete the other`,
        done,
      };
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
 * Writes the rendered files with their provenance headers, then `.flow/lock.json` v2, and removes the rendered `speckit-*` skills and commands.
 * @param {string} root
 * @param {Map<string, string>} files
 * @returns {string[]} the spec-kit files it removed
 */
export function writeRendered(root, files) {
  const removed = removable(root);
  for (const p of removed) rmSync(join(root, p), { recursive: true, force: true });
  const written = withHeaders(root, files);
  for (const [path, text] of written) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  // The lock goes last: a failed write leaves the old lock, and `check` names what differs.
  writeLock(root, lockOf(root, written));
  return removed;
}

/**
 * The spec-kit files `writeRendered` removes: its rendered skills and commands, not its folders (that is `migrate`).
 * @param {string} root
 */
export function removable(root) {
  return leftovers(root).filter((p) => !LEFTOVER_DIRS.includes(p));
}

/**
 * The provenance of what `sync` renders in `root`: the configured preset, at the installed Flow's version (the preset
 * version is Flow's version).
 * @param {string} root
 * @returns {import("./provenance.mjs").Provenance}
 */
export function provenanceOf(root) {
  return { preset: loadConfig(root).config.preset ?? "neutral", version: VERSION };
}

/**
 * The rendered files as `sync` writes them: each comment-capable one with its provenance header (FR-3).
 * @param {string} root
 * @param {Map<string, string>} files
 * @returns {Map<string, string>}
 */
export function withHeaders(root, files) {
  const meta = provenanceOf(root);
  return new Map([...files].map(([path, text]) => [path, withHeader(path, text, meta)]));
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
    // shortcut: every output is rendered until profiles land (STA-1945 PR 3), which record the selected one.
    profile: "*",
    overrides: overridesDigest(root),
    files: Object.fromEntries([...written].map(([path, text]) => [path, digestOf(text)])),
    // Third-party skills are pinned here once Flow installs them (STA-1945 PR 7).
    skills: {},
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
  for (const { path, kind } of driftOf(root, lock))
    problems.push(
      kind === "missing"
        ? `${path} is missing (run \`${NAME} sync\`)`
        : `${path} differs from what \`${NAME} sync\` rendered (change the preset or .flow/overrides/, then sync)`,
    );
  return problems;
}
