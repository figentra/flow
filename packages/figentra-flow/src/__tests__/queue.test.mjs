/**
 * Figentra Flow file contract:
 * Purpose: hold the queue lock to its contract: one holder at a time (a second session waits until the first
 *   releases), a lock older than 15 minutes is taken over with a notice, the lock is released when the work throws,
 *   a lock taken over while held is left to its new holder, and a bad queue name is refused.
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
