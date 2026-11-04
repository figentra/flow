/**
 * Figentra Flow file contract:
 * Purpose: `fflow land [<pr>] [--stack] [--dry-run] [--manual-ok]`, the lander's checklist as code: squash-merge a PR
 *   only when it is open, clean, based on the default branch, green on `fflow/gate` from the gate App on its exact
 *   head, conventionally titled, its spec's approvals are recorded and it changes no owner-only path (with the globs
 *   an `extend` of `owner-only` adds, STA-1945 FR-5); then set Linear
 *   Done, record the merge commit, remove the worktree through `clean`'s rules, delete the branch and comment. When the
 *   base's ruleset requires an approving review the head lacks, it dispatches the approval workflow and turns on
 *   auto-merge at the head instead, never an admin path; `land` on a merged PR runs the steps after the merge
 *   (STA-1856). `--stack` lands a stack bottom-up: after each squash it merges the default branch into the next PR,
 *   resolves each conflict that is only the landed parent's own change (`lib/stack.mjs`), retargets the PR, gates it
 *   and lands it; a re-run after a stop picks the stack up where it stopped (STA-1945 FR-16).
 * Boundary: every rule is read from GitHub's live state and the spec at the PR's head; nothing changes until all
 *   pass. The merge carries `sha`, so GitHub refuses it if the head moved. Waiting on required checks exits 4. Steps
 *   after the merge only warn (exit 3)
 *   and never undo it. A stack is brought up to date by a merge commit and a normal push, never a rewrite; any other
 *   conflict stops the stack with the merge aborted and the files named.
 * Runtime: node
 * Governing contract: Stackra ADR 0503 (decision 5), ADR 0502; STA-1729 phase 3 (the leader's plan stop of
 *   2026-10-31); STA-1856 (FR-1 to FR-3); STA-1945 (FR-16, AC-14).
 * Secrets: none here. GitHub calls go through `gh` (or the repository's `bot:gh`), Linear through the environment's
 *   token, which is never read into output.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { checkApproval, ownerApprovalProblems, statusOf, tierOf } from "./gate.mjs";
import { clean } from "./clean.mjs";
import { gateRun, slugOf } from "./gate-run.mjs";
import { trackerFor } from "../adapters/tracker/index.mjs";
import { github } from "../lib/github.mjs";
import { aiReview } from "../lib/review.mjs";
import { pathProblems, reviewerProblems, roleOf } from "../lib/roles.mjs";
import { loadTeam } from "../lib/team.mjs";
import { artifactProblems } from "../lib/artifacts.mjs";
import { say } from "../lib/cli.mjs";
import { gateLogins, loadConfig } from "../lib/config.mjs";
import { ownerOnlyPaths, packageFindings } from "../lib/owner-only.mjs";
import { ownerOnlyExtra } from "../lib/render.mjs";
import { requiredCheckState, requiredContexts } from "../lib/required-checks.mjs";
import {
  APPROVE_WORKFLOW,
  LANDED_KEY,
  NAME,
  STACK_PARENT_KEY,
  STATUS_CONTEXT,
} from "../lib/product.mjs";
import { mergeUp } from "../lib/stack.mjs";
import { defaultBranch, fetch, git, mainCheckout, remote, worktrees } from "../lib/git.mjs";

/** The tiers whose changes need the AI review when the configuration's `review.required` names none. */
export const REVIEW_TIERS = ["small", "feature", "big"];

/** A conventional commit header (the squash commit's title). */
export const CONVENTIONAL =
  /^(?:build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(?:\([\w./-]+\))?!?: \S/;

/**
 * Why `statuses` (a commit's, newest first) do not make that commit green: `fflow/gate` must be `success`,
 * posted by the configured gate App (any of its logins, `gateLogins`). Shared by `land` and `train`.
 * @param {any[]} statuses
 * @param {string | undefined} sha  the commit, for the message
 * @param {string | string[] | undefined} gateApp
 * @returns {string[]}
 */
export function gateProblems(statuses, sha, gateApp) {
  const problems = [];
  // The trusted gate status creator comes only from the configuration (defence in depth; the ruleset is the
  // guarantee).
  // An empty login trusts no one (a deleted poster has no login either).
  const logins = [gateApp ?? []].flat().filter(Boolean);
  if (!logins.length)
    problems.push("no gate App is configured: set apps.gate.login in the configuration");
  const head = String(sha ?? "").slice(0, 12);
  // GitHub lists a commit's statuses newest first; the newest of the context counts.
  const gate = statuses.find((s) => s.context === STATUS_CONTEXT);
  if (!gate)
    problems.push(
      `no ${STATUS_CONTEXT} on the head ${head} (run \`${NAME} gate run\`; an older commit's gate does not count)`,
    );
  else if (gate.state !== "success")
    problems.push(`${STATUS_CONTEXT} is ${gate.state} on the head ${head}`);
  else if (!logins.includes(gate.creator?.login ?? ""))
    problems.push(
      `${STATUS_CONTEXT} on the head was posted by ${gate.creator?.login ?? "nobody"}, not ${logins.join(" or ")}`,
    );
  return problems;
}

/**
 * The GitHub `owner/name` of `root`'s origin and the API with the configured credentials, or why there is none
 * (AC-034: never a silent fallback to the caller's own gh login).
 * @param {string} root
 * @returns {{ repo?: string, api?: import("../lib/github.mjs").Api, problem?: string }}
 */
export function connect(root) {
  const url = git(root, ["remote", "get-url", "origin"]).out;
  const repo = slugOf(url);
  if (!repo) return { problem: `origin (${url}) is not a GitHub repository` };
  try {
    return { repo, api: github(root) };
  } catch (error) {
    return { problem: /** @type {Error} */ (error).message };
  }
}

/**
 * Every reason the PR may not land; empty means it may.
 * @param {{ pr: any, statuses: any[], base: string, spec?: string, gateApp?: string | string[],
 *           reviewer?: string, required: boolean, files?: string[],
 *           manualOk?: boolean, stack?: boolean, review?: { verdict: string | null, ignored: string[] },
 *           artifacts?: string[], reviewTiers?: string[], ownerOnly?: string[],
 *           ownerFindings?: string[] }} input
 * @returns {string[]}
 */
export function landRules({
  pr,
  statuses,
  base,
  spec,
  gateApp,
  reviewer,
  required,
  files = [],
  ownerOnly = [],
  ownerFindings = [],
  manualOk = false,
  stack = false,
  review,
  artifacts = [],
  reviewTiers = REVIEW_TIERS,
}) {
  const problems = [...artifacts];
  // STA-1856 FR-1: what only the owner approves never lands through an agent.
  const owned = ownerOnlyPaths(files, ownerOnly);
  if (owned.length)
    problems.push(`owner-only paths, so the owner lands it: ${owned.slice(0, 20).join(", ")}`);
  for (const f of ownerFindings) problems.push(`owner-only change, so the owner lands it: ${f}`);
  if (pr.state !== "open") problems.push(`the PR is ${pr.merged ? "already merged" : pr.state}`);
  if (pr.draft) problems.push("the PR is a draft");
  if (pr.mergeable_state === "dirty") problems.push(`the PR conflicts with ${pr.base?.ref}`);
  if (pr.base?.ref !== base && !stack)
    problems.push(`stacked on \`${pr.base?.ref}\`: land that first, or use --stack`);
  problems.push(...gateProblems(statuses, pr.head?.sha, gateApp));
  const title = String(pr.title ?? "");
  if (!CONVENTIONAL.test(title) || title.length > 100)
    problems.push(
      `the title is not a conventional commit header of at most 100 characters: "${title}"`,
    );
  // ADR 0230 (AC-031): a change whose spec's tier is in `review.required` (default small, feature, big) needs the
  // independent AI review on its head; a spec with no tier counts as small, and work with no spec is exempt.
  if (
    spec !== undefined &&
    reviewTiers.includes(tierOf(spec) ?? "small") &&
    review?.verdict !== "PASS"
  )
    problems.push(
      `no AI review PASS for ${pr.head?.sha} (counted verdict: ${review?.verdict ?? "none"}): a different agent posts "AI-REVIEW: PASS ${pr.head?.sha} base=${pr.base?.ref}" as the ${reviewer ?? "(unconfigured, apps.review.slug)"} app${review?.ignored.length ? `; ignored: ${[...new Set(review.ignored)].join("; ")}` : ""}`,
    );
  if (spec !== undefined) {
    problems.push(...checkApproval(spec).map((p) => `spec: ${p}`));
    const tier = tierOf(spec);
    if (
      (tier === "feature" || tier === "big") &&
      !["tasked", "implementing", "done"].includes(statusOf(spec))
    )
      problems.push(
        `spec: a ${tier} spec lands from Tasked or later; it is ${statusOf(spec) || "unset"}`,
      );
  }
  if (!required && !manualOk)
    problems.push(
      `${base}'s ruleset does not require ${STATUS_CONTEXT} yet (phase 6); until then only the tester lands, with --manual-ok`,
    );
  return problems;
}

/** The squash commit's message: one `Refs:` line and the co-author trailers of the PR's commits. */
export function squashMessage(/** @type {string | undefined} */ key, /** @type {any[]} */ commits) {
  const coauthors = new Set();
  for (const c of commits)
    for (const line of String(c.commit?.message ?? "").split("\n"))
      if (/^Co-authored-by: /i.test(line.trim()))
        coauthors.add(line.trim().replace(/^co-authored-by/i, "Co-Authored-By"));
  return [...(key ? [`Refs: ${key.toUpperCase()}`] : []), ...coauthors].join("\n");
}

/** A list response's items; none when the call failed or answered something else. */
const list = (/** @type {{ json: any }} */ r) => (Array.isArray(r.json) ? r.json : []);

/** Turns on auto-merge (squash), pinned to the head that was checked. */
const AUTO_MERGE = `mutation($id: ID!, $head: GitObjectID!, $title: String!, $body: String!) {
  enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: SQUASH, expectedHeadOid: $head,
    commitHeadline: $title, commitBody: $body }) { clientMutationId }
}`;

/**
 * Every path the PR changes (a rename's old path too), each listed entry, and how many files GitHub listed (it lists
 * at most 3000).
 * @param {import("../lib/github.mjs").Api} api
 * @param {string} repo
 * @param {number} number
 */
function changedFiles(api, repo, number) {
  /** @type {string[]} */
  const files = [];
  /** @type {{ filename: string, previous_filename?: string, status: string }[]} */
  const entries = [];
  let listed = 0;
  for (let page = 1; page <= 30; page++) {
    const got = list(api("GET", `/repos/${repo}/pulls/${number}/files?per_page=100&page=${page}`));
    listed += got.length;
    for (const f of got) {
      entries.push(f);
      files.push(f.filename, ...(f.previous_filename ? [f.previous_filename] : []));
    }
    if (got.length < 100) break;
  }
  return { files, entries, listed };
}

/** At this many changed files the approval check refuses, so `land` does too: the owner reviews it. */
export const MAX_FILES = 300;

/** A branch name as an API path: each segment encoded, the slashes kept. */
const refPath = (/** @type {string} */ branch) =>
  branch.split("/").map(encodeURIComponent).join("/");

/** The spec text at `sha` for the branch's key, read through the API; undefined when there is none. */
function specAt(
  /** @type {import("../lib/github.mjs").Api} */ api,
  /** @type {string} */ repo,
  /** @type {string} */ sha,
  /** @type {string | undefined} */ key,
) {
  if (!key) return undefined;
  const dirs = api("GET", `/repos/${repo}/contents/.agents/specs?ref=${sha}`);
  const dir =
    dirs.ok && Array.isArray(dirs.json)
      ? dirs.json.find((d) => d.type === "dir" && d.name.startsWith(`${key}-`))
      : undefined;
  if (!dir) return undefined;
  const file = api("GET", `/repos/${repo}/contents/.agents/specs/${dir.name}/spec.md?ref=${sha}`);
  return file.ok
    ? Buffer.from(String(file.json?.content ?? ""), "base64").toString("utf8")
    : undefined;
}

/**
 * @typedef {{ api: import("../lib/github.mjs").Api, done: (key: string, url: string) => Promise<void>,
 *             log: (s: string) => void, warn: (s: string) => void,
 *             scheme?: import("../adapters/tracker/index.mjs").KeyScheme }} LandDeps
 */

/**
 * Lands one PR.
 * @param {{ root: string, repo: string, base: string, number: number, dry?: boolean, manualOk?: boolean,
 *           gateApp?: string | string[], reviewer?: string, owner?: string, refs?: string, deps: LandDeps }} options
 *   `refs`: the issue the squash's `Refs:` names when the branch is not a key branch (`<prefix>/<key>-<slug>`); then a
 *   slug that only looks like a key (`adr/0008-sta-12-x`) neither names the squash, picks a spec nor moves to Done,
 *   and `refs` is not moved to Done either. A key branch keeps its key, its spec gate and its Done.
 * @returns {Promise<{ code: number, problems?: string[], merged?: string, head?: string,
 *   queued?: boolean, waiting?: string[] }>}
 */
export async function landOne({
  root,
  repo,
  base,
  number,
  dry = false,
  manualOk = false,
  gateApp,
  reviewer,
  owner,
  refs,
  deps,
}) {
  const { api, log } = deps;
  const pr = api("GET", `/repos/${repo}/pulls/${number}`);
  if (!pr.ok) return { code: 2, problems: [`PR #${number}: ${pr.err}`] };
  const head = pr.json.head.sha;
  const branch = pr.json.head.ref;
  const scheme = deps.scheme ?? trackerFor(root, { warn: () => {} }).scheme;
  // With `refs`, only a `<prefix>/<key>-<slug>` branch's key counts: an ADR slug may merely look like one.
  const key = refs && !scheme.isBranch(branch) ? undefined : scheme.parse(branch);
  // STA-1856 FR-3: an auto-merged PR comes back here to finish.
  if (pr.json.merged && pr.json.merge_commit_sha) {
    if (pr.json.base?.ref !== base)
      return { code: 1, problems: [`#${number} merged into ${pr.json.base?.ref}, not ${base}`] };
    if (dry) {
      log(
        `${NAME} land: would finish #${number}, merged as ${pr.json.merge_commit_sha.slice(0, 12)}`,
      );
      return { code: 0, head };
    }
    log(`${NAME} land: #${number} merged as ${pr.json.merge_commit_sha.slice(0, 12)}; finishing`);
    return finish({
      root,
      repo,
      number,
      branch,
      head,
      key,
      sha: pr.json.merge_commit_sha,
      scheme,
      deps,
    });
  }
  const statuses = api("GET", `/repos/${repo}/commits/${head}/statuses?per_page=100`).json ?? [];
  const rules = api("GET", `/repos/${repo}/rules/branches/${base}`);
  const required = (rules.ok ? (rules.json ?? []) : []).some(
    (/** @type {any} */ r) =>
      r.type === "required_status_checks" &&
      (r.parameters?.required_status_checks ?? []).some(
        (/** @type {any} */ c) => c.context === STATUS_CONTEXT,
      ),
  );
  const needsReview = (rules.ok ? (rules.json ?? []) : []).some(
    (/** @type {any} */ r) =>
      r.type === "pull_request" && (r.parameters?.required_approving_review_count ?? 0) > 0,
  );
  const spec = specAt(api, repo, head, key);
  const commit = api("GET", `/repos/${repo}/commits/${head}`).json ?? {};
  const reviews = list(api("GET", `/repos/${repo}/pulls/${number}/reviews?per_page=100`));
  const approved = reviews.some(
    (/** @type {any} */ r) => r.state === "APPROVED" && r.commit_id === head,
  );
  const review = aiReview(
    { sha: head, base: pr.json.base.ref },
    list(api("GET", `/repos/${repo}/issues/${number}/comments?per_page=100`)),
    reviews,
    [pr.json.user?.login, commit.author?.login, commit.committer?.login],
    { reviewer, owner },
  );
  // AC-043: the head must be here to check its files; fetch it when it is not.
  if (!git(root, ["cat-file", "-e", `${head}^{commit}`]).ok) fetch(root);
  const artifacts = git(root, ["cat-file", "-e", `${head}^{commit}`]).ok
    ? artifactProblems(root, `origin/${base}`, head, loadConfig(root).config.artifacts)
    : [`cannot read the head ${head.slice(0, 12)} to check its files (fetch failed)`];
  const { files, entries, listed } = changedFiles(api, repo, number);
  if (listed < Number(pr.json.changed_files))
    artifacts.push(`GitHub lists only ${listed} of ${pr.json.changed_files} changed files`);
  if (listed >= MAX_FILES)
    artifacts.push(
      `${listed} files changed, at the approval check's limit of ${MAX_FILES}: the owner reviews it`,
    );
  const config = loadConfig(root).config;
  // A package.json's root scripts and catalog entries are the owner's too; read both sides from git.
  const forkPoint = git(root, ["merge-base", `origin/${base}`, head]).out;
  const show = (/** @type {string} */ ref, /** @type {string} */ path) => {
    const r = git(root, ["show", `${ref}:${path}`]);
    return r.ok ? r.out : undefined;
  };
  /** @type {string[]} */
  const ownerFindings = [];
  for (const f of entries.filter((e) => e.filename.split("/").pop() === "package.json")) {
    // A side that should exist but cannot be read refuses; it never counts as added or removed.
    const old = f.previous_filename ?? f.filename;
    const before = f.status === "added" || !forkPoint ? undefined : show(forkPoint, old);
    const after = f.status === "removed" ? undefined : show(head, f.filename);
    if (f.status !== "added" && before === undefined)
      ownerFindings.push(`${old} cannot be read at the merge base`);
    else if (f.status !== "removed" && after === undefined)
      ownerFindings.push(`${f.filename} cannot be read at the head`);
    else ownerFindings.push(...packageFindings(f.filename, before, after));
  }
  const problems = landRules({
    pr: pr.json,
    statuses,
    base,
    spec,
    review,
    artifacts,
    files,
    ownerOnly: ownerOnlyExtra(root),
    ownerFindings,
    gateApp,
    reviewer,
    required,
    manualOk,
    reviewTiers: config.review?.required,
  });
  // AC-051 to AC-053: with a roster, the reviewer is not the builder, the builder's role stays in its paths, and an
  // owner-kept spec's approvals are the owner's.
  const team = loadTeam(root);
  if (team && spec !== undefined) {
    problems.push(
      ...reviewerProblems(team, spec, review.passes),
      ...ownerApprovalProblems(spec, owner).map((p) => `spec: ${p}`),
      ...pathProblems(team, roleOf(spec), repo, files),
    );
  }
  if (problems.length) return { code: 1, problems };
  const queue = needsReview && !approved;
  if (dry) {
    log(
      `${NAME} land: would ${queue ? "request the approval and auto-merge" : "squash-merge"} #${number} (${branch} at ${head.slice(0, 12)}) into ${base}`,
    );
    return { code: 0 };
  }

  const commits = api("GET", `/repos/${repo}/pulls/${number}/commits?per_page=100`).json ?? [];
  // STA-1856 FR-2: a required review comes from the approval workflow; auto-merge waits for it and every check.
  if (queue) {
    if (!existsSync(join(root, ".github", "workflows", APPROVE_WORKFLOW)))
      return {
        code: 1,
        problems: [
          `${base}'s ruleset requires an approving review and .github/workflows/${APPROVE_WORKFLOW} is not installed (run \`${NAME} sync\`)`,
        ],
      };
    // The approval checks every required check on the head; asking before they are green only gets a refusal.
    const checks = requiredCheckState({
      required: requiredContexts(rules.ok ? (rules.json ?? []) : []),
      statuses,
      checkRuns:
        api("GET", `/repos/${repo}/commits/${head}/check-runs?per_page=100`).json?.check_runs ?? [],
      trusted: { ...(gateApp ? { [STATUS_CONTEXT]: gateApp } : {}), ...config.approve?.checks },
    });
    const bad = [...checks.failed.map((c) => `${c} failed`), ...checks.untrusted];
    if (bad.length) return { code: 1, problems: bad.map((b) => `required check: ${b}`) };
    if (checks.pending.length) {
      log(
        `${NAME} land: #${number}: waiting on ${checks.pending.join(", ")}; \`${NAME} land ${number}\` again once green`,
      );
      return { code: 4, queued: true, waiting: checks.pending };
    }
    const asked = api("POST", `/repos/${repo}/actions/workflows/${APPROVE_WORKFLOW}/dispatches`, {
      ref: base,
      inputs: { pr: String(number), head },
    });
    if (!asked.ok) return { code: 1, problems: [`the approval request was refused: ${asked.err}`] };
    const auto = api("POST", "/graphql", {
      query: AUTO_MERGE,
      variables: {
        id: pr.json.node_id,
        head,
        title: `${pr.json.title} (#${number})`,
        body: squashMessage(key ?? refs, commits),
      },
    });
    const error = auto.json?.errors?.[0]?.message;
    if (!auto.ok || error)
      return { code: 1, problems: [`auto-merge was not turned on: ${error ?? auto.err}`] };
    log(
      `${NAME} land: #${number}: approval requested, auto-merge on at ${head.slice(0, 12)}; \`${NAME} land ${number}\` finishes it once merged`,
    );
    return { code: 0, queued: true };
  }
  const merge = api("PUT", `/repos/${repo}/pulls/${number}/merge`, {
    merge_method: "squash",
    sha: head,
    commit_title: `${pr.json.title} (#${number})`,
    commit_message: squashMessage(key ?? refs, commits),
  });
  if (!merge.ok) return { code: 1, problems: [`GitHub refused the merge: ${merge.err}`] };
  const sha = merge.json.sha;
  log(`${NAME} land: #${number} landed on ${base} as ${sha.slice(0, 12)}`);
  return finish({ root, repo, number, branch, head, key, sha, scheme, manualOk, deps });
}

/**
 * The steps after a merge: tracker Done, the merge commit recorded, the worktree removed, the branch deleted and a
 * comment. Each only warns (exit 3); none undoes the merge.
 * @param {{ root: string, repo: string, number: number, branch: string, head: string, key: string | undefined,
 *           sha: string, scheme: import("../adapters/tracker/index.mjs").KeyScheme, manualOk?: boolean,
 *           deps: LandDeps }} options
 * @returns {Promise<{ code: number, merged: string, head: string }>}
 */
async function finish({
  root,
  repo,
  number,
  branch,
  head,
  key,
  sha,
  scheme,
  manualOk = false,
  deps,
}) {
  const { api, log, warn } = deps;
  let warned = false;
  const step = async (/** @type {string} */ what, /** @type {() => unknown} */ fn) => {
    try {
      const out = await fn();
      if (out === false) throw new Error("failed");
    } catch (error) {
      warned = true;
      warn(`${NAME} land: warning: ${what}: ${/** @type {Error} */ (error).message}`);
    }
  };
  if (key)
    await step(`tracker ${scheme.display(key)} Done`, () =>
      deps.done(key, `https://github.com/${repo}/commit/${sha}`),
    );
  // AC-029: `clean` counts a squashed branch as saved by this commit (a squash has its own patch id).
  if (git(root, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]).ok)
    await step(
      "record the merge commit",
      () => git(root, ["config", `branch.${branch}.${LANDED_KEY}`, sha]).ok,
    );
  await step("fetch", () => fetch(root).ok);
  const tree = worktrees(root).find((t) => t.branch === branch);
  if (tree)
    await step("remove the worktree", async () => {
      const r = await clean({
        cwd: root,
        only: [tree.path],
        issues: { state: async () => "Done" },
      });
      for (const k of r.kept)
        log(`${NAME} land: kept ${k.path}: ${k.reason} (${NAME} clean takes it later)`);
    });
  // Only the branch as it was landed: a push after the merge is someone's work.
  await step("delete the branch", () => {
    const now = api("GET", `/repos/${repo}/git/ref/heads/${refPath(branch)}`).json?.object?.sha;
    if (now !== head)
      throw new Error(`${branch} is at ${now ?? "nothing"}, not the landed ${head}; kept`);
    return api("DELETE", `/repos/${repo}/git/refs/heads/${refPath(branch)}`).ok;
  });
  await step(
    "comment",
    () =>
      api("POST", `/repos/${repo}/issues/${number}/comments`, {
        body: `Landed by \`${NAME} land\` as ${sha}.${manualOk ? ` (\`--manual-ok\`: the ruleset does not require \`${STATUS_CONTEXT}\` yet.)` : ""}`,
      }).ok,
  );
  return { code: warned ? 3 : 0, merged: sha, head };
}

/**
 * The PRs from the bottom of the stack under `number` up to it, and the head of the PR below the bottom when that one
 * already squash-merged into `base` (a re-run after a stop). A merged parent whose branch is still at its head was not
 * finished (auto-merge landed it), so it heads the chain and `landOne` finishes it.
 * @param {import("../lib/github.mjs").Api} api
 * @param {string} repo
 * @param {string} base
 * @param {number} number
 * @returns {{ chain: any[], parent?: string, problem?: string }}
 */
function stackOf(api, repo, base, number) {
  const org = repo.split("/")[0];
  /** @type {any[]} */
  const chain = [];
  let cur = api("GET", `/repos/${repo}/pulls/${number}`).json;
  if (!cur?.base) return { chain, problem: `PR #${number} was not found` };
  while (cur.base.ref !== base) {
    chain.unshift(cur);
    const below = list(
      api("GET", `/repos/${repo}/pulls?state=all&head=${org}:${encodeURIComponent(cur.base.ref)}`),
    );
    const open = below.find((p) => p.state === "open");
    const landed = below.find((p) => p.merged_at && p.base?.ref === base);
    if (open) cur = open;
    else if (!landed)
      return {
        chain,
        problem: `#${cur.number} is stacked on \`${cur.base.ref}\`, which has no open PR and none merged into ${base}`,
      };
    else if (
      api("GET", `/repos/${repo}/git/ref/heads/${refPath(landed.head.ref)}`).json?.object?.sha !==
      landed.head.sha
    )
      return { chain, parent: landed.head.sha };
    else cur = landed;
  }
  chain.unshift(cur);
  return { chain };
}

/**
 * Brings a stacked PR onto `base` in its worktree: the merge-up, a normal push when the head moved, the retarget when
 * GitHub has not made it, and the gate when the head has no green one (an earlier run's counts).
 * @param {{ root: string, repo: string, base: string, pr: any, parent?: string,
 *           gateApp?: string | string[], dry: boolean,
 *           deps: LandDeps & { gate: (cwd: string) => Promise<number> } }} options
 * @returns {Promise<string[]>} why the stack stops here; empty when the PR is ready to land
 */
async function bringUp({ root, repo, base, pr, parent, gateApp, dry, deps }) {
  const { api, log } = deps;
  const at = `#${pr.number}`;
  const branch = pr.head.ref;
  const tree = worktrees(root).find((t) => t.branch === branch);
  if (!tree)
    return [
      `${at} (${branch}) has no local worktree to update; \`${NAME} start\` one, then land again`,
    ];
  if (dry) {
    log(
      `${NAME} land --stack: would merge ${base} into ${branch} in ${tree.path} (resolving only conflicts where ${base} holds the landed parent's version), push, retarget ${at} to ${base}, gate and land it`,
    );
    return [];
  }
  fetch(root);
  const up = mergeUp({ root: tree.path, child: branch, base, squashedParent: parent });
  if (up.conflicts.length)
    return [
      `${at}: merging ${base} into ${branch} conflicts in ${up.conflicts.join(", ")}, which ${base} changed beyond the landed parent; the merge is aborted: resolve it in ${tree.path}, commit, then land the stack again`,
    ];
  if (!up.merged) return [`${at}: merging ${base} into ${branch} failed: ${up.error}`];
  if (up.resolved.length)
    log(
      `${NAME} land --stack: ${at}: resolved ${up.resolved.join(", ")}, where ${base} holds the landed parent's version`,
    );
  const head = git(tree.path, ["rev-parse", "HEAD"]).out;
  if (head !== git(tree.path, ["rev-parse", "-q", "--verify", `origin/${branch}`]).out) {
    const pushed = remote(tree.path, ["push", "-q", "origin", "HEAD"]);
    if (!pushed.ok) return [`${at}: push failed: ${pushed.err}`];
  }
  // GitHub retargets a PR whose base branch was deleted; set it ourselves if that has not happened yet.
  const on = api("GET", `/repos/${repo}/pulls/${pr.number}`).json?.base?.ref;
  if (on !== base) {
    const moved = api("PATCH", `/repos/${repo}/pulls/${pr.number}`, { base });
    if (!moved.ok)
      return [`${at}: retargeting to ${base} failed: ${moved.err}; it stays on \`${on}\``];
  }
  const statuses = list(api("GET", `/repos/${repo}/commits/${head}/statuses?per_page=100`));
  if (gateProblems(statuses, head, gateApp).length) {
    const gate = await deps.gate(tree.path);
    if (gate !== 0) return [`${at}: ${NAME} gate run exited ${gate}; the stack stops here`];
  }
  return [];
}

/**
 * Lands the stack under `number` bottom-up: after each squash the next PR is brought onto the default branch
 * (`bringUp`), then landed in turn. Stops at the first that cannot go, naming it; run again, it resumes there. With
 * `dry`, prints the plan and checks only the bottom PR's rules, since the others change on the way.
 * @param {{ root: string, repo: string, base: string, number: number, dry?: boolean, manualOk?: boolean,
 *           gateApp?: string | string[], reviewer?: string, owner?: string,
 *           deps: LandDeps & { gate: (cwd: string) => Promise<number> } }} options
 * @returns {Promise<{ code: number, problems?: string[], waiting?: string[] }>}
 */
export async function landStack({
  root,
  repo,
  base,
  number,
  dry = false,
  manualOk = false,
  gateApp,
  reviewer,
  owner,
  deps,
}) {
  const { log } = deps;
  const { chain, parent: landed, problem } = stackOf(deps.api, repo, base, number);
  if (problem) return { code: 1, problems: [problem] };
  if (dry)
    log(
      `${NAME} land --stack: ${chain.map((p) => `#${p.number}`).join(" → ")} into ${base}, bottom first`,
    );
  // Once GitHub retargets the bottom to `base`, only the record an earlier run left still names its parent.
  /** @type {string | undefined} */
  let parent =
    landed ??
    (git(root, ["config", "--get", `branch.${chain[0].head.ref}.${STACK_PARENT_KEY}`]).out ||
      undefined);
  for (const [i, pr] of chain.entries()) {
    if ((i > 0 || parent) && pr.state === "open") {
      const problems = await bringUp({ root, repo, base, pr, parent, gateApp, dry, deps });
      if (problems.length) return { code: 1, problems };
      if (dry) continue;
    }
    const next = chain[i + 1];
    const record = (/** @type {string | undefined} */ sha) => {
      if (next && sha) git(root, ["config", `branch.${next.head.ref}.${STACK_PARENT_KEY}`, sha]);
    };
    // Written before the merge too: a run that dies after it, once GitHub retargets the next PR, still resumes.
    if (!dry && pr.state === "open")
      record(deps.api("GET", `/repos/${repo}/pulls/${pr.number}`).json?.head?.sha);
    const result = await landOne({
      root,
      repo,
      base,
      number: pr.number,
      dry,
      manualOk,
      gateApp,
      reviewer,
      owner,
      deps,
    });
    if (result.code === 1 || result.code === 2)
      return { ...result, problems: (result.problems ?? []).map((p) => `#${pr.number}: ${p}`) };
    // The rest of the stack builds on this PR's merge, which now waits on its approval and checks.
    if (result.queued) {
      log(
        `${NAME} land --stack: #${pr.number} waits on its ${result.waiting ? "checks" : "approval"}; land the stack again once it merges`,
      );
      return result.waiting
        ? { code: result.code, problems: [], waiting: result.waiting }
        : { code: result.code, problems: [] };
    }
    if (dry) continue;
    parent = result.head;
    record(parent);
    log(`${NAME} land --stack: ${i + 1}/${chain.length} landed`);
  }
  return { code: 0 };
}

/** `fflow land [<pr>] [--stack] [--dry-run] [--manual-ok]`. */
export async function run(/** @type {string[]} */ args) {
  const cwd = process.cwd();
  const root = mainCheckout(cwd);
  if (!root) {
    console.error(`${NAME} land: not in a git repository`);
    return 2;
  }
  const { repo, api, problem: refusal } = connect(root);
  if (!repo || !api) {
    console.error(`${NAME} land: ${refusal}`);
    return 2;
  }
  let number = Number.parseInt(args.find((a) => /^#?\d+$/.test(a))?.replace("#", "") ?? "", 10);
  if (Number.isNaN(number)) {
    const branch = git(cwd, ["branch", "--show-current"]).out;
    number = (api(
      "GET",
      `/repos/${repo}/pulls?state=open&head=${repo.split("/")[0]}:${encodeURIComponent(branch)}`,
    ).json ?? [])[0]?.number;
    if (!number) {
      console.error(`${NAME} land: no open PR for ${branch || "this head"}; pass its number`);
      return 2;
    }
  }
  const { scheme, tracker, problem } = trackerFor(root);
  const deps = {
    api,
    scheme,
    done: (/** @type {string} */ key, /** @type {string} */ url) =>
      tracker ? tracker.done(scheme.display(key), url) : Promise.reject(new Error(problem)),
    log: console.log,
    warn: console.error,
    gate: async (/** @type {string} */ dir) => (await gateRun({ cwd: dir })).code,
  };
  const apps = loadConfig(root).config.apps ?? {};
  const options = {
    root,
    repo,
    base: defaultBranch(root),
    number,
    manualOk: args.includes("--manual-ok"),
    gateApp: gateLogins(apps),
    reviewer: apps.review?.slug,
    owner: apps.owner,
    deps,
  };
  const dry = args.includes("--dry-run");
  const result = args.includes("--stack")
    ? await landStack({ ...options, dry })
    : await landOne({ ...options, dry });
  for (const p of result.problems ?? []) console.error(`${NAME} land: ${p}`);
  if ("waiting" in result && result.waiting)
    say("blocked", `${NAME} land: required checks still running; land again once green`);
  else if ("queued" in result && result.queued)
    say(
      "approved",
      `${NAME} land: approval requested; GitHub merges it when every required check passes`,
    );
  else if (result.code === 0 || result.code === 3)
    say(dry ? "approved" : "shipped", `${NAME} land: ${dry ? "ready to land" : "landed"}`);
  else say("blocked", `${NAME} land: not landed`);
  return result.code;
}
