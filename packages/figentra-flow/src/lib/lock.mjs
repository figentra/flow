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
import { NAME } from "./product.mjs";

/** @typedef {{ source: string, version: string, licence: string, digest: string }} SkillPin */
/**
 * @typedef {{ lockVersion: 2, flow: string, preset: { name: string, version: string, digest: string },
 *   profile: string, overrides: string, files: Record<string, string>, skills: Record<string, SkillPin> }} Lock
 */

/** Raised when `.flow/lock.json` is not valid JSON, has an unknown `lockVersion`, or is not a valid v2 lock. */
export class LockError extends Error {}

/** Raised when a newer Flow wrote `.flow/lock.json` (an unknown `lockVersion`): nothing may rewrite it. */
export class NewerLockError extends LockError {}

/** The digest of one text, as the lock writes it. */
export const digestOf = (/** @type {string} */ text) =>
  `sha256:${createHash("sha256").update(text).digest("hex")}`;

/**
 * The lock of `root`: undefined without one; a v1 lock comes back upgraded.
 * @param {string} root
 * @returns {Lock | undefined}
 * @throws {LockError} on invalid JSON, an unknown `lockVersion` or a v2 lock of the wrong shape
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
  if (!isRecord(parsed)) throw new LockError(`${LOCK} is not an object`);
  // v1 had no lockVersion; any other version is a newer Flow's, which this one must not read or overwrite.
  const v1 = parsed.lockVersion === undefined;
  if (!v1 && parsed.lockVersion !== 2)
    throw new NewerLockError(
      `${LOCK} has lockVersion ${JSON.stringify(parsed.lockVersion)}; this ${NAME} reads 1 and 2 (run a newer ${NAME})`,
    );
  const bad = v1 ? v1Problem(parsed) : v2Problem(parsed);
  if (bad) throw new LockError(`${LOCK} is not a valid v${v1 ? 1 : 2} lock: ${bad}`);
  return v1
    ? upgradeLock(/** @type {Parameters<typeof upgradeLock>[0]} */ (parsed))
    : /** @type {Lock} */ (/** @type {unknown} */ (parsed));
}

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isRecord(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Why `map` is not an object of strings, or undefined.
 * @param {string} name
 * @param {unknown} map
 */
function stringsProblem(name, map) {
  if (!isRecord(map)) return `${name} is not an object`;
  const key = Object.keys(map).find((k) => typeof map[k] !== "string");
  return key === undefined ? undefined : `${name}["${key}"] is not a string`;
}

/**
 * The first way a v1 lock falls short of its shape, or undefined.
 * @param {Record<string, unknown>} lock
 */
function v1Problem(lock) {
  for (const key of ["version", "preset"])
    if (lock[key] !== undefined && typeof lock[key] !== "string") return `${key} is not a string`;
  return lock.files === undefined ? undefined : stringsProblem("files", lock.files);
}

/**
 * The first way a v2 lock falls short of its shape, or undefined.
 * @param {Record<string, unknown>} lock
 */
function v2Problem(lock) {
  for (const key of ["flow", "profile", "overrides"])
    if (typeof lock[key] !== "string") return `${key} is not a string`;
  return (
    stringsProblem("preset", lock.preset) ??
    (["name", "version", "digest"].every((k) => k in /** @type {object} */ (lock.preset))
      ? undefined
      : "preset needs name, version and digest") ??
    stringsProblem("files", lock.files) ??
    (isRecord(lock.skills) ? undefined : "skills is not an object")
  );
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
 * The rules block stackra/core's `tools/scripts/agents-sync.mjs` appends to `AGENTS.md` after `sync` renders it
 * (`\n\n<block>\n` at the end of the file): `driftOf` reads `AGENTS.md` without it, so only the rest must match.
 * shortcut: one consumer's block, by its marker text, tolerated only at the end of the root `AGENTS.md`; remove it
 * when STA-2098 H6 (T149) retires agents-sync.
 */
const RULES_BLOCK =
  /\n\n<!-- BEGIN generated from \.agents\/rules[^\n]*-->\n[\s\S]*?\n<!-- END generated from \.agents\/rules -->\n$/;

/**
 * The owned files that differ from the lock: changed (any byte, header or no header; `AGENTS.md` outside core's
 * rules block) or missing.
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
    else {
      const text = readFileSync(at, "utf8");
      const owned = path === "AGENTS.md" ? text.replace(RULES_BLOCK, "\n") : text;
      if (digestOf(owned) !== digest) drift.push({ path, kind: "changed" });
    }
  }
  return drift;
}
