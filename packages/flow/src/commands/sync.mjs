/**
 * Figentra Flow file contract:
 * Purpose: `fflow sync [--direct] [--workspace <dir>]` (ADR 0510): renders the repository's preset commands (and any
 *   `.flow/overrides/commands/`) into the `flow-*` skills, writes `.flow/lock.json` and removes spec-kit's rendered
 *   `speckit-*` skills and commands. By default it writes neutral skill documents into `.agents/skills/flow-<verb>/` and
 *   then runs the repository's own projector (`pnpm run agents:sync`) when its package.json has one; `--direct`
 *   renders Claude Code skills and OpenCode commands itself, for a repository without a projector. Nothing runs
 *   spec-kit's `specify`. It renders only the locked preset: when the installed preset's name or digest differs from
 *   the lock's, it refuses and names `fflow update` (STA-1945 FR-1, FR-2), and it refuses a preset whose declared Flow
 *   range the installed Flow is outside (STA-2097). It installs the preset's third-party skills the profile selects
 *   (FR-6) into `.agents/skills/.vendor/`, pinned in the lock, and refuses one it may not or
 *   cannot install (FR-8). It applies the repository's overrides and names each one it skips: an invalid one, or one
 *   that breaks a mandatory policy (FR-4, FR-5). It renders the preset's surfaces (`.claude/settings.json`, the
 *   OpenCode projection, `.mcp.yaml`, `AGENTS.md` and `CLAUDE.md`, `lefthook.yml`), removes each owned file it no
 *   longer renders that nobody edited, never touches `.agents/specs/`, and, with `lefthook.yml` rendered, pins
 *   `mise.toml`'s oxfmt and oxlint at the catalog's versions (FR-7).
 * Boundary: writes only the rendered files, `mise.toml`'s two pins, `.agents/skills/.vendor/`, `.flow/lock.json`,
 *   and what the repository's own `agents:sync` writes; fetches third-party skills from their public sources.
 * Runtime: node
 * Governing contract: ADR 0510; STA-1729 (F3); STA-1945 (FR-1, FR-2, FR-4, FR-5, FR-6, FR-7, FR-8, AC-8, P-002);
 *   STA-2097.
 * Secrets: none.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { CONFIG_FILE, NAME } from "../lib/product.mjs";
import { projectAssistants } from "../lib/project-assistants.mjs";
import { ConfigError, loadConfig } from "../lib/config.mjs";
import { BUNDLED, LOCK, presetSource } from "../lib/flow-dir.mjs";
import { driftOf, LockError, NewerLockError, readLock } from "../lib/lock.mjs";
import { incompatibility } from "../lib/preset-package.mjs";
import { catalogPins, LEFTHOOK_FILE, pinTools } from "../lib/render-lefthook.mjs";
import { MCP_FILE } from "../lib/render-mcp.mjs";
import {
  appliedOverrides,
  legacyConflict,
  migrateLegacy,
  presetDrift,
  render,
  selectedSkills,
  writeRendered,
} from "../lib/render.mjs";
import { installSkills } from "../lib/skills.mjs";
import { parseYaml } from "../lib/yaml.mjs";
import { runIn } from "../lib/workspace-run.mjs";

/** The package's assets folder. */
export const ASSETS = fileURLToPath(new URL("../../assets", import.meta.url));

// Moved to lib/flow-dir.mjs so lib/spec-check.mjs reads it without this command (STA-2131).
export { BUNDLED };

/** Raised when `sync` would adopt a preset the lock does not record; `fflow update` adopts it. */
export class SyncRefusal extends Error {}

/**
 * Whether the repository's package.json has an `agents:sync` projector.
 * @param {string} root
 */
export function hasProjector(root) {
  const manifest = join(root, "package.json");
  if (!existsSync(manifest)) return false;
  return Boolean(JSON.parse(readFileSync(manifest, "utf8")).scripts?.["agents:sync"]);
}

/**
 * The lock of `root`, or undefined when it has none or it is unreadable (`sync` rewrites it).
 * @param {string} root
 * @throws {ConfigError} when a newer Flow wrote the lock, which this one must not rewrite
 */
export function lockOrNone(root) {
  try {
    return readLock(root);
  } catch (error) {
    if (error instanceof NewerLockError) throw new ConfigError(error.message);
    if (error instanceof LockError) return undefined;
    throw error;
  }
}

/**
 * The rendered files a repository often writes itself before Flow renders them, each with where its own content
 * belongs instead, so a first sync never replaces it unasked. A product's 800-line AGENTS.md became the preset's
 * 100-line page on its first 0.9 update; geo's .mcp.yaml lost six of its servers.
 */
const OWN = {
  "AGENTS.md": `${CONFIG_FILE}'s \`agentsMd.facts\``,
  "README.md": "`.flow/readme.yml`",
  ".mcp.yaml": `${CONFIG_FILE}'s \`mcp\` servers`,
  ".github/CODEOWNERS":
    "an extend override (`.flow/overrides/<name>.yml`, `kind: extend`, `target: .github/CODEOWNERS`)",
  "lefthook.yml": `${CONFIG_FILE}'s \`lefthook\` jobs`,
  "opencode.jsonc": "an extend or replace override in `.flow/overrides/`",
  ".claude/settings.json": `${CONFIG_FILE}'s \`claudeCode\``,
};

/** The opt-in surfaces: a repository that sets `surfaces.<name>` asks Flow to take its own file over. */
const OPT_IN = ["lefthook.yml", "opencode.jsonc", ".claude/settings.json"];

/** The provenance header a rendered file carries (any version or product name), so an unreadable lock still owns it. */
const RENDERED = /Generated by \S+ from the \S+ preset /;

/**
 * What a render of `path` would drop from `before`: an `.mcp.yaml`'s server names, else its non-blank lines the render
 * lacks (comments that only name who wrote the file left out), a few at most.
 * @param {string} path
 * @param {string} before
 * @param {string} after
 */
export function dropsOf(path, before, after) {
  if (path === MCP_FILE) {
    const servers = (/** @type {string} */ t) => {
      try {
        return Object.keys(parseYaml(t)?.mcpServers ?? {});
      } catch {
        return [];
      }
    };
    const kept = new Set(servers(after));
    return servers(before).filter((s) => !kept.has(s));
  }
  const kept = new Set(after.split("\n").map((l) => l.trim()));
  return before
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !kept.has(l) && !/^(#|\/\/|<!--).*(Generated|Written) by /.test(l))
    .slice(0, 8);
}

/**
 * The files `files` would replace that the repository wrote itself: there, not in the lock, without a render's
 * header, and not what `sync` renders.
 * @param {string} root
 * @param {Map<string, string>} files
 * @param {{ files?: Record<string, string> } | undefined} lock
 * @returns {{ path: string, drops: string[] }[]}
 */
function ownFiles(root, files, lock) {
  return Object.keys(OWN).flatMap((p) => {
    // An opt-in surface renders only when the config asks for it (or the lock already owns it): that is the answer.
    if (OPT_IN.includes(p)) return [];
    if (!files.has(p) || lock?.files?.[p] || !existsSync(join(root, p))) return [];
    const text = readFileSync(join(root, p), "utf8");
    if (text === files.get(p) || RENDERED.test(text.slice(0, 400))) return [];
    return [{ path: p, drops: dropsOf(p, text, /** @type {string} */ (files.get(p))) }];
  });
}

/**
 * Renders and writes the `flow-*` files of `root`.
 * @param {string} root
 * @param {{ direct?: boolean, log?: (s: string) => void, adopt?: boolean,
 *   fetchTree?: import("../lib/skills.mjs").FetchTree }} [options] `adopt` takes the installed preset even when the
 *   lock records another (only `update` passes it); `fetchTree` replaces the git fetch of third-party skills (tests)
 * @throws {SyncRefusal} when the installed preset differs from the lock's and `adopt` is not set, or a first sync
 *   would replace a file the repository wrote (`ownFiles`)
 * @throws {ConfigError} when a newer Flow wrote the lock, a third-party skill may not or cannot install, the preset
 *   package is not installed, or the preset declares a Flow range the installed Flow is outside (STA-2097)
 */
export function sync(root, { direct = false, log = console.log, adopt = false, fetchTree } = {}) {
  // STA-2097: a preset outside the installed Flow's range is refused before anything else, `update` included.
  const incompatible = incompatibility(presetSource(root));
  if (incompatible) throw new ConfigError(`${incompatible.detail} (${incompatible.fix})`);
  const lock = lockOrNone(root);
  const drift = adopt ? undefined : presetDrift(root, lock);
  if (drift) throw new SyncRefusal(drift);
  // Both config files would resolve the wrong preset; refuse before the install prunes anything.
  const conflict = legacyConflict(root);
  if (conflict) throw new ConfigError(conflict);
  // First: a skill that may not or cannot install refuses before the rename or the render writes anything.
  installSkills(root, selectedSkills(root), { fetchTree });
  const migrated = migrateLegacy(root);
  if (migrated.error) throw new ConfigError(migrated.error);
  for (const line of migrated.done) log(`${NAME} sync: ${line} (the ${NAME} rename)`);
  const { overrides, skipped } = appliedOverrides(root);
  for (const p of skipped)
    log(`${NAME} sync: skipped ${p} (\`${NAME} validate\` names every problem)`);
  const files = render(root, { direct, overrides });
  const own = ownFiles(root, files, lock);
  if (own.length)
    throw new SyncRefusal(
      [
        `${NAME} would replace files the repository wrote (${LOCK} does not list them). Keep their own content where ${NAME} renders it from, delete each file, then sync again:`,
        ...own.map(
          ({ path, drops }) =>
            `- ${path}: into ${OWN[/** @type {keyof typeof OWN} */ (path)]}${drops.length ? ` (the render would drop: ${drops.join("; ")})` : ""}`,
        ),
      ].join("\n"),
    );
  // An owned file someone edited since the last sync, or a repository's own file an opted-in surface takes over, is
  // rendered over; say what goes, and where it belongs.
  const takenOver = OPT_IN.filter((p) => files.has(p) && !lock?.files?.[p]).map((path) => ({
    path,
  }));
  for (const { path } of [...(lock ? driftOf(root, lock) : []), ...takenOver])
    if (path in OWN && files.has(path) && existsSync(join(root, path))) {
      const drops = dropsOf(
        path,
        readFileSync(join(root, path), "utf8"),
        /** @type {string} */ (files.get(path)),
      );
      if (drops.length)
        log(
          `${NAME} sync: ${path} ${lock?.files?.[path] ? "was edited since the last sync" : "was the repository's own"}; this render drops ${drops.join("; ")} (keep it in ${OWN[/** @type {keyof typeof OWN} */ (path)]})`,
        );
    }
  const removed = writeRendered(root, files, overrides);
  for (const p of removed) log(`${NAME} sync: removed ${p}`);
  if (files.has(LEFTHOOK_FILE) && pinMise(root))
    log(`${NAME} sync: pinned npm:oxfmt and npm:oxlint in mise.toml at the catalog's versions`);
  log(`${NAME} sync: rendered ${files.size} file(s); .flow/lock.json written`);
  // A direct sync also projects `.agents/` into each assistant's folders (STA-2098 H6), and so does any sync of a
  // repository whose config sets `projection`: its rendered sources stay under `.agents/` (core's ADR 0016).
  if (!direct && loadConfig(root).config.projection !== true)
    return { files: [...files.keys()], removed };
  const projection = projectAssistants(root);
  for (const line of [...projection.conflict, ...projection.broken]) log(`${NAME} sync: ${line}`);
  log(
    `${NAME} sync: projected .agents/ (${projection.written.length} written, ${projection.linked.length} linked, ${projection.pruned.length} pruned, ${projection.ok} up to date)`,
  );
  return { files: [...files.keys()], removed, projection };
}

/**
 * Sets `mise.toml`'s `npm:oxfmt` and `npm:oxlint` pins to the versions `pnpm-workspace.yaml`'s catalog pins, which
 * the rendered hooks run (STA-1945 FR-7, AC-8); a repository whose catalog pins neither is left alone.
 * @param {string} root
 * @returns {boolean} whether `mise.toml` changed
 */
export function pinMise(root) {
  const workspace = join(root, "pnpm-workspace.yaml");
  const pins = existsSync(workspace) ? catalogPins(readFileSync(workspace, "utf8")) : undefined;
  if (!pins) return false;
  const file = join(root, "mise.toml");
  const before = existsSync(file) ? readFileSync(file, "utf8") : "";
  const after = pinTools(before, pins);
  if (after !== before) writeFileSync(file, after);
  return after !== before;
}

/**
 * Runs the repository's projector after a non-direct render (a direct one projects in `sync`); its output is dropped
 * when `quiet`.
 * @param {string} root
 * @param {boolean} direct
 * @param {import("../lib/workspace-run.mjs").Io} io
 * @returns {number}
 */
export function project(root, direct, io) {
  if (direct) return 0;
  if (!hasProjector(root)) {
    io.log(
      `${NAME} sync: .agents/skills is ready for Codex; no agents:sync projector is configured. For other configured harnesses, run \`${NAME} sync --direct\` (defaults to Claude Code and OpenCode)`,
    );
    return 0;
  }
  const r = spawnSync("pnpm", ["run", "agents:sync"], {
    cwd: root,
    stdio: io.quiet ? "ignore" : "inherit",
  });
  return r.status ?? 1;
}

/**
 * One repository's `sync`.
 * @param {string} root
 * @param {string[]} args
 * @param {import("../lib/workspace-run.mjs").Io} io
 */
export function report(root, args, io) {
  const direct = args.includes("--direct");
  let projected;
  try {
    projected = sync(root, { direct, log: io.log }).projection;
  } catch (error) {
    if (!(error instanceof SyncRefusal)) throw error;
    io.log(`${NAME} sync: ${error.message}`);
    return { code: 1, line: `refused: ${error.message}` };
  }
  // A conflict or a broken source in the direct projection fails the sync.
  const code = projected
    ? Number(projected.conflict.length + projected.broken.length > 0)
    : project(root, direct, io);
  return { code, line: code ? `synced; agents:sync exited ${code}` : "synced" };
}

/** `fflow sync [--direct] [--workspace <dir>]`. */
export const run = (/** @type {string[]} */ args = []) => runIn(args, report);
