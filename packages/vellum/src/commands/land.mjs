/**
 * Vellum file contract:
 * Purpose: `vellum land [<pr>] [--stack] [--dry-run] [--manual-ok]`, the lander's checklist as code: squash-merge a PR
 *   only when it is open, clean, based on the default branch, green on `vellum/gate` from the gate App on its exact
 *   head, conventionally titled and its spec's approvals are recorded; then set Linear Done, record the merge commit,
 *   remove the worktree through `clean`'s rules, delete the branch and comment. `--stack` lands a stack bottom-up.
 * Boundary: every rule is read from GitHub's live state and the spec at the PR's head; nothing changes until all
 *   pass. The merge carries `sha`, so GitHub refuses it if the head moved. Steps after the merge only warn (exit 3)
 *   and never undo it. A stack is brought up to date by a merge commit and a normal push, never a rewrite.
 * Runtime: node
 * Governing contract: Stackra ADR 0503 (decision 5), ADR 0502; STA-1729 phase 3 (the leader's plan stop of
 *   2026-10-31).
 * Secrets: none here. GitHub calls go through `gh` (or the repository's `bot:gh`), Linear through the environment's
 *   token, which is never read into output.
 */
import { checkApproval, statusOf, tierOf } from "./gate.mjs";
import { clean } from "./clean.mjs";
import { gateRun } from "./gate-run.mjs";
import { client, linear } from "../lib/linear.mjs";
import { github } from "../lib/github.mjs";
import {
  defaultBranch,
  fetch,
  git,
  issueKey,
  mainCheckout,
  remote,
  worktrees,
} from "../lib/git.mjs";

/** The status creator `land` trusts by default (defence in depth; the ruleset is the guarantee). */
export const GATE_APP = "stackra-gate[bot]";

/** A conventional commit header (the squash commit's title). */
export const CONVENTIONAL =
  /^(?:build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(?:\([\w./-]+\))?!?: \S/;

/**
 * Every reason the PR may not land; empty means it may.
 * @param {{ pr: any, statuses: any[], base: string, spec?: string, gateApp?: string, required: boolean,
 *           manualOk?: boolean, stack?: boolean }} input
 * @returns {string[]}
 */
export function landRules({
  pr,
  statuses,
  base,
  spec,
  gateApp = GATE_APP,
  required,
  manualOk = false,
  stack = false,
}) {
  const problems = [];
  const head = String(pr.head?.sha ?? "").slice(0, 12);
  if (pr.state !== "open") problems.push(`the PR is ${pr.merged ? "already merged" : pr.state}`);
  if (pr.draft) problems.push("the PR is a draft");
  if (pr.mergeable_state === "dirty") problems.push(`the PR conflicts with ${pr.base?.ref}`);
  if (pr.base?.ref !== base && !stack)
    problems.push(`stacked on \`${pr.base?.ref}\`: land that first, or use --stack`);
  // GitHub lists a commit's statuses newest first; the newest of the context counts.
  const gate = statuses.find((s) => s.context === "vellum/gate");
  if (!gate)
    problems.push(
      `no vellum/gate on the head ${head} (run \`vellum gate run\`; an older commit's gate does not count)`,
    );
  else if (gate.state !== "success")
    problems.push(`vellum/gate is ${gate.state} on the head ${head}`);
  else if (gate.creator?.login !== gateApp)
    problems.push(
      `vellum/gate on the head was posted by ${gate.creator?.login ?? "nobody"}, not ${gateApp}`,
    );
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
      `${base}'s ruleset does not require vellum/gate yet (phase 6); until then only the tester lands, with --manual-ok`,
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
 *             log: (s: string) => void, warn: (s: string) => void }} LandDeps
 */

/**
 * Lands one PR.
 * @param {{ root: string, repo: string, base: string, number: number, dry?: boolean, manualOk?: boolean,
 *           gateApp?: string, deps: LandDeps }} options
 * @returns {Promise<{ code: number, problems?: string[], merged?: string }>}
 */
export async function landOne({
  root,
  repo,
  base,
  number,
  dry = false,
  manualOk = false,
  gateApp,
  deps,
}) {
  const { api, log, warn } = deps;
  const pr = api("GET", `/repos/${repo}/pulls/${number}`);
  if (!pr.ok) return { code: 2, problems: [`PR #${number}: ${pr.err}`] };
  const head = pr.json.head.sha;
  const branch = pr.json.head.ref;
  const statuses = api("GET", `/repos/${repo}/commits/${head}/statuses?per_page=100`).json ?? [];
  const rules = api("GET", `/repos/${repo}/rules/branches/${base}`);
  const required = (rules.ok ? (rules.json ?? []) : []).some(
    (/** @type {any} */ r) =>
      r.type === "required_status_checks" &&
      (r.parameters?.required_status_checks ?? []).some(
        (/** @type {any} */ c) => c.context === "vellum/gate",
      ),
  );
  const key = issueKey(branch);
  const problems = landRules({
    pr: pr.json,
    statuses,
    base,
    spec: specAt(api, repo, head, key),
    gateApp,
    required,
    manualOk,
  });
  if (problems.length) return { code: 1, problems };
  if (dry) {
    log(
      `vellum land: would squash-merge #${number} (${branch} at ${head.slice(0, 12)}) into ${base}`,
    );
    return { code: 0 };
  }

  const commits = api("GET", `/repos/${repo}/pulls/${number}/commits?per_page=100`).json ?? [];
  const merge = api("PUT", `/repos/${repo}/pulls/${number}/merge`, {
    merge_method: "squash",
    sha: head,
    commit_title: `${pr.json.title} (#${number})`,
    commit_message: squashMessage(key, commits),
  });
  if (!merge.ok) return { code: 1, problems: [`GitHub refused the merge: ${merge.err}`] };
  const sha = merge.json.sha;
  log(`vellum land: #${number} landed on ${base} as ${sha.slice(0, 12)}`);

  let warned = false;
  const step = async (/** @type {string} */ what, /** @type {() => unknown} */ fn) => {
    try {
      const out = await fn();
      if (out === false) throw new Error("failed");
    } catch (error) {
      warned = true;
      warn(`vellum land: warning: ${what}: ${/** @type {Error} */ (error).message}`);
    }
  };
  if (key)
    await step(`Linear ${key.toUpperCase()} Done`, () =>
      deps.done(key, `https://github.com/${repo}/commit/${sha}`),
    );
  // AC-029: `clean` counts a squashed branch as saved by this commit (a squash has its own patch id).
  if (git(root, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]).ok)
    await step(
      "record the merge commit",
      () => git(root, ["config", `branch.${branch}.vellumLanded`, sha]).ok,
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
        log(`vellum land: kept ${k.path}: ${k.reason} (vellum clean takes it later)`);
    });
  await step(
    "delete the branch",
    () => api("DELETE", `/repos/${repo}/git/refs/heads/${branch}`).ok,
  );
  await step(
    "comment",
    () =>
      api("POST", `/repos/${repo}/issues/${number}/comments`, {
        body: `Landed by \`vellum land\` as ${sha}.${manualOk ? " (`--manual-ok`: the ruleset does not require `vellum/gate` yet.)" : ""}`,
      }).ok,
  );
  return { code: warned ? 3 : 0, merged: sha };
}

/**
 * Lands the stack under `number` bottom-up: each next PR is updated by merging the default branch, pushed, gated
 * and landed in turn. Stops at the first that cannot go, naming it.
 * @param {{ root: string, repo: string, base: string, number: number, manualOk?: boolean, gateApp?: string,
 *           deps: LandDeps & { gate: (cwd: string) => Promise<number> } }} options
 */
export async function landStack({ root, repo, base, number, manualOk = false, gateApp, deps }) {
  const { api, log } = deps;
  const owner = repo.split("/")[0];
  /** @type {any[]} */
  const chain = [];
  let cur = api("GET", `/repos/${repo}/pulls/${number}`).json;
  while (cur) {
    chain.unshift(cur);
    if (cur.base.ref === base) break;
    cur = (api(
      "GET",
      `/repos/${repo}/pulls?state=open&head=${owner}:${encodeURIComponent(cur.base.ref)}`,
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
            `#${pr.number} (${pr.head.ref}) has no local worktree to update; \`vellum start\` one, then land again`,
          ],
        };
      fetch(root);
      const merged = git(tree.path, ["merge", "--no-edit", "-q", `origin/${base}`]);
      if (!merged.ok) {
        git(tree.path, ["merge", "--abort"]);
        return {
          code: 1,
          problems: [
            `#${pr.number}: merging ${base} into ${pr.head.ref} conflicts; resolve it there, then land again`,
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
          problems: [`#${pr.number}: vellum gate run exited ${gate}; the stack stops here`],
        };
    }
    const result = await landOne({ root, repo, base, number: pr.number, manualOk, gateApp, deps });
    if (result.code === 1 || result.code === 2)
      return { ...result, problems: (result.problems ?? []).map((p) => `#${pr.number}: ${p}`) };
    log(`vellum land --stack: ${i + 1}/${chain.length} landed`);
  }
  return { code: 0 };
}

/** The default Linear step: Done, with a comment naming the merge commit. */
async function linearDone(/** @type {string} */ key, /** @type {string} */ url) {
  const api = linear(client({ env: process.env }));
  const issue = await api.issue(key.toUpperCase());
  if (!issue) throw new Error(`${key.toUpperCase()} not found`);
  await api.setState(issue, "Done");
  await api.comment(issue, `Landed: ${url} (vellum land).`);
}

/** `vellum land [<pr>] [--stack] [--dry-run] [--manual-ok]`. */
export async function run(/** @type {string[]} */ args) {
  const cwd = process.cwd();
  const root = mainCheckout(cwd);
  if (!root) {
    console.error("vellum land: not in a git repository");
    return 2;
  }
  const url = git(root, ["remote", "get-url", "origin"]).out;
  const repo = url.match(/github\.com[:/]+([^/]+\/[^/]+?)(?:\.git)?\/?$/)?.[1];
  if (!repo) {
    console.error(`vellum land: origin (${url}) is not a GitHub repository`);
    return 2;
  }
  const api = github(root);
  let number = Number.parseInt(args.find((a) => /^#?\d+$/.test(a))?.replace("#", "") ?? "", 10);
  if (Number.isNaN(number)) {
    const branch = git(cwd, ["branch", "--show-current"]).out;
    number = (api(
      "GET",
      `/repos/${repo}/pulls?state=open&head=${repo.split("/")[0]}:${encodeURIComponent(branch)}`,
    ).json ?? [])[0]?.number;
    if (!number) {
      console.error(`vellum land: no open PR for ${branch || "this head"}; pass its number`);
      return 2;
    }
  }
  /** @type {any} */
  let pkg = {};
  try {
    pkg = JSON.parse(git(root, ["show", "HEAD:package.json"]).out || "{}");
  } catch {
    // no package.json: the defaults
  }
  const deps = {
    api,
    done: linearDone,
    log: console.log,
    warn: console.error,
    gate: async (/** @type {string} */ dir) => (await gateRun({ cwd: dir })).code,
  };
  const options = {
    root,
    repo,
    base: defaultBranch(root),
    number,
    manualOk: args.includes("--manual-ok"),
    gateApp: pkg.vellum?.gateApp ?? GATE_APP,
    deps,
  };
  const result = args.includes("--stack")
    ? await landStack(options)
    : await landOne({ ...options, dry: args.includes("--dry-run") });
  for (const p of result.problems ?? []) console.error(`vellum land: ${p}`);
  return result.code;
}
