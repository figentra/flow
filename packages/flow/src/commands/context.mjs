/**
 * Figentra Flow file contract:
 * Purpose: `fflow context`: task-sized navigation of one repository or the registered collection.
 * Boundary: read-only, offline; shares discovery with MCP, never runs a discovered command.
 * Runtime: node
 * Secrets: none.
 */
import { discoverContext } from "../lib/context.mjs";

/**
 * @param {import("../lib/console.mjs").Io} io
 * @param {import("../lib/context.mjs").ContextOptions} options
 */
export function handle(io, options) {
  const result = discoverContext(io.cwd, options);
  if (io.json) io.output.json(result);
  else {
    for (const repo of result.repositories) {
      io.output.line(
        `${repo.path}: ${repo.error ?? `${repo.revision ?? "unborn"} (${repo.dirty ? "dirty" : "clean"})`}`,
      );
      if (repo.error) continue;
      for (const file of repo.instructions ?? []) io.output.line(`  instruction: ${file}`);
      for (const entry of repo.matches ?? [])
        io.output.line(`  ${entry.kind}: ${entry.path}${entry.name ? ` — ${entry.name}` : ""}`);
      if (repo.truncated)
        io.output.line(
          `  showing ${repo.matches.length} of ${repo.total}; narrow --path or --query`,
        );
      for (const problem of repo.problems ?? []) io.output.line(`  problem: ${problem}`);
    }
    if (!result.totalRepositories)
      io.output.line(
        "No registered repositories; use --repo or register a workspace with fflow init --workspace.",
      );
    if (result.truncated)
      io.output.line(`Showing 25 of ${result.totalRepositories} repositories; select --repo.`);
    for (const note of result.limitations) io.output.line(note);
  }
  return !result.totalRepositories || result.repositories.some((r) => r.error || r.problemCount)
    ? 1
    : 0;
}
