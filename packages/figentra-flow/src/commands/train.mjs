/**
 * Figentra Flow file contract:
 * Purpose: `figentra-flow train open|add|close|build|eject|depart|status`, the repository's release train (STA-1746):
 *   open a train (a GitHub milestone and a `<label><version>` label, the version next from changesets), board green
 *   PRs in order, cut off, build `train/<version>` from the default branch by merge commits (ejecting a conflicting
 *   member), gate it and, on red, eject the first breaking member by gating prefixes (`train.eject: "bisect"`) or stop
 *   (`"manual"`), then depart: fast-forward the default branch to the green tip, close the milestone and open the next
 *   train. `train.after` holds a departure until each upstream repository's train is published.
 * Boundary: the train's state (members in board order, ejections, PRs waiting for the next train, the cut-off) is a
 *   marked line in its milestone's description; nothing is stored locally. Members are merged with merge commits,
 *   never rebased or squashed. `train/<version>` is Flow's scratch branch: a candidate that does not descend from it
 *   replaces it by delete and push, never a forced push. Depart is a fast-forward only (`force: false`), refused
 *   unless `figentra-flow/gate` is green on the tip's exact sha; the steps after it only warn (exit 3). Every
 *   mutating subcommand takes `--dry-run`.
 * Runtime: node
 * Governing contract: STA-1746 (owner approval 2026-11-01); Stackra ADR 0503; STA-1729 phase 3 (land's gate rule).
 * Secrets: none here. GitHub calls go through the credentials port (`gh`), network git through `remote`.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { connect, gateProblems } from "./land.mjs";
import { gateRun } from "./gate-run.mjs";
import { loadConfig } from "../lib/config.mjs";
import { NAME, STATUS_CONTEXT } from "../lib/product.mjs";
import { defaultBranch, fetch, git, mainCheckout, remote, remoteTip } from "../lib/git.mjs";

/**
 * The `train` settings' defaults; `figentra-flow.config.json`'s `train` block overrides each. No `cutoff`: the cut-off
 * is `train close` by hand.
 * @type {TrainConfig}
 */
export const DEFAULTS = { label: "train:", eject: "bisect", after: [] };

const MARK = `<!-- ${NAME}/train `;
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/;

/**
 * @typedef {{ members: number[], ejected: { pr: number, reason: string }[], waiting: number[], closed: boolean }} State
 * @typedef {{ number: number, version: string, open: boolean, created: string, state: State }} Train
 * @typedef {{ label: string, eject: "bisect" | "manual", after: string[], cutoff?: number }} TrainConfig
 * @typedef {{ api: import("../lib/github.mjs").Api, log: (s: string) => void, warn: (s: string) => void,
 *             gate: (dir: string, ref: string) => Promise<number>, now?: () => number }} TrainDeps
 * @typedef {{ root: string, repo: string, base: string, cfg: TrainConfig, gateApp?: string, dry?: boolean,
 *             deps: TrainDeps }} Ctx
 * @typedef {{ code: number, problems?: string[], version?: string, tip?: string }} Result
 */

/** @returns {Result} */
const fail = (/** @type {string} */ problem, code = 1) => ({ code, problems: [problem] });
const list = (/** @type {{ json: any }} */ r) => (Array.isArray(r.json) ? r.json : []);
const short = (/** @type {string | undefined} */ sha) => String(sha ?? "").slice(0, 12);

/** A train's state from its milestone description; an empty train when the line is missing or unreadable. */
export function stateOf(/** @type {string | undefined} */ description) {
  /** @type {State} */
  const blank = { members: [], ejected: [], waiting: [], closed: false };
  const text = String(description ?? "");
  const at = text.indexOf(MARK);
  if (at < 0) return blank;
  try {
    return { ...blank, ...JSON.parse(text.slice(at + MARK.length, text.indexOf(" -->", at))) };
  } catch {
    return blank;
  }
}

/** The milestone description that holds a train's state. */
export const stateText = (/** @type {string} */ version, /** @type {State} */ state) =>
  `Release train ${version}, run by \`${NAME} train\`; the line below is its state.\n${MARK}${JSON.stringify(state)} -->`;

const parts = (/** @type {string} */ v) => (v.match(SEMVER) ?? []).slice(1, 4).map(Number);

/** Positive when `a` is the higher version. shortcut: a pre-release tag is ignored, fine while trains are x.y.z. */
export function compare(/** @type {string} */ a, /** @type {string} */ b) {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** `version` bumped by `kind` (`major`, `minor` or `patch`). */
export function bump(/** @type {string} */ version, /** @type {string} */ kind) {
  const [major, minor, patch] = parts(version);
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/**
 * The next version changesets will give: the highest of each named package's version bumped by its changeset;
 * undefined when no changeset names a known package.
 * @param {string[]} changesets  the `.changeset/*.md` texts
 * @param {Record<string, string>} versions  each workspace package's current version, by name
 */
export function nextVersion(changesets, versions) {
  /** @type {string | undefined} */
  let best;
  for (const text of changesets) {
    const front = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
    for (const [, name, kind] of front.matchAll(
      /^\s*["']?(@?[\w.-]+(?:\/[\w.-]+)?)["']?\s*:\s*(major|minor|patch)\s*$/gm,
    )) {
      const now = versions[name];
      if (!now || !SEMVER.test(now)) continue;
      const next = bump(now, kind);
      if (!best || compare(next, best) > 0) best = next;
    }
  }
  return best;
}

/** `nextVersion` for the repository at `root`: its changesets and its tracked `package.json` files. */
function changesetVersion(/** @type {string} */ root) {
  const dir = join(root, ".changeset");
  const texts = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".md") && f !== "README.md")
        .map((f) => readFileSync(join(dir, f), "utf8"))
    : [];
  /** @type {Record<string, string>} */
  const versions = {};
  for (const path of git(root, ["ls-files", "--", ":(glob)**/package.json"]).out.split("\n")) {
    if (!path) continue;
    try {
      const manifest = JSON.parse(readFileSync(join(root, path), "utf8"));
      if (manifest.name && manifest.version) versions[manifest.name] = manifest.version;
    } catch {
      // an unreadable manifest names no version
    }
  }
  return nextVersion(texts, versions);
}

/**
 * The repository's trains (its milestones titled `<label><version>`), the highest version first.
 * @param {import("../lib/github.mjs").Api} api
 * @param {string} repo
 * @param {string} label
 * @returns {Train[]}
 */
function trains(api, repo, label) {
  const r = api("GET", `/repos/${repo}/milestones?state=all&per_page=100`);
  if (!r.ok) throw new Error(`cannot read ${repo}'s milestones: ${r.err}`);
  return list(r)
    .filter((m) => String(m.title).startsWith(label) && SEMVER.test(m.title.slice(label.length)))
    .map((m) => ({
      number: m.number,
      version: m.title.slice(label.length),
      open: m.state === "open",
      created: m.created_at,
      state: stateOf(m.description),
    }))
    .sort((a, b) => compare(b.version, a.version));
}

/** The open train; there is at most one (`open` refuses a second). */
const current = (/** @type {Ctx} */ ctx) =>
  trains(ctx.deps.api, ctx.repo, ctx.cfg.label).find((t) => t.open);

/** Whether the train is cut off: closed by hand, or `train.cutoff` hours have passed since it opened. */
export function cutOff(/** @type {Train} */ t, /** @type {TrainConfig} */ cfg, now = Date.now()) {
  return (
    t.state.closed ||
    (cfg.cutoff !== undefined && now - Date.parse(t.created) >= cfg.cutoff * 3_600_000)
  );
}

const save = (/** @type {Ctx} */ ctx, /** @type {Train} */ t) =>
  ctx.deps.api("PATCH", `/repos/${ctx.repo}/milestones/${t.number}`, {
    description: stateText(t.version, t.state),
  });

/** Why `pr` may not board (or stay on) a train: open, based on the default branch, green on its exact head. */
function boardProblems(/** @type {Ctx} */ ctx, /** @type {any} */ pr) {
  const problems = [];
  if (pr.state !== "open") problems.push(`the PR is ${pr.merged ? "already merged" : pr.state}`);
  if (pr.base?.ref !== ctx.base)
    problems.push(`it is based on \`${pr.base?.ref}\`, not ${ctx.base}`);
  const statuses = list(
    ctx.deps.api("GET", `/repos/${ctx.repo}/commits/${pr.head?.sha}/statuses?per_page=100`),
  );
  problems.push(...gateProblems(statuses, pr.head?.sha, ctx.gateApp));
  return problems;
}

/**
 * Why an upstream repository's train holds this one: its newest train that is cut off or departed has no release
 * tagged with its version (`<v>`, `v<v>` or `<package>@<v>`) yet.
 * @param {import("../lib/github.mjs").Api} api
 * @param {string} up  `owner/name`
 * @param {string} label
 * @returns {string[]}
 */
export function upstreamProblems(api, up, label) {
  /** @type {Train | undefined} */
  let due;
  try {
    due = trains(api, up, label).find((t) => !t.open || t.state.closed);
  } catch (error) {
    return [`after ${up}: ${/** @type {Error} */ (error).message}`];
  }
  if (!due) return [];
  const v = due.version;
  const releases = api("GET", `/repos/${up}/releases?per_page=100`);
  if (!releases.ok) return [`after ${up}: cannot read its releases: ${releases.err}`];
  const published = list(releases).some(
    (r) => !r.draft && ([v, `v${v}`].includes(r.tag_name) || String(r.tag_name).endsWith(`@${v}`)),
  );
  return published
    ? []
    : [`after ${up}: its train ${v} is not published yet; this train departs after it`];
}

/**
 * `train open [<version>]`: the milestone and the label; the version is next from changesets unless given.
 * @returns {Promise<Result>}
 */
export async function trainOpen(/** @type {Ctx} */ ctx, /** @type {string | undefined} */ version) {
  const { api, log } = ctx.deps;
  const all = trains(api, ctx.repo, ctx.cfg.label);
  const open = all.find((t) => t.open);
  if (open) return fail(`train ${open.version} is open; the next opens when it departs`);
  if (version !== undefined && !SEMVER.test(version))
    return fail(`${version} is not a version (x.y.z)`, 2);
  if (version !== undefined && all.some((t) => t.version === version))
    return fail(`train ${version} exists already`);
  let v = version ?? changesetVersion(ctx.root);
  if (!v)
    return fail(
      `no changeset names a package to bump; pass the version: ${NAME} train open <x.y.z>`,
    );
  // The departed train's changesets stay on the branch until its Version Packages PR lands.
  while (all.some((t) => t.version === v)) v = bump(v, "patch");
  const name = `${ctx.cfg.label}${v}`;
  if (ctx.dry) {
    log(`${NAME} train: would open ${name} (a milestone and a label)`);
    return { code: 0, version: v };
  }
  const label = api("POST", `/repos/${ctx.repo}/labels`, {
    name,
    color: "0e8a16",
    description: `Release train ${v}`,
  });
  // 422: the label exists already (a train opened by hand); it is reused.
  if (!label.ok && !/HTTP 422/.test(label.err))
    return fail(`creating the label ${name} failed: ${label.err}`);
  const milestone = api("POST", `/repos/${ctx.repo}/milestones`, {
    title: name,
    description: stateText(v, stateOf("")),
  });
  if (!milestone.ok) return fail(`creating the milestone ${name} failed: ${milestone.err}`);
  log(`${NAME} train: opened ${name} (milestone #${milestone.json?.number})`);
  return { code: 0, version: v };
}

/**
 * `train add <pr>`: board a PR that is open, on the default branch and green on its exact head; after the cut-off it waits for the next train.
 * @returns {Promise<Result>}
 */
export async function trainAdd(/** @type {Ctx} */ ctx, /** @type {number} */ number) {
  const { api, log } = ctx.deps;
  const t = current(ctx);
  if (!t) return fail(`no train is open (${NAME} train open)`);
  const pr = api("GET", `/repos/${ctx.repo}/pulls/${number}`);
  if (!pr.ok) return fail(`#${number}: ${pr.err}`, 2);
  const problems = boardProblems(ctx, pr.json);
  if (problems.length) return { code: 1, problems: problems.map((p) => `#${number}: ${p}`) };
  if (t.state.members.includes(number) || t.state.waiting.includes(number))
    return fail(`#${number} is on train ${t.version} already`);
  const name = `${ctx.cfg.label}${t.version}`;
  if (cutOff(t, ctx.cfg, ctx.deps.now?.())) {
    if (ctx.dry) {
      log(`${NAME} train: ${name} is cut off; would hold #${number} for the next train`);
      return { code: 0 };
    }
    t.state.waiting.push(number);
    const saved = save(ctx, t);
    if (!saved.ok) return fail(`recording #${number} failed: ${saved.err}`);
    log(`${NAME} train: ${name} is cut off; #${number} rides the next train`);
    return { code: 0 };
  }
  if (ctx.dry) {
    log(`${NAME} train: would board #${number} on ${name} as member ${t.state.members.length + 1}`);
    return { code: 0 };
  }
  const steps = [
    () => api("POST", `/repos/${ctx.repo}/issues/${number}/labels`, { labels: [name] }),
    () => api("PATCH", `/repos/${ctx.repo}/issues/${number}`, { milestone: t.number }),
    () => {
      t.state.members.push(number);
      return save(ctx, t);
    },
  ];
  for (const step of steps) {
    const r = step();
    if (!r.ok) return fail(`boarding #${number} failed: ${r.err}`);
  }
  log(`${NAME} train: #${number} boarded ${name} as member ${t.state.members.length}`);
  return { code: 0 };
}

/**
 * `train close`: the cut-off; a PR added after it waits for the next train.
 * @returns {Promise<Result>}
 */
export async function trainClose(/** @type {Ctx} */ ctx) {
  const t = current(ctx);
  if (!t) return fail(`no train is open (${NAME} train open)`);
  if (t.state.closed) return fail(`train ${t.version} is cut off already`);
  if (ctx.dry) {
    ctx.deps.log(
      `${NAME} train: would cut off train ${t.version} (${t.state.members.length} members)`,
    );
    return { code: 0 };
  }
  t.state.closed = true;
  const saved = save(ctx, t);
  if (!saved.ok) return fail(`cutting off failed: ${saved.err}`);
  ctx.deps.log(
    `${NAME} train: train ${t.version} is cut off with ${t.state.members.length} members`,
  );
  return { code: 0 };
}

/** Takes `n` off the train with the reason: the state, the label, the milestone and a comment. Failures only warn. */
async function eject(
  /** @type {Ctx} */ ctx,
  /** @type {Train} */ t,
  /** @type {number} */ n,
  /** @type {string} */ reason,
) {
  const { api, log, warn } = ctx.deps;
  t.state.members = t.state.members.filter((m) => m !== n);
  t.state.ejected.push({ pr: n, reason });
  log(`${NAME} train: ejected #${n}: ${reason}`);
  const name = `${ctx.cfg.label}${t.version}`;
  const steps = /** @type {[string, () => { ok: boolean, err: string }][]} */ ([
    ["record the ejection", () => save(ctx, t)],
    [
      "remove the label",
      () => api("DELETE", `/repos/${ctx.repo}/issues/${n}/labels/${encodeURIComponent(name)}`),
    ],
    [
      "clear the milestone",
      () => api("PATCH", `/repos/${ctx.repo}/issues/${n}`, { milestone: null }),
    ],
    [
      "comment",
      () =>
        api("POST", `/repos/${ctx.repo}/issues/${n}/comments`, {
          body: `Ejected from train ${t.version} by \`${NAME} train\`: ${reason}.\n\nFix it, then \`${NAME} train add ${n}\` again.`,
        }),
    ],
  ]);
  for (const [what, step] of steps) {
    const r = step();
    if (!r.ok) warn(`${NAME} train: warning: #${n}: ${what}: ${r.err}`);
  }
}

/**
 * Merges the members, in board order, onto the default branch in `tree` with merge commits. A member that no longer
 * boards, whose head moved, or that conflicts is ejected and the build goes on.
 * @returns {Promise<Result & { merged?: { pr: number, sha: string }[] }>}
 */
async function assemble(
  /** @type {Ctx} */ ctx,
  /** @type {Train} */ t,
  /** @type {string} */ tree,
) {
  const { api } = ctx.deps;
  const start = git(tree, ["checkout", "-q", "--detach", `origin/${ctx.base}`]);
  if (!start.ok) return fail(`checking out origin/${ctx.base} failed: ${start.err}`, 2);
  const refs = t.state.members.map((n) => `+refs/pull/${n}/head:refs/remotes/origin/pull/${n}`);
  const fetched = remote(ctx.root, ["fetch", "-q", "origin", ...refs]);
  if (!fetched.ok) return fail(`fetching the members failed: ${fetched.err}`, 2);
  /** @type {{ pr: number, sha: string }[]} */
  const merged = [];
  for (const n of [...t.state.members]) {
    const pr = api("GET", `/repos/${ctx.repo}/pulls/${n}`);
    const why = pr.ok ? boardProblems(ctx, pr.json) : [pr.err];
    if (why.length) {
      await eject(ctx, t, n, `it no longer boards: ${why.join("; ")}`);
      continue;
    }
    const ref = `refs/remotes/origin/pull/${n}`;
    if (git(tree, ["rev-parse", ref]).out !== pr.json.head.sha) {
      await eject(ctx, t, n, "its head moved during the build");
      continue;
    }
    const m = git(tree, [
      "merge",
      "--no-ff",
      "--no-edit",
      "-q",
      "-m",
      `Merge #${n}: ${pr.json.title}`,
      ref,
    ]);
    if (!m.ok) {
      const conflicted = git(tree, ["diff", "--name-only", "--diff-filter=U"]).out !== "";
      git(tree, ["merge", "--abort"]);
      if (!conflicted)
        return fail(`merging #${n} failed: ${m.err || "git merge exited non-zero"}`, 2);
      const before = merged.map((x) => `#${x.pr}`).join(", ");
      await eject(
        ctx,
        t,
        n,
        `it conflicts with ${ctx.base}${before ? ` and ${before}` : ""} on the train`,
      );
      continue;
    }
    merged.push({ pr: n, sha: git(tree, ["rev-parse", "HEAD"]).out });
  }
  return { code: 0, merged };
}

/**
 * Points `branch` at `sha` on origin and gates it there. The branch is Flow's scratch branch, never on the default
 * branch: a candidate that does not descend from it replaces it by delete and push, never a forced push.
 * @returns {Promise<Result>}  code: the gate's (0 green, 1 red), or 2 when it could not be pushed
 */
async function gateAt(
  /** @type {Ctx} */ ctx,
  /** @type {string} */ tree,
  /** @type {string} */ branch,
  /** @type {string} */ sha,
) {
  const co = git(tree, ["checkout", "-q", "--detach", sha]);
  if (!co.ok) return fail(`checking out ${short(sha)} failed: ${co.err}`, 2);
  const there = remoteTip(ctx.root, branch);
  if (there !== sha) {
    if (there && !git(ctx.root, ["merge-base", "--is-ancestor", there, sha]).ok) {
      const gone = remote(ctx.root, ["push", "-q", "origin", "--delete", branch]);
      if (!gone.ok) return fail(`replacing ${branch} failed: ${gone.err}`, 2);
    }
    const pushed = remote(tree, ["push", "-q", "origin", `${sha}:refs/heads/${branch}`]);
    if (!pushed.ok) return fail(`pushing ${branch} failed: ${pushed.err}`, 2);
  }
  return { code: await ctx.deps.gate(tree, branch) };
}

/**
 * The first member whose merge turns the train red: prefix k is the train after its k-th merge; the default branch
 * (k = 0) is taken as green and the whole train (k = n) is known red.
 * @returns {Promise<Result & { pr?: number, sha?: string }>}
 */
async function bisect(
  /** @type {Ctx} */ ctx,
  /** @type {string} */ tree,
  /** @type {string} */ branch,
  /** @type {{ pr: number, sha: string }[]} */ merged,
) {
  let [lo, hi] = [1, merged.length];
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const r = await gateAt(ctx, tree, branch, merged[mid - 1].sha);
    if (r.code === 1) hi = mid;
    else if (r.code === 0) lo = mid + 1;
    else return r.problems ? r : fail(`gate run exited ${r.code} on a prefix; the build stops`, 2);
  }
  return { code: 0, pr: merged[hi - 1].pr, sha: merged[hi - 1].sha };
}

/**
 * `train build`: `train/<version>` from the default branch, the members merged in order, gated; ejects on red.
 * @returns {Promise<Result>}
 */
export async function trainBuild(/** @type {Ctx} */ ctx) {
  const { api, log, warn } = ctx.deps;
  const t = current(ctx);
  if (!t) return fail(`no train is open (${NAME} train open)`);
  if (!cutOff(t, ctx.cfg, ctx.deps.now?.()))
    return fail(`train ${t.version} is still boarding; cut it off first (${NAME} train close)`);
  if (!t.state.members.length) return fail(`train ${t.version} has no members`);
  const branch = `train/${t.version}`;
  if (ctx.dry) {
    log(
      `${NAME} train: would build ${branch} from ${ctx.base}, merging ${t.state.members.map((n) => `#${n}`).join(", ")} in order, then gate it (eject: ${ctx.cfg.eject})`,
    );
    return { code: 0 };
  }
  if (!fetch(ctx.root).ok) return fail("fetching origin failed", 2);
  const tree = join(ctx.root, ".claude", "worktrees", `train-${t.version}`);
  if (!existsSync(tree)) {
    const made = git(ctx.root, ["worktree", "add", "-q", "--detach", tree, `origin/${ctx.base}`]);
    if (!made.ok) return fail(`creating the build worktree failed: ${made.err}`, 2);
  }
  try {
    for (;;) {
      const built = await assemble(ctx, t, tree);
      if (built.code || !built.merged) return built;
      if (!built.merged.length)
        return fail(`every member was ejected; train ${t.version} has nothing to build`);
      const tip = built.merged[built.merged.length - 1].sha;
      const gated = await gateAt(ctx, tree, branch, tip);
      if (gated.problems) return gated;
      if (gated.code === 0) {
        log(
          `${NAME} train: ${branch} at ${short(tip)} is green (${built.merged.length} members); ${NAME} train depart`,
        );
        return { code: 0, tip };
      }
      if (gated.code !== 1)
        return fail(
          `gate run exited ${gated.code} on ${branch}: the gate did not run, so nothing is ejected`,
          2,
        );
      if (ctx.cfg.eject === "manual")
        return fail(
          `${branch} at ${short(tip)} is red; train.eject is manual: find the breaking member, \`${NAME} train eject <pr>\`, then build again`,
        );
      const culprit = await bisect(ctx, tree, branch, built.merged);
      if (culprit.code || culprit.pr === undefined) return culprit;
      const red = list(
        api("GET", `/repos/${ctx.repo}/commits/${culprit.sha}/statuses?per_page=100`),
      ).find((s) => s.context === STATUS_CONTEXT);
      // shortcut: the box keeps the check's log; the eject names the red status and its report link, not the lines.
      await eject(
        ctx,
        t,
        culprit.pr,
        `the train turns red with it: ${STATUS_CONTEXT} failed on ${short(culprit.sha)}${red?.description ? ` (${red.description})` : ""}${red?.target_url ? `, ${red.target_url}` : ""}`,
      );
    }
  } finally {
    const removed = git(ctx.root, ["worktree", "remove", tree]);
    if (!removed.ok) warn(`${NAME} train: kept the build worktree ${tree}: ${removed.err}`);
  }
}

/**
 * `train eject <pr>`: the manual eject, for `train.eject: "manual"`.
 * @returns {Promise<Result>}
 */
export async function trainEject(/** @type {Ctx} */ ctx, /** @type {number} */ number) {
  const t = current(ctx);
  if (!t) return fail(`no train is open (${NAME} train open)`);
  if (!t.state.members.includes(number)) return fail(`#${number} is not on train ${t.version}`);
  if (ctx.dry) {
    ctx.deps.log(`${NAME} train: would eject #${number} from train ${t.version}`);
    return { code: 0 };
  }
  await eject(ctx, t, number, "ejected by hand");
  return { code: 0 };
}

/**
 * `train depart`: fast-forward the default branch to the train's tip, only when `figentra-flow/gate` is green on
 * that exact sha and every `train.after` upstream is published; then close the milestone and open the next train.
 * @returns {Promise<Result>}
 */
export async function trainDepart(/** @type {Ctx} */ ctx) {
  const { api, log, warn } = ctx.deps;
  const t = current(ctx);
  if (!t) return fail(`no train is open (${NAME} train open)`);
  if (!cutOff(t, ctx.cfg, ctx.deps.now?.()))
    return fail(`train ${t.version} is still boarding; cut it off and build it first`);
  const branch = `train/${t.version}`;
  const problems = ctx.cfg.after.flatMap((up) => upstreamProblems(api, up, ctx.cfg.label));
  const ref = api("GET", `/repos/${ctx.repo}/git/ref/heads/${branch}`);
  /** @type {string | undefined} */
  const tip = ref.ok ? ref.json?.object?.sha : undefined;
  if (!tip) problems.push(`${branch} does not exist (${NAME} train build)`);
  else {
    const statuses = list(api("GET", `/repos/${ctx.repo}/commits/${tip}/statuses?per_page=100`));
    problems.push(...gateProblems(statuses, tip, ctx.gateApp).map((p) => `${branch}: ${p}`));
    const cmp = api("GET", `/repos/${ctx.repo}/compare/${ctx.base}...${tip}`);
    if (!cmp.ok || cmp.json?.status !== "ahead")
      problems.push(
        `${branch} is not a fast-forward of ${ctx.base} (${cmp.ok ? cmp.json?.status : cmp.err}); build it again`,
      );
  }
  if (problems.length || !tip) return { code: 1, problems };
  if (ctx.dry) {
    log(
      `${NAME} train: would fast-forward ${ctx.base} to ${branch} at ${short(tip)}, close the milestone and open the next train`,
    );
    return { code: 0, tip };
  }
  const ff = api("PATCH", `/repos/${ctx.repo}/git/refs/heads/${ctx.base}`, {
    sha: tip,
    force: false,
  });
  if (!ff.ok) return fail(`GitHub refused the fast-forward: ${ff.err}`);
  log(`${NAME} train: train ${t.version} departed: ${ctx.base} is at ${short(tip)}`);

  // After the fast-forward every step only warns (exit 3) and never undoes it.
  let warned = false;
  const warning = (/** @type {string} */ what, /** @type {string} */ why) => {
    warned = true;
    warn(`${NAME} train: warning: ${what}: ${why}`);
  };
  const closed = api("PATCH", `/repos/${ctx.repo}/milestones/${t.number}`, {
    state: "closed",
    description: stateText(t.version, t.state),
  });
  /** A step's result; a thrown read counts as its failure, never as the command's. */
  const safely = async (/** @type {() => Promise<Result>} */ step) => {
    try {
      return await step();
    } catch (error) {
      return fail(/** @type {Error} */ (error).message);
    }
  };
  if (!closed.ok) warning("close the milestone", closed.err);
  else {
    const next = await safely(() => trainOpen(ctx, undefined));
    if (next.code) warning("open the next train", (next.problems ?? []).join("; "));
    else
      for (const n of t.state.waiting) {
        const r = await safely(() => trainAdd(ctx, n));
        if (r.code) warning(`board #${n} on train ${next.version}`, (r.problems ?? []).join("; "));
      }
  }
  return { code: warned ? 3 : 0, tip };
}

/**
 * `train status`: the open train's members and their gates, ejections, waiting PRs, its tip and the upstream chain.
 * @returns {Promise<Result>}
 */
export async function trainStatus(/** @type {Ctx} */ ctx) {
  const { api, log } = ctx.deps;
  const gateOf = (/** @type {string} */ sha) =>
    list(api("GET", `/repos/${ctx.repo}/commits/${sha}/statuses?per_page=100`)).find(
      (s) => s.context === STATUS_CONTEXT,
    )?.state ?? "none";
  const t = current(ctx);
  if (!t) log(`${NAME} train: no train is open (${NAME} train open)`);
  else {
    log(
      `train ${t.version} (${cutOff(t, ctx.cfg, ctx.deps.now?.()) ? "cut off" : "boarding"}), milestone #${t.number}`,
    );
    for (const n of t.state.members) {
      const pr = api("GET", `/repos/${ctx.repo}/pulls/${n}`).json ?? {};
      log(
        `  #${n} ${pr.title ?? ""}: ${STATUS_CONTEXT} ${pr.head?.sha ? `${gateOf(pr.head.sha)} on ${short(pr.head.sha)}` : "unknown"}`,
      );
    }
    for (const e of t.state.ejected) log(`  ejected #${e.pr}: ${e.reason}`);
    if (t.state.waiting.length)
      log(`  waiting for the next train: ${t.state.waiting.map((n) => `#${n}`).join(", ")}`);
    const ref = api("GET", `/repos/${ctx.repo}/git/ref/heads/train/${t.version}`);
    const tip = ref.ok ? ref.json?.object?.sha : undefined;
    log(
      `  train/${t.version}: ${tip ? `${short(tip)}, ${STATUS_CONTEXT} ${gateOf(tip)}` : "not built"}`,
    );
  }
  for (const up of ctx.cfg.after) {
    const problems = upstreamProblems(api, up, ctx.cfg.label);
    log(
      `  after ${up}: ${problems.length ? problems.join("; ").replace(`after ${up}: `, "") : "published"}`,
    );
  }
  return { code: 0 };
}

const SUBCOMMANDS = ["open", "add", "close", "build", "eject", "depart", "status"];

/** `figentra-flow train <open [<version>]|add <pr>|close|build|eject <pr>|depart|status> [--dry-run]`. */
export async function run(/** @type {string[]} */ args) {
  const [sub, ...rest] = args;
  const usage = `usage: ${NAME} train <open [<x.y.z>]|add <pr>|close|build|eject <pr>|depart|status> [--dry-run]`;
  if (!SUBCOMMANDS.includes(sub)) {
    console.error(usage);
    return sub === undefined || sub === "--help" ? 0 : 2;
  }
  const root = mainCheckout(process.cwd());
  if (!root) {
    console.error(`${NAME} train: not in a git repository`);
    return 2;
  }
  const loaded = loadConfig(root);
  if (loaded.errors.length) {
    for (const e of loaded.errors) console.error(`${NAME} train: ${e}`);
    return 2;
  }
  const { repo, api, problem } = connect(root);
  if (!repo || !api) {
    console.error(`${NAME} train: ${problem}`);
    return 2;
  }
  const arg = rest.find((a) => !a.startsWith("--"));
  const number = Number.parseInt(arg?.replace("#", "") ?? "", 10);
  if ((sub === "add" || sub === "eject") && Number.isNaN(number)) {
    console.error(usage);
    return 2;
  }
  /** @type {Ctx} */
  const ctx = {
    root,
    repo,
    base: defaultBranch(root),
    cfg: { ...DEFAULTS, ...loaded.config.train },
    gateApp: loaded.config.apps?.gate?.login,
    dry: rest.includes("--dry-run"),
    deps: {
      api,
      log: console.log,
      warn: console.error,
      gate: async (dir, ref) => {
        const r = await gateRun({ cwd: dir, ref });
        if (r.problem) console.error(`${NAME} gate run: ${r.problem}`);
        return r.code;
      },
    },
  };
  /** @type {Result} */
  let result;
  try {
    result =
      sub === "open"
        ? await trainOpen(ctx, arg)
        : sub === "add"
          ? await trainAdd(ctx, number)
          : sub === "close"
            ? await trainClose(ctx)
            : sub === "build"
              ? await trainBuild(ctx)
              : sub === "eject"
                ? await trainEject(ctx, number)
                : sub === "depart"
                  ? await trainDepart(ctx)
                  : await trainStatus(ctx);
  } catch (error) {
    result = fail(/** @type {Error} */ (error).message, 2);
  }
  for (const p of result.problems ?? []) console.error(`${NAME} train ${sub}: ${p}`);
  return result.code;
}
