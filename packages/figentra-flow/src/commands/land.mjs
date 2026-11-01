/**
 * Figentra Flow file contract:
 * Purpose: `figentra-flow land [<pr>] [--stack] [--dry-run] [--manual-ok]`, the lander's checklist as code: squash-merge a PR
 *   only when it is open, clean, based on the default branch, green on `figentra-flow/gate` from the gate App on its exact
 *   head, conventionally titled, its spec's approvals are recorded and it changes no owner-only path; then set Linear
 *   Done, record the merge commit, remove the worktree through `clean`'s rules, delete the branch and comment. When the
 *   base's ruleset requires an approving review the head lacks, it dispatches the approval workflow and turns on
 *   auto-merge at the head instead, never an admin path; `land` on a merged PR runs the steps after the merge
 *   (STA-1856). `--stack` lands a stack bottom-up.
 * Boundary: every rule is read from GitHub's live state and the spec at the PR's head; nothing changes until all
 *   pass. The merge carries `sha`, so GitHub refuses it if the head moved. Waiting on required checks exits 4. Steps
 *   after the merge only warn (exit 3)
 *   and never undo it. A stack is brought up to date by a merge commit and a normal push, never a rewrite.
 * Runtime: node
 * Governing contract: Stackra ADR 0503 (decision 5), ADR 0502; STA-1729 phase 3 (the leader's plan stop of
 *   2026-10-31); STA-1856 (FR-1 to FR-3).
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
import { loadConfig } from "../lib/config.mjs";
import { ownerOnlyPaths, packageFindings } from "../lib/owner-only.mjs";
import { requiredCheckState, requiredContexts } from "../lib/required-checks.mjs";
import { APPROVE_WORKFLOW, LANDED_KEY, NAME, STATUS_CONTEXT } from "../lib/product.mjs";
import { defaultBranch, fetch, git, mainCheckout, remote, worktrees } from "../lib/git.mjs";

/** The tiers whose changes need the AI review when the configuration's `review.required` names none. */
export const REVIEW_TIERS = ["small", "feature", "big"];

/** A conventional commit header (the squash commit's title). */
export const CONVENTIONAL =
  /^(?:build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(?:\([\w./-]+\))?!?: \S/;

/**
 * Why `statuses` (a commit's, newest first) do not make that commit green: `figentra-flow/gate` must be `success`,
 * posted by the configured gate App. Shared by `land` and `train`.
 * @param {any[]} statuses
 * @param {string | undefined} sha  the commit, for the message
 * @param {string | undefined} gateApp
 * @returns {string[]}
 */
export function gateProblems(statuses, sha, gateApp) {
  const problems = [];
  // The trusted gate status creator comes only from the configuration (defence in depth; the ruleset is the
  // guarantee).
  if (!gateApp)
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
  else if (gate.creator?.login !== gateApp)
    problems.push(
      `${STATUS_CONTEXT} on the head was posted by ${gate.creator?.login ?? "nobody"}, not ${gateApp}`,
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
 * @param {{ pr: any, statuses: any[], base: string, spec?: string, gateApp?: string, reviewer?: string,
 *           required: boolean, files?: string[],
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
 *           gateApp?: string, reviewer?: string, owner?: string, deps: LandDeps }} options
 * @returns {Promise<{ code: number, problems?: string[], merged?: string, queued?: boolean,
 *   waiting?: string[] }>}
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
  deps,
}) {
  const { api, log } = deps;
  const pr = api("GET", `/repos/${repo}/pulls/${number}`);
  if (!pr.ok) return { code: 2, problems: [`PR #${number}: ${pr.err}`] };
  const head = pr.json.head.sha;
  const branch = pr.json.head.ref;
  const scheme = deps.scheme ?? trackerFor(root, { warn: () => {} }).scheme;
  const key = scheme.parse(branch);
  // STA-1856 FR-3: an auto-merged PR comes back here to finish.
  if (pr.json.merged && pr.json.merge_commit_sha) {
    if (pr.json.base?.ref !== base)
      return { code: 1, problems: [`#${number} merged into ${pr.json.base?.ref}, not ${base}`] };
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
    ownerOnly: config.approve?.ownerOnly,
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
        body: squashMessage(key, commits),
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
    commit_message: squashMessage(key, commits),
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
 * @returns {Promise<{ code: number, merged: string }>}
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
  return { code: warned ? 3 : 0, merged: sha };
}

/**
 * Lands the stack under `number` bottom-up: each next PR is updated by merging the default branch, pushed, gated
 * and landed in turn. Stops at the first that cannot go, naming it.
 * @param {{ root: string, repo: string, base: string, number: number, manualOk?: boolean, gateApp?: string,
 *           reviewer?: string, owner?: string, deps: LandDeps & { gate: (cwd: string) => Promise<number> } }} options
 */
export async function landStack({
  root,
  repo,
  base,
  number,
  manualOk = false,
  gateApp,
  reviewer,
  owner,
  deps,
}) {
  const { api, log } = deps;
  const org = repo.split("/")[0];
  /** @type {any[]} */
  const chain = [];
  let cur = api("GET", `/repos/${repo}/pulls/${number}`).json;
  while (cur) {
    chain.unshift(cur);
    if (cur.base.ref === base) break;
    cur = (api(
      "GET",
      `/repos/${repo}/pulls?state=open&head=${org}:${encodeURIComponent(cur.base.ref)}`,
    ).json ?? [])[0];
    if (!cur)
      return {
        code: 1,
        problems: [
          `#${chain[0].number} is stacked on \`${chain[0].base.ref}\`, which has no open PR`,
        ],
      };
  }
  for (const [i, pr] of chain.entries()) {
    if (i > 0) {
      const tree = worktrees(root).find((t) => t.branch === pr.head.ref);
      if (!tree)
        return {
          code: 1,
          problems: [
            `#${pr.number} (${pr.head.ref}) has no local worktree to update; \`${NAME} start\` one, then land again`,
          ],
        };
      fetch(root);
      const merged = git(tree.path, ["merge", "--no-edit", "-q", `origin/${base}`]);
      if (!merged.ok) {
        // A conflict leaves unmerged paths; anything else (no git identity, a hook) is reported as git said it.
        const conflicted = git(tree.path, ["diff", "--name-only", "--diff-filter=U"]).out !== "";
        git(tree.path, ["merge", "--abort"]);
        return {
          code: 1,
          problems: [
            conflicted
              ? `#${pr.number}: merging ${base} into ${pr.head.ref} conflicts; resolve it there, then land again`
              : `#${pr.number}: merging ${base} into ${pr.head.ref} failed: ${merged.err || "git merge exited non-zero"}`,
          ],
        };
      }
      const pushed = remote(tree.path, ["push", "-q", "origin", "HEAD"]);
      if (!pushed.ok) return { code: 1, problems: [`#${pr.number}: push failed: ${pushed.err}`] };
      // GitHub retargets a PR whose base branch was deleted; set it ourselves if that has not happened yet.
      if (api("GET", `/repos/${repo}/pulls/${pr.number}`).json?.base?.ref !== base)
        api("PATCH", `/repos/${repo}/pulls/${pr.number}`, { base });
      const gate = await deps.gate(tree.path);
      if (gate !== 0)
        return {
          code: 1,
          problems: [`#${pr.number}: ${NAME} gate run exited ${gate}; the stack stops here`],
        };
    }
    const result = await landOne({
      root,
      repo,
      base,
      number: pr.number,
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
      return { code: result.code, ...(result.waiting ? { waiting: result.waiting } : {}) };
    }
    log(`${NAME} land --stack: ${i + 1}/${chain.length} landed`);
  }
  return { code: 0 };
}

/** `figentra-flow land [<pr>] [--stack] [--dry-run] [--manual-ok]`. */
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
    gateApp: apps.gate?.login,
    reviewer: apps.review?.slug,
    owner: apps.owner,
    deps,
  };
  const result = args.includes("--stack")
    ? await landStack(options)
    : await landOne({ ...options, dry: args.includes("--dry-run") });
  for (const p of result.problems ?? []) console.error(`${NAME} land: ${p}`);
  const dry = args.includes("--dry-run") && !args.includes("--stack");
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
