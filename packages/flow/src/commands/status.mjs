/**
 * Figentra Flow file contract:
 * Purpose: `fflow status [--repo <path>] [--json] [--offline] [--metrics [--since <n>d]] [--by role [--role <id>]]
 *   [--divergence]` (FR-7, FR-12, AC-012, AC-024, AC-026, AC-032, AC-050): one block per
 *   repository of the workspace (or the one named, or the current one) with its specs, worktrees, open PRs and
 *   sessions as four tables (FR-31), and a fifth of the live agent sessions by title, state, worktree and stage
 *   (STA-1945 FR-20, AC-19), each problem counted and, under `--verbose`, every one listed; `--json` writes the
 *   snapshot as the console's data. Exit 0, or 1 when a warning (more building sessions than the cap, a session title
 *   off ADR 0001's pattern or at odds with its record) is present, so a script can alert. The options are declared
 *   in src/lib/console.mjs; `refusal` names a combination they refuse, and `status` runs them. `--divergence`
 *   (STA-1945 FR-9, AC-11) prints instead, per repository, its lock's Flow version and preset (name, version,
 *   digest), the preset lag, the overrides by kind with the replacements and disables (owner, review date) and those
 *   past their review date, and the drift from the lock; exit 1 when a repository drifts or has an override past
 *   its review date. It reads the repositories only, never GitHub.
 * Boundary: read-only; GitHub through each repository's credentials, none with `--offline`.
 * Runtime: node
 * Governing contract: STA-1729 phase 4 (the leader's plan stop of 2026-10-31); STA-1945 FR-31 (AC-37), FR-9 (AC-11).
 * Secrets: none.
 */
import { existsSync } from "node:fs";

import { slugOf } from "./gate-run.mjs";
import { divergence } from "../lib/divergence.mjs";
import { git } from "../lib/git.mjs";
import { github } from "../lib/github.mjs";
import { NAME, STATUS_CONTEXT } from "../lib/product.mjs";
import { metrics } from "../lib/metrics.mjs";
import { systemSessions } from "../lib/sessions.mjs";
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
 * The snapshot grouped by role, for the repositories with a roster; `only` keeps one role.
 * @param {any} snap
 * @param {string} [only]
 * @returns {string}
 */
export function renderByRole(snap, only) {
  /** @type {string[]} */
  const out = [];
  for (const repo of snap.repos) {
    if (!repo.byRole) continue;
    out.push(repo.github ?? repo.path);
    for (const r of repo.byRole.filter((/** @type {any} */ x) => !only || x.role === only))
      out.push(
        `  ${r.role ?? "(no role)"}: ${r.specs.length} spec(s) — ${r.inProgress} in progress, ${r.inReview} in review, ${r.blocked} blocked, ${r.ownerWaiting} waiting on the owner`,
        `    sessions: ${r.sessions.join(", ") || "none"}`,
        ...(r.specs.length ? [`    specs: ${r.specs.join(", ")}`] : []),
      );
    out.push("");
  }
  return out.length ? out.join("\n") : 'no repository names a roster ("team")';
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

/** A gate state as a table's status cell. */
const GATE_CELL = { success: "ok", pending: "warn", failure: "fail", error: "fail" };

/**
 * One repository's tables (FR-31): specs, worktrees, PRs and sessions, and the live sessions when the snapshot read
 * them (FR-20); every problem under `verbose`.
 * @param {any} repo
 * @param {boolean} verbose
 * @returns {{ title: string, columns: { header: string, key: string, kind?: "status" | "count" }[], rows: Record<string, unknown>[], problems?: string[] }[]}
 */
export function tablesOf(repo, verbose) {
  const specs = [...repo.specs].sort((a, b) => String(a.status).localeCompare(String(b.status)));
  return [
    {
      title: "Specs",
      columns: [
        { header: "Status", key: "status" },
        { header: "Spec", key: "folder" },
        { header: "Tier", key: "tier" },
        { header: "Session", key: "session" },
        // FR-25: optional tasks a Done spec left open
        { header: "Skipped optional", key: "skipped" },
        { header: "Problems", key: "problems", kind: "count" },
      ],
      rows: specs.map((s) => ({
        status: s.status ?? "?",
        folder: s.folder,
        tier: s.tier ?? "",
        session: s.session ?? "",
        skipped: s.skipped?.join(", ") ?? "",
        problems: s.problems.length,
      })),
      ...(verbose
        ? {
            problems: specs.flatMap((s) =>
              s.problems.map((/** @type {string} */ p) => `${s.folder}: ${p}`),
            ),
          }
        : {}),
    },
    {
      title: "Worktrees",
      columns: [
        { header: "Branch", key: "branch" },
        { header: "Path", key: "path" },
        { header: "State", key: "state" },
        { header: "Idle h", key: "idle", kind: "count" },
        { header: "Ahead/behind", key: "drift" },
      ],
      rows: repo.worktrees.map((/** @type {any} */ t) => ({
        branch: t.branch ?? "(detached)",
        path: t.path,
        state: [t.dirty ? "dirty" : "clean", t.inUse ? "in use" : null].filter(Boolean).join(", "),
        idle: t.idleHours,
        drift: t.ahead !== null ? `+${t.ahead}/-${t.behind}` : "not pushed",
      })),
    },
    {
      title: "PRs",
      columns: [
        { header: "Gate", key: "gate", kind: "status" },
        { header: "PR", key: "number" },
        { header: "Title", key: "title" },
        { header: "Review", key: "review" },
        { header: "Notes", key: "notes" },
      ],
      rows: repo.prs.map((/** @type {any} */ p) => ({
        gate: GATE_CELL[/** @type {keyof typeof GATE_CELL} */ (p.gate?.state)] ?? "skip",
        number: `#${p.number}`,
        title: p.title,
        review: p.review ?? "none",
        notes: [
          `${STATUS_CONTEXT} ${p.gate?.state ?? "none"}`,
          p.gate && p.gate.trusted === false ? "untrusted poster" : null,
          p.draft ? "draft" : null,
          p.stacked ? `stacked on ${p.base}` : null,
        ]
          .filter(Boolean)
          .join(", "),
      })),
      ...(repo.prsProblem ? { problems: [repo.prsProblem] } : {}),
    },
    {
      title: "Sessions",
      columns: [
        { header: "Session", key: "name" },
        { header: "Specs", key: "specs" },
        { header: "Worktree", key: "worktrees" },
        { header: "Gate", key: "gates" },
      ],
      rows: repo.sessions.map((/** @type {any} */ s) => ({
        name: `${s.name}${s.building ? " (building)" : ""}`,
        specs: s.specs.join(", "),
        worktrees: s.worktrees.join(", ") || "none",
        gates: s.gates.map((/** @type {any} */ g) => g ?? "none").join(", ") || "none",
      })),
    },
    ...(repo.live
      ? [
          {
            title: "Live sessions",
            columns: [
              { header: "Session", key: "name" },
              { header: "State", key: "state" },
              { header: "Worktree", key: "worktree" },
              { header: "Stage", key: "stage" },
              { header: "Pid", key: "pid" },
              { header: "Notes", key: "notes" },
            ],
            rows: repo.live.map((/** @type {import("../lib/sessions.mjs").LiveSession} */ s) => ({
              name: s.name || "(untitled)",
              state: s.state,
              worktree: s.worktree,
              stage: s.stage ?? "none",
              pid: s.pid ?? "",
              notes: [s.note, s.problem].filter(Boolean).join("; "),
            })),
          },
        ]
      : []),
  ];
}

/**
 * One repository's divergence report as text lines (FR-9).
 * @param {import("../lib/divergence.mjs").Divergence} d
 * @returns {string[]}
 */
export function renderDivergence(d) {
  if (!d.synced && !d.drift.length) return ["not synced (no .flow/lock.json)", ...d.problems];
  const kinds = Object.entries(d.overrides).map(([kind, n]) => `${kind} ${n}`);
  return [
    ...(d.preset
      ? [
          `${NAME} ${d.flow}; preset ${d.preset.name} ${d.preset.version} (${d.preset.digest || "no digest"}); profile ${d.profile}`,
          d.lag ? `preset lag: locked ${d.lag.locked}, latest ${d.lag.latest}` : "preset lag: none",
        ]
      : []),
    `overrides: ${kinds.join(", ") || "none"}${d.expired.length ? `; past review: ${d.expired.join(", ")}` : ""}`,
    ...d.reviewed.map(
      (r) =>
        `  ${r.kind} ${r.id}: owner ${r.owner}, review ${r.review}${r.state === "ok" ? "" : ` (${r.state})`}`,
    ),
    ...d.problems,
    d.drift.length ? "drift:" : "drift: none",
    ...d.drift.map((p) => `  ${p}`),
  ];
}

/** @typedef {{ repo?: string, offline: boolean, metrics: boolean, since: string, by?: string, role?: string, web: boolean, port: number, divergence?: boolean }} StatusOptions */

/**
 * What is wrong with `fflow status`'s options, as a usage error's message and hint, or undefined.
 * @param {StatusOptions} options
 * @returns {{ message: string, hint: string } | undefined}
 */
export function refusal({ offline, metrics: wanted, since, by, role, web, port, divergence: div }) {
  if (div && (wanted || web || by !== undefined))
    return {
      message: "--divergence is its own report; it takes no --metrics, --web or --by",
      hint: `${NAME} status --divergence`,
    };
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    return { message: "--port takes a port number", hint: `${NAME} status --web --port 4747` };
  if (wanted && offline)
    return { message: "--metrics reads GitHub; it cannot run --offline", hint: "drop --offline" };
  if (wanted && !(Number(since.replace(/d$/, "")) > 0))
    return {
      message: "--since takes a number of days",
      hint: `${NAME} status --metrics --since 30d`,
    };
  if (by !== undefined && by !== "role")
    return { message: "--by takes `role`", hint: `${NAME} status --by role` };
  if (role !== undefined && by !== "role")
    return {
      message: "--role goes with --by role",
      hint: `${NAME} status --by role --role ${role}`,
    };
  return undefined;
}

/**
 * `fflow status`, after `refusal` passed its options.
 * @param {import("../lib/console.mjs").Io} io
 * @param {StatusOptions} options
 * @returns {Promise<number>}
 */
export async function status(
  io,
  { repo, offline, metrics: wanted, since, by, role, web, port, divergence: div },
) {
  const repos = () => reposFor(repo, io.cwd);
  if (div) {
    const found = repos().map((r) => ({
      ...r,
      ...(existsSync(r.path) ? divergence(r.path) : { repo: r.path, error: "missing" }),
    }));
    if (io.json) io.output.json({ repos: found });
    else
      for (const d of found) {
        io.output.title(`${d.github || d.path}${d.github ? `  (${d.path})` : ""}`);
        if ("error" in d) io.output.warn(`skipped: ${d.error}`);
        else for (const line of renderDivergence(d)) io.output.line(`  ${line}`);
      }
    return found.some((d) => "drift" in d && (d.drift.length || d.expired.length)) ? 1 : 0;
  }
  const read = () => {
    const live = systemSessions();
    // One process listing and one read of the session files serve every repository's `in use` and live sessions.
    const running = live.processes();
    const files = live.sessionFiles();
    return snapshot({
      repos: repos(),
      cap: readSessionCap(),
      offline,
      busy: running?.map((p) => p.cwd),
      live: { processes: () => running, sessionFiles: () => files },
      api: offline ? undefined : (root) => github(root),
    });
  };
  if (web) {
    const server = statusServer(read);
    // Never resolves: the page is served until the process is stopped (Ctrl-C).
    return new Promise(() =>
      server.listen(port, "127.0.0.1", () => {
        const address = /** @type {import("node:net").AddressInfo} */ (server.address());
        io.output.line(`${NAME} status: http://127.0.0.1:${address.port}/ (Ctrl-C stops it)`);
      }),
    );
  }
  if (wanted) {
    const days = Number(since.replace(/d$/, ""));
    const m = metrics({
      repos: repos(),
      api: (root) => github(root),
      since: Date.now() - days * 86_400_000,
    });
    if (io.json) io.output.json(m);
    else io.output.line(renderMetrics(m));
    return 0;
  }
  const snap = read();
  const code = snap.warnings.length ? 1 : 0;
  if (io.json) {
    io.output.json(snap);
    return code;
  }
  if (by === "role") io.output.line(renderByRole(snap, role));
  else
    for (const r of snap.repos) {
      io.output.title(`${r.github ?? r.path}${r.github ? `  (${r.path})` : ""}`);
      if (r.error) {
        io.output.warn(`skipped: ${r.error}`);
        continue;
      }
      for (const { title, columns, rows, problems = [] } of tablesOf(r, io.verbose)) {
        if (rows.length) io.output.table({ title, columns, rows });
        else io.output.line(`  ${title}: none`);
        if (problems.length) io.output.list(problems);
      }
      const counted = r.specs.reduce((n, /** @type {any} */ s) => n + s.problems.length, 0);
      if (counted && !io.verbose)
        io.output.note(`${counted} spec problem(s); \`${NAME} status --verbose\` lists them`);
    }
  for (const w of snap.warnings) io.output.warn(w);
  return code;
}
