/**
 * Figentra Flow file contract:
 * Purpose: `figentra-flow status [--repo <path>] [--json] [--offline]` (FR-7, AC-012, AC-024, AC-026): one block per
 *   repository of the workspace (or the one named, or the current one) with its specs by status, worktrees, open PRs
 *   and sessions; `--json` prints the snapshot itself. Exit 0, or 1 when a warning (more building sessions than the
 *   cap) is present, so a script can alert.
 * Boundary: read-only; GitHub through each repository's credentials, none with `--offline`.
 * Runtime: node
 * Governing contract: STA-1729 phase 4 (the leader's plan stop of 2026-10-31).
 * Secrets: none.
 */
import { slugOf } from "./gate-run.mjs";
import { busyFolders, git } from "../lib/git.mjs";
import { github } from "../lib/github.mjs";
import { NAME, STATUS_CONTEXT } from "../lib/product.mjs";
import { snapshot } from "../lib/snapshot.mjs";
import { readSessionCap, readWorkspace } from "../lib/workspace.mjs";

/**
 * The repositories to show: `--repo`, else the workspace list, else the current checkout.
 * @param {string | undefined} repo
 * @param {string} cwd
 */
export function reposFor(repo, cwd) {
  if (repo === undefined) {
    const listed = readWorkspace();
    if (listed.length) return listed;
  }
  const top = git(repo ?? cwd, ["rev-parse", "--show-toplevel"]);
  const path = top.ok ? top.out : (repo ?? cwd);
  return [{ path, github: slugOf(git(path, ["remote", "get-url", "origin"]).out) ?? "" }];
}

/**
 * The snapshot as text, one block per repository.
 * @param {any} snap
 * @returns {string}
 */
export function render(snap) {
  /** @type {string[]} */
  const out = [];
  for (const repo of snap.repos) {
    out.push(`${repo.github ?? repo.path}${repo.github ? `  (${repo.path})` : ""}`);
    if (repo.error) {
      out.push(`  skipped: ${repo.error}`, "");
      continue;
    }
    out.push("  specs:");
    if (!repo.specs.length) out.push("    none");
    for (const s of [...repo.specs].sort((a, b) =>
      String(a.status).localeCompare(String(b.status)),
    ))
      out.push(
        `    ${s.status ?? "?"} ${s.folder}${s.tier ? ` [${s.tier}]` : ""}${s.session ? ` session ${s.session}` : ""}${s.problems.length ? ` — ${s.problems.length} problem(s)` : ""}`,
      );
    out.push("  worktrees:");
    if (!repo.worktrees.length) out.push("    none");
    for (const t of repo.worktrees) {
      const marks = [
        t.dirty ? "dirty" : "clean",
        t.inUse ? "in use" : null,
        `idle ${t.idleHours} h`,
        t.ahead !== null ? `+${t.ahead}/-${t.behind}` : "not pushed",
      ].filter(Boolean);
      out.push(`    ${t.branch ?? "(detached)"} ${t.path} — ${marks.join(", ")}`);
    }
    out.push("  PRs:");
    if (repo.prsProblem) out.push(`    ${repo.prsProblem}`);
    else if (!repo.prs.length) out.push("    none");
    for (const p of repo.prs)
      out.push(
        `    #${p.number} ${p.title} — ${STATUS_CONTEXT} ${p.gate?.state ?? "none"}${p.gate && p.gate.trusted === false ? " (untrusted poster)" : ""}, review ${p.review ?? "none"}${p.draft ? ", draft" : ""}${p.stacked ? `, stacked on ${p.base}` : ""}`,
      );
    out.push("  sessions:");
    if (!repo.sessions.length) out.push("    none");
    for (const s of repo.sessions)
      out.push(
        `    ${s.name}${s.building ? " (building)" : ""}: ${s.specs.join(", ")}; worktree ${s.worktrees.join(", ") || "none"}; gate ${s.gates.map((/** @type {any} */ g) => g ?? "none").join(", ") || "none"}`,
      );
    out.push("");
  }
  for (const w of snap.warnings) out.push(`warning: ${w}`);
  return out.join("\n");
}

/** `figentra-flow status [--repo <path>] [--json] [--offline]`. */
export function run(/** @type {string[]} */ args) {
  const opt = (/** @type {string} */ name) =>
    args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined;
  const offline = args.includes("--offline");
  const snap = snapshot({
    repos: reposFor(opt("repo"), process.cwd()),
    cap: readSessionCap(),
    offline,
    busy: busyFolders(),
    api: offline ? undefined : (root) => github(root),
  });
  console.log(args.includes("--json") ? JSON.stringify(snap, null, 2) : render(snap));
  if (snap.warnings.length && !args.includes("--json"))
    console.error(`${NAME} status: see the warning above`);
  return snap.warnings.length ? 1 : 0;
}
