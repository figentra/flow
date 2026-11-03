/**
 * Figentra Flow file contract:
 * Purpose: `.flow/lock.json` v2 (STA-1945 FR-2): the preset (name, version, digest of its content), the Flow version,
 *   the profile, the digest of `.flow/overrides/`, every owned output with its digest and the pinned skills. A v1 lock
 *   (`version`, `preset`, `files`) is read as v2, and the next `sync` writes it as v2. The digests hash the paths in
 *   sorted order with line endings normalised to LF, so the same content gives the same digest on every machine
 *   (NFR-3).
 * Boundary: reads the repository and the preset; `writeLock` is the only write.
 * Runtime: node
 * Governing contract: STA-1945 (FR-2, P-004).
 * Secrets: none.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { LOCK, OVERRIDES } from "./flow-dir.mjs";

/** @typedef {{ source: string, version: string, licence: string, digest: string }} SkillPin */
/**
 * @typedef {{ lockVersion: 2, flow: string, preset: { name: string, version: string, digest: string },
 *   profile: string, overrides: string, files: Record<string, string>, skills: Record<string, SkillPin> }} Lock
 */

/** Raised when `.flow/lock.json` is not valid JSON. */
export class LockError extends Error {}

/** The digest of one text, as the lock writes it. */
export const digestOf = (/** @type {string} */ text) =>
  `sha256:${createHash("sha256").update(text).digest("hex")}`;

/**
 * The lock of `root`: undefined without one; a v1 lock comes back upgraded.
 * @param {string} root
 * @returns {Lock | undefined}
 * @throws {LockError} on invalid JSON
 */
export function readLock(root) {
  const file = join(root, LOCK);
  if (!existsSync(file)) return undefined;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new LockError(`${LOCK} is not valid JSON`);
  }
  if (parsed === null || typeof parsed !== "object")
    throw new LockError(`${LOCK} is not an object`);
  return parsed.lockVersion === 2 ? parsed : upgradeLock(parsed);
}

/** The lock's text, as `writeLock` writes it. */
export const lockText = (/** @type {Lock} */ lock) => `${JSON.stringify(lock, null, 2)}\n`;

/**
 * @param {string} root
 * @param {Lock} lock
 */
export function writeLock(root, lock) {
  mkdirSync(join(root, dirname(LOCK)), { recursive: true });
  writeFileSync(join(root, LOCK), lockText(lock));
}

/**
 * sha256 over every file under `dir`: each path (sorted, `/`-separated) and its text with CRLF normalised to LF.
 * @param {string} dir
 * @returns {string}
 */
export function treeDigest(dir) {
  const hash = createHash("sha256");
  const paths = readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((p) => p.replaceAll("\\", "/"))
    .filter((p) => statSync(join(dir, p)).isFile())
    .toSorted();
  for (const p of paths)
    hash.update(`${p}\0${readFileSync(join(dir, p), "utf8").replaceAll("\r\n", "\n")}\0`);
  return `sha256:${hash.digest("hex")}`;
}

/**
 * @param {string} root
 * @returns {string} the digest of `.flow/overrides/`, "" when absent
 */
export function overridesDigest(root) {
  const dir = join(root, OVERRIDES);
  return existsSync(dir) ? treeDigest(dir) : "";
}

/**
 * A v1 lock as v2. v1 recorded no preset digest, so the digest is "" and the next `sync` records it.
 * @param {{ version?: string, preset?: string, files?: Record<string, string> }} v1
 * @returns {Lock}
 */
export function upgradeLock(v1) {
  return {
    lockVersion: 2,
    flow: v1.version ?? "",
    preset: { name: v1.preset ?? "neutral", version: v1.version ?? "", digest: "" },
    profile: "*",
    overrides: "",
    files: Object.fromEntries(
      Object.entries(v1.files ?? {}).map(([p, h]) => [
        p,
        h.startsWith("sha256:") ? h : `sha256:${h}`,
      ]),
    ),
    skills: {},
  };
}

/**
 * The owned files that differ from the lock: changed (any byte, header or no header) or missing.
 * @param {string} root
 * @param {Lock} lock
 * @returns {{ path: string, kind: "changed" | "missing" }[]}
 */
export function driftOf(root, lock) {
  /** @type {{ path: string, kind: "changed" | "missing" }[]} */
  const drift = [];
  for (const [path, digest] of Object.entries(lock.files)) {
    const at = join(root, path);
    if (!existsSync(at)) drift.push({ path, kind: "missing" });
    else if (digestOf(readFileSync(at, "utf8")) !== digest) drift.push({ path, kind: "changed" });
  }
  return drift;
}
