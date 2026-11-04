#!/usr/bin/env node
/**
 * Figentra Flow file contract:
 * Purpose: the `merge` job of main's approval workflow, the serial merge lane of ADR 0523 decision 3 (the L2 design,
 *   PR D). It sweeps the land requests (`select`) in PR-number order and squash-merges each one at its head when:
 *   - the request is valid (`requestProblems`), there is no `HOLD_LABEL` and the automation variable is `on` or
 *     `merge-only`;
 *   - `decide` finds nothing against it but owner-only changes (open, not a draft, head in this repository, required
 *     checks green from their trusted sources, the environment and ref);
 *   - GitHub's `mergeable_state` is `clean`, `unstable` or `has_hooks` (`unknown` waits for the next sweep);
 *   - either the Flow App's newest review is APPROVED at the head and nothing is owner-only (the Flow path), or the
 *     owner's (`OWNER`, a User) newest review is APPROVED at the head (the owner path).
 *   The merge sends `sha`, the title with `(#n)` and `squashMessage` (the key from the default branch's configuration,
 *   read through the contents API, and the AI review's verdict as a record). A 405 or 409 on a PR that is merged
 *   counts as merged; otherwise the sticky comment says `waiting` with GitHub's message and the label stays. On a
 *   merge it removes the label and the sticky comment says `merged as <sha>`.
 * Boundary: reads with the job's token; writes with a token `app-token.mjs` mints for each PR it merges: `merge`, or
 *   `merge-workflows` only on the owner path for a PR that touches `.github/workflows/**` or `.github/actions/**`.
 *   Never checks out or runs the PR's code, never uses auto-merge. Exits 1 only on an infrastructure error.
 * Runtime: node (GitHub Actions)
 * Governing contract: ADR 0523 (decision 3); the L2 design (merge, PR D); STA-1945.
 * Secrets: `GITHUB_TOKEN` from the environment; the Flow App token is minted in process and revoked; neither is
 *   printed.
 */
import { pathToFileURL } from "node:url";

import { withToken } from "./app-token.mjs";
import {
  ApiError,
  decide,
  get,
  keyAt,
  pages,
  requestProblems,
  rest,
  select,
  stickyBody,
  upsertSticky,
} from "./approve-check.mjs";
import { squashMessage } from "./land-rules.mjs";
import {
  AUTOMATION_RUNS,
  AUTOMATION_VARIABLE,
  HOLD_LABEL,
  LAND_LABEL,
  STATUS_CONTEXT,
} from "./product.mjs";
import { aiReview } from "./review.mjs";

/** @typedef {import("./approve-check.mjs").Rest} Rest */

/** The `mergeable_state`s GitHub merges from; `unknown` is still being computed. */
const MERGEABLE = ["clean", "unstable", "has_hooks"];

/** Whether `path` is a workflow or an action, which only a `workflows: write` token may change. */
const workflowPath = (/** @type {string} */ path) =>
  /^\.github\/(?:workflows|actions)\//i.test(path);

/**
 * Whether the newest verdict (a comment is not one) among `reviews` by `who` is an approval at `sha`.
 * @param {any[]} reviews
 * @param {(r: any) => boolean} who
 * @param {string} sha
 */
const approvedAt = (reviews, who, sha) => {
  const last = reviews.filter((r) => who(r) && r.state !== "COMMENTED").at(-1);
  return last?.state === "APPROVED" && last.commit_id === sha;
};

/**
 * Merges PR `number` if every rule allows it now, or says why not.
 * @param {{ read: Rest, write: (token: string) => Rest, mintToken: typeof withToken, env: Record<string, string |
 *           undefined>, repo: string, number: number, defaultBranch: string, flow: string[], owner?: string,
 *           requesters: string[], reviewers: string[], trusted: any, extraOwnerOnly: string[] }} c
 * @returns {Promise<{ merged: string } | { skip: string }>}
 */
export async function mergeOne(c) {
  const { read, repo, number, flow, owner } = c;
  const requested = await requestProblems(read, repo, number, c.requesters, flow);
  if (requested.length) return { skip: requested.join("; ") };
  // Read now, not at the sweep's start: an earlier merge changes this PR's mergeable_state.
  const pr = await get(read, `/repos/${repo}/pulls/${number}`);
  const labels = (pr.labels ?? []).map((/** @type {any} */ l) => l.name);
  if (!labels.includes(LAND_LABEL) || labels.includes(HOLD_LABEL))
    return { skip: `the PR has ${labels.includes(HOLD_LABEL) ? HOLD_LABEL : `no ${LAND_LABEL}`}` };
  const sha = String(pr.head?.sha ?? "");
  if (!MERGEABLE.includes(pr.mergeable_state))
    return { skip: `mergeable_state is ${pr.mergeable_state ?? "unknown"}` };
  const d = await decide({
    api: read,
    repo,
    number,
    expectedHead: sha,
    approver: flow,
    ref: String(c.env.GITHUB_REF),
    environment: String(c.env.ENVIRONMENT),
    trusted: c.trusted,
    extraOwnerOnly: c.extraOwnerOnly,
  });
  const ownerOnly = d.owner ?? [];
  const other = d.refuse.filter((r) => !ownerOnly.includes(r));
  if (other.length) return { skip: other.join("; ") };
  const reviews = await pages(read, `/repos/${repo}/pulls/${number}/reviews`);
  const byFlow = !ownerOnly.length && approvedAt(reviews, (r) => flow.includes(r.user?.login), sha);
  const byOwner =
    owner !== undefined &&
    approvedAt(reviews, (r) => r.user?.login === owner && r.user?.type === "User", sha);
  if (!byFlow && !byOwner)
    return {
      skip: ownerOnly.length
        ? `owner-only, and the owner has not approved ${sha}`
        : `no approval at ${sha}`,
    };
  // Only the owner path reaches here with a workflow change: decide counts every workflow path as owner-only.
  const role = (d.paths ?? []).some(workflowPath) ? "merge-workflows" : "merge";
  const commits = await pages(read, `/repos/${repo}/pulls/${number}/commits`);
  const commit = await get(read, `/repos/${repo}/commits/${sha}`);
  const review = aiReview(
    { sha, base: pr.base.ref },
    await pages(read, `/repos/${repo}/issues/${number}/comments`),
    reviews,
    [pr.user?.login, commit.author?.login, commit.committer?.login],
    { reviewer: c.reviewers, owner },
  );
  const key = await keyAt(read, repo, pr.head.ref, c.defaultBranch);
  return c.mintToken(
    role,
    { oidc: JSON.parse(c.env.OIDC || "null"), defaultBranch: c.defaultBranch, env: c.env },
    async (token) => {
      const w = c.write(token);
      const sticky = (/** @type {"merged" | "waiting"} */ state, /** @type {string[]} */ why) =>
        upsertSticky({
          read,
          write: async () => w,
          repo,
          number,
          body: stickyBody(sha, state, why),
          flow,
        });
      const merge = await w("PUT", `/repos/${repo}/pulls/${number}/merge`, {
        merge_method: "squash",
        sha,
        commit_title: `${pr.title} (#${number})`,
        commit_message: squashMessage(key, commits, { verdict: review.verdict, sha }),
      });
      if (merge.ok) {
        const merged = String(merge.json?.sha ?? "");
        await w(
          "DELETE",
          `/repos/${repo}/issues/${number}/labels/${encodeURIComponent(LAND_LABEL)}`,
        );
        await sticky("merged", [`merged as ${merged}`]);
        return { merged };
      }
      if (merge.status !== 405 && merge.status !== 409)
        throw new ApiError(`PUT /repos/${repo}/pulls/${number}/merge answered ${merge.status}`);
      const now = await get(read, `/repos/${repo}/pulls/${number}`);
      if (now.merged) return { merged: String(now.merge_commit_sha ?? "") };
      const message = String(merge.json?.message ?? `HTTP ${merge.status}`);
      await sticky("waiting", [`GitHub did not merge it: ${message}`]);
      return { skip: message };
    },
  );
}

/**
 * Merges every land request that may merge now, in PR-number order.
 * @param {Record<string, string | undefined>} env
 * @param {{ read?: Rest, write?: (token: string) => Rest, withToken?: typeof withToken,
 *           log?: (s: string) => void }} [deps]
 * @returns {Promise<number>} 0 swept, 1 an infrastructure error on some PR
 */
export async function main(env, deps = {}) {
  const log = deps.log ?? console.log;
  const automation = env.AUTOMATION ?? "";
  if (!AUTOMATION_RUNS.includes(automation)) {
    log(`::notice::${AUTOMATION_VARIABLE} is ${JSON.stringify(automation)}: automation is frozen`);
    return 0;
  }
  const base = env.GITHUB_API_URL;
  const read = deps.read ?? rest(String(env.GITHUB_TOKEN), base);
  const repo = String(env.REPO);
  const defaultBranch = String(env.DEFAULT_BRANCH);
  let trusted;
  try {
    trusted = JSON.parse(env.TRUSTED || "{}");
  } catch {
    trusted = null;
  }
  const context = {
    read,
    write: deps.write ?? ((/** @type {string} */ t) => rest(t, base)),
    mintToken: deps.withToken ?? withToken,
    env,
    repo,
    defaultBranch,
    flow: /** @type {string[]} */ ([trusted?.[STATUS_CONTEXT] ?? []].flat().filter(Boolean)),
    owner: env.OWNER || undefined,
    requesters: JSON.parse(env.REQUESTERS || "[]"),
    reviewers: JSON.parse(env.REVIEWERS || "[]"),
    trusted,
    extraOwnerOnly: JSON.parse(env.OWNER_ONLY_EXTRA || "[]"),
  };
  let failed = false;
  try {
    for (const pr of await select(read, repo, defaultBranch)) {
      try {
        const r = await mergeOne({ ...context, number: pr.number });
        log("merged" in r ? `#${pr.number} merged as ${r.merged}` : `#${pr.number}: ${r.skip}`);
      } catch (error) {
        failed = true;
        log(`::error::#${pr.number}: ${/** @type {Error} */ (error).message}`);
      }
    }
  } catch (error) {
    log(`::error::${/** @type {Error} */ (error).message}`);
    return 1;
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = await main(process.env);
