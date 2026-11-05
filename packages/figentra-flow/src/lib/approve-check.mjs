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
 *   - every required check on that head is green from its trusted source, with one success (`TRUSTED` maps a context
 *     to a login or a list of logins; any other shape, or text that is not JSON, refuses), or it adds no new failure
 *     against the default branch's recorded baseline (STA-1945 FR-22): a required check that fails on the head is
 *     excused only when the repository lists it in `approve.tolerate` (rendered as `TOLERATE`; empty by default, so
 *     nothing is), it concluded `failure`, from its trusted source, on the baseline's commit too, and the `Baseline`
 *     check, which the ruleset must then require, is green on the head (it compares each task with the baseline, a
 *     newly reached failure excepted). The tolerance is per check, so the list names only checks that run no more
 *     than Baseline's tasks; `Baseline` and `fflow/gate`, which runs the whole check command, are never excused, and
 *     a list naming either, or a `TOLERATE` that is not a list of names, refuses. Without a baseline every required
 *     check must be green, as before;
 *   - the base's ruleset requires the code owner's review and the base holds `.github/CODEOWNERS`, so GitHub itself
 *     asks the owner for owner-only paths.
 *   Everything is read at that SHA, so a later push cannot change what was checked. After approving it re-reads the
 *   PR and dismisses its own review if the head moved. If GitHub refuses the dismissal, the same App requests changes
 *   (which replaces its approval), turns auto-merge off, and comments what each step did.
 *   Dispatched (no `MODE`), it checks the one PR it is given, and a refusal is one PR comment. With `MODE=event`
 *   (main's event lane, the L2 design) it sweeps every open PR labelled `LAND_LABEL` (`select`): the label's newest
 *   adder must be a User with write or admin, or a Bot whose App slug `REQUESTERS` lists (`requestProblems`;
 *   `github-actions` and the Flow App never); then `decide` and the land rules (`landRules`, with `required`) run at
 *   that head. It approves at most once per head and keeps one sticky comment (first line `LAND_MARKER`) and the
 *   `LAND_CONTEXT` status, each rewritten only when it changes; `classify` names the state (waiting, owner, refused,
 *   approved).
 * Boundary: GitHub REST only: reads with the job's token; the review, the comment and the status with the App's token
 *   (dispatched: `APP_TOKEN`; event mode: an `approve` token `app-token.mjs` mints over OIDC, only once there is
 *   something to write, revoked at the end). It never checks out or runs the PR's code and never merges. Event mode
 *   posts nothing unless the automation variable is `on`, exits 0 on every refusal and 1 only on an infrastructure
 *   error.
 * Runtime: node (GitHub Actions)
 * Governing contract: STA-1856 FR-4 (the security review of 2026-11-01); ADR 0523; the L2 design (PR D); STA-1945 FR-22.
 * Secrets: `GITHUB_TOKEN` and `APP_TOKEN` from the environment, or the minted token in memory; never printed.
 */
import { appendFileSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";

import { keyScheme } from "../adapters/tracker/index.mjs";
import { mint } from "./app-token.mjs";
import { findBaseline } from "./baseline.mjs";
import { landRules, specAt } from "./land-rules.mjs";
import { ownerOnlyPaths, packageFindings } from "./owner-only.mjs";
import {
  AUTOMATION_VARIABLE,
  BASELINE_CHECK,
  CONFIG_FILE,
  HOLD_LABEL,
  LAND_COMMAND,
  LAND_CONTEXT,
  LAND_LABEL,
  LAND_MARKER,
  NAME,
  NEVER_TOLERATED,
  STATUS_CONTEXT,
} from "./product.mjs";
import { requiredCheckState, requiredContexts } from "./required-checks.mjs";
import { actor } from "./review.mjs";

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
export async function textAt(api, repo, path, ref) {
  const r = await api("GET", `/repos/${repo}/contents/${encodePath(path)}?ref=${ref}`);
  return r.ok && typeof r.json?.content === "string"
    ? Buffer.from(r.json.content, "base64").toString("utf8")
    : undefined;
}

/** Whether `t` maps each context to a login or a non-empty list of logins. */
const wellFormed = (/** @type {unknown} */ t) => {
  const login = (/** @type {unknown} */ x) => typeof x === "string" && x !== "";
  return (
    typeof t === "object" &&
    t !== null &&
    !Array.isArray(t) &&
    Object.values(t).every((v) => login(v) || (Array.isArray(v) && v.length > 0 && v.every(login)))
  );
};

/**
 * Every reason not to approve, and the head it checked. `owner` holds the reasons that only the owner's review clears
 * (owner-only paths and findings, a listing at GitHub's limit); each is in `refuse` too. `paths` are the changed paths.
 * @param {{ api: Rest, repo: string, number: number, expectedHead: string, approver: string | string[],
 *           ref: string, environment: string, trusted?: Record<string, string | string[]>,
 *           extraOwnerOnly?: string[], tolerate?: unknown }} input `approver`: the approving App's login, or each of its
 *   logins; `tolerate`: the parsed `TOLERATE`, anything but a list of names refuses
 * @returns {Promise<{ refuse: string[], sha?: string, nodeId?: string, owner?: string[], paths?: string[],
 *                     baseline?: { sha: string, tolerated: string[] } }>} `baseline`: what the failures were compared
 *   against, and the listed required checks failing there too
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
  tolerate = [],
}) {
  // Fail closed: a trusted source nobody can read trusts no one.
  if (!wellFormed(trusted))
    return { refuse: ["TRUSTED is not an object of context to a login or a list of logins"] };
  /** @type {string[]} */
  const refuse = [];
  if (!/^[0-9a-f]{40}$/.test(expectedHead)) refuse.push("`head` is not a 40-hex SHA");
  // Fail closed: a malformed list excuses nothing, and naming a never-excused check is a broken config.
  /** @type {string[]} */
  const listed =
    Array.isArray(tolerate) && tolerate.every((c) => typeof c === "string" && c !== "")
      ? tolerate
      : [];
  if (listed !== tolerate)
    refuse.push(
      `\`TOLERATE\` is not a JSON list of check names (\`${NAME} sync\` renders it from \`approve.tolerate\`)`,
    );
  const never = listed.filter((c) => NEVER_TOLERATED.includes(c));
  if (never.length)
    refuse.push(`\`approve.tolerate\` lists ${never.join(", ")}, which a red main never excuses`);
  const excusable = listed.filter((c) => !NEVER_TOLERATED.includes(c));

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
  if ([approver].flat().includes(p.user?.login))
    refuse.push(`the author is ${p.user.login}, the approving App`);
  if (refuse.length) return { refuse, sha };

  // Files at exactly this head, from the merge base.
  const cmp = await api("GET", `/repos/${repo}/compare/${p.base.sha}...${sha}`);
  const files = Array.isArray(cmp.json?.files) ? cmp.json.files : undefined;
  /** @type {string[]} */
  const owner = [];
  /** @type {string[]} */
  let paths = [];
  if (!files) refuse.push(`the comparison with ${p.base.ref} cannot be read`);
  else if (files.length >= MAX_FILES)
    owner.push(`${files.length} files changed, at GitHub's listing limit: the owner reviews it`);
  else {
    paths = files.flatMap((/** @type {any} */ f) =>
      [f.filename, f.previous_filename].filter(Boolean),
    );
    // A newline or other control character could split a path in a log line or a later tool.
    const control = (/** @type {string} */ x) =>
      [...x].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
    if (paths.some(control)) refuse.push("a changed path holds a control character");
    const owned = ownerOnlyPaths(paths, extraOwnerOnly);
    if (owned.length) owner.push(`owner-only paths: ${owned.slice(0, 20).join(", ")}`);
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
      else owner.push(...packageFindings(f.filename, before, after));
    }
  }
  refuse.push(...owner);

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
    // STA-1945 FR-22: on a red default branch, a listed check failing on its recorded baseline too is not a new failure.
    if (failed.some((c) => excusable.includes(c))) {
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
        // Baseline itself is green here, so a red Baseline run on main never excuses one on the head. Only a run that
        // concluded `failure` on main is a recorded failure: a cancelled or timed-out one shows nothing.
        const before = (await at(found.sha)).outright;
        const tolerated = failed.filter((c) => excusable.includes(c) && before.includes(c));
        failed = failed.filter((c) => !tolerated.includes(c));
        baseline = { sha: found.sha, tolerated };
      }
    }
    if (state.pending.length)
      refuse.push(`required checks still running: ${state.pending.join(", ")}`);
    if (failed.length)
      refuse.push(
        `required checks failed${baseline ? ` that \`approve.tolerate\` does not list or that do not fail on the baseline at ${baseline.sha}` : ""}: ${failed.join(", ")}`,
      );
    refuse.push(...state.untrusted);
    if (!state.pending.length && !failed.length && !state.untrusted.length && !state.succeeded)
      refuse.push("no required check succeeded (all were skipped)");
  }
  return { refuse, sha, nodeId: p.node_id, owner, paths, baseline };
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

/** `text` as JSON, or null (which `decide` refuses) when it is not JSON. */
const parsed = (/** @type {string} */ text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/**
 * Approves `sha` with `write`, then re-reads the PR and takes the approval back if the head moved. Undefined when the
 * approval stands; otherwise what happened, and whether it is worth a PR comment (dispatch mode posts one).
 * @param {{ read: Rest, write: Rest, repo: string, number: number, sha: string, nodeId?: string, run: string,
 *           body: string }} input
 * @returns {Promise<{ lines: string[], comment: boolean } | undefined>}
 */
/**
 * The parsed `TOLERATE`: text that is not JSON is `null`, not undefined (which would default to the empty list), so
 * `decide` refuses it.
 * @param {string | undefined} text
 * @returns {unknown}
 */
function parsedTolerate(text) {
  try {
    return JSON.parse(text || "[]");
  } catch {
    return null;
  }
}

/**
 * The approving review's body: every required check green, or (STA-1945 FR-22) no new failure against the baseline.
 * @param {string} sha
 * @param {string} run
 * @param {{ sha: string, tolerated: string[] } | undefined} baseline
 * @param {string} lead what else held, such as "no owner-only change"
 */
function approvedBody(sha, run, baseline, lead) {
  if (!baseline)
    return `Approved at ${sha}: ${lead}, every required check green from its source ([run](${run})).`;
  const listed = baseline.tolerated.map((c) => `\`${c}\``).join(", ");
  return (
    `Approved at ${sha}: ${lead}, and no new failure against the default branch's baseline at ${baseline.sha}. ` +
    `Tolerated, as \`approve.tolerate\` lists them and they fail there too: ${listed}. ` +
    `\`${BASELINE_CHECK}\` compared each task; its summary lists the pre-existing and newly reached ones ([run](${run})).`
  );
}

async function approveAt({ read, write, repo, number, sha, nodeId, run, body }) {
  const review = await write("POST", `/repos/${repo}/pulls/${number}/reviews`, {
    commit_id: sha,
    event: "APPROVE",
    body,
  });
  if (!review.ok)
    return { lines: [`the review was refused (HTTP ${review.status})`], comment: false };
  // A push between the check and the review: take the approval back.
  const now = (await read("GET", `/repos/${repo}/pulls/${number}`)).json?.head?.sha;
  if (now === sha) return undefined;
  const id = review.json?.id;
  const dismissal =
    id === undefined
      ? undefined
      : await write("PUT", `/repos/${repo}/pulls/${number}/reviews/${id}/dismissals`, {
          message: `The head moved to ${now} after ${sha} was checked.`,
          event: "DISMISS",
        });
  if (dismissal?.ok)
    return {
      lines: [`the head moved to ${now} after ${sha} was checked; the approval was dismissed`],
      comment: false,
    };
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
  return {
    lines: [
      `The head moved to ${now} after ${sha} was checked.`,
      `- Dismissing the approval failed (${id === undefined ? "no review id" : `HTTP ${dismissal?.status}`}).`,
      blocked.ok
        ? "- This App now requests changes, which replaces its approval."
        : `- Requesting changes failed too (HTTP ${blocked.status}): the approval may still stand. Dismiss it by hand before anyone merges.`,
      offError ? `- Turning auto-merge off failed: ${offError}.` : "- Auto-merge is off.",
    ],
    comment: true,
  };
}

/**
 * Checks, then approves at the checked head or comments why not. With `MODE=event`, sweeps the land requests
 * (`event`).
 * @param {Record<string, string | undefined>} env
 * @param {{ read?: Rest, write?: Rest, log?: (s: string) => void, mint?: typeof mint }} [deps]
 * @returns {Promise<number>} 0 approved (event mode: swept), 1 refused (event mode: an infrastructure error)
 */
export async function main(env, deps = {}) {
  if (env.MODE === "event") return event(env, deps);
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
    trusted: parsed(env.TRUSTED || "{}"),
    extraOwnerOnly: JSON.parse(env.OWNER_ONLY_EXTRA || "[]"),
    tolerate: parsedTolerate(env.TOLERATE),
  });
  if (refuse.length) {
    await write("POST", `/repos/${repo}/issues/${number}/comments`, {
      body: `Approval refused ([run](${run})):\n\n${refuse.map((r) => `- ${r}`).join("\n")}\n`,
    });
    for (const r of refuse) log(`::error::${r}`);
    return 1;
  }
  const failed = await approveAt({
    read,
    write,
    repo,
    number,
    sha: String(sha),
    nodeId,
    run,
    body: approvedBody(String(sha), run, baseline, "no owner-only change"),
  });
  if (failed) {
    if (failed.comment)
      await write("POST", `/repos/${repo}/issues/${number}/comments`, {
        body: [...failed.lines, `([run](${run}))`].join("\n"),
      });
    log(`::error::${failed.lines.join(" ")}`);
    return 1;
  }
  log(`Approved ${repo}#${number} at ${sha}`);
  return 0;
}

/** Raised for an answer that is not the expected one: an infrastructure error, so the job goes red. */
export class ApiError extends Error {}

/**
 * One GET's JSON, or an `ApiError` naming the path and status.
 * @param {Rest} api
 * @param {string} path
 */
export async function get(api, path) {
  const r = await api("GET", path);
  if (!r.ok || r.json === undefined)
    throw new ApiError(`GET ${path.split("?")[0]} answered ${r.status}`);
  return r.json;
}

/**
 * Every item of a listing, oldest page first (at most 30 pages of 100).
 * @param {Rest} api
 * @param {string} path
 * @returns {Promise<any[]>}
 */
export async function pages(api, path) {
  const items = [];
  for (let page = 1; page <= 30; page++) {
    const json = await get(
      api,
      `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
    );
    if (!Array.isArray(json)) throw new ApiError(`GET ${path.split("?")[0]} answered no list`);
    items.push(...json);
    if (json.length < 100) break;
  }
  return items;
}

/**
 * The open PRs labelled `LAND_LABEL`, in number order: those without `HOLD_LABEL`, based on `defaultBranch`, with
 * their head in `repo`. Each is the full pull request; every event sweeps all of them, so a run that GitHub's
 * concurrency replaces loses nothing.
 * @param {Rest} api
 * @param {string} repo
 * @param {string} defaultBranch
 */
export async function select(api, repo, defaultBranch) {
  const issues = await pages(
    api,
    `/repos/${repo}/issues?state=open&labels=${encodeURIComponent(LAND_LABEL)}`,
  );
  const out = [];
  for (const i of issues
    .filter(
      (i) => i.pull_request && !i.labels?.some((/** @type {any} */ l) => l.name === HOLD_LABEL),
    )
    .toSorted((a, b) => a.number - b.number)) {
    const pr = await get(api, `/repos/${repo}/pulls/${i.number}`);
    if (pr.state === "open" && pr.base?.ref === defaultBranch && pr.head?.repo?.full_name === repo)
      out.push(pr);
  }
  return out;
}

/**
 * Why the land request on PR `number` does not count: the newest `labeled` event for `LAND_LABEL` must be by a User
 * with write or admin (maintain reads as write), or by a Bot whose App slug `requesters` lists. `github-actions` and
 * the Flow App (`flow`, its logins) never count, since either could add the label without anyone asking.
 * @param {Rest} api
 * @param {string} repo
 * @param {number} number
 * @param {string[]} requesters App slugs
 * @param {string[]} [flow] the Flow App's logins
 * @returns {Promise<string[]>}
 */
export async function requestProblems(api, repo, number, requesters, flow = []) {
  const events = await pages(api, `/repos/${repo}/issues/${number}/events`);
  const added = events
    .filter((e) => e.event === "labeled" && e.label?.name === LAND_LABEL)
    .toSorted((a, b) => a.id - b.id)
    .at(-1);
  if (!added) return [`no one is recorded adding ${LAND_LABEL}`];
  const login = String(added.actor?.login ?? "");
  const slug = added.performed_via_github_app?.slug;
  if (
    login === "github-actions[bot]" ||
    flow.includes(login) ||
    (slug && flow.map((f) => actor(f)).includes(slug))
  )
    return [`${LAND_LABEL} was added by ${login}, which never requests a land`];
  if (added.actor?.type === "Bot")
    return slug && requesters.includes(slug)
      ? []
      : [`${LAND_LABEL} was added by ${login}, an App approve.requesters does not list`];
  if (added.actor?.type !== "User") return [`${LAND_LABEL} was added by ${login || "nobody"}`];
  const r = await api(
    "GET",
    `/repos/${repo}/collaborators/${encodeURIComponent(login)}/permission`,
  );
  if (r.status >= 500) throw new ApiError(`GET collaborators permission answered ${r.status}`);
  const permission = r.ok ? r.json?.permission : undefined;
  return permission === "admin" || permission === "write"
    ? []
    : [
        `${LAND_LABEL} was added by ${login}, whose permission is ${permission ?? "unknown"} (write or admin asks for a land)`,
      ];
}

/** Reasons that only time clears: a check or the gate still running, or a draft. */
const waiting = (/** @type {string} */ r) =>
  r.startsWith("required checks still running") ||
  r.startsWith("the PR is a draft") ||
  r.startsWith(`no ${STATUS_CONTEXT} on the head`) ||
  r.startsWith(`${STATUS_CONTEXT} is pending`);

/**
 * The land request's state from its reasons: `approved` with none, `refused` when any reason is neither waiting nor
 * the owner's, else `owner` when the owner's review is needed, else `waiting`.
 * @param {string[]} refuse
 * @param {string[]} [owner] the reasons only the owner's review clears (`decide`'s `owner`)
 * @returns {"approved" | "refused" | "owner" | "waiting"}
 */
export function classify(refuse, owner = []) {
  if (!refuse.length) return "approved";
  const rest = refuse.filter((r) => !owner.includes(r));
  if (rest.some((r) => !waiting(r))) return "refused";
  return rest.length < refuse.length ? "owner" : "waiting";
}

/** What to do next, for each state. */
const NEXT = {
  approved: "Approved at this head; the merge lane merges it once GitHub allows.",
  waiting: "Nothing to do: Flow checks again when they finish.",
  owner: `The owner reviews it. Once the owner approves this head, comment \`${LAND_COMMAND}\`.`,
  refused: `Fix each reason and push (a push withdraws the request), then \`${LAND_COMMAND}\` again.`,
  merged: "Nothing to do.",
};

/**
 * The sticky comment's body: `LAND_MARKER`, then `head: <sha> state: <state>`, each reason and the next step. It
 * holds nothing that changes from run to run, so an unchanged state is never rewritten.
 * @param {string} sha
 * @param {keyof typeof NEXT} state
 * @param {string[]} reasons
 */
export const stickyBody = (sha, state, reasons) =>
  [
    LAND_MARKER,
    `head: ${sha} state: ${state}`,
    "",
    ...reasons.map((r) => `- ${r}`),
    ...(reasons.length ? [""] : []),
    NEXT[state],
  ].join("\n");

/**
 * Writes the one comment on PR `number` that starts with `LAND_MARKER` and is by the Flow App (`flow`), only when its
 * body differs. `write` gives the App's API, minted only when a write is needed. Returns the comment's URL.
 * @param {{ read: Rest, write: () => Promise<Rest>, repo: string, number: number, body: string,
 *           flow: string[] }} input
 */
export async function upsertSticky({ read, write, repo, number, body, flow }) {
  const mine = (await pages(read, `/repos/${repo}/issues/${number}/comments`)).find(
    (c) => flow.includes(c.user?.login) && String(c.body ?? "").startsWith(LAND_MARKER),
  );
  if (mine && String(mine.body).trim() === body.trim()) return String(mine.html_url ?? "");
  const w = await write();
  const r = mine
    ? await w("PATCH", `/repos/${repo}/issues/comments/${mine.id}`, { body })
    : await w("POST", `/repos/${repo}/issues/${number}/comments`, { body });
  if (!r.ok)
    throw new ApiError(
      `${mine ? "PATCH" : "POST"} the ${LAND_CONTEXT} comment answered ${r.status}`,
    );
  return String(r.json?.html_url ?? mine?.html_url ?? "");
}

/**
 * The issue key of `branch` under the default branch's configuration, read through the contents API.
 * @param {Rest} api
 * @param {string} repo
 * @param {string} branch
 * @param {string} defaultBranch
 */
export async function keyAt(api, repo, branch, defaultBranch) {
  const text = await textAt(api, repo, CONFIG_FILE, encodeURIComponent(defaultBranch));
  const config = (text && parsed(text)) || {};
  return keyScheme(config.tracker).parse(branch);
}

/** The `LAND_CONTEXT` state for each land state. */
const STATUS_STATE = {
  approved: "success",
  waiting: "pending",
  owner: "pending",
  refused: "failure",
};

/**
 * Event mode: every land request, checked, then approved once at its head or explained, in the sticky comment and the
 * `LAND_CONTEXT` status.
 * @param {Record<string, string | undefined>} env
 * @param {{ read?: Rest, write?: Rest, log?: (s: string) => void, mint?: typeof mint }} deps
 */
async function event(env, deps) {
  const log = deps.log ?? console.log;
  const automation = env.AUTOMATION ?? "";
  if (automation !== "on") {
    log(`::notice::${AUTOMATION_VARIABLE} is ${JSON.stringify(automation)}: approve posts nothing`);
    return 0;
  }
  const base = env.GITHUB_API_URL;
  const read = deps.read ?? rest(String(env.GITHUB_TOKEN), base);
  const repo = String(env.REPO);
  const run = String(env.RUN_URL ?? "");
  const defaultBranch = String(env.DEFAULT_BRANCH);
  const trusted = parsed(env.TRUSTED || "{}");
  const flow = /** @type {string[]} */ ([trusted?.[STATUS_CONTEXT] ?? []].flat().filter(Boolean));
  const requesters = JSON.parse(env.REQUESTERS || "[]");
  /** @type {import("./app-token.mjs").Minted | undefined} */
  let minted;
  /** @type {Rest | undefined} */
  let writer;
  // Minted only when something is written; one token for the sweep.
  const write = async () => {
    if (writer) return writer;
    if (deps.write) return (writer = deps.write);
    minted = await (deps.mint ?? mint)("approve", {
      oidc: JSON.parse(env.OIDC || "null"),
      defaultBranch,
      env,
    });
    return (writer = rest(minted.token, base));
  };
  try {
    for (const pr of await select(read, repo, defaultBranch)) {
      const number = pr.number;
      const sha = String(pr.head.sha);
      const d = await decide({
        api: read,
        repo,
        number,
        expectedHead: sha,
        approver: flow,
        ref: String(env.GITHUB_REF),
        environment: String(env.ENVIRONMENT),
        trusted,
        extraOwnerOnly: JSON.parse(env.OWNER_ONLY_EXTRA || "[]"),
        tolerate: parsedTolerate(env.TOLERATE),
      });
      const statuses = await pages(read, `/repos/${repo}/commits/${sha}/statuses`);
      // Owner-only paths and findings are decide's (`d.owner`), so the land rules get no files.
      const rules = landRules({
        pr,
        statuses,
        base: defaultBranch,
        spec: await specAt(read, repo, sha, await keyAt(read, repo, pr.head.ref, defaultBranch)),
        gateApp: flow,
        required: true,
      });
      const reasons = [
        ...new Set([
          ...(await requestProblems(read, repo, number, requesters, flow)),
          ...d.refuse,
          ...rules,
        ]),
      ];
      let state = classify(reasons, d.owner);
      if (state === "approved") {
        const reviews = await pages(read, `/repos/${repo}/pulls/${number}/reviews`);
        const mine = reviews.filter((r) => flow.includes(r.user?.login)).at(-1);
        // One approval per head: a repeated event never posts a second.
        if (!(mine?.state === "APPROVED" && mine.commit_id === sha)) {
          const failed = await approveAt({
            read,
            write: await write(),
            repo,
            number,
            sha,
            nodeId: d.nodeId,
            run,
            body: approvedBody(sha, run, d.baseline, "every land rule passed"),
          });
          if (failed) {
            reasons.push(...failed.lines);
            state = "refused";
          }
        }
      }
      const url = await upsertSticky({
        read,
        write,
        repo,
        number,
        body: stickyBody(sha, state, reasons),
        flow,
      });
      const description = `${state}: ${reasons[0] ?? "every land rule passed at this head"}`.slice(
        0,
        140,
      );
      const last = statuses.find(
        (s) => s.context === LAND_CONTEXT && flow.includes(s.creator?.login),
      );
      if (last?.state !== STATUS_STATE[state] || last?.description !== description) {
        const r = await (
          await write()
        )("POST", `/repos/${repo}/statuses/${sha}`, {
          state: STATUS_STATE[state],
          context: LAND_CONTEXT,
          description,
          ...(url.startsWith("https://") ? { target_url: url } : {}),
        });
        if (!r.ok) throw new ApiError(`POST the ${LAND_CONTEXT} status answered ${r.status}`);
      }
      log(`#${number} at ${sha}: ${state}${reasons.length ? `: ${reasons.join("; ")}` : ""}`);
      if (env.GITHUB_STEP_SUMMARY)
        appendFileSync(
          env.GITHUB_STEP_SUMMARY,
          `| #${number} | ${sha.slice(0, 12)} | ${state} | ${(reasons[0] ?? "").replaceAll("|", "\\|")} |\n`,
        );
    }
    return 0;
  } catch (error) {
    log(`::error::${/** @type {Error} */ (error).message}`);
    return 1;
  } finally {
    await minted?.revoke().catch(() => log("::warning::revoking the approve token failed"));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = await main(process.env);
