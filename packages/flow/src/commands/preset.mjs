/**
 * Figentra Flow file contract:
 * Purpose: `fflow preset add <pkg> [--dry-run]` (STA-2097, PLAN section 9 P1): installs a preset package as a dev
 *   dependency with the package manager whose lockfile the repository has (pnpm-lock.yaml, package-lock.json,
 *   yarn.lock; pnpm when none), then names it as `preset` in the configuration, keeping the rest of it, and says to
 *   run `fflow sync`. `--dry-run` prints the install command and the configuration change and runs nothing. There is
 *   no postinstall: a preset carries guard code, so it is loaded only once the configuration names it.
 * Boundary: runs the package manager (an argument array, no shell, after the name is checked) and writes the
 *   configuration file; never `sync`.
 * Runtime: node
 * Governing contract: ADR 0510; STA-2097.
 * Secrets: none.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ConfigError, loadConfig } from "../lib/config.mjs";
import { isPackageName } from "../lib/preset-package.mjs";
import { CONFIG_FILE, NAME } from "../lib/product.mjs";
import { STARTER_CONFIG } from "./init.mjs";

/** The package managers by their lockfile, in the order they are looked for; the first is the default. */
const MANAGERS = [
  { lockfile: "pnpm-lock.yaml", bin: "pnpm", add: ["add", "-D"] },
  { lockfile: "package-lock.json", bin: "npm", add: ["install", "-D"] },
  { lockfile: "yarn.lock", bin: "yarn", add: ["add", "-D"] },
];

/**
 * The command that installs `pkg` as a dev dependency of the repository at `root`.
 * @param {string} root
 * @param {string} pkg
 * @returns {{ bin: string, args: string[] }}
 */
export function installCommand(root, pkg) {
  const { bin, add } = MANAGERS.find((m) => existsSync(join(root, m.lockfile))) ?? MANAGERS[0];
  // pnpm refuses to add to a workspace's root without -w.
  const workspace = bin === "pnpm" && existsSync(join(root, "pnpm-workspace.yaml")) ? ["-w"] : [];
  return { bin, args: [...add, ...workspace, pkg] };
}

/**
 * `fflow preset add <pkg>` in the repository at `root`.
 * @param {import("../lib/console.mjs").Io} io
 * @param {string} root
 * @param {{ pkg: string, dryRun?: boolean }} options
 * @param {(bin: string, args: string[], options: { cwd: string, stdio: "inherit" }) =>
 *   { status: number | null, error?: Error }} [spawn] runs the package manager (tests inject one)
 * @returns {number}
 * @throws {ConfigError} when `pkg` is not a package name, or the configuration cannot be read
 */
export function add(io, root, { pkg, dryRun = false }, spawn = spawnSync) {
  if (!isPackageName(pkg))
    throw new ConfigError(`${pkg} is not an npm package name (name or @scope/name)`);
  // The file loadConfig reads (the pre-0.2.2 name until `sync` renames it), else a new one.
  const { source } = loadConfig(root);
  const file = source ?? join(root, CONFIG_FILE);
  let config;
  try {
    config = source ? JSON.parse(readFileSync(file, "utf8")) : { ...STARTER_CONFIG };
  } catch (error) {
    // Never overwrite a file that does not parse.
    throw new ConfigError(`${file} is not valid JSON (${/** @type {Error} */ (error).message})`);
  }
  const { bin, args } = installCommand(root, pkg);
  const shown = [bin, ...args].join(" ");
  if (dryRun) {
    io.output.line(`would run: ${shown}`);
    io.output.line(`would set "preset": "${pkg}" in ${file}`);
    return 0;
  }
  const r = spawn(bin, args, { cwd: root, stdio: "inherit" });
  if (r.error || r.status !== 0) {
    io.output.error(
      `${shown} ${r.error ? `could not run: ${r.error.message}` : `exited ${r.status}`}; ${CONFIG_FILE} is unchanged`,
    );
    return 1;
  }
  writeFileSync(file, `${JSON.stringify({ ...config, preset: pkg }, null, 2)}\n`);
  io.output.success(`${pkg} is installed and named as the preset in ${file}`);
  io.output.info(`run \`${NAME} sync\` to render it`);
  return 0;
}
