/**
 * Figentra Flow file contract:
 * Purpose: `fflow diff [--direct] [--workspace <dir>]` (STA-1945 FR-1, AC-1): prints every file `sync` or `update`
 *   would add, change or delete, `.flow/lock.json` among them, each change with its removed (`-`) and added (`+`)
 *   lines. It renders as the last sync did (`--direct` when the lock lists Claude Code skills) unless `--direct` is
 *   given. When the installed preset differs from the lock, this is what `update` would write, and it says so.
 * Boundary: reads only; writes nothing.
 * Runtime: node
 * Governing contract: STA-1945 (FR-1, P-001).
 * Secrets: none.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { LOCK } from "../lib/flow-dir.mjs";
import { lockText } from "../lib/lock.mjs";
import { NAME } from "../lib/product.mjs";
import {
  appliedOverrides,
  lockOf,
  presetDrift,
  removable,
  render,
  syncedDirect,
  withHeaders,
} from "../lib/render.mjs";
import { runIn } from "../lib/workspace-run.mjs";
import { lockOrNone } from "./sync.mjs";

/** @typedef {{ path: string, kind: "add" | "change" | "delete", patch: string }} Change */

/**
 * The lines of `after` that are not in `before` (`+`) and the reverse (`-`), in order, by their longest common
 * subsequence. Owned files are small, so the quadratic table is fine.
 * @param {string} before
 * @param {string} after
 */
export function linePatch(before, after) {
  const a = before.split("\n");
  const b = after.split("\n");
  const common = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      common[i][j] =
        a[i] === b[j] ? common[i + 1][j + 1] + 1 : Math.max(common[i + 1][j], common[i][j + 1]);
  /** @type {string[]} */
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (common[i + 1][j] >= common[i][j + 1]) out.push(`-${a[i++]}`);
    else out.push(`+${b[j++]}`);
  }
  while (i < a.length) out.push(`-${a[i++]}`);
  while (j < b.length) out.push(`+${b[j++]}`);
  return out.join("\n");
}

/**
 * What `sync` (or, when the preset differs from the lock, `update`) would change in `root`.
 * @param {string} root
 * @param {{ direct?: boolean }} [options]
 * @returns {Change[]}
 */
export function diff(root, { direct } = {}) {
  const { overrides } = appliedOverrides(root);
  const written = withHeaders(
    root,
    render(root, { direct: direct ?? syncedDirect(lockOrNone(root)), overrides }),
    overrides,
  );
  written.set(LOCK, lockText(lockOf(root, written)));
  /** @type {Change[]} */
  const changes = [];
  for (const [path, text] of written) {
    const at = join(root, path);
    if (!existsSync(at)) changes.push({ path, kind: "add", patch: linePatch("", text) });
    else {
      const now = readFileSync(at, "utf8");
      if (now !== text) changes.push({ path, kind: "change", patch: linePatch(now, text) });
    }
  }
  for (const path of removable(root)) changes.push({ path, kind: "delete", patch: "" });
  return changes;
}

/**
 * One repository's `diff`.
 * @param {string} root
 * @param {string[]} args
 * @param {import("../lib/workspace-run.mjs").Io} io
 */
export function report(root, args, io) {
  const changes = diff(root, args.includes("--direct") ? { direct: true } : {});
  const drift = presetDrift(root, lockOrNone(root));
  if (drift) io.log(`${NAME} diff: ${drift}; this is what \`${NAME} update\` would change`);
  for (const c of changes) {
    io.log(`${c.kind} ${c.path}`);
    if (c.patch) io.log(c.patch);
  }
  if (!changes.length) io.log(`${NAME} diff: nothing to change`);
  return {
    code: 0,
    line: changes.length
      ? `${changes.length} change(s): ${changes.map((c) => `${c.kind} ${c.path}`).join(", ")}`
      : "nothing to change",
  };
}

/** `fflow diff [--direct] [--workspace <dir>]`. */
export const run = (/** @type {string[]} */ args = []) => runIn(args, report);
