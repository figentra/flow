/**
 * Figentra Flow file contract:
 * Purpose: `fflow update [--preset <version>] [--direct] [--workspace <dir>]` (STA-1945 FR-1, AC-2): adopts the
 *   installed preset deliberately. It prints the diff, then syncs with the installed preset, which rewrites the lock
 *   (last). The preset version is Flow's version and pnpm stays the only installer, so `--preset <version>` refuses
 *   any version but the installed one.
 * Boundary: writes what `sync` writes.
 * Runtime: node
 * Governing contract: STA-1945 (FR-1, FR-2, P-002).
 * Secrets: none.
 */
import { NAME, PACKAGE, VERSION } from "../lib/product.mjs";
import { syncedDirect } from "../lib/render.mjs";
import { runIn } from "../lib/workspace-run.mjs";
import { diff } from "./diff.mjs";
import { lockOrNone, project, sync } from "./sync.mjs";

/**
 * Adopts the installed preset in `root`.
 * @param {string} root
 * @param {{ preset?: string, direct?: boolean, log?: (line: string) => void }} [options]
 * @returns {number}
 */
export function update(root, { preset, direct, log = console.log } = {}) {
  if (preset !== undefined && preset !== VERSION) {
    log(
      `${NAME} update: the installed preset is ${VERSION}, not ${preset}; install ${PACKAGE}@${preset} with your package manager, then run \`${NAME} update\``,
    );
    return 1;
  }
  const rendered = direct ?? syncedDirect(lockOrNone(root));
  const changes = diff(root, { direct: rendered });
  for (const c of changes) {
    log(`${c.kind} ${c.path}`);
    if (c.patch) log(c.patch);
  }
  sync(root, { direct: rendered, log, adopt: true });
  log(`${NAME} update: the lock records the ${VERSION} preset`);
  return 0;
}

/**
 * One repository's `update`.
 * @param {string} root
 * @param {string[]} args
 * @param {import("../lib/workspace-run.mjs").Io} io
 */
export function report(root, args, io) {
  const at = args.indexOf("--preset");
  const preset = at === -1 ? undefined : (args[at + 1] ?? "");
  const direct = args.includes("--direct") ? true : syncedDirect(lockOrNone(root));
  const code = update(root, { preset, direct, log: io.log });
  if (code) return { code, line: `refused: ${VERSION} is installed, not ${preset}` };
  const projected = project(root, direct, io);
  return {
    code: projected,
    line: projected ? `updated; agents:sync exited ${projected}` : `updated to ${VERSION}`,
  };
}

/** `fflow update [--preset <version>] [--direct] [--workspace <dir>]`. */
export const run = (/** @type {string[]} */ args = []) => runIn(args, report);
