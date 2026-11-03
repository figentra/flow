/**
 * Figentra Flow file contract:
 * Purpose: hold the hooks runner to C13: with the workspace install the jobs run here through lefthook (no
 *   `LEFTHOOK` or `LEFTHOOK_EXCLUDE` reaching them, the workspace's binaries first) and the proof is
 *   `Hooks-Run: local`; without it the runner gets a repository holding only the run's ref, whose index is exactly
 *   the staged tree (also for a first commit), the job clears both variables and git's repository variables itself,
 *   and the proof names the box run and that tree; in a linked worktree's hook (`GIT_DIR`, `GIT_INDEX_FILE` set) the
 *   caller's branch and index stay as they were; a failure passes through and leaves no proof; a git step that fails
 *   partway leaves no ref or folder behind; a tree with artifacts never reaches the box; commit-msg appends the saved
 *   proof only when it is this tree's, and without one runs the pre-commit jobs too; no runner, or the github-actions
 *   runner, is refused naming `"runner"`; the trailer is read back from the message's trailer block only.
 * Boundary: temporary repositories; lefthook, git and the runner faked where named; no box, no network.
 * Runtime: node
 * Governing contract: STA-1945 (C13, PR 13).
 */
// @covers sta-1945:FR-18 sta-1945:AC-16 sta-1945:P-024
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { runnerPort } from "../adapters/runner/index.mjs";
import { canRunLocally, hasHooksTrailer, runHooks, TRAILER } from "../lib/hooks-run.mjs";
import { commit, repo, sh } from "./__fixtures__/repo.mjs";

/**
 * A command runner that hands the job to `run`.
 * @param {(job: import("../adapters/runner/index.mjs").Job) => number} run
 * @returns {import("../adapters/runner/index.mjs").Runner}
 */
const fake = (run) => ({ kind: "command", wraps: false, program: "stackra", run });

/** The saved pre-commit proof in the repository's git folder. */
const savedOf = (/** @type {string} */ root) => join(root, ".git", "fflow-hooks-run");

/**
 * Sets `vars` in the environment for one test (`undefined` unsets) and restores them after it.
 * @param {{ after: (fn: () => void) => void }} t the test's context
 * @param {Record<string, string | undefined>} vars
 */
function withEnv(t, vars) {
  const set = (/** @type {Record<string, string | undefined>} */ v) => {
    for (const [k, x] of Object.entries(v))
      if (x === undefined) delete process.env[k];
      else process.env[k] = x;
  };
  const before = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  set(vars);
  t.after(() => set(before));
}

/** Writes an executable shell script. */
const script = (/** @type {string} */ path, /** @type {string} */ body) =>
  writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });

test("hooks run: with the workspace install, lefthook runs here without LEFTHOOK and the proof is local", async (t) => {
  const r = repo();
  t.after(r.dispose);
  assert.equal(canRunLocally(r.root), false);
  mkdirSync(join(r.root, "node_modules"));
  writeFileSync(join(r.root, "node_modules", ".modules.yaml"), "");
  assert.equal(canRunLocally(r.root), true);
  withEnv(t, { LEFTHOOK: "0", LEFTHOOK_EXCLUDE: "lint" });
  /** @type {any[]} */
  const calls = [];
  let status = 0;
  /** @type {any} */
  const spawn = (
    /** @type {string} */ program,
    /** @type {string[]} */ args,
    /** @type {any} */ opts,
  ) => {
    calls.push({ program, args, opts });
    return { status };
  };
  const result = await runHooks({ root: r.root, stage: "pre-commit", spawn });
  assert.deepEqual(result, { code: 0, trailer: `${TRAILER}: local` });
  assert.equal(calls[0].program, "lefthook");
  assert.deepEqual(calls[0].args, ["run", "pre-commit"]);
  assert.equal(calls[0].opts.cwd, r.root);
  assert.equal(calls[0].opts.env.LEFTHOOK, undefined);
  assert.equal(calls[0].opts.env.LEFTHOOK_EXCLUDE, undefined);
  assert.ok(
    calls[0].opts.env.PATH.startsWith(`${join(r.root, "node_modules", ".bin")}${delimiter}`),
  );
  assert.equal(readFileSync(savedOf(r.root), "utf8"), `${TRAILER}: local\n`);

  // A failed run is the jobs' code and takes the saved proof away.
  status = 1;
  const failed = await runHooks({ root: r.root, stage: "pre-commit", spawn });
  assert.equal(failed.code, 1);
  assert.equal(existsSync(savedOf(r.root)), false);

  // A message file the trailer cannot be added to is a refusal, not a pass.
  status = 0;
  const lost = await runHooks({
    root: r.root,
    stage: "commit-msg",
    args: [".git/NO_SUCH_MSG"],
    spawn,
  });
  assert.equal(lost.code, 2);
  assert.match(lost.problem ?? "", /the trailer was not added/);
  // No saved proof (the failed run took it): the commit-msg run runs the pre-commit jobs first.
  assert.deepEqual(
    calls.slice(-2).map((c) => c.args),
    [
      ["run", "pre-commit"],
      ["run", "commit-msg", ".git/NO_SUCH_MSG"],
    ],
  );

  /** @type {any} */
  const missing = () => ({ error: new Error("ENOENT"), status: null });
  const absent = await runHooks({ root: r.root, stage: "pre-push", spawn: missing });
  assert.equal(absent.code, 2);
  assert.match(absent.problem ?? "", /`lefthook` is not in node_modules\/\.bin or on PATH/);
});

test("hooks run: without the install, the box gets the staged tree and the proof names the run and the tree", async (t) => {
  const r = repo();
  t.after(r.dispose);
  commit(r.root, "a.txt", "one\n");
  writeFileSync(join(r.root, "a.txt"), "staged\n");
  writeFileSync(join(r.root, "b.txt"), "new\n");
  sh(r.root, "add", "a.txt", "b.txt");
  writeFileSync(join(r.root, "a.txt"), "unstaged\n");
  const head = sh(r.root, "rev-parse", "HEAD");
  const tree = sh(r.root, "write-tree");
  /** @type {any} */
  let seen;
  const result = await runHooks({
    root: r.root,
    stage: "pre-commit",
    runner: fake((job) => {
      seen = {
        ...job,
        head: sh(job.dir, "rev-parse", "HEAD"),
        refs: sh(job.dir, "for-each-ref", "--format=%(refname)"),
        staged: sh(job.dir, "diff", "--cached", "--name-only"),
        a: readFileSync(join(job.dir, "a.txt"), "utf8"),
      };
      return 0;
    }),
  });
  assert.equal(seen.head, head);
  assert.equal(seen.staged, "a.txt\nb.txt");
  assert.equal(seen.a, "staged\n");
  const vars = sh(r.root, "rev-parse", "--local-env-vars").split("\n").join(" ");
  assert.equal(
    seen.command,
    `unset LEFTHOOK LEFTHOOK_EXCLUDE ${vars} && pnpm install --frozen-lockfile && pnpm exec lefthook run pre-commit`,
  );
  assert.match(seen.refs, /^refs\/fflow-hooks\/\S+$/, "the box holds the run's ref only");
  const [, run] = seen.label.match(/^fflow hooks pre-commit (\S+)$/) ?? [];
  assert.ok(run, seen.label);
  assert.deepEqual(result, { code: 0, trailer: `${TRAILER}: box stackra ${run} ${tree}` });
  assert.equal(hasHooksTrailer(`feat: x\n\n${result.trailer}`), true);
  assert.equal(existsSync(seen.dir), false, "the job folder is removed");
  assert.equal(sh(r.root, "for-each-ref", "refs/fflow-hooks/"), "", "the temporary ref is removed");
  assert.equal(readFileSync(savedOf(r.root), "utf8"), `${result.trailer}\n`);
  assert.equal(
    readFileSync(join(r.root, "a.txt"), "utf8"),
    "unstaged\n",
    "the checkout is untouched",
  );
  assert.equal(sh(r.root, "write-tree"), tree, "the index is untouched");

  // The commit-msg run gets the message on the box and appends the saved proof here.
  const msg = join(r.root, ".git", "COMMIT_EDITMSG");
  writeFileSync(msg, "feat: add b\n\nRefs: STA-1945\n");
  /** @type {string} */
  let boxed = "";
  const tail = await runHooks({
    root: r.root,
    stage: "commit-msg",
    args: [".git/COMMIT_EDITMSG"],
    runner: fake((job) => {
      boxed = readFileSync(join(job.dir, ".git", "COMMIT_EDITMSG"), "utf8");
      assert.match(
        job.command,
        /--frozen-lockfile && pnpm exec lefthook run commit-msg \.git\/COMMIT_EDITMSG$/,
      );
      return 0;
    }),
  });
  assert.equal(boxed, "feat: add b\n\nRefs: STA-1945\n");
  assert.deepEqual(tail, { code: 0, trailer: result.trailer });
  assert.equal(readFileSync(msg, "utf8"), `feat: add b\n\nRefs: STA-1945\n${result.trailer}\n`);
  assert.equal(existsSync(savedOf(r.root)), false, "the saved proof is used once");
});

test("hooks run: a proof saved for another tree is not this commit's; the commit-msg run runs pre-commit too", async (t) => {
  const r = repo();
  t.after(r.dispose);
  writeFileSync(savedOf(r.root), `${TRAILER}: box old r0 ${"0".repeat(40)}\n`);
  const tree = sh(r.root, "write-tree");
  const msg = join(r.root, ".git", "MERGE_MSG");
  writeFileSync(msg, "Merge branch 'x'\n");
  const result = await runHooks({
    root: r.root,
    stage: "commit-msg",
    args: [".git/MERGE_MSG"],
    runner: fake((job) => {
      assert.match(
        job.command,
        /&& pnpm exec lefthook run pre-commit && pnpm exec lefthook run commit-msg \.git\/COMMIT_EDITMSG$/,
      );
      return 0;
    }),
  });
  assert.equal(result.code, 0);
  assert.match(result.trailer, new RegExp(`^${TRAILER}: box stackra \\S+ ${tree}$`));
  assert.equal(readFileSync(msg, "utf8"), `Merge branch 'x'\n\n${result.trailer}\n`);
  assert.equal(existsSync(savedOf(r.root)), false);
});

test("hooks run: the box job clears LEFTHOOK and LEFTHOOK_EXCLUDE even when the runner passes the caller's environment", async (t) => {
  const r = repo();
  t.after(r.dispose);
  const bin = join(r.root, "..", "bin");
  mkdirSync(bin);
  const out = join(r.root, "..", "seen");
  script(
    join(bin, "pnpm"),
    `[ "$1" = exec ] && printf '%s|%s|%s\\n' "\${LEFTHOOK-unset}" "\${LEFTHOOK_EXCLUDE-unset}" "$*" > "$HOOKS_OUT"\nexit 0`,
  );
  withEnv(t, {
    LEFTHOOK: "0",
    LEFTHOOK_EXCLUDE: "lint",
    HOOKS_OUT: out,
    PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
  });
  const result = await runHooks({
    root: r.root,
    stage: "pre-commit",
    runner: runnerPort({ kind: "local" }),
  });
  assert.equal(result.code, 0);
  assert.equal(readFileSync(out, "utf8"), "unset|unset|exec lefthook run pre-commit\n");
});

test("hooks run: in a linked worktree's hook, the box steps leave the caller's branch and index alone", async (t) => {
  const r = repo();
  t.after(r.dispose);
  const wt = join(r.root, "..", "wt");
  sh(r.root, "worktree", "add", "-q", "-b", "feat", wt);
  writeFileSync(join(wt, "b.txt"), "new\n");
  sh(wt, "add", "b.txt");
  const head = sh(wt, "rev-parse", "HEAD");
  // What git sets for a hook in a linked worktree (sh() keeps the environment it was loaded with).
  const gitDir = sh(wt, "rev-parse", "--absolute-git-dir");
  withEnv(t, { GIT_DIR: gitDir, GIT_INDEX_FILE: join(gitDir, "index") });
  /** @type {any} */
  let seen;
  const result = await runHooks({
    root: wt,
    stage: "pre-commit",
    runner: fake((job) => {
      seen = {
        command: job.command,
        refs: sh(job.dir, "for-each-ref", "--format=%(refname)"),
        staged: sh(job.dir, "diff", "--cached", "--name-only"),
      };
      return 0;
    }),
  });
  assert.equal(result.code, 0, result.problem);
  assert.equal(seen.staged, "b.txt");
  assert.match(seen.refs, /^refs\/fflow-hooks\/\S+$/);
  assert.match(seen.command, /^unset LEFTHOOK LEFTHOOK_EXCLUDE .*\bGIT_DIR\b.*&& pnpm install/);
  assert.match(seen.command, /^unset [^&]*\bGIT_INDEX_FILE\b/);
  assert.equal(
    sh(wt, "symbolic-ref", "--short", "HEAD"),
    "feat",
    "the worktree stays on its branch",
  );
  assert.equal(sh(wt, "rev-parse", "HEAD"), head);
  assert.equal(sh(wt, "diff", "--cached", "--name-only"), "b.txt", "its index is untouched");
});

test("hooks run: a first commit's box has an unborn head and the staged files", async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "flow-hooks-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  sh(root, "init", "-q", "-b", "main");
  sh(root, "config", "user.name", "t");
  sh(root, "config", "user.email", "t@t");
  sh(root, "config", "commit.gpgsign", "false");
  writeFileSync(join(root, "a.txt"), "first\n");
  sh(root, "add", "a.txt");
  /** @type {any} */
  let seen;
  const result = await runHooks({
    root,
    stage: "pre-commit",
    runner: fake((job) => {
      seen = {
        head: spawnSync("git", ["rev-parse", "--verify", "-q", "HEAD"], { cwd: job.dir }).status,
        branch: sh(job.dir, "symbolic-ref", "--short", "HEAD"),
        staged: sh(job.dir, "diff", "--cached", "--name-only"),
      };
      return 0;
    }),
  });
  assert.equal(result.code, 0, result.problem);
  assert.notEqual(seen.head, 0, "HEAD is unborn");
  assert.equal(seen.branch, "fflow-hooks");
  assert.equal(seen.staged, "a.txt");
  assert.match(
    result.trailer,
    new RegExp(`^${TRAILER}: box stackra \\S+ ${sh(root, "write-tree")}$`),
  );
});

test("hooks run: a git step that fails partway leaves no ref and no folder", async (t) => {
  const r = repo();
  t.after(r.dispose);
  const bin = join(r.root, "..", "bin");
  const tmp = join(r.root, "..", "tmp");
  mkdirSync(bin);
  mkdirSync(tmp);
  const real = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
  script(
    join(bin, "git"),
    `case " $* " in *" fetch "*) echo "fetch refused" >&2; exit 1;; esac\nexec '${real}' "$@"`,
  );
  withEnv(t, { TMPDIR: tmp, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` });
  const result = await runHooks({
    root: r.root,
    stage: "pre-commit",
    runner: fake(() => assert.fail("no job runs")),
  });
  assert.equal(result.code, 2);
  assert.match(result.problem ?? "", /git -C .* fetch .* failed: fetch refused/);
  assert.equal(sh(r.root, "for-each-ref", "refs/fflow-hooks/"), "");
  assert.deepEqual(readdirSync(tmp), []);
});

test("hooks run: a tree with build output or an oversized file never reaches the box", async (t) => {
  const r = repo();
  t.after(r.dispose);
  mkdirSync(join(r.root, "dist"));
  writeFileSync(join(r.root, "dist", "out.js"), "x\n");
  sh(r.root, "add", "dist/out.js");
  const box = fake(() => assert.fail("no job runs"));
  const built = await runHooks({ root: r.root, stage: "pre-commit", runner: box });
  assert.equal(built.code, 2);
  assert.match(built.problem ?? "", /artifacts:\n {2}dist\/out\.js: build or tool output/);
  sh(r.root, "rm", "-q", "--cached", "dist/out.js");
  writeFileSync(join(r.root, "big.txt"), "0123456789\n");
  sh(r.root, "add", "big.txt");
  const big = await runHooks({
    root: r.root,
    stage: "pre-commit",
    runner: box,
    artifacts: { maxBytes: 4 },
  });
  assert.equal(big.code, 2);
  assert.match(big.problem ?? "", /big\.txt: .* over the/);
});

test("hooks run: a failed box run passes through and leaves no proof", async (t) => {
  const r = repo();
  t.after(r.dispose);
  writeFileSync(savedOf(r.root), `${TRAILER}: local\n`);
  const result = await runHooks({ root: r.root, stage: "pre-commit", runner: fake(() => 1) });
  assert.equal(result.code, 1);
  assert.equal(existsSync(savedOf(r.root)), false);
  const gone = await runHooks({ root: r.root, stage: "pre-push", runner: fake(() => 127) });
  assert.equal(gone.code, 2);
  assert.match(gone.problem ?? "", /exit 127: `stackra` .*not on PATH/);
});

test("hooks run: no runner, or the github-actions runner, is refused naming the runner key", async (t) => {
  const r = repo();
  t.after(r.dispose);
  const none = await runHooks({ root: r.root, stage: "pre-commit" });
  assert.equal(none.code, 2);
  assert.match(none.problem ?? "", /no workspace install.*"runner" in flow\.config\.json/);
  const actions = await runHooks({
    root: r.root,
    stage: "pre-commit",
    runner: { kind: "github-actions", wraps: false, program: "gh", run: () => 0 },
  });
  assert.equal(actions.code, 2);
  assert.match(actions.problem ?? "", /runs the gate, not hooks/);
  const bare = await runHooks({ root: r.root, stage: "commit-msg", runner: fake(() => 0) });
  assert.equal(bare.code, 2);
  assert.match(bare.problem ?? "", /message file/);
});

test("hooks trailer: local or a box run with its tree, in the trailer block only", () => {
  const tree = "a".repeat(40);
  assert.equal(hasHooksTrailer(`fix: y\n\nRefs: STA-1\n${TRAILER}: local\n`), true);
  assert.equal(hasHooksTrailer(`fix: y\n\n${TRAILER}: box ci-1 r1 ${tree}`), true);
  assert.equal(hasHooksTrailer("fix: y\n\nRefs: STA-1"), false);
  assert.equal(hasHooksTrailer(`fix: y\n\n${TRAILER}: box ci-1 r1 not-a-tree`), false);
  assert.equal(hasHooksTrailer(`fix: y\n\n${TRAILER}: local\n\nbody after it`), false);
});
