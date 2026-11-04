/**
 * Figentra Flow file contract:
 * Purpose: the land rules, pure, so `fflow land` and main's approve job run the same ones (ADR 0523, L2 PR C):
 *   `landRules` lists every reason a PR may not land (state, draft, conflict, base, `fflow/gate` from a gate login on
 *   the exact head, a conventional title, the spec's approvals and tier, owner-only paths and findings, a confirmed
 *   blocking finding of Flow's own review (STA-1945 AC-40), the ruleset before phase 6, and the caller's artifact
 *   problems). The AI review is advisory (ADR 0523 decision 6, owner 2026-11-04): `reviewWarnings` names a missing,
 *   stale or FAIL verdict and `squashMessage` records the verdict as an `AI-Review:` line, but neither ever refuses.
 *   `gateProblems` is shared with `train`; `specAt` reads the spec at the head through the contents API, as data.
 * Boundary: pure but for `specAt`, which only reads through the given API. Imports nothing from `commands/`.
 * Runtime: node
 * Governing contract: Stackra ADR 0503 (decision 5), ADR 0502, ADR 0230; ADR 0523 (decision 6); STA-1729 phase 3
 *   (AC-031); STA-1856 FR-1; STA-1945 (FR-5, AC-40).
 * Secrets: none.
 */
import { ownerOnlyPaths } from "./owner-only.mjs";
import { NAME, STATUS_CONTEXT } from "./product.mjs";
import { checkApproval, statusOf, tierOf } from "./spec-status.mjs";

/** The tiers whose changes get the AI review when the configuration's `review.required` names none. */
export const REVIEW_TIERS = ["small", "feature", "big"];

/** A conventional commit header (the squash commit's title). */
export const CONVENTIONAL =
  /^(?:build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(?:\([\w./-]+\))?!?: \S/;

/** At this many changed files the approval check refuses, so `land` does too: the owner reviews it. */
export const MAX_FILES = 300;

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
 * What `landRules` and `reviewWarnings` read. `blocking`: the review workflow's confirmed blocking findings
 * (`blockingFindings`); `review` and `reviewer`: the AI review's counted verdict and the reviewer App slugs, which
 * only `reviewWarnings` reads.
 * @typedef {{ pr: any, statuses: any[], base: string, spec?: string, gateApp?: string | string[],
 *             reviewer?: string | string[], required: boolean, files?: string[],
 *             manualOk?: boolean, stack?: boolean, review?: { verdict: string | null, ignored: string[] },
 *             artifacts?: string[], reviewTiers?: string[], ownerOnly?: string[],
 *             ownerFindings?: string[], blocking?: string[] }} LandInput
 */

/**
 * Every reason the PR may not land; empty means it may. The AI review is not among them (`reviewWarnings`).
 * @param {LandInput} input
 * @returns {string[]}
 */
export function landRules({
  pr,
  statuses,
  base,
  spec,
  gateApp,
  required,
  files = [],
  ownerOnly = [],
  ownerFindings = [],
  manualOk = false,
  stack = false,
  artifacts = [],
  blocking = [],
}) {
  const problems = [...artifacts];
  // AC-40: a confirmed blocking finding stops the PR until a new review clears it.
  for (const b of blocking)
    problems.push(
      `the review confirmed a blocking finding: ${b} (fix it, then review the new head: /flow-review)`,
    );
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

/**
 * What `land` warns about but never refuses on (ADR 0523 decision 6): a change whose spec's tier is in
 * `review.required` (default small, feature, big; a spec with no tier counts as small) without the AI review's PASS
 * on its exact head and base (ADR 0230, AC-031). Work with no spec is exempt.
 * @param {LandInput} input
 * @returns {string[]}
 */
export function reviewWarnings({ pr, spec, review, reviewer, reviewTiers = REVIEW_TIERS }) {
  if (spec === undefined || !reviewTiers.includes(tierOf(spec) ?? "small")) return [];
  if (review?.verdict === "PASS") return [];
  const by = [reviewer ?? []].flat().filter(Boolean).join(" or ");
  const ignored = review?.ignored.length
    ? `; ignored: ${[...new Set(review.ignored)].join("; ")}`
    : "";
  return [
    `advisory, not blocking (ADR 0523): no AI review PASS for ${pr.head?.sha} (counted verdict: ${review?.verdict ?? "none"}): a different agent posts "AI-REVIEW: PASS ${pr.head?.sha} base=${pr.base?.ref}" as the ${by || "(unconfigured, apps.review.slug)"} app${ignored}`,
  ];
}

/**
 * The squash commit's message: one `Refs:` line, the AI review's verdict on the landed head when given
 * (`AI-Review: PASS <sha>`, `AI-Review: FAIL <sha>` or `AI-Review: none`), and the co-author trailers of the PR's
 * commits.
 * @param {string | undefined} key
 * @param {any[]} commits
 * @param {{ verdict: string | null, sha: string }} [review]
 */
export function squashMessage(key, commits, review) {
  const coauthors = new Set();
  for (const c of commits)
    for (const line of String(c.commit?.message ?? "").split("\n"))
      if (/^Co-authored-by: /i.test(line.trim()))
        coauthors.add(line.trim().replace(/^co-authored-by/i, "Co-Authored-By"));
  return [
    ...(key ? [`Refs: ${key.toUpperCase()}`] : []),
    ...(review
      ? [`AI-Review: ${review.verdict ? `${review.verdict} ${review.sha}` : "none"}`]
      : []),
    ...coauthors,
  ].join("\n");
}

/** The spec text at `sha` for the branch's key, read through the API; undefined when there is none. */
export function specAt(
  /** @type {import("./github.mjs").Api} */ api,
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
