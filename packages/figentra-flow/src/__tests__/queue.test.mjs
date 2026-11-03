/**
 * Figentra Flow file contract:
 * Purpose: hold the queue lock to its contract: one holder at a time (a second session waits until the first
 *   releases), a lock 15 minutes old or more is taken over with a notice and only one of two takers wins, the lock is
 *   released when the work throws, a lock taken over while held is left to its new holder, a create whose answer was
 *   lost is this session's, and every refusal (a bad name, an unreadable base or holder, a lock commit, a create or a
 *   takeover GitHub keeps refusing) ends in a QueueError instead of a wait.
 * Boundary: an in-memory GitHub (refs and commits) and an injected clock; no network.
 * Runtime: node
 * Governing contract: STA-1945 (FR-17, AC-15, P-023; plan C12).
 */
// @covers sta-1945:FR-17 sta-1945:AC-15 sta-1945:P-023
import { test } from "node:test";
import assert from "node:assert/strict";

import { QueueError, withQueueLock } from "../lib/queue.mjs";
import { fakeGitHub } from "./__fixtures__/github.mjs";

const REPO = "o/r";
const LOCK = "heads/flow/queue/adr";

/** A clock that `sleep` moves forward, yielding to the other session each time. */
const timing = () => {
  const clock = { t: Date.parse("2026-11-03T10:00:00Z") };
  /** @type {number[]} */
  const slept = [];
  const sleep = async (/** @type {number} */ ms) => {
    slept.push(ms);
    clock.t += ms;
    await new Promise((resolve) => setImmediate(resolve));
  };
  return { clock, slept, sleep, now: () => clock.t };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("withQueueLock: two sessions at once hold the queue one after the other, and the lock is released", async () => {
  const { clock, slept, sleep, now } = timing();
  const { api, refs } = fakeGitHub(clock);
  /** @type {string[]} */
  const logs = [];
  const options = {
    api,
    repo: REPO,
    name: "adr",
    sleep,
    now,
    log: (/** @type {string} */ s) => logs.push(s),
  };
  let inside = 0;
  /** @type {string[]} */
  const order = [];
  const work = (/** @type {string} */ who) => async () => {
    inside++;
    assert.equal(inside, 1, "two sessions held the queue at once");
    assert.ok(refs.has(LOCK));
    order.push(`${who} in`);
    await tick();
    await tick();
    order.push(`${who} out`);
    inside--;
    return who;
  };
  const results = await Promise.all([
    withQueueLock(options, work("a")),
    withQueueLock(options, work("b")),
  ]);
  assert.deepEqual(results, ["a", "b"]);
  assert.deepEqual(order, ["a in", "a out", "b in", "b out"]);
  assert.ok(slept.length > 0, "the second session waited");
  assert.match(logs.join("\n"), /the adr queue is held since .*; waiting/);
  assert.equal(refs.has(LOCK), false);
});

test("withQueueLock: a lock older than 15 minutes is taken over with a notice", async () => {
  const { clock, slept, sleep, now } = timing();
  const { api, refs, commits } = fakeGitHub(clock);
  commits.set("old", {
    tree: { sha: "t0" },
    parents: ["m0"],
    committer: { date: new Date(clock.t - 16 * 60_000).toISOString() },
  });
  refs.set(LOCK, "old");
  /** @type {string[]} */
  const logs = [];
  const got = await withQueueLock(
    { api, repo: REPO, name: "adr", sleep, now, log: (s) => logs.push(s) },
    async () => {
      assert.equal(commits.get(/** @type {string} */ (refs.get(LOCK)))?.parents[0], "old");
      return 42;
    },
  );
  assert.equal(got, 42);
  assert.deepEqual(slept, []);
  assert.match(logs.join("\n"), /took the adr queue over from a stale lock/);
  assert.equal(refs.has(LOCK), false);
});

test("withQueueLock: a fresh lock is not taken over; the session waits for it", async () => {
  const { clock, slept, sleep, now } = timing();
  const { api, refs, commits } = fakeGitHub(clock);
  commits.set("held", {
    tree: { sha: "t0" },
    parents: ["m0"],
    committer: { date: new Date(clock.t - 14 * 60_000).toISOString() },
  });
  refs.set(LOCK, "held");
  // The holder releases after the first wait.
  const release = async (/** @type {number} */ ms) => {
    await sleep(ms);
    refs.delete(LOCK);
  };
  await withQueueLock(
    { api, repo: REPO, name: "adr", sleep: release, now, log: () => {} },
    async () => {
      assert.notEqual(refs.get(LOCK), "held");
    },
  );
  assert.deepEqual(slept, [5000]);
});

test("withQueueLock: the lock is released when the work throws", async () => {
  const { clock, sleep, now } = timing();
  const { api, refs } = fakeGitHub(clock);
  await assert.rejects(
    withQueueLock({ api, repo: REPO, name: "adr", sleep, now, log: () => {} }, async () => {
      throw new Error("boom");
    }),
    /boom/,
  );
  assert.equal(refs.has(LOCK), false);
});

test("withQueueLock: a lock taken over while held is left to its new holder, with a warning", async () => {
  const { clock, sleep, now } = timing();
  const { api, refs } = fakeGitHub(clock);
  /** @type {string[]} */
  const logs = [];
  await withQueueLock(
    { api, repo: REPO, name: "adr", sleep, now, log: (s) => logs.push(s) },
    async () => {
      refs.set(LOCK, "someone-else");
    },
  );
  assert.equal(refs.get(LOCK), "someone-else");
  assert.match(logs.join("\n"), /taken over as stale while this session held it/);
});

test("withQueueLock: a bad queue name, or a base it cannot read, is refused before any lock", async () => {
  const { clock, sleep, now } = timing();
  const { api, refs } = fakeGitHub(clock);
  const run = () => Promise.resolve();
  await assert.rejects(
    withQueueLock({ api, repo: REPO, name: "../x", sleep, now }, run),
    QueueError,
  );
  await assert.rejects(
    withQueueLock({ api, repo: REPO, name: "adr", base: "nope", sleep, now }, run),
    /cannot read nope/,
  );
  assert.equal(refs.has(LOCK), false);
});

/** The fake's API with `method` on paths matching `re` refused with `err`. */
const refusing =
  (
    /** @type {import("../lib/github.mjs").Api} */ api,
    /** @type {string} */ method,
    /** @type {RegExp} */ re,
    err = "HTTP 403",
  ) =>
  /** @type {import("../lib/github.mjs").Api} */
  (m, path, body) =>
    m === method && re.test(path) ? { ok: false, json: { message: err }, err } : api(m, path, body);

/** A lock at `sha`, `minutes` old. */
const lockAt = (
  /** @type {ReturnType<typeof fakeGitHub>} */ gh,
  /** @type {{ t: number }} */ clock,
  /** @type {string} */ sha,
  /** @type {number} */ minutes,
) => {
  gh.commits.set(sha, {
    tree: { sha: "t0" },
    parents: ["m0"],
    committer: { date: new Date(clock.t - minutes * 60_000).toISOString() },
  });
  gh.refs.set(LOCK, sha);
};

test("withQueueLock: a lock exactly 15 minutes old is stale", async () => {
  const { clock, slept, sleep, now } = timing();
  const gh = fakeGitHub(clock);
  lockAt(gh, clock, "old", 15);
  await withQueueLock(
    { api: gh.api, repo: REPO, name: "adr", sleep, now, log: () => {} },
    async () =>
      assert.equal(gh.commits.get(/** @type {string} */ (gh.refs.get(LOCK)))?.parents[0], "old"),
  );
  assert.deepEqual(slept, []);
});

test("withQueueLock: a takeover GitHub refuses while the lock stays stale is a QueueError, not a loop", async () => {
  const { clock, sleep, now } = timing();
  const gh = fakeGitHub(clock);
  lockAt(gh, clock, "old", 16);
  let patches = 0;
  const api = refusing(gh.api, "PATCH", /\/git\/refs\//);
  await assert.rejects(
    withQueueLock(
      {
        api: (m, path, body) => {
          if (m === "PATCH") patches++;
          return api(m, path, body);
        },
        repo: REPO,
        name: "adr",
        sleep,
        now,
        log: () => {},
      },
      async () => assert.fail("ran without the lock"),
    ),
    (error) =>
      error instanceof QueueError &&
      /cannot take over the stale flow\/queue\/adr lock: HTTP 403/.test(error.message),
  );
  assert.equal(patches, 1);
  assert.equal(gh.refs.get(LOCK), "old");
});

test("withQueueLock: of two takers of one stale lock only one wins; the other waits for it", async () => {
  const { clock, slept, sleep, now } = timing();
  const gh = fakeGitHub(clock);
  lockAt(gh, clock, "old", 16);
  let rival = "";
  /** @type {import("../lib/github.mjs").Api} */
  const api = (m, path, body) => {
    // The rival's fast-forward from the same stale commit lands just before this session's.
    if (m === "PATCH" && !rival) {
      rival = gh.api("POST", `/repos/${REPO}/git/commits`, { tree: "t0", parents: ["old"] }).json
        .sha;
      assert.equal(gh.api("PATCH", path, { sha: rival, force: false }).ok, true);
    }
    return gh.api(m, path, body);
  };
  /** @type {string[]} */
  const logs = [];
  const release = async (/** @type {number} */ ms) => {
    assert.equal(gh.refs.get(LOCK), rival, "the rival holds the queue while this session waits");
    await sleep(ms);
    gh.refs.delete(LOCK);
  };
  await withQueueLock(
    { api, repo: REPO, name: "adr", sleep: release, now, log: (s) => logs.push(s) },
    async () => assert.notEqual(gh.refs.get(LOCK), rival),
  );
  assert.deepEqual(slept, [5000]);
  assert.doesNotMatch(logs.join("\n"), /took the adr queue over/);
  assert.match(logs.join("\n"), /the adr queue is held since .*; waiting/);
  assert.equal(gh.refs.has(LOCK), false);
});

test("withQueueLock: a create whose answer was lost holds the lock, without waiting for itself", async () => {
  const { clock, slept, sleep, now } = timing();
  const gh = fakeGitHub(clock);
  /** @type {import("../lib/github.mjs").Api} */
  const api = (m, path, body) => {
    const r = gh.api(m, path, body);
    return m === "POST" && path.endsWith("/git/refs")
      ? { ok: false, json: {}, err: "HTTP 502" }
      : r;
  };
  let ran = false;
  await withQueueLock({ api, repo: REPO, name: "adr", sleep, now, log: () => {} }, async () => {
    ran = true;
  });
  assert.equal(ran, true);
  assert.deepEqual(slept, []);
  assert.equal(gh.refs.has(LOCK), false);
});

test("withQueueLock: a lock commit, a create or a holder GitHub keeps refusing is a QueueError", async () => {
  const run = async () => assert.fail("ran without the lock");
  const world = () => {
    const t = timing();
    return { ...t, gh: fakeGitHub(t.clock) };
  };
  const one = world();
  await assert.rejects(
    withQueueLock(
      {
        ...one,
        api: refusing(one.gh.api, "POST", /\/git\/commits$/),
        repo: REPO,
        name: "adr",
        log: () => {},
      },
      run,
    ),
    (error) =>
      error instanceof QueueError &&
      /cannot make the flow\/queue\/adr lock: HTTP 403/.test(error.message),
  );
  const two = world();
  await assert.rejects(
    withQueueLock(
      {
        ...two,
        api: refusing(two.gh.api, "POST", /\/git\/refs$/),
        repo: REPO,
        name: "adr",
        log: () => {},
      },
      run,
    ),
    (error) =>
      error instanceof QueueError && /cannot create flow\/queue\/adr: HTTP 403/.test(error.message),
  );
  assert.equal(two.gh.refs.has(LOCK), false);
  // A holder whose commit cannot be read: two waits, then the refusal.
  const three = world();
  three.gh.refs.set(LOCK, "ghost");
  await assert.rejects(
    withQueueLock({ ...three, api: three.gh.api, repo: REPO, name: "adr", log: () => {} }, run),
    (error) =>
      error instanceof QueueError &&
      /cannot read the flow\/queue\/adr lock's commit ghost/.test(error.message),
  );
  assert.equal(three.slept.length, 2);
  assert.equal(three.gh.refs.get(LOCK), "ghost");
});
