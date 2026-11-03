/**
 * Figentra Flow file contract:
 * Purpose: `fflow next [<key>] [--json]` (FR-13): the task's current stage and the command that moves it on, read
 *   from Flow's record and the spec's `**Status**`, and at the build stage the wave tasks.md's markers leave (FR-24);
 *   the key defaults to the branch's. It warns when the record has commits origin does not.
 * Boundary: reads the record, the spec and git; writes nothing.
 * Runtime: node
 * Governing contract: STA-1945 (FR-13, AC-13, P-017).
 * Secrets: none.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { schemeFor } from "../adapters/tracker/index.mjs";
import { specDir, statusOf } from "./gate.mjs";
import { say } from "../lib/cli.mjs";
import { git } from "../lib/git.mjs";
import { NAME } from "../lib/product.mjs";
import { emptyRecord, readRecord, RecordError, unpushed } from "../lib/record.mjs";
import { parseTasks } from "../lib/spec-parse.mjs";
import { nextStep } from "../lib/stages.mjs";
import { nextWave, WaveError } from "../lib/waves.mjs";

/**
 * What the spec of `key` says: its folder and declared status, when the folder exists, and the build's next wave
 * from tasks.md's markers (`built` once tasks.md has tasks and none is owed; neither on a dependency cycle).
 * @param {string} root
 * @param {string} key
 * @returns {{ specDir?: string, specStatus?: string, wave?: { wave: number, ids: string[] }, built?: boolean }}
 */
export function specFacts(root, key) {
  const found = specDir({ root, key, keys: schemeFor(root) });
  if (!found.dir || !existsSync(join(root, found.dir, "spec.md"))) return {};
  const facts = {
    specDir: found.dir,
    specStatus: statusOf(readFileSync(join(root, found.dir, "spec.md"), "utf8")),
  };
  const file = join(root, found.dir, "tasks.md");
  if (!existsSync(file)) return facts;
  const tasks = parseTasks(readFileSync(file, "utf8"));
  try {
    const wave = nextWave(tasks);
    return wave ? { ...facts, wave } : { ...facts, built: tasks.length > 0 };
  } catch (error) {
    // `gate tasks` names the cycle; the build stage then waits on it
    if (error instanceof WaveError) return facts;
    throw error;
  }
}

/**
 * The next step of a task.
 * @param {{ cwd: string, key?: string }} options
 * @returns {{ ok: true, key: string, recorded: boolean, state: string, stage: import("../lib/stages.mjs").Stage,
 *             command: string, wave?: { wave: number, ids: string[] }, unpushed: boolean } | { ok: false, problem: string }}
 */
export function next({ cwd, key }) {
  const top = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (!top.ok) return { ok: false, problem: `${cwd} is not in a git repository` };
  const root = top.out;
  const scheme = schemeFor(root);
  const k = key ? scheme.parse(key) : scheme.keys(git(root, ["branch", "--show-current"]).out)[0];
  if (!k) return { ok: false, problem: `no issue key: pass one, or work on the issue's branch` };
  let record;
  try {
    record = readRecord(root, k);
  } catch (error) {
    if (error instanceof RecordError) return { ok: false, problem: error.message };
    throw error;
  }
  const step = nextStep(record ?? emptyRecord(k), specFacts(root, k));
  return {
    ok: true,
    key: k,
    recorded: record !== undefined,
    state: record?.state ?? "active",
    ...step,
    unpushed: record !== undefined && unpushed(root),
  };
}

/** @param {string[]} args */
export async function run(args = []) {
  const key = args.find((a) => !a.startsWith("--"));
  const result = next({ cwd: process.cwd(), key });
  if (!result.ok) {
    console.error(`${NAME} next: ${result.problem}`);
    return 1;
  }
  if (args.includes("--json")) {
    console.log(JSON.stringify({ schema: `${NAME}.next/1`, ...result, ok: undefined }, null, 2));
    return 0;
  }
  const shown = result.key.toUpperCase();
  say(
    result.state === "failed" ? "blocked" : result.state === "waiting" ? "waiting" : "checking",
    `${shown}: ${result.stage}${result.recorded ? ` (${result.state})` : " (no record yet)"}`,
  );
  console.log(result.command);
  if (result.wave)
    say(
      "checking",
      `wave ${result.wave.wave} restarts at ${result.wave.ids[0]}: ${result.wave.ids.join(", ")}`,
    );
  if (result.unpushed)
    say(
      "waiting",
      `the record has commits origin lacks: push the branch (\`${NAME} session stop\` retries)`,
    );
  return 0;
}
