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

import { git } from "./git.mjs";

/**
 * `error` says why a run has no exit code of its own (a timeout, a signal, an output too large); `exit` is then 1.
 * @typedef {{ command: string, exit: number, ms: number, head: string, clean: boolean, digest: string, at: string,
 *   error?: string }} TaskEvidence
 */

/** How long a check may run before it is killed. */
export const EVIDENCE_TIMEOUT_MS = 60 * 60 * 1000;

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
  // commands that print the environment (bare `env`, `env -0 > x`, `/usr/bin/env`, `export`, `set`) or a vault's values
  /(?:^|[;&|(`])\s*(?:\S*\/)?(?:env(?:\s+-\S+)*|export|set)\s*(?:$|[;&|)<>`])/,
  /(?:^|[;&|(`])\s*(?:\S*\/)?printenv\b/,
  /\binfisical\s+(?:export|secrets)\b/,
  // a `.env` file (`.env.example` is fine)
  /(?:^|[\s<'"=/])\.env(?:\.(?!example\b)[\w.-]+)?(?=$|[\s;&|)'"])/,
  // printing a secret-named variable; shortcut: other names (`echo $X`) are not caught, the guard's secret rules are
  /\b(?:echo|printf)\b[^;&|]*\$\{?[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY)/,
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
 * Whether a task's recorded attempts include a passing one: exit 0 at a clean HEAD (P-028).
 * @param {TaskEvidence[] | undefined} attempts
 */
export const passed = (attempts) => (attempts ?? []).some((e) => e.exit === 0 && e.clean);

/**
 * Whether `root` has no change outside the `ignore` paths (Flow's own bookkeeping: the record and the tasks file).
 * @param {string} root
 * @param {string[]} ignore
 */
const cleanOutside = (root, ignore) => {
  // every untracked file by name, so an excluded one inside an untracked folder is not reported as the folder
  const s = git(root, [
    "status",
    "--porcelain",
    "--untracked-files=all",
    "--",
    ".",
    ...ignore.map((p) => `:(exclude)${p}`),
  ]);
  return s.ok && s.out === "";
};

/**
 * Runs `command` in `root` and returns its evidence; `[x]` needs `exit` 0 and `clean`. `echo` prints the captured
 * output to stderr after the run (the digest is taken either way). `ignore` lists paths the clean check skips.
 * @param {string} root
 * @param {string} command
 * @param {{ echo?: boolean, now?: () => Date, timeoutMs?: number, ignore?: string[] }} [options]
 * @returns {TaskEvidence}
 */
export function runEvidence(
  root,
  command,
  { echo = false, now = () => new Date(), timeoutMs = EVIDENCE_TIMEOUT_MS, ignore = [] } = {},
) {
  if (secretLooking(command))
    throw new Error("the command looks like it carries or prints a secret");
  const head = git(root, ["rev-parse", "HEAD"]).out;
  const cleanBefore = cleanOutside(root, ignore);
  const at = now();
  const started = Date.now();
  const r = spawnSync(command, {
    cwd: root,
    shell: true,
    encoding: "utf8",
    maxBuffer: 256 << 20,
    timeout: timeoutMs,
  });
  const ms = Date.now() - started;
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (echo && output) process.stderr.write(output);
  const error =
    /** @type {NodeJS.ErrnoException | undefined} */ (r.error)?.code === "ETIMEDOUT"
      ? `timed out after ${Math.round(timeoutMs / 1000)}s`
      : r.error
        ? r.error.message
        : r.signal
          ? `killed by ${r.signal}`
          : undefined;
  return {
    command,
    exit: r.status ?? 1,
    ms,
    head,
    // the tree the command saw, one it left unchanged, and a HEAD it did not move (a commit or reset in the command)
    clean:
      cleanBefore && cleanOutside(root, ignore) && git(root, ["rev-parse", "HEAD"]).out === head,
    digest: `sha256:${createHash("sha256").update(output).digest("hex")}`,
    at: at.toISOString(),
    ...(error ? { error } : {}),
  };
}
