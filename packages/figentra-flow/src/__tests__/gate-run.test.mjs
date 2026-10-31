/**
 * Figentra Flow file contract:
 * Purpose: hold `figentra-flow gate run` to its contract: refusals before any box (dirty, detached, unpushed, no GitHub
 *   origin, no runner configured), and a runner program that is not installed; the job folder is a clean clone at the head with the default branch's ref and the poster
 *   beside it; the check command (default, `gate.check` in the configuration, the spec gate where Figentra Flow is installed); the box command
 *   keeps the log and the exit for the poster; the runner's exit code passes through.
 * Boundary: temporary repositories with a local bare origin; the runner and the remote tip injected; no network,
 *   no box.
 * Runtime: node
 * Governing contract: ADR 0022; Stackra ADR 0503; STA-1729 phase 2.
 */
// @covers sta-1729:FR-5 sta-1729:FR-9 sta-1729:AC-008 sta-1729:AC-009 sta-1729:P-005 sta-1729:P-009
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { secretsPort } from "../adapters/secrets.mjs";
import { boxCommand, checkCommand, gateRun, slugOf } from "../commands/gate-run.mjs";
import { CONFIG_FILE, ENV_PREFIX, GATE_MARKER, STATUS_CONTEXT } from "../lib/product.mjs";
import { commit, repo, sh } from "./__fixtures__/repo.mjs";

const GITHUB = "git@github.com:figentra/flow.git";

/** A repository whose origin names GitHub while pushes go to the local bare origin. */
function ghRepo(/** @type {Record<string, string>} */ files = {}) {
  const r = repo(files);
  sh(r.root, "remote", "set-url", "origin", GITHUB);
  sh(r.root, "remote", "set-url", "--push", "origin", r.origin);
  return r;
}

/**
 * A runner that hands the job to `run`.
 * @param {(job: import("../adapters/runner/index.mjs").Job) => number} run
 */
const fake = (run) => ({ kind: "command", wraps: false, program: "stackra", run });

/** The local bare origin's tip, standing in for ls-remote against GitHub. */
const tipOf =
  (/** @type {string} */ origin) => (/** @type {string} */ _root, /** @type {string} */ branch) => {
    try {
      return sh(origin, "rev-parse", `refs/heads/${branch}`);
    } catch {
      return undefined;
    }
  };

test("gate run: the job is a clean clone at the head, with the poster and the job file, and the exit passes through", async (t) => {
  const r = ghRepo();
  t.after(r.dispose);
  commit(r.root, "a.txt");
  sh(r.root, "push", "-q", "origin", "main");
  /** @type {any} */
  let seen;
  const result = await gateRun({
    cwd: r.root,
    tip: tipOf(r.origin),
    now: () => new Date("2026-10-31T10:00:00Z"),
    runner: fake((job) => {
      const dir = job.dir;
      seen = {
        ...job,
        head: sh(dir, "rev-parse", "HEAD"),
        base: sh(dir, "rev-parse", "refs/remotes/origin/main"),
        origin: sh(dir, "remote", "get-url", "origin"),
        file: existsSync(join(dir, "a.txt")),
        poster: existsSync(join(dir, ".figentra-flow-gate", "post.mjs")),
        job: JSON.parse(readFileSync(join(dir, ".figentra-flow-gate", "job.json"), "utf8")),
      };
      return 1;
    }),
  });
  const sha = sh(r.root, "rev-parse", "HEAD");
  assert.deepEqual(result, { code: 1, sha });
  assert.equal(seen.head, sha);
  assert.equal(seen.base, sha);
  assert.equal(seen.origin, GITHUB);
  assert.equal(seen.file, true);
  assert.equal(seen.poster, true);
  assert.deepEqual(seen.job, {
    sha,
    branch: "main",
    repository: "figentra/flow",
    startedAt: "2026-10-31T10:00:00.000Z",
    context: STATUS_CONTEXT,
    marker: GATE_MARKER,
    envPrefix: ENV_PREFIX,
  });
  assert.match(seen.label, /^figentra-flow gate figentra\/flow@[0-9a-f]{12}$/);
  assert.equal(existsSync(seen.dir), false);
});

test("gate run: refuses a dirty tree, an unpushed head, a detached head and a non-GitHub origin before any box", async (t) => {
  const r = ghRepo();
  t.after(r.dispose);
  let ran = 0;
  const runner = fake(() => ++ran);
  writeFileSync(join(r.root, "wip.txt"), "x\n");
  assert.match(
    (await gateRun({ cwd: r.root, tip: tipOf(r.origin), runner })).problem ?? "",
    /uncommitted/,
  );
  sh(r.root, "add", "wip.txt");
  sh(r.root, "commit", "-q", "-m", "wip");
  assert.match(
    (await gateRun({ cwd: r.root, tip: tipOf(r.origin), runner })).problem ?? "",
    /push it first/,
  );
  sh(r.root, "push", "-q", "origin", "main");
  sh(r.root, "checkout", "-q", "--detach");
  assert.match(
    (await gateRun({ cwd: r.root, tip: tipOf(r.origin), runner })).problem ?? "",
    /--ref/,
  );
  sh(r.root, "checkout", "-q", "main");
  writeFileSync(join(r.root, CONFIG_FILE), "{}");
  sh(r.root, "add", CONFIG_FILE);
  sh(r.root, "commit", "-q", "-m", "config");
  assert.match(
    (await gateRun({ cwd: r.root, tip: tipOf(r.origin), runner })).problem ?? "",
    /version/,
    "an invalid configuration is reported as itself, not as an unpushed head",
  );
  sh(r.root, "rm", "-q", CONFIG_FILE);
  sh(r.root, "commit", "-q", "-m", "no config");
  sh(r.root, "push", "-q", "origin", "main");
  sh(r.root, "remote", "set-url", "origin", r.origin);
  assert.match(
    (await gateRun({ cwd: r.root, tip: tipOf(r.origin), runner })).problem ?? "",
    /not a GitHub repository/,
  );
  assert.equal(ran, 0);
});

test("gate run: a runner program that is not installed is a refusal naming it and --box", async (t) => {
  const r = ghRepo();
  t.after(r.dispose);
  const result = await gateRun({ cwd: r.root, tip: tipOf(r.origin), runner: fake(() => 127) });
  assert.equal(result.code, 2);
  assert.match(result.problem ?? "", /`stackra` is not on PATH \(the command runner\).*--box/);
});

test("gate run: a config without a runner is refused before any box; the runner's flags and wrap reach the job (AC-038)", async (t) => {
  const r = ghRepo({ [CONFIG_FILE]: JSON.stringify({ version: 1 }) });
  t.after(r.dispose);
  sh(r.root, "push", "-q", "origin", "main");
  assert.match(
    (await gateRun({ cwd: r.root, tip: tipOf(r.origin) })).problem ?? "",
    /needs "runner".*--box/,
  );
  /** @type {any} */
  let seen;
  const wrapping = { ...fake((job) => ((seen = job), 0)), wraps: true };
  const result = await gateRun({
    cwd: r.root,
    tip: tipOf(r.origin),
    runner: wrapping,
    flags: ["--no-wait"],
  });
  assert.equal(result.code, 0);
  assert.deepEqual(seen.flags, ["--no-wait"]);
  // no `secrets` block: the env port leaves the poster as it is, but the wrap point is taken
  assert.match(seen.command, /node \.figentra-flow-gate\/post\.mjs$/);
});

test("check command: pnpm verify by default, the repository's own, and the spec gate where Figentra Flow is installed", (t) => {
  const r = repo({
    [CONFIG_FILE]: JSON.stringify({ version: 1, gate: { check: "pnpm test" } }),
    "package.json": JSON.stringify({
      devDependencies: { "figentra-flow": "catalog:" },
    }),
  });
  t.after(r.dispose);
  assert.equal(
    checkCommand(r.root),
    "pnpm install --frozen-lockfile && pnpm test && pnpm exec figentra-flow gate ci",
  );
  assert.equal(
    checkCommand(join(r.root, "nowhere")),
    "pnpm install --frozen-lockfile && pnpm verify",
  );
});

test("box command: the check's log and exit are kept for the poster; the secrets port wraps the poster", () => {
  assert.equal(
    boxCommand("pnpm verify"),
    "{ pnpm verify; echo $? > .figentra-flow-gate/exit; } 2>&1 | tee .figentra-flow-gate/log.txt; node .figentra-flow-gate/post.mjs",
  );
  assert.match(
    boxCommand("x", {
      wrap: (c) => secretsPort({ kind: "infisical", paths: { gate: "/ci/gate" } }).wrap(c, "gate"),
    }),
    /; infisical run --silent --path=\/ci\/gate -- node \.figentra-flow-gate\/post\.mjs$/,
  );
});

test("slug: the GitHub owner/name of an ssh or https origin", () => {
  assert.equal(slugOf("git@github.com:figentra/flow.git"), "figentra/flow");
  assert.equal(slugOf("https://github.com/figentra/stackra"), "figentra/stackra");
  assert.equal(slugOf("/tmp/origin.git"), undefined);
});
