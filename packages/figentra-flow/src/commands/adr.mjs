/**
 * Figentra Flow file contract:
 * Purpose: `fflow adr reserve <slug> --issue <key> [--owner <who>]` (STA-1945 FR-17): under the `adr` queue lock, read the numbers
 *   file the preset's `queues.adr` names on the default branch, append the next number on a branch `adr/<n>-<slug>`,
 *   open a PR, gate it and land it with `fflow land`, and only then print the number (stdout carries only the
 *   number; everything else goes to stderr). Two sessions never take one.
 * Boundary: GitHub through the configured credentials; the working tree is never touched (the gate runs from a
 *   temporary detached worktree in `.claude/worktrees/`). A reservation that does not land prints no number, names its
 *   PR and withdraws it (auto-merge off, closed, branch deleted); the lock is always released.
 * Runtime: node
 * Governing contract: STA-1945 (FR-17, AC-15, P-023; plan C12); replaces core's `tools/scripts/adr-reserve.mjs`
 *   (STA-1732).
 * Secrets: none here; the token stays inside `gh` or the wrapper.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { connect, landOne } from "./land.mjs";
import { trackerFor } from "../adapters/tracker/index.mjs";
import { say } from "../lib/cli.mjs";
import { gateLogins, loadConfig } from "../lib/config.mjs";
import { presetDir } from "../lib/flow-dir.mjs";
import { defaultBranch, fetch, git, mainCheckout } from "../lib/git.mjs";
import { NAME } from "../lib/product.mjs";
import { QueueError, withQueueLock } from "../lib/queue.mjs";
import { YamlError, parseYaml } from "../lib/yaml.mjs";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISSUE = /^[A-Za-z][A-Za-z0-9]*-\d+$/;
/** An owner as the numbers file records it: one line with no YAML key or comment mark (core's rule). */
const OWNER = /^[^\n:#]+$/;
/** Flow's own binary, so the gate runs as a child whose stdout can be sent to stderr. */
const BIN = fileURLToPath(new URL("../../bin/fflow.mjs", import.meta.url));
/** A repository-relative file path with no `..` segment. */
const FILE = /^(?!.*(?:^|\/)\.\.(?:\/|$))[\w.-]+(?:\/[\w.-]+)*$/;

/** How long a reservation waits for its PR's checks, approval and auto-merge before it gives up. */
export const LAND_WAIT_MS = 10 * 60_000;

/**
 * The numbers file the preset's `queues:` names for `name`, or undefined.
 * @param {string} root
 * @param {string} name
 */
export function queueFile(root, name) {
  const file = join(presetDir(root), "preset.yml");
  let path;
  try {
    path = existsSync(file) ? parseYaml(readFileSync(file, "utf8"))?.queues?.[name] : undefined;
  } catch (error) {
    // A repository's own preset.yml outside the YAML subset declares no queue.
    if (!(error instanceof YamlError)) throw error;
  }
  return typeof path === "string" && FILE.test(path) ? path : undefined;
}

/** The next free number of a numbers file: its highest top-level key plus one, four digits. */
export function nextNumber(/** @type {string} */ text) {
  const keys = [...text.matchAll(/^["']?(\d+)["']?\s*:/gm)].map((m) => Number(m[1]));
  return String(Math.max(0, ...keys) + 1).padStart(4, "0");
}

/** The numbers file with the reservation appended as its last entry. */
export function withReservation(
  /** @type {string} */ text,
  /** @type {string} */ number,
  /** @type {{ slug: string, issue: string, owner?: string }} */ { slug, issue, owner },
) {
  const entry = [
    `"${number}":`,
    `  slug: ${slug}`,
    "  status: reserved",
    ...(owner ? [`  owner: ${owner}`] : []),
    `  issue: ${issue}`,
  ];
  return `${text === "" || text.endsWith("\n") ? text : `${text}\n`}${entry.join("\n")}\n`;
}

/** Turns a PR's auto-merge off. */
const DISABLE_AUTO_MERGE = `mutation($id: ID!) {
  disablePullRequestAutoMerge(input: { pullRequestId: $id }) { clientMutationId }
}`;

/**
 * @typedef {{ api: import("../lib/github.mjs").Api, repo: string, base: string, file?: string,
 *             gate: (branch: string) => Promise<number>,
 *             land: (pr: number) => Promise<{ code: number, merged?: string, queued?: boolean, problems?: string[] }>,
 *             log: (s: string) => void, sleep?: (ms: number) => Promise<unknown>, now?: () => number }} ReserveDeps
 */

/**
 * Reserves the next ADR number for `slug`: returns it only once its entry is on the default branch. One that does not
 * land is withdrawn (auto-merge off, the PR closed, its branch deleted), so it cannot land later.
 * @param {{ root: string, slug: string, issue: string, owner?: string, deps: ReserveDeps }} options
 * @returns {Promise<{ number?: string, pr?: number, problem?: string }>}
 */
export async function reserveAdr({ root, slug, issue, owner, deps }) {
  const { api, repo, base, gate, land, log } = deps;
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? Date.now;
  if (!SLUG.test(slug)) return { problem: `"${slug}" is not a kebab-case slug` };
  if (!ISSUE.test(issue)) return { problem: `"${issue}" is not an issue key (e.g. STA-12)` };
  if (owner !== undefined && !OWNER.test(owner))
    return { problem: `"${owner}" is not an owner (one line, no \`:\` or \`#\`)` };
  const file = deps.file ?? queueFile(root, "adr");
  if (!file) return { problem: "the preset declares no `queues.adr` numbers file" };
  const key = issue.toUpperCase();
  return withQueueLock({ api, repo, name: "adr", base, sleep, now, log }, async () => {
    // The tip first, and the file at it, so the branch and the file's blob agree.
    const tip = api("GET", `/repos/${repo}/git/ref/heads/${base}`).json?.object?.sha;
    if (!tip) return { problem: `cannot read ${base}'s tip` };
    const got = api("GET", `/repos/${repo}/contents/${file}?ref=${tip}`);
    if (!got.ok) return { problem: `cannot read ${file} on ${base}: ${got.err}` };
    const text = Buffer.from(String(got.json?.content ?? ""), "base64").toString("utf8");
    const number = nextNumber(text);
    const branch = `adr/${number}-${slug}`;
    const title = `docs(adr): reserve ${number} ${slug}`;
    const made = api("POST", `/repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: tip });
    if (!made.ok) return { problem: `cannot create ${branch}: ${made.err}` };
    /** @type {number | undefined} */
    let pr;
    let nodeId;
    let armed = false;
    /**
     * The reservation did not land: take it off GitHub so a later `land` cannot land it, or return its number when
     * GitHub merged it in the meantime.
     * @param {string} why
     * @returns {Promise<{ number?: string, pr?: number, problem?: string }>}
     */
    const withdraw = async (why) => {
      if (pr !== undefined) {
        if (armed)
          api("POST", "/graphql", { query: DISABLE_AUTO_MERGE, variables: { id: nodeId } });
        api("PATCH", `/repos/${repo}/pulls/${pr}`, { state: "closed" });
        // Merged before auto-merge went off: the number is on the base, and `land` finishes the rest.
        if (api("GET", `/repos/${repo}/pulls/${pr}`).json?.merged) {
          await land(pr);
          return { number, pr };
        }
      }
      const gone = api("DELETE", `/repos/${repo}/git/refs/heads/${branch}`).ok;
      return {
        pr,
        problem: `${why}; nothing reserved${gone ? "" : ` (${branch} was not deleted: delete it${pr === undefined ? "" : ` and close #${pr}`}, it must not be landed)`}`,
      };
    };
    const put = api("PUT", `/repos/${repo}/contents/${file}`, {
      message: `${title}\n\nRefs: ${key}`,
      content: Buffer.from(withReservation(text, number, { slug, issue: key, owner })).toString(
        "base64",
      ),
      sha: got.json?.sha,
      branch,
    });
    if (!put.ok) return withdraw(`cannot commit the reservation to ${branch}: ${put.err}`);
    const opened = api("POST", `/repos/${repo}/pulls`, {
      title,
      head: branch,
      base,
      body: `Reserves ADR ${number} for \`${slug}\` (${key}), through \`${NAME} adr reserve\`.\n\nRefs: ${key}`,
    });
    if (!opened.ok || typeof opened.json?.number !== "number")
      return withdraw(`cannot open the PR for ${branch}: ${opened.err}`);
    pr = /** @type {number} */ (opened.json.number);
    nodeId = opened.json.node_id;
    const url = `https://github.com/${repo}/pull/${pr}`;
    // shortcut: a gate longer than the lock's 15 minutes lets a stale takeover read the same number; its PR then
    // conflicts on the same lines and lands nothing, so numbers stay distinct. Upgrade to a lock heartbeat if seen.
    const gated = await gate(branch);
    if (gated !== 0) return withdraw(`${NAME} gate run exited ${gated} on ${url}`);
    const deadline = now() + LAND_WAIT_MS;
    let landed = await land(pr);
    // Waiting on checks (4) asks `land` again; an auto-merge waits for the merge, which `land` then finishes.
    while (!landed.merged && (landed.code === 4 || (landed.code === 0 && landed.queued))) {
      if (landed.code === 0) armed = true;
      if (now() >= deadline) break;
      await sleep(15_000);
      if (landed.code === 4 || api("GET", `/repos/${repo}/pulls/${pr}`).json?.merged)
        landed = await land(pr);
    }
    if (!landed.merged)
      return withdraw(
        `${url} did not land${landed.problems?.length ? `: ${landed.problems.join("; ")}` : ` in ${LAND_WAIT_MS / 60_000} minutes`}`,
      );
    return { number, pr };
  });
}

/**
 * `fflow adr reserve <slug> --issue <key> [--owner <who>]`. The number alone goes to stdout, so
 * `n=$(fflow adr reserve …)` captures just it.
 * @param {string[]} args
 * @param {{ cwd?: string, connectTo?: typeof connect, reserve?: typeof reserveAdr }} [seams] for tests
 */
export async function run(
  args,
  { cwd = process.cwd(), connectTo = connect, reserve = reserveAdr } = {},
) {
  const [verb, ...rest] = args;
  /** @type {string[]} */
  const slugs = [];
  /** @type {Record<string, string | undefined>} */
  const opts = {};
  for (let i = 0; i < rest.length; i++)
    if (rest[i] === "--issue" || rest[i] === "--owner") opts[rest[i].slice(2)] = rest[++i];
    else slugs.push(rest[i]);
  const { issue, owner } = opts;
  if (verb !== "reserve" || !issue || slugs.length !== 1 || ("owner" in opts && !owner)) {
    console.error(`usage: ${NAME} adr reserve <kebab-slug> --issue <key> [--owner <who>]`);
    return 2;
  }
  const root = mainCheckout(cwd);
  if (!root) {
    console.error(`${NAME} adr: not in a git repository`);
    return 2;
  }
  const { repo, api, problem: refusal } = connectTo(root);
  if (!repo || !api) {
    console.error(`${NAME} adr: ${refusal}`);
    return 2;
  }
  const base = defaultBranch(root);
  const { scheme, tracker, problem } = trackerFor(root);
  const apps = loadConfig(root).config.apps ?? {};
  const landDeps = {
    api,
    scheme,
    done: (/** @type {string} */ key, /** @type {string} */ url) =>
      tracker ? tracker.done(scheme.display(key), url) : Promise.reject(new Error(problem)),
    log: console.error,
    warn: console.error,
  };
  /** @type {{ number?: string, pr?: number, problem?: string }} */
  let result;
  try {
    result = await reserve({
      root,
      slug: slugs[0],
      issue,
      owner,
      deps: {
        api,
        repo,
        base,
        log: console.error,
        land: (number) =>
          landOne({
            root,
            repo,
            base,
            number,
            gateApp: gateLogins(apps),
            reviewer: apps.review?.slug,
            owner: apps.owner,
            // The squash names this issue, whatever key the slug `adr/<n>-<slug>` seems to carry; landing does not close it.
            refs: issue,
            deps: landDeps,
          }),
        // The gate runs on the reservation's head from a throwaway detached worktree (ADR 0503: worktrees live only
        // in .claude/worktrees/), as a child whose output goes to stderr.
        gate: async (branch) => {
          const dir = join(root, ".claude", "worktrees", branch.replaceAll("/", "-"));
          const ready = fetch(root);
          const added = ready.ok
            ? git(root, ["worktree", "add", "-q", "--detach", dir, `origin/${branch}`])
            : ready;
          if (!added.ok) {
            console.error(`${NAME} adr: cannot check out ${branch} to gate it: ${added.err}`);
            return 2;
          }
          try {
            const gated = spawnSync(process.execPath, [BIN, "gate", "run", "--ref", branch], {
              cwd: dir,
              stdio: ["ignore", 2, 2],
            });
            return gated.error ? 127 : (gated.status ?? 4);
          } finally {
            git(root, ["worktree", "remove", "--force", dir]);
          }
        },
      },
    });
  } catch (error) {
    // the lock could not be taken (no access, an unreadable default branch)
    if (!(error instanceof QueueError)) throw error;
    result = { problem: error.message };
  }
  if (result.problem) {
    console.error(`${NAME} adr: ${result.problem}`);
    say("blocked", `${NAME} adr reserve: not reserved`);
    return 1;
  }
  console.log(result.number);
  say("shipped", `${NAME} adr reserve: ${result.number} is on ${base} (#${result.pr})`);
  return 0;
}
