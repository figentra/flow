/**
 * Figentra Flow file contract:
 * Purpose: `fflow status --web [--port <n>]`: the status snapshot as a local page that refreshes itself. `/`
 *   serves one self-contained HTML page (no external script, style or font); `/status.json` rebuilds and returns the
 *   snapshot on each request.
 * Boundary: read-only and local: it listens on 127.0.0.1 only, answers GET and HEAD only (405 otherwise), and writes
 *   nothing. The page renders every value through `textContent`, so a spec title or PR title is never markup.
 * Runtime: node
 * Governing contract: STA-1729 phase 4 (the leader's `status --web`, 2026-11-01).
 * Secrets: none; the snapshot carries no token or environment value.
 */
import { createServer } from "node:http";

import { DISPLAY_NAME, STATUS_CONTEXT } from "./product.mjs";

/** The page: a shell that fetches `/status.json` every 30 seconds and draws it with DOM text only. */
export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${DISPLAY_NAME} status</title>
<style>
:root { color-scheme: light dark; --fg: #1a1a1a; --muted: #666; --bg: #fff; --line: #e3e3e3; --warn: #b45309; }
@media (prefers-color-scheme: dark) { :root { --fg: #eee; --muted: #9a9a9a; --bg: #141414; --line: #2c2c2c; --warn: #f59e0b; } }
body { margin: 0 auto; max-width: 72rem; padding: 1rem; font: 14px/1.45 system-ui, sans-serif; color: var(--fg); background: var(--bg); }
h1 { font-size: 1.2rem; margin: 0 0 .25rem; } h2 { font-size: 1rem; margin: 1.5rem 0 .25rem; } h3 { font-size: .9rem; margin: .75rem 0 .25rem; color: var(--muted); }
table { border-collapse: collapse; width: 100%; } td, th { text-align: left; padding: .2rem .5rem .2rem 0; border-bottom: 1px solid var(--line); vertical-align: top; }
.muted { color: var(--muted); } .warn { color: var(--warn); font-weight: 600; } .wrap { overflow-x: auto; }
</style>
</head>
<body>
<h1>${DISPLAY_NAME} status</h1>
<p class="muted" id="taken">Loading…</p>
<div id="warnings"></div>
<div id="repos"></div>
<script>
const el = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = String(text); if (cls) e.className = cls; return e; };
const table = (head, rows) => {
  const wrap = el("div", undefined, "wrap"); const t = el("table"); const tr = el("tr");
  for (const h of head) tr.append(el("th", h)); t.append(tr);
  for (const r of rows) { const row = el("tr"); for (const c of r) row.append(el("td", c ?? "")); t.append(row); }
  if (!rows.length) { const row = el("tr"); const td = el("td", "none", "muted"); td.colSpan = head.length; row.append(td); t.append(row); }
  wrap.append(t); return wrap;
};
async function draw() {
  const snap = await (await fetch("status.json", { cache: "no-store" })).json();
  document.getElementById("taken").textContent = "Taken " + new Date(snap.takenAt).toLocaleString() + " · session cap " + snap.cap;
  const warnings = document.getElementById("warnings"); warnings.replaceChildren(...snap.warnings.map((w) => el("p", "Warning: " + w, "warn")));
  const repos = document.getElementById("repos"); repos.replaceChildren();
  for (const r of snap.repos) {
    repos.append(el("h2", r.github || r.path));
    if (r.error) { repos.append(el("p", "Skipped: " + r.error, "muted")); continue; }
    repos.append(el("h3", "Specs"), table(["Status", "Spec", "Tier", "Session", "Problems"], r.specs.map((s) => [s.status, s.folder, s.tier, s.session, s.problems.length || ""])));
    repos.append(el("h3", "Worktrees"), table(["Branch", "Path", "State", "Idle (h)", "Ahead/behind"], r.worktrees.map((t) => [t.branch || "(detached)", t.path, (t.dirty ? "dirty" : "clean") + (t.inUse ? ", in use" : ""), t.idleHours, t.ahead === null ? "not pushed" : "+" + t.ahead + "/-" + t.behind])));
    repos.append(el("h3", "Pull requests"), r.prsProblem ? el("p", r.prsProblem, "muted") : table(["#", "Title", "${STATUS_CONTEXT}", "Review", "Base"], r.prs.map((p) => [p.number, p.title, p.gate ? p.gate.state : "none", p.review || "none", p.base + (p.stacked ? " (stacked)" : "")])));
    repos.append(el("h3", "Sessions"), table(["Session", "Specs", "Worktrees", "Gates", "Building"], r.sessions.map((s) => [s.name, s.specs.join(", "), s.worktrees.join(", "), s.gates.map((g) => g || "none").join(", "), s.building ? "yes" : ""])));
  }
}
draw().catch((e) => { document.getElementById("taken").textContent = "Could not load the status: " + e.message; });
setInterval(() => draw().catch(() => {}), 30000);
</script>
</body>
</html>
`;

/**
 * The page's server; `read` builds the snapshot for each `/status.json`.
 * @param {() => unknown} read
 */
export function statusServer(read) {
  return createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { allow: "GET, HEAD" }).end();
      return;
    }
    const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    const send = (/** @type {string} */ type, /** @type {string} */ body) =>
      res
        .writeHead(200, {
          "content-type": type,
          "cache-control": "no-store",
          // Self-contained page: its own inline script and style, data from this server only.
          "content-security-policy":
            "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'",
        })
        .end(req.method === "HEAD" ? undefined : body);
    if (path === "/") return send("text/html; charset=utf-8", PAGE);
    if (path === "/status.json") {
      try {
        return send("application/json", JSON.stringify(read()));
      } catch (error) {
        res
          .writeHead(500, { "content-type": "text/plain" })
          .end(/** @type {Error} */ (error).message);
        return;
      }
    }
    res.writeHead(404).end();
  });
}
