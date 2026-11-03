/**
 * Figentra Flow file contract:
 * Purpose: a task's evidence (STA-1945 FR-23): run its check command in the worktree and record the command, exit
 *   code, duration, HEAD, whether the tree was clean and a digest of the output, and refuse a command that looks like
 *   it carries or prints a secret before it runs (NFR-5).
 * Boundary: runs the command through the shell in `root` and `git` there; writes nothing itself. The output is
 *   hashed, never stored, and printed only when the caller asks.
 * Runtime: node
 * Governing contract: STA-1945 FR-23, NFR-5.
 * Secrets: none; the output is kept only as a digest.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

import { git, isClean } from "./git.mjs";

/** @typedef {{ command: string, exit: number, ms: number, head: string, clean: boolean, digest: string, at: string }} TaskEvidence */

/** Literal secrets and commands that print them. */
const SECRET = [
  // provider token shapes
  /\b(?:gh[opsur]_|github_pat_)[A-Za-z0-9_]{20,}/,
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\b(?:glpat-|npm_|lin_api_)[A-Za-z0-9_-]{20,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  // a literal value for a secret-named variable or flag (`$NAME` references are fine)
  /\b[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY)[A-Z0-9_]*=(?!["']?\$)\S/,
  /--(?:password|token|secret|api-key)(?:=|\s+)(?!["']?\$)[^\s-]/i,
  /\bBearer\s+(?!\$)[A-Za-z0-9._~+/-]{8,}/,
  // commands that print the environment or a vault's values
  /(?:^|[;&|(]\s*)env\s*(?:$|[;&|)])/,
  /(?:^|[;&|(]\s*)printenv\b/,
  /\binfisical\s+(?:export|secrets)\b/,
];

/** A long run mixing upper case, lower case and digits (a random key); hex such as a commit SHA is not one. */
const randomLooking = (/** @type {string} */ word) =>
  word.length >= 32 && /[A-Z]/.test(word) && /[a-z]/.test(word) && /\d/.test(word);

/**
 * Whether `command` carries a secret-looking value or would print secrets; `task done` refuses it before it runs.
 * @param {string} command
 * @returns {boolean}
 */
export function secretLooking(command) {
  return (
    SECRET.some((re) => re.test(command)) ||
    (command.match(/[A-Za-z0-9+=_]{32,}/g) ?? []).some(randomLooking)
  );
}

/**
 * Runs `command` in `root` and returns its evidence; `[x]` needs `exit` 0 and `clean`. `echo` prints the captured
 * output to stderr after the run (the digest is taken either way).
 * @param {string} root
 * @param {string} command
 * @param {{ echo?: boolean, now?: () => Date }} [options]
 * @returns {TaskEvidence}
 */
export function runEvidence(root, command, { echo = false, now = () => new Date() } = {}) {
  if (secretLooking(command))
    throw new Error("the command looks like it carries or prints a secret");
  const head = git(root, ["rev-parse", "HEAD"]).out;
  const cleanBefore = isClean(root);
  const at = now();
  const started = Date.now();
  const r = spawnSync(command, { cwd: root, shell: true, encoding: "utf8", maxBuffer: 256 << 20 });
  const ms = Date.now() - started;
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (echo && output) process.stderr.write(output);
  return {
    command,
    exit: r.status ?? 1,
    ms,
    head,
    // the tree the command saw, and one it left unchanged
    clean: cleanBefore && isClean(root),
    digest: `sha256:${createHash("sha256").update(output).digest("hex")}`,
    at: at.toISOString(),
  };
}
