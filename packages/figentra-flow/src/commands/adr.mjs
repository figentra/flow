/**
 * Figentra Flow file contract:
 * Purpose: `fflow adr reserve <slug> --issue <key>` (STA-1945 FR-17): under the `adr` queue lock, read the numbers
 *   file the preset's `queues.adr` names on the default branch, append the next number on a branch `adr/<n>-<slug>`,
 *   open a PR, gate it and land it with `fflow land`, and only then print the number. Two sessions never take one.
 * Boundary: GitHub through the configured credentials; the working tree is never touched (the gate runs from a
 *   temporary detached worktree in `.claude/worktrees/`). A reservation that does not land prints no number and names
 *   its PR; the lock is always released.
 * Runtime: node
 * Governing contract: STA-1945 (FR-17, AC-15, P-023; plan C12); replaces core's `tools/scripts/adr-reserve.mjs`
 *   (STA-1732).
 * Secrets: none here; the token stays inside `gh` or the wrapper.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { gateRun } from "./gate-run.mjs";
import { connect, landOne } from "./land.mjs";
import { trackerFor } from "../adapters/tracker/index.mjs";
import { say } from "../lib/cli.mjs";
import { loadConfig } from "../lib/config.mjs";
import { presetDir } from "../lib/flow-dir.mjs";
import { defaultBranch, fetch, git, mainCheckout } from "../lib/git.mjs";
import { NAME } from "../lib/product.mjs";
import { QueueError, withQueueLock } from "../lib/queue.mjs";
import { parseYaml } from "../lib/yaml.mjs";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISSUE = /^[A-Za-z][A-Za-z0-9]*-\d+$/;
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
  const path = existsSync(file) ? parseYaml(readFileSync(file, "utf8"))?.queues?.[name] : undefined;
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
  /** @type {{ slug: string, issue: string }} */ { slug, issue },
) {
  const entry = [`"${number}":`, `  slug: ${slug}`, "  status: reserved", `  issue: ${issue}`];
  return `${text === "" || text.endsWith("\n") ? text : `${text}\n`}${entry.join("\n")}\n`;
}

/**
 * @typedef {{ api: import("../lib/github.mjs").Api, repo: string, base: string, file?: string,
 *             gate: (branch: string) => Promise<number>,
 *             land: (pr: number) => Promise<{ code: number, merged?: string, queued?: boolean, problems?: string[] }>,
 *             log: (s: string) => void, sleep?: (ms: number) => Promise<unknown>, now?: () => number }} ReserveDeps
 */

/**
 * Reserves the next ADR number for `slug`: returns it only once its entry is on the default branch.
 * @param {{ root: string, slug: string, issue: string, deps: ReserveDeps }} options
 * @returns {Promise<{ number?: string, pr?: number, problem?: string }>}
 */
export async function reserveAdr({ root, slug, issue, deps }) {
  const { api, repo, base, gate, land, log } = deps;
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? Date.now;
  if (!SLUG.test(slug)) return { problem: `"${slug}" is not a kebab-case slug` };
  if (!ISSUE.test(issue)) return { problem: `"${issue}" is not an issue key (e.g. STA-12)` };
  const file = deps.file ?? queueFile(root, "adr");
  if (!file) return { problem: "the preset declares no `queues.adr` numbers file" };
  const key = issue.toUpperCase();
  return withQueueLock({ api, repo, name: "adr", base, sleep, now, log }, async () => {
    const got = api("GET", `/repos/${repo}/contents/${file}?ref=${base}`);
    if (!got.ok) return { problem: `cannot read ${file} on ${base}: ${got.err}` };
    const text = Buffer.from(String(got.json?.content ?? ""), "base64").toString("utf8");
    const number = nextNumber(text);
    const branch = `adr/${number}-${slug}`;
    const title = `docs(adr): reserve ${number} ${slug}`;
    const tip = api("GET", `/repos/${repo}/git/ref/heads/${base}`).json?.object?.sha;
    if (!tip) return { problem: `cannot read ${base}'s tip` };
    const made = api("POST", `/repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: tip });
    if (!made.ok) return { problem: `cannot create ${branch}: ${made.err}` };
    const put = api("PUT", `/repos/${repo}/contents/${file}`, {
      message: `${title}\n\nRefs: ${key}`,
      content: Buffer.from(withReservation(text, number, { slug, issue: key })).toString("base64"),
      sha: got.json?.sha,
      branch,
    });
    if (!put.ok) return { problem: `cannot commit the reservation to ${branch}: ${put.err}` };
    const opened = api("POST", `/repos/${repo}/pulls`, {
      title,
      head: branch,
      base,
      body: `Reserves ADR ${number} for \`${slug}\` (${key}), through \`${NAME} adr reserve\`.\n\nRefs: ${key}`,
    });
    const pr = opened.json?.number;
    if (!opened.ok || typeof pr !== "number")
      return { problem: `cannot open the PR for ${branch}: ${opened.err}` };
    const url = `https://github.com/${repo}/pull/${pr}`;
    // shortcut: a gate longer than the lock's 15 minutes lets a stale takeover read the same number; its PR then
    // conflicts on the same lines and lands nothing, so numbers stay distinct. Upgrade to a lock heartbeat if seen.
    const gated = await gate(branch);
    if (gated !== 0)
      return { pr, problem: `${NAME} gate run exited ${gated} on ${url}; nothing reserved` };
    const deadline = now() + LAND_WAIT_MS;
    let landed = await land(pr);
    // Waiting on checks (4) asks `land` again; an auto-merge waits for the merge, which `land` then finishes.
    while (!landed.merged && (landed.code === 4 || (landed.code === 0 && landed.queued))) {
      if (now() >= deadline) break;
      await sleep(15_000);
      if (landed.code === 4 || api("GET", `/repos/${repo}/pulls/${pr}`).json?.merged)
        landed = await land(pr);
    }
    if (!landed.merged)
      return {
        pr,
        problem: `${url} did not land${landed.problems?.length ? `: ${landed.problems.join("; ")}` : ""}; nothing reserved`,
      };
    return { number, pr };
  });
}

/** `fflow adr reserve <slug> --issue <key>`. */
export async function run(/** @type {string[]} */ args) {
  const [verb, ...rest] = args;
  const at = rest.indexOf("--issue");
  const issue = at >= 0 ? rest[at + 1] : undefined;
  const slugs = rest.filter((_, i) => at < 0 || (i !== at && i !== at + 1));
  if (verb !== "reserve" || !issue || slugs.length !== 1) {
    console.error(`usage: ${NAME} adr reserve <kebab-slug> --issue <key>`);
    return 2;
  }
  const root = mainCheckout(process.cwd());
  if (!root) {
    console.error(`${NAME} adr: not in a git repository`);
    return 2;
  }
  const { repo, api, problem: refusal } = connect(root);
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
    log: console.log,
    warn: console.error,
  };
  /** @type {{ number?: string, pr?: number, problem?: string }} */
  let result;
  try {
    result = await reserveAdr({
      root,
      slug: slugs[0],
      issue,
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
            gateApp: apps.gate?.login,
            reviewer: apps.review?.slug,
            owner: apps.owner,
            deps: landDeps,
          }),
        // The gate runs on the reservation's head from a throwaway detached worktree (ADR 0503: worktrees live only
        // in .claude/worktrees/).
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
            const gated = await gateRun({ cwd: dir, ref: branch });
            if (gated.problem) console.error(`${NAME} adr: ${gated.problem}`);
            return gated.code;
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
