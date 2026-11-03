#!/usr/bin/env node
/**
 * Figentra Flow file contract:
 * Purpose: the `fflow` binary (`figentra-flow` is its deprecated alias): runs `fflow <command> …` on the console
 *   engine, `@stackra/console` (src/lib/console.mjs; a dependency, ADR 0506 decision 8, FR-31), and exits with its
 *   code. `fflow guard`, which the agent hook runs on every tool call, dispatches first and never loads the engine.
 * Runtime: node
 * Secrets: none.
 */
import { ConfigError } from "../src/lib/config.mjs";
import { NAME } from "../src/lib/product.mjs";

const argv = process.argv.slice(2);

if (argv[0] === "guard" && !argv.includes("--help") && !argv.includes("-h")) {
  const { run } = await import("../src/commands/guard.mjs");
  try {
    process.exit(await run(argv.slice(1)));
  } catch (error) {
    // An invalid or missing configuration is a refusal (2) naming the key, not a crash.
    if (!(error instanceof ConfigError)) throw error;
    console.error(`${NAME} guard: ${error.message}`);
    process.exit(2);
  }
}

const [{ createConsole }, { nodePorts }, { CONSOLE }] = await Promise.all([
  import("@stackra/console"),
  import("@stackra/console/node"),
  import("../src/lib/console.mjs"),
]);
process.exit(await createConsole(CONSOLE).run(argv, nodePorts()));
