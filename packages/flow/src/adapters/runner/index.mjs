/**
 * Figentra Flow file contract:
 * Purpose: the runner port (AC-038): where `gate run`'s job runs. `ssh`: the job folder is rsynced to `host` and the
 *   command runs there (`--box <host>` picks it for one run); `local`: the caller's machine; `command`: an argument
 *   list with `{label}`, `{dir}` and `{command}` placeholders, and `{flags}` for the arguments after `gate run --`
 *   (Figentra's is `testbed run`); its `start` runs one gate shard alongside others and keeps its stdout (the
 *   testbed's JSON line under `--json`). `runnerFor(root, config)` builds it from `flow.config.json`'s
 *   `runner`. Without one, config file or not, it is refused, naming the key (AC-036, AC-045).
 *   `github-actions` follows the gate workflow's run on the PR and reads the verdict main's workflow posts
 *   (`./github-actions.mjs`), trusting it only from the gate App's logins (`apps.gate`).
 * Boundary: spawns the runner's processes and returns their exit code; 127 when the program is not installed.
 * Runtime: node
 * Governing contract: STA-1729 phase A (A3); Stackra ADR 0484 (the testbed).
 * Secrets: none here. `posts` says where the poster runs: on the `ssh` or `local` box after the check (`box`), or,
 *   for a `command` runner such as the testbed, on the caller's side after the box returns the check's exit code
 *   (`caller`, the owner's option C1 of 2026-11-01: a testbed job's environment and docker socket put every project
 *   secret within reach of the code under test, so the gate App's key never goes to the box). `wraps` tells
 *   `gate run` whether to wrap a box-side poster with the secrets port.
 */
import { spawn as spawnAsync, spawnSync } from "node:child_process";
import { basename } from "node:path";

import { ConfigError, gateLogins } from "../../lib/config.mjs";
import { CONFIG_FILE, NAME } from "../../lib/product.mjs";
import { githubActionsRunner } from "./github-actions.mjs";

/**
 * @typedef {{ dir: string, command: string, label: string, flags: string[], sha?: string, branch?: string,
 *             repository?: string, base?: string }} Job
 * @typedef {{ kind: string, wraps: boolean, program: string, host?: string, posts?: "box" | "caller",
 *             run: (job: Job) => number, start?: (job: Job) => Promise<{ code: number, out: string }> }} Runner
 */

/** An ssh destination safe to put on a command line: `[user@]host`. */
const HOST = /^(?:[\w.-]+@)?[\w.-]+$/;

/** A spawned process's exit code: 127 when the program could not start, 4 when it died without one. */
const exitOf = (/** @type {import("node:child_process").SpawnSyncReturns<any>} */ r) =>
  r.error ? 127 : (r.status ?? 4);

/**
 * The runner a block names.
 * @param {any} block the configuration's `runner`
 * @param {{ spawn?: typeof spawnSync, root?: string, gate?: string | string[] }} [options] `gate`: the gate App's
 *   logins, whose status the `github-actions` runner trusts
 * @returns {Runner}
 */
export function runnerPort(block, { spawn = spawnSync, root, gate } = {}) {
  if (block?.kind === "ssh") {
    if (!HOST.test(block.host))
      throw new ConfigError(`runner "ssh": host is not a host: ${block.host}`);
    return {
      kind: "ssh",
      wraps: true,
      program: "rsync",
      host: block.host,
      run({ dir, command }) {
        const remote = `/tmp/${NAME}-gate/${basename(dir)}`;
        const copied = spawn(
          "rsync",
          [
            "-a",
            "--delete",
            "--rsync-path",
            `mkdir -p ${remote} && rsync`,
            `${dir}/`,
            `${block.host}:${remote}/`,
          ],
          { stdio: "inherit" },
        );
        if (copied.status !== 0) return copied.error ? 127 : 2;
        return exitOf(
          spawn(
            "ssh",
            [
              block.host,
              `cd ${remote} && ${command}; code=$?; cd / && rm -rf ${remote}; exit $code`,
            ],
            { stdio: "inherit" },
          ),
        );
      },
    };
  }
  if (block?.kind === "local")
    return {
      kind: "local",
      wraps: true,
      program: "sh",
      run: ({ dir, command }) =>
        exitOf(spawn("sh", ["-c", command], { cwd: dir, stdio: "inherit" })),
    };
  if (block?.kind === "command") {
    /** @type {string[]} */
    const argv = block.run;
    // One pass, so a placeholder inside the check command is never expanded again.
    const argsOf = (/** @type {Job} */ job) =>
      argv.flatMap((a) =>
        a === "{flags}"
          ? job.flags
          : [a.replace(/\{(label|dir|command)\}/g, (_, k) => job[/** @type {"label"} */ (k)])],
      );
    return {
      kind: "command",
      wraps: block.secrets === true,
      posts: "caller",
      program: argv[0],
      run(job) {
        const args = argsOf(job);
        return exitOf(spawn(args[0], args.slice(1), { stdio: "inherit" }));
      },
      // A gate shard (FR-15): runs alongside the others; the job's output streams to stderr, stdout is kept.
      start(job) {
        const args = argsOf(job);
        return new Promise((done) => {
          let out = "";
          const child = spawnAsync(args[0], args.slice(1), {
            stdio: ["ignore", "pipe", "inherit"],
          });
          child.stdout?.on("data", (d) => (out += d));
          child.on("error", () => done({ code: 127, out }));
          child.on("close", (code) => done({ code: code ?? 4, out }));
        });
      },
    };
  }
  if (block?.kind === "github-actions") return githubActionsRunner(block, { root, gate });
  throw new ConfigError(`runner: unknown kind ${block?.kind}`);
}

/**
 * The repository's runner: `--box <host>` for this run, else the configuration's `runner`.
 * @param {string} root
 * @param {any} config the loaded configuration
 * @param {{ box?: string, spawn?: typeof spawnSync }} [options]
 * @returns {{ runner?: Runner, problem?: string }}
 */
export function runnerFor(root, config, { box, spawn } = {}) {
  if (box !== undefined) return { runner: runnerPort({ kind: "ssh", host: box }, { spawn }) };
  if (config.runner)
    return { runner: runnerPort(config.runner, { spawn, root, gate: gateLogins(config.apps) }) };
  return { problem: `gate run needs "runner" in ${CONFIG_FILE} (or --box <ssh host>)` };
}
