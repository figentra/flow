/**
 * Figentra Flow file contract:
 * Purpose: the git hooks proven where they can run (FR-18, AC-16, P-024). With the workspace install (pnpm's
 *   `node_modules/.modules.yaml`), `runHooks` runs `lefthook run <stage>` here and proves it with `Hooks-Run: local`.
 *   Without it, the runner port runs the same jobs on a box for the staged tree (pre-push: the head's), from a clone
 *   whose index is exactly what is staged, and the proof is `Hooks-Run: box <host> <run-id> <tree-sha>`. A passing
 *   pre-commit run saves its trailer in the git folder (a failed one removes it); the commit-msg run appends it to the
 *   message when it is `local` or names the tree being committed, else its own, and removes it. `hasHooksTrailer`
 *   reads the trailer back for the gate.
 * Boundary: runs git, lefthook (here) or the runner (a box); writes a temporary folder and a temporary ref, both
 *   removed when the run ends, the saved trailer in the git folder, and the commit message's trailer. A failed run
 *   is the job's exit code (the commit is refused as a local failure would be); no runner, or the github-actions
 *   runner (it runs the gate, not hooks), is refused naming `"runner"` in the configuration, and a tree carrying build
 *   or tool output or an oversized file is refused before it reaches a box (AC-043). `LEFTHOOK` and
 *   `LEFTHOOK_EXCLUDE` never reach the jobs, here or on a box, so no variable turns a run into an empty pass.
 * Runtime: node
 * Governing contract: STA-1945 (C13, PR 13); Stackra ADR 0484 (the testbed).
 * Secrets: none; the box gets the staged tree and the commit message only.
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

import { artifactProblems } from "./artifacts.mjs";
import { defaultBranch, git } from "./git.mjs";
import { CONFIG_FILE, NAME } from "./product.mjs";

/** The stages `fflow hooks run` takes. */
export const HOOK_STAGES = ["pre-commit", "commit-msg", "pre-push"];

/** The commit trailer's key. */
export const TRAILER = "Hooks-Run";

/** A trailer `runHooks` writes: `local`, or `box <host> <run-id> <tree-sha>`. */
const TRAILER_LINE = new RegExp(`^${TRAILER}: (?:local|box \\S+ \\S+ [0-9a-f]{40,64})$`, "m");

/**
 * @param {string} root
 * @returns {boolean} the workspace install the jobs need is present
 */
export const canRunLocally = (root) => existsSync(join(root, "node_modules", ".modules.yaml"));

/**
 * Whether the message's trailer block (its last paragraph) holds a `Hooks-Run:` trailer.
 * @param {string} message
 * @returns {boolean}
 */
export const hasHooksTrailer = (message) =>
  TRAILER_LINE.test(
    message
      .trim()
      .split(/\n\s*\n/)
      .at(-1) ?? "",
  );

/**
 * @typedef {{ root: string, stage: "pre-commit" | "commit-msg" | "pre-push", args?: string[],
 *             runner?: import("../adapters/runner/index.mjs").Runner,
 *             artifacts?: { paths?: string[], maxBytes?: number }, spawn?: typeof spawnSync }} HooksOptions
 *   `args`: git's hook arguments (commit-msg: the message file); `artifacts`: the configuration's `artifacts`
 */

/**
 * Runs the stage's hooks here or on a box and returns the proof.
 * @param {HooksOptions} options
 * @returns {Promise<{ code: number, trailer: string, problem?: string }>} `trailer` is `Hooks-Run: local` or
 *   `Hooks-Run: box <host> <run> <tree>`, empty when nothing ran
 */
export async function runHooks(options) {
  const { root, stage, args = [] } = options;
  const message = stage === "commit-msg" ? args[0] : undefined;
  if (stage === "commit-msg" && !message)
    return { code: 2, trailer: "", problem: "commit-msg needs the message file" };
  const saved = resolve(root, git(root, ["rev-parse", "--git-path", `${NAME}-hooks-run`]).out);
  const result = canRunLocally(root) ? here(options) : onBox(options);
  if (result.code !== 0) {
    if (stage === "pre-commit") rmSync(saved, { force: true });
    return result;
  }
  if (stage === "pre-commit") writeFileSync(saved, `${result.trailer}\n`);
  if (message) {
    const kept = existsSync(saved) ? readFileSync(saved, "utf8").trim() : "";
    rmSync(saved, { force: true });
    // A proof saved for another tree (a commit aborted at its message, then a merge or a reword) is not this one's.
    const tree = git(root, ["write-tree"]);
    const trailer =
      kept === `${TRAILER}: local` || (tree.ok && kept.endsWith(` ${tree.out}`))
        ? kept
        : result.trailer;
    const added = git(root, [
      "interpret-trailers",
      "--in-place",
      "--if-exists",
      "replace",
      "--trailer",
      trailer,
      resolve(root, message),
    ]);
    if (!added.ok) return { code: 2, trailer, problem: `the trailer was not added: ${added.err}` };
    return { code: 0, trailer };
  }
  return result;
}

/**
 * `lefthook run <stage>` here, the workspace's binaries first on PATH.
 * @param {HooksOptions} options
 * @returns {{ code: number, trailer: string, problem?: string }}
 */
function here({ root, stage, args = [], spawn = spawnSync }) {
  const env = {
    ...process.env,
    LEFTHOOK: undefined,
    LEFTHOOK_EXCLUDE: undefined,
    PATH: `${join(root, "node_modules", ".bin")}${delimiter}${process.env.PATH ?? ""}`,
  };
  const r = spawn("lefthook", ["run", stage, ...args], { cwd: root, stdio: "inherit", env });
  if (r.error)
    return {
      code: 2,
      trailer: "",
      problem: "`lefthook` is not in node_modules/.bin or on PATH; add it to the workspace",
    };
  return { code: r.status ?? 4, trailer: `${TRAILER}: local` };
}

/**
 * The same jobs on the runner's box, in a clone of the staged tree (pre-push: the head).
 * @param {HooksOptions} options
 * @returns {{ code: number, trailer: string, problem?: string }}
 */
function onBox({ root, stage, args = [], runner, artifacts }) {
  const refuse = (/** @type {string} */ problem) => ({ code: 2, trailer: "", problem });
  if (!runner)
    return refuse(
      `no workspace install here and no runner to run the ${stage} hooks on; set "runner" in ${CONFIG_FILE}`,
    );
  if (runner.kind === "github-actions")
    return refuse(
      `the github-actions runner runs the gate, not hooks; set an ssh or command "runner" in ${CONFIG_FILE}`,
    );
  const head = git(root, ["rev-parse", "--verify", "-q", "HEAD"]);
  const staged = stage !== "pre-push";
  const tree = git(root, staged ? ["write-tree"] : ["rev-parse", "HEAD^{tree}"]);
  if (!tree.ok) return refuse(`the ${staged ? "staged" : "head's"} tree: ${tree.err}`);
  const commitTree = (/** @type {string} */ t, /** @type {string[]} */ parents) =>
    git(root, [
      "commit-tree",
      "--no-gpg-sign",
      t,
      ...parents.flatMap((p) => ["-p", p]),
      "-m",
      `${NAME} hooks ${stage}`,
    ]);
  const made = staged ? commitTree(tree.out, head.ok ? [head.out] : []) : head;
  if (!made.ok) return refuse(`git commit-tree failed: ${made.err}`);
  // AC-043 before the box: what the tree adds against its parent (pre-push: the default branch), or, with none, all.
  const against = staged
    ? head
    : git(root, ["rev-parse", "--verify", "-q", `origin/${defaultBranch(root)}`]);
  let [base, top] = [against.out, made.out];
  if (!against.ok) {
    const empty = git(root, ["hash-object", "-t", "tree", "/dev/null"]);
    base = commitTree(empty.out, []).out;
    top = commitTree(tree.out, [base]).out;
  }
  const found = artifactProblems(root, base, top, artifacts);
  if (found.length) return refuse(`the tree carries artifacts:\n  ${found.join("\n  ")}`);
  const run = randomUUID();
  const ref = `refs/${NAME}-hooks/${run}`;
  const dir = mkdtempSync(join(tmpdir(), `${NAME}-hooks-`));
  try {
    for (const step of [
      ["update-ref", ref, made.out],
      ["clone", "-q", "--no-hardlinks", "--no-checkout", root, dir],
      ["-C", dir, "fetch", "-q", root, `+${ref}:${ref}`],
      ["-C", dir, "checkout", "-q", "--detach", made.out],
      // The box's index is what is staged here: HEAD back on the parent, or unborn for a first commit.
      ...(staged
        ? [
            head.ok
              ? ["-C", dir, "reset", "-q", "--soft", head.out]
              : ["-C", dir, "checkout", "-q", "--orphan", `${NAME}-hooks`],
          ]
        : []),
    ]) {
      const r = git(root, step);
      if (!r.ok) return refuse(`git ${step.join(" ")} failed: ${r.err}`);
    }
    // The stage is one of HOOK_STAGES and the message has a fixed name, so nothing here needs quoting.
    let hook = stage;
    if (stage === "commit-msg") {
      copyFileSync(resolve(root, args[0]), join(dir, ".git", "COMMIT_EDITMSG"));
      hook = `${stage} .git/COMMIT_EDITMSG`;
    }
    // The caller's environment reaches a `local` or `command` runner's job: no LEFTHOOK there either.
    const command = `pnpm install --frozen-lockfile && env -u LEFTHOOK -u LEFTHOOK_EXCLUDE pnpm exec lefthook run ${hook}`;
    const code = runner.run({ dir, command, label: `${NAME} hooks ${stage} ${run}`, flags: [] });
    if (code === 127)
      return refuse(
        `exit 127: \`${runner.program}\` (the ${runner.kind} runner) or a program the job runs on the box (pnpm) is not on PATH`,
      );
    return { code, trailer: `${TRAILER}: box ${runner.host ?? runner.program} ${run} ${tree.out}` };
  } finally {
    git(root, ["update-ref", "-d", ref]);
    rmSync(dir, { recursive: true, force: true });
  }
}
