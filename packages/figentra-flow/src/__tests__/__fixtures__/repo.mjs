/**
 * Figentra Flow file contract:
 * Purpose: a throwaway repository for the worktree command tests: a main checkout on `main` with one commit, pushed to
 *   a local bare `origin` whose HEAD is `main`, so fetch, push and `origin/HEAD` work with no network.
 * Boundary: test helper; writes only under the OS temp folder, and the caller removes it.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1729.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CONFIG_FILE } from "../../lib/product.mjs";

/** The configuration a test repository carries unless `files` names its own: our tracker and tester trees. */
export const CONFIG = {
  version: 1,
  tracker: {
    kind: "linear",
    team: "STA",
    branchPrefix: "figentra",
    otherBranchPrefixes: ["delegate"],
  },
  clean: { keep: ["g-*", "*-gate", "land-*"] },
};

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
};

/**
 * Runs git in `cwd`, throwing on failure.
 * @param {string} cwd
 * @param {string[]} args
 */
export function sh(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: ENV });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

/**
 * A repository with a bare origin; `files` are committed on main first.
 * @param {Record<string, string>} [files]
 * @returns {{ root: string, origin: string, dispose: () => void }}
 */
export function repo(files = {}) {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "flow-repo-")));
  const origin = join(top, "origin.git");
  const root = join(top, "main");
  sh(top, "init", "-q", "--bare", "-b", "main", origin);
  sh(top, "init", "-q", "-b", "main", root);
  // The code under test runs plain git, not sh(): a runner with no global identity must still commit (merges in
  // `land --stack`), so the repository carries its own.
  sh(root, "config", "user.name", "t");
  sh(root, "config", "user.email", "t@t");
  sh(root, "config", "commit.gpgsign", "false");
  writeFileSync(join(root, "README.md"), "x\n");
  writeFileSync(join(root, CONFIG_FILE), `${JSON.stringify(CONFIG, null, 2)}\n`);
  for (const [path, text] of Object.entries(files)) writeFileSync(join(root, path), text);
  sh(root, "add", "-A");
  sh(root, "commit", "-q", "-m", "init");
  sh(root, "remote", "add", "origin", origin);
  sh(root, "push", "-q", "-u", "origin", "main");
  sh(root, "remote", "set-head", "origin", "main");
  return { root, origin, dispose: () => rmSync(top, { recursive: true, force: true }) };
}

/**
 * Commits a file in `cwd`.
 * @param {string} cwd
 * @param {string} name
 * @param {string} [text]
 */
export function commit(cwd, name, text = `${name}\n`) {
  writeFileSync(join(cwd, name), text);
  sh(cwd, "add", name);
  sh(cwd, "commit", "-q", "-m", `add ${name}`);
}
