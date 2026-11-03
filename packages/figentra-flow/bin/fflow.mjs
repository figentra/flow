#!/usr/bin/env node
/**
 * Figentra Flow file contract:
 * Purpose: the `fflow` binary (`figentra-flow` is its deprecated alias): runs `fflow <command> …` on the console
 *   engine (src/lib/console.mjs) and exits with its code. `@stackra/console` is an optional peer (NFR-1, FR-31): when it
 *   is missing or fails to import, and always for `fflow guard`, which the agent hook runs on every tool call, the
 *   plain dispatcher (src/lib/plain.mjs) runs it instead.
 * Runtime: node
 * Secrets: none.
 */
import { runPlain } from "../src/lib/plain.mjs";

const argv = process.argv.slice(2);

/** The engine's run of `argv`, or undefined when the optional peer is missing or fails to import (silently, plan C9). */
async function engine() {
  try {
    const [{ createConsole }, { nodePorts }, { CONSOLE }] = await Promise.all([
      import("@stackra/console"),
      import("@stackra/console/node"),
      import("../src/lib/console.mjs"),
    ]);
    return () => createConsole(CONSOLE).run(argv, nodePorts());
  } catch {
    return undefined;
  }
}

const hook = argv[0] === "guard" && !argv.includes("--help") && !argv.includes("-h");
const run = hook ? undefined : await engine();
process.exit(await (run ? run() : runPlain(argv)));
