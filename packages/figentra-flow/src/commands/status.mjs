/**
 * Figentra Flow file contract:
 * Purpose: `figentra-flow status [--repo <path>] [--json] [--offline] [--metrics [--since <n>d]]` (FR-7, AC-012,
 *   AC-024, AC-026, AC-032): one block per
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
import { metrics } from "../lib/metrics.mjs";
import { snapshot } from "../lib/snapshot.mjs";
import { statusServer } from "../lib/status-web.mjs";
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

/**
 * The metrics as text.
 * @param {any} m
 * @returns {string}
 */
export function renderMetrics(m) {
  const hours = (/** @type {any} */ x) => `${x.median ?? "-"} h median, ${x.p90 ?? "-"} h p90`;
  const line = (/** @type {string} */ name, /** @type {any} */ n) =>
    n.error
      ? `${name}: ${n.error}`
      : [
          `${name}: ${n.merged} merged; lead ${hours(n.leadHours)}; cycle ${hours(n.cycleHours)}`,
          `  gate runs per PR ${n.gateRunsPerPr ?? "-"} (${n.redShare ?? "-"}% red); rework ${n.reworkPerPr ?? "-"} heads per PR; review rounds ${n.reviewRoundsPerPr ?? "-"} per PR`,
          `  approval latency ${n.approvalDays.median ?? "-"} d median; ${n.open} open PRs, ${n.openAgeDays.median ?? "-"} d median age`,
        ].join("\n");
  return [
    `since ${m.since}`,
    ...m.repos.map((/** @type {any} */ r) => line(r.github ?? r.path, r)),
    line("total", m.total),
  ].join("\n");
}

/** `figentra-flow status [--repo <path>] [--json] [--offline] [--metrics [--since <n>d]] [--web [--port <n>]]`. */
export function run(/** @type {string[]} */ args) {
  const opt = (/** @type {string} */ name) =>
    args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined;
  const offline = args.includes("--offline");
  if (args.includes("--web")) {
    const port = Number(opt("port") ?? 4747);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      console.error(`${NAME} status: --port takes a port number`);
      return 2;
    }
    const read = () =>
      snapshot({
        repos: reposFor(opt("repo"), process.cwd()),
        cap: readSessionCap(),
        offline,
        busy: busyFolders(),
        api: offline ? undefined : (root) => github(root),
      });
    const server = statusServer(read);
    // Never resolves: the page is served until the process is stopped (Ctrl-C).
    return new Promise(() =>
      server.listen(port, "127.0.0.1", () => {
        const address = /** @type {import("node:net").AddressInfo} */ (server.address());
        console.log(`${NAME} status: http://127.0.0.1:${address.port}/ (Ctrl-C stops it)`);
      }),
    );
  }
  if (args.includes("--metrics")) {
    if (offline) {
      console.error(`${NAME} status: --metrics reads GitHub; it cannot run --offline`);
      return 2;
    }
    const days = Number((opt("since") ?? "30d").replace(/d$/, ""));
    if (!Number.isFinite(days) || days <= 0) {
      console.error(`${NAME} status: --since takes a number of days, e.g. 30d`);
      return 2;
    }
    const m = metrics({
      repos: reposFor(opt("repo"), process.cwd()),
      api: (root) => github(root),
      since: Date.now() - days * 86_400_000,
    });
    console.log(args.includes("--json") ? JSON.stringify(m, null, 2) : renderMetrics(m));
    return 0;
  }
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
