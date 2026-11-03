/**
 * Figentra Flow file contract:
 * Purpose: `fflow sync [--direct] [--workspace <dir>]` (ADR 0510): renders the repository's preset commands (and any
 *   `.flow/overrides/commands/`) into the `flow-*` skills, writes `.flow/lock.json` and removes spec-kit's rendered
 *   `speckit-*` skills and commands. By default it writes neutral skill documents into `.agents/skills/flow-<verb>/` and
 *   then runs the repository's own projector (`pnpm run agents:sync`) when its package.json has one; `--direct`
 *   renders Claude Code skills and OpenCode commands itself, for a repository without a projector. Nothing runs
 *   spec-kit's `specify`. It renders only the locked preset: when the installed preset's name or digest differs from
 *   the lock's, it refuses and names `fflow update` (STA-1945 FR-1, FR-2). It installs the preset's third-party skills
 *   the profile selects (FR-6) into `.agents/skills/.vendor/`, pinned in the lock, and refuses one it may not or
 *   cannot install (FR-8).
 * Boundary: writes only the rendered files, `.agents/skills/.vendor/`, `.flow/lock.json`, and what the repository's
 *   own `agents:sync` writes; fetches third-party skills from their public sources.
 * Runtime: node
 * Governing contract: ADR 0510; STA-1729 (F3); STA-1945 (FR-1, FR-2, FR-6, FR-8, P-002).
 * Secrets: none.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { NAME } from "../lib/product.mjs";
import { ConfigError } from "../lib/config.mjs";
import { LockError, NewerLockError, readLock } from "../lib/lock.mjs";
import {
  legacyConflict,
  migrateLegacy,
  presetDrift,
  render,
  selectedSkills,
  writeRendered,
} from "../lib/render.mjs";
import { installSkills } from "../lib/skills.mjs";
import { runIn } from "../lib/workspace-run.mjs";

/** The package's assets folder. */
export const ASSETS = fileURLToPath(new URL("../../assets", import.meta.url));

/** The presets bundled with Flow. */
export const BUNDLED = ["neutral", "stackra"];

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
 * Renders and writes the `flow-*` files of `root`.
 * @param {string} root
 * @param {{ direct?: boolean, log?: (s: string) => void, adopt?: boolean,
 *   fetchTree?: import("../lib/skills.mjs").FetchTree }} [options] `adopt` takes the installed preset even when the
 *   lock records another (only `update` passes it); `fetchTree` replaces the git fetch of third-party skills (tests)
 * @throws {SyncRefusal} when the installed preset differs from the lock's and `adopt` is not set
 * @throws {ConfigError} when a newer Flow wrote the lock, or a third-party skill may not or cannot install
 */
export function sync(root, { direct = false, log = console.log, adopt = false, fetchTree } = {}) {
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
  const files = render(root, { direct });
  const removed = writeRendered(root, files);
  for (const p of removed) log(`${NAME} sync: removed ${p} (spec-kit)`);
  log(`${NAME} sync: rendered ${files.size} file(s); .flow/lock.json written`);
  return { files: [...files.keys()], removed };
}

/**
 * Runs the repository's projector after a non-direct render; its output is dropped when `quiet`.
 * @param {string} root
 * @param {boolean} direct
 * @param {import("../lib/workspace-run.mjs").Io} io
 * @returns {number}
 */
export function project(root, direct, io) {
  if (direct) return 0;
  if (!hasProjector(root)) {
    io.log(
      `${NAME} sync: no agents:sync script projects .agents/skills; run \`${NAME} sync --direct\` to render Claude Code and OpenCode files`,
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
  try {
    sync(root, { direct, log: io.log });
  } catch (error) {
    if (!(error instanceof SyncRefusal)) throw error;
    io.log(`${NAME} sync: ${error.message}`);
    return { code: 1, line: `refused: ${error.message}` };
  }
  const code = project(root, direct, io);
  return { code, line: code ? `synced; agents:sync exited ${code}` : "synced" };
}

/** `fflow sync [--direct] [--workspace <dir>]`. */
export const run = (/** @type {string[]} */ args = []) => runIn(args, report);
