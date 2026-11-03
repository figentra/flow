/**
 * Figentra Flow file contract:
 * Purpose: Flow's queue lock (STA-1945 FR-17): the branch ref `flow/queue/<name>`, created through the GitHub API on a
 *   commit made for it. Creating the ref fails while another session holds it, so one session holds a queue at a time.
 *   A lock whose commit is older than 15 minutes is stale: it is taken over by a fast-forward onto a child of that
 *   commit, which only one taker can win.
 * Boundary: GitHub refs and commits only; never the working tree or a local branch. The lock is released in `finally`,
 *   and only while it is still this session's.
 * Runtime: node
 * Governing contract: STA-1945 (FR-17, AC-15, P-023; plan C12).
 * Secrets: none here; the token stays inside `gh` or the wrapper.
 */
import { NAME } from "./product.mjs";

/** A lock older than this is stale and may be taken over. */
export const STALE_MINUTES = 15;

/** The branch folder the queue locks live in. */
export const QUEUE_PREFIX = "flow/queue/";

/** A queue's name: one lower-case kebab segment. */
const QUEUE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The lock could not be taken for a reason other than another holder (no access, an unreadable base). */
export class QueueError extends Error {}

/**
 * Runs `fn` while this session holds the queue `name`: waits with backoff while another holds it, takes it over with a
 * notice once that holder is stale, and releases it when `fn` ends, however it ends.
 * @template T
 * @param {{ api: import("./github.mjs").Api, repo: string, name: string, base?: string, staleMinutes?: number,
 *           now?: () => number, sleep?: (ms: number) => Promise<unknown>, log?: (s: string) => void }} options
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withQueueLock(options, fn) {
  const {
    api,
    repo,
    name,
    base = "main",
    staleMinutes = STALE_MINUTES,
    now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log = console.error,
  } = options;
  if (!QUEUE_NAME.test(name)) throw new QueueError(`"${name}" is not a queue name`);
  const branch = `${QUEUE_PREFIX}${name}`;
  const refUrl = `/repos/${repo}/git/ref/heads/${branch}`;
  const tip = api("GET", `/repos/${repo}/git/ref/heads/${base}`);
  const baseSha = tip.json?.object?.sha;
  const tree = baseSha && api("GET", `/repos/${repo}/git/commits/${baseSha}`).json?.tree?.sha;
  if (!tree) throw new QueueError(`cannot read ${base} to make the ${branch} lock: ${tip.err}`);
  /** A fresh lock commit, dated now by GitHub, so its age is the hold's age. */
  const lockCommit = (/** @type {string} */ parent) => {
    const made = api("POST", `/repos/${repo}/git/commits`, {
      message: `${NAME} queue lock: ${name}`,
      tree,
      parents: [parent],
    });
    if (!made.json?.sha) throw new QueueError(`cannot make the ${branch} lock: ${made.err}`);
    return /** @type {string} */ (made.json.sha);
  };

  /** @type {string | undefined} */
  let held;
  let wait = 5000;
  let missing = 0;
  let announced = false;
  while (!held) {
    const mine = lockCommit(baseSha);
    const made = api("POST", `/repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: mine });
    if (made.ok) {
      held = mine;
      continue;
    }
    const at = api("GET", refUrl).json?.object?.sha;
    if (!at) {
      // Released between the two calls; a create that keeps failing with no holder is a refusal, not a wait.
      if (++missing >= 3) throw new QueueError(`cannot create ${branch}: ${made.err}`);
      continue;
    }
    missing = 0;
    const since = Date.parse(api("GET", `/repos/${repo}/git/commits/${at}`).json?.committer?.date ?? "");
    if (Number.isFinite(since) && now() - since >= staleMinutes * 60_000) {
      // A fast-forward from the stale commit: if another taker moved or released it first, this one is refused.
      const take = lockCommit(at);
      if (api("PATCH", `/repos/${repo}/git/refs/heads/${branch}`, { sha: take, force: false }).ok) {
        log(
          `${NAME}: took the ${name} queue over from a stale lock of ${new Date(since).toISOString()}`,
        );
        held = take;
      }
      continue;
    }
    if (!announced)
      log(
        `${NAME}: the ${name} queue is held${Number.isFinite(since) ? ` since ${new Date(since).toISOString()}` : ""}; waiting`,
      );
    announced = true;
    await sleep(wait);
    wait = Math.min(wait * 2, 60_000);
  }

  try {
    return await fn();
  } finally {
    // shortcut: read-then-delete is not atomic; a takeover in that instant loses its lock, which then times out stale.
    if (api("GET", refUrl).json?.object?.sha === held) {
      const gone = api("DELETE", `/repos/${repo}/git/refs/heads/${branch}`);
      if (!gone.ok)
        log(`${NAME}: warning: ${branch} was not released (${gone.err}); it goes stale in ${staleMinutes} minutes`);
    } else log(`${NAME}: warning: ${branch} was taken over as stale while this session held it`);
  }
}
