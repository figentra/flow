#!/usr/bin/env node
/**
 * Figentra Flow file contract:
 * Purpose: the `figentra-flow` binary (alias `fflow`) — dispatches `figentra-flow <command> …` to
 *   src/commands/<command>.mjs and exits with its code.
 * Runtime: node
 * Secrets: none.
 */
import { NAME } from "../src/lib/product.mjs";

const COMMANDS = [
  "init",
  "sync",
  "gate",
  "trace",
  "parse",
  "linear",
  "start",
  "clean",
  "guard",
  "land",
];
const [command, ...args] = process.argv.slice(2);
if (!COMMANDS.includes(command)) {
  console.error(`usage: ${NAME} <${COMMANDS.join("|")}> …`);
  process.exit(command === undefined || command === "--help" ? 0 : 2);
}
const { run } = await import(`../src/commands/${command}.mjs`);
process.exit(await run(args));
