#!/usr/bin/env node
/**
 * Vellum file contract:
 * Purpose: the `vellum` binary — dispatches `vellum <command> …` to src/commands/<command>.mjs and exits with its
 *   code.
 * Runtime: node
 * Secrets: none.
 */
const COMMANDS = ["init", "sync", "gate", "trace", "parse", "linear"];
const [command, ...args] = process.argv.slice(2);
if (!COMMANDS.includes(command)) {
  console.error(`usage: vellum <${COMMANDS.join("|")}> …`);
  process.exit(command === undefined || command === "--help" ? 0 : 2);
}
const { run } = await import(`../src/commands/${command}.mjs`);
process.exit(await run(args));
