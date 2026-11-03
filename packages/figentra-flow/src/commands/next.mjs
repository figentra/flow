/**
 * Figentra Flow file contract:
 * Purpose: `fflow next [<key>] [--json]` (FR-13): the task's current stage and the command that moves it on, read
 *   from Flow's record and the spec's `**Status**`; the key defaults to the branch's. It warns when the record has
 *   commits origin does not.
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
import { nextStep } from "../lib/stages.mjs";

/**
 * What the spec of `key` says: its folder and declared status, when the folder exists.
 * @param {string} root
 * @param {string} key
 * @returns {{ specDir?: string, specStatus?: string }}
 */
export function specFacts(root, key) {
  const found = specDir({ root, key, keys: schemeFor(root) });
  if (!found.dir || !existsSync(join(root, found.dir, "spec.md"))) return {};
  return {
    specDir: found.dir,
    specStatus: statusOf(readFileSync(join(root, found.dir, "spec.md"), "utf8")),
  };
}

/**
 * The next step of a task.
 * @param {{ cwd: string, key?: string }} options
 * @returns {{ ok: true, key: string, recorded: boolean, state: string, stage: import("../lib/stages.mjs").Stage,
 *             command: string, unpushed: boolean } | { ok: false, problem: string }}
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
  if (result.unpushed)
    say(
      "waiting",
      `the record has commits origin lacks: push the branch (\`${NAME} session stop\` retries)`,
    );
  return 0;
}
