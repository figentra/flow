/**
 * Figentra Flow file contract:
 * Purpose: the `github-issues` tracker adapter: keys `gh-<n>` name the repository's own issue `#<n>`; its title, its
 *   state (closed as completed is Done, closed as not planned is Canceled, open is Open), In Progress as a label, Done
 *   as closing it as completed, and comments (posting one gives its link; `comments` lists them, STA-2098), through
 *   the GitHub API with the repository's credentials.
 * Boundary: GitHub REST calls through `lib/github.mjs` (the credentials port); a failure is thrown to the caller.
 * Runtime: node
 * Governing contract: STA-1729 phase A (A2).
 * Secrets: none here; `gh` or the credentials wrapper holds the token.
 */
import { github } from "../../lib/github.mjs";
import { git } from "../../lib/git.mjs";

/** The label `inProgress` adds. */
export const IN_PROGRESS_LABEL = "in progress";

/**
 * @param {any} _block the configuration's `tracker` (`kind: "github-issues"`)
 * @param {{ root: string, api?: import("../../lib/github.mjs").Api }} context
 * @returns {import("./index.mjs").Tracker}
 */
export function githubIssuesTracker(_block, { root, api }) {
  const repo = git(root, ["remote", "get-url", "origin"]).out.match(
    /github\.com[:/]+([^/]+\/[^/]+?)(?:\.git)?\/?$/,
  )?.[1];
  /** @type {import("../../lib/github.mjs").Api | undefined} */
  let gh = api;
  /** A repository-level call. */
  const repoCall = (/** @type {string} */ method, /** @type {string} */ tail) => {
    if (!repo) throw new Error("origin is not a GitHub repository");
    gh ??= github(root);
    return gh(method, `/repos/${repo}${tail}`);
  };
  const call = (
    /** @type {string} */ method,
    /** @type {string} */ key,
    /** @type {string} */ tail,
    /** @type {unknown} */ body = undefined,
  ) => {
    if (!repo) throw new Error("origin is not a GitHub repository");
    const n = key.match(/-(\d+)$/)?.[1];
    if (!n) throw new Error(`${key} is not a GitHub issue key`);
    gh ??= github(root);
    const r = gh(method, `/repos/${repo}/issues/${n}${tail}`, body);
    if (!r.ok) throw new Error(`${method} issue #${n}${tail}: ${r.err}`);
    return r.json;
  };
  return {
    async title(key) {
      return call("GET", key, "").title;
    },
    async state(key) {
      const issue = call("GET", key, "");
      if (issue.state !== "closed") return "Open";
      return issue.state_reason === "not_planned" ? "Canceled" : "Done";
    },
    async inProgress(key, branch) {
      call("POST", key, "/labels", { labels: [IN_PROGRESS_LABEL] });
      if (branch) call("POST", key, "/comments", { body: `Started: branch \`${branch}\`.` });
    },
    async done(key, url) {
      call("POST", key, "/comments", { body: `Landed: ${url}.` });
      call("PATCH", key, "", { state: "closed", state_reason: "completed" });
    },
    async comment(key, body) {
      return call("POST", key, "/comments", { body })?.html_url;
    },
    async comments(key) {
      // shortcut: the first 100 comments only; page through `Link` when an issue holds more.
      return (call("GET", key, "/comments?per_page=100") ?? []).map((/** @type {any} */ c) => ({
        body: c.body ?? "",
        url: c.html_url,
        createdAt: c.created_at,
      }));
    },
    async role(key, label) {
      // POST /labels would create a missing label; the roster's labels are the lead's to create.
      if (!repoCall("GET", `/labels/${encodeURIComponent(label)}`).ok)
        throw new Error(`the label ${label} does not exist on GitHub (the lead creates it)`);
      for (const old of call("GET", key, "").labels ?? [])
        if (old.name.startsWith("role:") && old.name !== label)
          call("DELETE", key, `/labels/${encodeURIComponent(old.name)}`);
      call("POST", key, "/labels", { labels: [label] });
    },
    async missingLabels(labels) {
      return labels.filter((label) => !repoCall("GET", `/labels/${encodeURIComponent(label)}`).ok);
    },
  };
}
