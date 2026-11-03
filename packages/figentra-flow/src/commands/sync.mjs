/**
 * Figentra Flow file contract:
 * Purpose: `fflow sync [--direct]` (ADR 0510): renders the repository's preset commands (and any
 *   `.flow/overrides/commands/`) into the `flow-*` skills, writes `.flow/lock.json` and removes spec-kit's rendered
 *   `speckit-*` skills and commands. By default it writes neutral skill documents into `.agents/skills/flow-<verb>/` and
 *   then runs the repository's own projector (`pnpm run agents:sync`) when its package.json has one; `--direct`
 *   renders Claude Code skills and OpenCode commands itself, for a repository without a projector. Nothing runs
 *   spec-kit's `specify`.
 * Boundary: writes only the rendered files, `.flow/lock.json`, and what the repository's own `agents:sync` writes.
 * Runtime: node
 * Governing contract: ADR 0510; STA-1729 (F3).
 * Secrets: none.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { git } from "../lib/git.mjs";
import { NAME } from "../lib/product.mjs";
import { ConfigError } from "../lib/config.mjs";
import { migrateLegacy, render, writeRendered } from "../lib/render.mjs";

/** The package's assets folder. */
export const ASSETS = fileURLToPath(new URL("../../assets", import.meta.url));

/** The presets bundled with Flow. */
export const BUNDLED = ["neutral", "stackra"];

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
 * Renders and writes the `flow-*` files of `root`.
 * @param {string} root
 * @param {{ direct?: boolean, log?: (s: string) => void }} [options]
 */
export function sync(root, { direct = false, log = console.log } = {}) {
  const migrated = migrateLegacy(root);
  if (migrated.error) throw new ConfigError(migrated.error);
  for (const line of migrated.done) log(`${NAME} sync: ${line} (the ${NAME} rename)`);
  const files = render(root, { direct });
  const removed = writeRendered(root, files);
  for (const p of removed) log(`${NAME} sync: removed ${p}`);
  log(`${NAME} sync: rendered ${files.size} file(s); .flow/lock.json written`);
  return { files: [...files.keys()], removed };
}

/** `fflow sync [--direct]`. */
export function run(/** @type {string[]} */ args = []) {
  const top = git(process.cwd(), ["rev-parse", "--show-toplevel"]);
  const root = top.ok ? top.out : process.cwd();
  const direct = args.includes("--direct");
  sync(root, { direct });
  if (direct) return 0;
  if (!hasProjector(root)) {
    console.log(
      `${NAME} sync: no agents:sync script projects .agents/skills; run \`${NAME} sync --direct\` to render Claude Code and OpenCode files`,
    );
    return 0;
  }
  const r = spawnSync("pnpm", ["run", "agents:sync"], { cwd: root, stdio: "inherit" });
  return r.status ?? 1;
}
