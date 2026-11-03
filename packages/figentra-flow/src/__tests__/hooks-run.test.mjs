/**
 * Figentra Flow file contract:
 * Purpose: hold the hooks runner to C13: with the workspace install the jobs run here through lefthook (no
 *   `LEFTHOOK` reaching them) and the proof is `Hooks-Run: local`; without it the runner gets a clone whose index is
 *   exactly the staged tree, and the proof names the box run and that tree; a failure passes through and saves no
 *   proof; commit-msg appends the saved proof; no runner, or the github-actions runner, is refused naming doctor; the
 *   trailer is read back from the message's trailer block only.
 * Boundary: temporary repositories; lefthook and the runner injected; no box, no network.
 * Runtime: node
 * Governing contract: STA-1945 (C13, PR 13).
 */
// @covers sta-1945:FR-18 sta-1945:AC-16 sta-1945:P-024
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { canRunLocally, hasHooksTrailer, INNER, runHooks, TRAILER } from "../lib/hooks-run.mjs";
import { commit, repo, sh } from "./__fixtures__/repo.mjs";

/**
 * A command runner that hands the job to `run`.
 * @param {(job: import("../adapters/runner/index.mjs").Job) => number} run
 * @returns {import("../adapters/runner/index.mjs").Runner}
 */
const fake = (run) => ({ kind: "command", wraps: false, program: "stackra", run });

/** The saved pre-commit proof in the repository's git folder. */
const savedOf = (/** @type {string} */ root) => join(root, ".git", "fflow-hooks-run");

test("hooks run: with the workspace install, lefthook runs here without LEFTHOOK and the proof is local", async (t) => {
  const r = repo();
  t.after(r.dispose);
  assert.equal(canRunLocally(r.root), false);
  mkdirSync(join(r.root, "node_modules"));
  writeFileSync(join(r.root, "node_modules", ".modules.yaml"), "");
  assert.equal(canRunLocally(r.root), true);
  const before = process.env.LEFTHOOK;
  process.env.LEFTHOOK = "0";
  t.after(() => {
    if (before === undefined) delete process.env.LEFTHOOK;
    else process.env.LEFTHOOK = before;
  });
  /** @type {any[]} */
  const calls = [];
  /** @type {any} */
  const spawn = (
    /** @type {string} */ program,
    /** @type {string[]} */ args,
    /** @type {any} */ opts,
  ) => {
    calls.push({ program, args, opts });
    return { status: 0 };
  };
  const result = await runHooks({ root: r.root, stage: "pre-commit", spawn });
  assert.deepEqual(result, { code: 0, trailer: `${TRAILER}: local` });
  assert.equal(calls[0].program, "lefthook");
  assert.deepEqual(calls[0].args, ["run", "pre-commit"]);
  assert.equal(calls[0].opts.cwd, r.root);
  assert.equal(calls[0].opts.env.LEFTHOOK, undefined);
  assert.equal(calls[0].opts.env[INNER], "1");
  assert.equal(readFileSync(savedOf(r.root), "utf8"), `${TRAILER}: local\n`);

  /** @type {any} */
  const missing = () => ({ error: new Error("ENOENT"), status: null });
  const absent = await runHooks({ root: r.root, stage: "pre-push", spawn: missing });
  assert.equal(absent.code, 2);
  assert.match(absent.problem ?? "", /lefthook.*fflow doctor/);
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
        staged: sh(job.dir, "diff", "--cached", "--name-only"),
        a: readFileSync(join(job.dir, "a.txt"), "utf8"),
      };
      return 0;
    }),
  });
  assert.equal(seen.head, head);
  assert.equal(seen.staged, "a.txt\nb.txt");
  assert.equal(seen.a, "staged\n");
  assert.equal(
    seen.command,
    `pnpm install --frozen-lockfile && ${INNER}=1 pnpm exec lefthook run pre-commit`,
  );
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
      assert.match(job.command, /lefthook run commit-msg \.git\/COMMIT_EDITMSG$/);
      return 0;
    }),
  });
  assert.equal(boxed, "feat: add b\n\nRefs: STA-1945\n");
  assert.deepEqual(tail, { code: 0, trailer: result.trailer });
  assert.equal(readFileSync(msg, "utf8"), `feat: add b\n\nRefs: STA-1945\n${result.trailer}\n`);
  assert.equal(existsSync(savedOf(r.root)), false, "the saved proof is used once");
});

test("hooks run: a failed box run passes through and saves no proof", async (t) => {
  const r = repo();
  t.after(r.dispose);
  const result = await runHooks({ root: r.root, stage: "pre-commit", runner: fake(() => 1) });
  assert.equal(result.code, 1);
  assert.equal(existsSync(savedOf(r.root)), false);
  const gone = await runHooks({ root: r.root, stage: "pre-push", runner: fake(() => 127) });
  assert.equal(gone.code, 2);
  assert.match(gone.problem ?? "", /`stackra` is not on PATH.*fflow doctor/);
});

test("hooks run: no runner, or the github-actions runner, is refused naming doctor", async (t) => {
  const r = repo();
  t.after(r.dispose);
  const none = await runHooks({ root: r.root, stage: "pre-commit" });
  assert.equal(none.code, 2);
  assert.match(none.problem ?? "", /no workspace install.*fflow doctor/);
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
