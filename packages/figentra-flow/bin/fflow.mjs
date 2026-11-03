#!/usr/bin/env node
/**
 * Figentra Flow file contract:
 * Purpose: the `fflow` binary (`figentra-flow` is its deprecated alias) — dispatches `fflow <command> …` to
 *   src/commands/<command>.mjs and exits with its code.
 * Runtime: node
 * Secrets: none.
 */
import { ConfigError } from "../src/lib/config.mjs";
import { NAME } from "../src/lib/product.mjs";

const COMMANDS = [
  "init",
  "sync",
  "update",
  "check",
  "diff",
  "validate",
  "gate",
  "trace",
  "parse",
  "linear",
  "start",
  "clean",
  "guard",
  "land",
  "train",
  "app",
  "status",
  "mcp",
  "team",
  "spec",
  "migrate",
  "ship",
  "release",
  "doctor",
  "readme",
];
const [command, ...args] = process.argv.slice(2);
if (!COMMANDS.includes(command)) {
  console.error(`usage: ${NAME} <${COMMANDS.join("|")}> …`);
  process.exit(command === undefined || command === "--help" ? 0 : 2);
}
const { run } = await import(`../src/commands/${command}.mjs`);
try {
  process.exit(await run(args));
} catch (error) {
  // An invalid or missing configuration is a refusal (2) naming the key, not a crash.
  if (!(error instanceof ConfigError)) throw error;
  console.error(`${NAME} ${command}: ${error.message}`);
  process.exit(2);
}
