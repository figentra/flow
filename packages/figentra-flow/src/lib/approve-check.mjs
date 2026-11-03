#!/usr/bin/env node
/**
 * Figentra Flow file contract:
 * Purpose: the approval workflow's check and approval (STA-1856 FR-4), run from the pinned package so it is tested here.
 *   It refuses unless:
 *   - the run is on the default branch;
 *   - its environment allows that branch only;
 *   - the PR is open and not a draft;
 *   - the PR's head is in the repository and is the `head` the caller checked;
 *   - the author is not the approving App;
 *   - nothing between the merge base and that head is owner-only (paths, a rename's old path, root scripts, a
 *     dependency moved off its catalog);
 *   - every required check on that head is green from its trusted source, with one success, or it adds no new failure
 *     against the default branch's recorded baseline (STA-1945 FR-22): a required check that fails on the head and,
 *     from its trusted source, on the baseline's commit too is not new, while the `Baseline` check, which the ruleset
 *     must then require, is green on the head and never tolerated itself (it compares each task with the baseline,
 *     a newly reached failure excepted). Without a baseline every required check must be green, as before;
 *   - the base's ruleset requires the code owner's review and the base holds `.github/CODEOWNERS`, so GitHub itself
 *     asks the owner for owner-only paths.
 *   Everything is read at that SHA, so a later push cannot change what was checked. After approving it re-reads the
 *   PR and dismisses its own review if the head moved. If GitHub refuses the dismissal, the same App requests changes
 *   (which replaces its approval), turns auto-merge off, and comments what each step did. A refusal is one PR comment.
 * Boundary: GitHub REST only: reads with the job's token, the review and the comment with the App's token. It never
 *   checks out or runs the PR's code and never merges.
 * Runtime: node (GitHub Actions)
 * Governing contract: STA-1856 FR-4 (the security review of 2026-11-01); STA-1945 FR-22.
 * Secrets: `GITHUB_TOKEN` and `APP_TOKEN` from the environment; never printed.
 */
import { basename } from "node:path";
import { pathToFileURL } from "node:url";

import { findBaseline } from "./baseline.mjs";
import { ownerOnlyPaths, packageFindings } from "./owner-only.mjs";
import { BASELINE_CHECK } from "./product.mjs";
import { requiredCheckState, requiredContexts } from "./required-checks.mjs";

/** GitHub lists at most this many files in a comparison; at the limit the owner reviews it. */
const MAX_FILES = 300;

/**
 * @typedef {(method: string, path: string, body?: unknown) => Promise<{ ok: boolean, status: number, json: any }>} Rest
 */

/** A path's segments URL-encoded. */
const encodePath = (/** @type {string} */ p) => p.split("/").map(encodeURIComponent).join("/");

/**
 * A file's text at `ref`, or undefined.
 * @param {Rest} api
 * @param {string} repo
 * @param {string} path
 * @param {string} ref
 */
async function textAt(api, repo, path, ref) {
  const r = await api("GET", `/repos/${repo}/contents/${encodePath(path)}?ref=${ref}`);
  return r.ok && typeof r.json?.content === "string"
    ? Buffer.from(r.json.content, "base64").toString("utf8")
    : undefined;
}

/**
 * Every reason not to approve, and the head it checked.
 * @param {{ api: Rest, repo: string, number: number, expectedHead: string, approver: string, ref: string,
 *           environment: string, trusted?: Record<string, string>, extraOwnerOnly?: string[] }} input
 * @returns {Promise<{ refuse: string[], sha?: string, nodeId?: string,
 *                     baseline?: { sha: string, tolerated: string[] } }>} `baseline`: what the failures were compared
 *   against, and the required checks failing there too
 */
export async function decide({
  api,
  repo,
  number,
  expectedHead,
  approver,
  ref,
  environment,
  trusted = {},
  extraOwnerOnly = [],
}) {
  /** @type {string[]} */
  const refuse = [];
  if (!/^[0-9a-f]{40}$/.test(expectedHead)) refuse.push("`head` is not a 40-hex SHA");

  // The App's key is safe only while its environment admits the default branch alone.
  const main = (await api("GET", `/repos/${repo}`)).json?.default_branch;
  if (!main || ref !== `refs/heads/${main}`)
    refuse.push(`the workflow runs on ${ref}, not the default branch ${main ?? "(unknown)"}`);
  const policy = (await api("GET", `/repos/${repo}/environments/${environment}`)).json
    ?.deployment_branch_policy;
  const names = policy?.custom_branch_policies
    ? (
        (await api("GET", `/repos/${repo}/environments/${environment}/deployment-branch-policies`))
          .json?.branch_policies ?? []
      ).map((/** @type {any} */ b) => `${b.type ?? "branch"}:${b.name}`)
    : [];
  if (names.length !== 1 || names[0] !== `branch:${main}`)
    refuse.push(
      `the ${environment} environment must allow the default branch only (deployment branches: selected, \`${main}\`)`,
    );

  const pr = await api("GET", `/repos/${repo}/pulls/${number}`);
  if (!pr.ok) return { refuse: [...refuse, `PR #${number} cannot be read (HTTP ${pr.status})`] };
  const p = pr.json;
  const sha = p.head?.sha;
  if (p.state !== "open") refuse.push("the PR is not open");
  if (p.draft) refuse.push("the PR is a draft");
  if (p.head?.repo?.full_name !== repo) refuse.push(`the head is not in ${repo}`);
  if (sha !== expectedHead)
    refuse.push(`the head is ${sha}, not the ${expectedHead} that was checked`);
  if (p.user?.login === approver) refuse.push(`the author is ${approver}, the approving App`);
  if (refuse.length) return { refuse, sha };

  // Files at exactly this head, from the merge base.
  const cmp = await api("GET", `/repos/${repo}/compare/${p.base.sha}...${sha}`);
  const files = Array.isArray(cmp.json?.files) ? cmp.json.files : undefined;
  if (!files) refuse.push(`the comparison with ${p.base.ref} cannot be read`);
  else if (files.length >= MAX_FILES)
    refuse.push(`${files.length} files changed, at GitHub's listing limit: the owner reviews it`);
  else {
    const paths = files.flatMap((/** @type {any} */ f) =>
      [f.filename, f.previous_filename].filter(Boolean),
    );
    // A newline or other control character could split a path in a log line or a later tool.
    const control = (/** @type {string} */ x) =>
      [...x].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
    if (paths.some(control)) refuse.push("a changed path holds a control character");
    const owned = ownerOnlyPaths(paths, extraOwnerOnly);
    if (owned.length) refuse.push(`owner-only paths: ${owned.slice(0, 20).join(", ")}`);
    const base = cmp.json.merge_base_commit?.sha;
    for (const f of files.filter(
      (/** @type {any} */ x) => basename(x.filename) === "package.json",
    )) {
      // A side that should exist but cannot be read refuses; it never counts as added or removed.
      const before =
        f.status === "added"
          ? undefined
          : await textAt(api, repo, f.previous_filename ?? f.filename, base);
      const after = f.status === "removed" ? undefined : await textAt(api, repo, f.filename, sha);
      if (f.status !== "added" && before === undefined)
        refuse.push(`${f.previous_filename ?? f.filename} cannot be read at the merge base`);
      else if (f.status !== "removed" && after === undefined)
        refuse.push(`${f.filename} cannot be read at the head`);
      else refuse.push(...packageFindings(f.filename, before, after));
    }
  }

  // Required checks on exactly this head, from their trusted sources.
  const rules = (
    await api("GET", `/repos/${repo}/rules/branches/${encodeURIComponent(p.base.ref)}`)
  ).json;
  const ruleList = Array.isArray(rules) ? rules : [];
  // GitHub itself must ask the owner for owner-only paths; this check is defence in depth.
  if (
    !ruleList.some(
      (/** @type {any} */ r) =>
        r?.type === "pull_request" && r.parameters?.require_code_owner_review === true,
    )
  )
    refuse.push(`${p.base.ref}'s ruleset does not require the code owner's review`);
  if ((await textAt(api, repo, ".github/CODEOWNERS", p.base.sha)) === undefined)
    refuse.push(`${p.base.ref} has no .github/CODEOWNERS (\`fflow sync\` writes it)`);
  const required = requiredContexts(ruleList);
  /** @type {{ sha: string, tolerated: string[] } | undefined} */
  let baseline;
  if (!required.length) refuse.push(`${p.base.ref} requires no status check`);
  else {
    const at = async (/** @type {string} */ commit, contexts = required) =>
      requiredCheckState({
        required: contexts,
        statuses:
          (await api("GET", `/repos/${repo}/commits/${commit}/statuses?per_page=100`)).json ?? [],
        checkRuns:
          (await api("GET", `/repos/${repo}/commits/${commit}/check-runs?per_page=100`)).json
            ?.check_runs ?? [],
        trusted,
      });
    const state = await at(sha);
    let failed = state.failed;
    // STA-1945 FR-22: on a red default branch, a check failing on its recorded baseline too is not a new failure.
    if (failed.length) {
      const found = await findBaseline({ api, repo, base: p.base.sha });
      const gate = required.filter((r) => r.context === BASELINE_CHECK);
      if ("searched" in found)
        refuse.push(
          `no baseline at ${p.base.sha} or its ${found.searched.length - 1} nearest ancestors, so every required check must be green`,
        );
      // Only the per-task comparison shows the failures are the same ones; a skipped Baseline compared nothing.
      else if (!gate.length || (await at(sha, gate)).succeeded !== 1)
        refuse.push(
          `a failure is tolerated only beside a green \`${BASELINE_CHECK}\` check, which ${p.base.ref}'s ruleset must require`,
        );
      else {
        // Baseline itself is green here, so a red Baseline run on main never excuses one on the head.
        const before = (await at(found.sha)).failed;
        const tolerated = failed.filter((c) => before.includes(c));
        failed = failed.filter((c) => !tolerated.includes(c));
        baseline = { sha: found.sha, tolerated };
      }
    }
    if (state.pending.length)
      refuse.push(`required checks still running: ${state.pending.join(", ")}`);
    if (failed.length)
      refuse.push(
        `required checks failed${baseline ? ` that do not fail on the baseline at ${baseline.sha}` : ""}: ${failed.join(", ")}`,
      );
    refuse.push(...state.untrusted);
    if (!state.pending.length && !failed.length && !state.untrusted.length && !state.succeeded)
      refuse.push("no required check succeeded (all were skipped)");
  }
  return { refuse, sha, nodeId: p.node_id, baseline };
}

/** Turns auto-merge off on the PR with node `id`. */
const AUTO_MERGE_OFF = `mutation($id: ID!) {
  disablePullRequestAutoMerge(input: { pullRequestId: $id }) { clientMutationId }
}`;

/**
 * GitHub REST with `token`.
 * @param {string} token
 * @param {string} [base]
 * @returns {Rest}
 */
export const rest =
  (token, base = "https://api.github.com") =>
  async (method, path, body) => {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { ok: r.ok, status: r.status, json: await r.json().catch(() => undefined) };
  };

/**
 * Checks, then approves at the checked head or comments why not.
 * @param {Record<string, string | undefined>} env
 * @param {{ read?: Rest, write?: Rest, log?: (s: string) => void }} [deps]
 * @returns {Promise<number>} 0 approved, 1 refused
 */
export async function main(env, deps = {}) {
  const base = env.GITHUB_API_URL;
  const read = deps.read ?? rest(String(env.GITHUB_TOKEN), base);
  const write = deps.write ?? rest(String(env.APP_TOKEN), base);
  const log = deps.log ?? console.log;
  const repo = String(env.REPO);
  const number = Number(env.PR);
  const run = String(env.RUN_URL ?? "");
  const { refuse, sha, nodeId, baseline } = await decide({
    api: read,
    repo,
    number,
    expectedHead: String(env.EXPECTED_HEAD ?? ""),
    approver: String(env.APPROVER),
    ref: String(env.GITHUB_REF),
    environment: String(env.ENVIRONMENT),
    trusted: JSON.parse(env.TRUSTED || "{}"),
    extraOwnerOnly: JSON.parse(env.OWNER_ONLY_EXTRA || "[]"),
  });
  if (refuse.length) {
    await write("POST", `/repos/${repo}/issues/${number}/comments`, {
      body: `Approval refused ([run](${run})):\n\n${refuse.map((r) => `- ${r}`).join("\n")}\n`,
    });
    for (const r of refuse) log(`::error::${r}`);
    return 1;
  }
  const review = await write("POST", `/repos/${repo}/pulls/${number}/reviews`, {
    commit_id: sha,
    event: "APPROVE",
    body: baseline
      ? `Approved at ${sha}: no owner-only change, and no new failure against the default branch's baseline at ` +
        `${baseline.sha}. Tolerated, as they fail there too: ${baseline.tolerated.map((c) => `\`${c}\``).join(", ")}. ` +
        `\`${BASELINE_CHECK}\` compared each task; its summary lists the pre-existing and newly reached ones ([run](${run})).`
      : `Approved at ${sha}: no owner-only change, every required check green from its source ([run](${run})).`,
  });
  if (!review.ok) {
    log(`::error::the review was refused (HTTP ${review.status})`);
    return 1;
  }
  // A push between the check and the review: take the approval back.
  const now = (await read("GET", `/repos/${repo}/pulls/${number}`)).json?.head?.sha;
  if (now !== sha) {
    const id = review.json?.id;
    const dismissal =
      id === undefined
        ? undefined
        : await write("PUT", `/repos/${repo}/pulls/${number}/reviews/${id}/dismissals`, {
            message: `The head moved to ${now} after ${sha} was checked.`,
            event: "DISMISS",
          });
    if (dismissal?.ok) {
      log(`::error::the head moved to ${now} after ${sha} was checked; the approval was dismissed`);
      return 1;
    }
    // The approval may stand on a head nobody checked. The same App's newer review replaces it (pull-requests:
    // write is enough); auto-merge off is a second guard. The comment says what each step did.
    const blocked = await write("POST", `/repos/${repo}/pulls/${number}/reviews`, {
      event: "REQUEST_CHANGES",
      body: `The head moved to ${now} after ${sha} was checked; this replaces the approval ([run](${run})).`,
    });
    const off = await write("POST", "/graphql", {
      query: AUTO_MERGE_OFF,
      variables: { id: nodeId },
    });
    const offError = off.ok
      ? off.json?.errors?.map((/** @type {any} */ e) => e.message).join("; ")
      : `HTTP ${off.status}`;
    const lines = [
      `The head moved to ${now} after ${sha} was checked.`,
      `- Dismissing the approval failed (${id === undefined ? "no review id" : `HTTP ${dismissal?.status}`}).`,
      blocked.ok
        ? "- This App now requests changes, which replaces its approval."
        : `- Requesting changes failed too (HTTP ${blocked.status}): the approval may still stand. Dismiss it by hand before anyone merges.`,
      offError ? `- Turning auto-merge off failed: ${offError}.` : "- Auto-merge is off.",
      `([run](${run}))`,
    ];
    await write("POST", `/repos/${repo}/issues/${number}/comments`, { body: lines.join("\n") });
    log(`::error::${lines.slice(0, -1).join(" ")}`);
    return 1;
  }
  log(`Approved ${repo}#${number} at ${sha}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = await main(process.env);
