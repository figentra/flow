/**
 * Vellum file contract:
 * Purpose: `vellum parse <file>` — print what the spec parsers (core's `spec-parse`, moved unchanged into
 *   ../lib/spec-parse.mjs) read from one spec-kit artifact, as JSON: tasks.md → its tasks, plan.md → its properties
 *   (P → validated FRs), routing.yaml → its task types, any other file → its live and struck FR/SC/EC/P ids.
 * Boundary: reads one file; writes only stdout.
 * Runtime: node
 * Governing contract: ADR 0120; ADR 0121.
 * Secrets: none.
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { definedIds, parseTasks, properties, routes } from "../lib/spec-parse.mjs";

/** The parse of `text`, chosen by the file name. */
export function parse(name, text) {
  if (name === "tasks.md") return parseTasks(text);
  if (name === "plan.md") return Object.fromEntries(properties(text));
  if (name === "routing.yaml") return [...routes(text)];
  return Object.fromEntries(
    ["FR", "SC", "EC", "P"].map((p) => {
      const { live, struck } = definedIds(text, p);
      return [p, { live: [...live], struck: [...struck] }];
    }),
  );
}

export function run([file]) {
  if (!file) {
    console.error("usage: vellum parse <spec.md|plan.md|tasks.md|routing.yaml>");
    return 2;
  }
  console.log(JSON.stringify(parse(basename(file), readFileSync(file, "utf8")), null, 2));
  return 0;
}
