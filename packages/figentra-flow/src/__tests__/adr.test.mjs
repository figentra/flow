/**
 * Figentra Flow file contract:
 * Purpose: hold `fflow adr reserve` to its contract: the next number is the numbers file's highest plus one; two
 *   sessions reserving at once get different numbers, each on the default branch before it is returned; a
 *   reservation that fails at any step (reading the tip or the file, the branch, the commit, the PR, the gate, the
 *   land, the land deadline) returns no number, withdraws what it made (auto-merge off, the PR closed, the branch
 *   deleted) and releases the lock, unless GitHub merged it first; one that waits on checks or auto-merge returns
 *   once merged; the stackra preset names the numbers file, and a preset without one (or one whose preset.yml is
 *   outside the YAML subset) is refused; the CLI prints only
 *   the number on stdout and turns each refusal into its exit code.
 * Boundary: an in-memory GitHub, the gate and `land` injected; temporary folders for the CLI; no network.
 * Runtime: node
 * Governing contract: STA-1945 (FR-17, AC-15, P-023; plan C12).
 */
// @covers sta-1945:FR-17 sta-1945:AC-15 sta-1945:P-023
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  LAND_WAIT_MS,
  nextNumber,
  queueFile,
  reserveAdr,
  run,
  withReservation,
} from "../commands/adr.mjs";
import { CONFIG_FILE } from "../lib/product.mjs";
import { QueueError } from "../lib/queue.mjs";
import { fakeGitHub } from "./__fixtures__/github.mjs";

const REPO = "o/r";
const FILE = "apps/docs/adr/numbers.yaml";
const START =
  '# the register\n"0001":\n  slug: first\n  status: accepted\n"0007":\n  slug: seventh\n';
const LOCK = "heads/flow/queue/adr";
const tick = () => new Promise((resolve) => setImmediate(resolve));

/**
 * The fake GitHub with the contents and pulls API, and a `land` that squash-merges a PR's file onto `main` unless
 * `main`'s copy moved since the branch was cut (the conflict a loser would meet). A merge moves `main`'s ref to a new
 * commit, at which the file can be read. `merge` says what `land` does: merge, refuse, turn auto-merge on (`queue`),
 * or wait on checks (`wait`, code 4); `onDisable` runs when auto-merge is turned off.
 * @param {{ merge?: (pr: number) => "merge" | "refuse" | "queue" | "wait", onDisable?: () => void }} [options]
 */
function github({ merge = () => "merge", onDisable = () => {} } = {}) {
  const clock = { t: Date.parse("2026-11-03T10:00:00Z") };
  const gh = fakeGitHub(clock);
  /** @type {Map<string, { text: string, sha: string }>} the numbers file on each branch, and at each main commit */
  const files = new Map([
    ["main", { text: START, sha: "f0" }],
    ["m0", { text: START, sha: "f0" }],
  ]);
  /** @type {Map<number, { head: string, from: string, merged: boolean, closed?: boolean }>} */
  const pulls = new Map();
  /** @type {string[]} the auto-merge ids turned off */
  const disabled = [];
  let n = 0;
  const ok = (/** @type {any} */ json) => ({ ok: true, json, err: "" });
  /** @type {import("../lib/github.mjs").Api} */
  const api = (method, path, body) => {
    const b = /** @type {any} */ (body);
    if (path.startsWith(`/repos/${REPO}/contents/${FILE}`)) {
      if (method === "GET") {
        const f = files.get(/** @type {string} */ (path.split("?ref=")[1]));
        return f
          ? ok({ sha: f.sha, content: Buffer.from(f.text).toString("base64") })
          : { ok: false, json: {}, err: "HTTP 404" };
      }
      files.set(b.branch, {
        text: Buffer.from(b.content, "base64").toString("utf8"),
        sha: `f${++n}`,
      });
      return ok({});
    }
    if (method === "POST" && path === `/repos/${REPO}/pulls`) {
      const number = 100 + pulls.size;
      pulls.set(number, {
        head: b.head,
        from: /** @type {any} */ (files.get("main")).sha,
        merged: false,
      });
      return ok({ number, node_id: `PR_${number}` });
    }
    const pull = pulls.get(Number(path.match(/\/pulls\/(\d+)$/)?.[1]));
    if (method === "GET" && pull) return ok({ merged: pull.merged });
    if (method === "PATCH" && pull && b.state === "closed") {
      if (!pull.merged) pull.closed = true;
      return ok({});
    }
    if (method === "POST" && path === "/graphql" && /disablePullRequestAutoMerge/.test(b.query)) {
      onDisable();
      disabled.push(b.variables.id);
      return ok({ data: {} });
    }
    return gh.api(method, path, body);
  };
  /** Squash-merges the PR, or refuses it when `main` moved under it or it was closed. */
  const squash = (/** @type {number} */ pr) => {
    const p = /** @type {{ head: string, from: string, merged: boolean, closed?: boolean }} */ (
      pulls.get(pr)
    );
    if (p.closed || /** @type {any} */ (files.get("main")).sha !== p.from) return false;
    const head = /** @type {any} */ (files.get(p.head));
    const sha = `m${pr}`;
    gh.commits.set(sha, {
      tree: { sha: "t0" },
      parents: [gh.refs.get("heads/main")],
      committer: { date: new Date(clock.t).toISOString() },
    });
    gh.refs.set("heads/main", sha);
    files.set("main", head);
    files.set(sha, head);
    p.merged = true;
    return true;
  };
  const land = async (/** @type {number} */ pr) => {
    await tick();
    const p = /** @type {{ merged: boolean }} */ (pulls.get(pr));
    if (p.merged) return { code: 0, merged: `m${pr}` };
    const how = merge(pr);
    if (how === "queue") return { code: 0, queued: true };
    if (how === "wait") return { code: 4, queued: true };
    if (how === "refuse" || !squash(pr))
      return { code: 1, problems: ["the PR conflicts with main"] };
    return { code: 0, merged: `m${pr}` };
  };
  const deps = {
    api,
    repo: REPO,
    base: "main",
    file: FILE,
    gate: async () => {
      await tick();
      return 0;
    },
    land,
    log: () => {},
    sleep: async (/** @type {number} */ ms) => {
      clock.t += ms;
      await tick();
    },
    now: () => clock.t,
  };
  return { deps, files, pulls, refs: gh.refs, squash, clock, disabled };
}

test("nextNumber and withReservation: the highest top-level key plus one, appended as the last entry", () => {
  assert.equal(nextNumber(START), "0008");
  assert.equal(nextNumber(""), "0001");
  assert.equal(nextNumber('"0042":\n  slug: x\n  "9999": nested is not a key\n'), "0043");
  assert.equal(
    withReservation("a: 1", "0002", { slug: "s", issue: "STA-1" }),
    'a: 1\n"0002":\n  slug: s\n  status: reserved\n  issue: STA-1\n',
  );
});

test("reserveAdr: two sessions at once get different numbers, each on main before it is returned", async () => {
  const { deps, files, refs } = github();
  /** @type {string[]} */
  const onMain = [];
  const one = (/** @type {string} */ slug) =>
    reserveAdr({ root: "/nowhere", slug, issue: "sta-1945", deps }).then((r) => {
      onMain.push(/** @type {any} */ (files.get("main")).text);
      return r;
    });
  const [a, b] = await Promise.all([one("queues"), one("stacks")]);
  assert.deepEqual([a.number, b.number], ["0008", "0009"]);
  assert.equal(a.problem, undefined);
  assert.equal(b.problem, undefined);
  assert.match(
    onMain[0],
    /"0008":\n {2}slug: queues\n {2}status: reserved\n {2}issue: STA-1945\n$/,
  );
  assert.match(onMain[1], /"0008":\n {2}slug: queues[\s\S]*"0009":\n {2}slug: stacks/);
  assert.ok(refs.has("heads/adr/0008-queues") && refs.has("heads/adr/0009-stacks"));
  assert.equal(refs.has("heads/flow/queue/adr"), false);
});

test("reserveAdr: a reservation that does not land returns no number, names its PR, withdraws it and releases the lock", async () => {
  const { deps, files, refs, pulls } = github({ merge: () => "refuse" });
  const r = await reserveAdr({ root: "/nowhere", slug: "queues", issue: "STA-1945", deps });
  assert.equal(r.number, undefined);
  assert.equal(r.pr, 100);
  assert.match(
    String(r.problem),
    /github\.com\/o\/r\/pull\/100 did not land: the PR conflicts with main; nothing reserved$/,
  );
  assert.equal(/** @type {any} */ (files.get("main")).text, START);
  assert.equal(pulls.get(100)?.closed, true);
  assert.equal(refs.has("heads/adr/0008-queues"), false);
  assert.equal(refs.has(LOCK), false);

  const red = github();
  const gated = await reserveAdr({
    root: "/nowhere",
    slug: "queues",
    issue: "STA-1945",
    deps: { ...red.deps, gate: async () => 1 },
  });
  assert.equal(gated.number, undefined);
  assert.match(String(gated.problem), /gate run exited 1 .*nothing reserved/);
  assert.equal(red.pulls.get(100)?.closed, true);
  assert.equal(red.refs.has("heads/adr/0008-queues"), false);
  assert.equal(red.refs.has(LOCK), false);
});

test("reserveAdr: a failure at each step before the PR is open returns no number, leaves no branch and releases the lock", async () => {
  /** @type {[string, (method: string, path: string, body: any, refs: Map<string, string>) => boolean, RegExp][]} */
  const steps = [
    [
      "the tip",
      (m, path, _, refs) => m === "GET" && path.endsWith("/git/ref/heads/main") && refs.has(LOCK),
      /cannot read main's tip/,
    ],
    [
      "the numbers file",
      (m, path) => m === "GET" && path.includes("/contents/"),
      /cannot read apps\/docs\/adr\/numbers\.yaml on main: HTTP 500/,
    ],
    [
      "the branch",
      (m, path, body) => m === "POST" && path.endsWith("/git/refs") && /\/adr\//.test(body?.ref),
      /cannot create adr\/0008-queues: HTTP 500/,
    ],
    [
      "the commit",
      (m, path) => m === "PUT" && path.includes("/contents/"),
      /cannot commit the reservation to adr\/0008-queues: HTTP 500; nothing reserved$/,
    ],
    [
      "the PR",
      (m, path) => m === "POST" && path.endsWith("/pulls"),
      /cannot open the PR for adr\/0008-queues: HTTP 500; nothing reserved$/,
    ],
  ];
  for (const [what, fails, why] of steps) {
    const world = github();
    let landed = false;
    /** @type {import("../lib/github.mjs").Api} */
    const api = (m, path, body) =>
      fails(m, path, body, world.refs)
        ? { ok: false, json: {}, err: "HTTP 500" }
        : world.deps.api(m, path, body);
    const r = await reserveAdr({
      root: "/nowhere",
      slug: "queues",
      issue: "STA-1945",
      deps: {
        ...world.deps,
        api,
        land: async () => {
          landed = true;
          return { code: 0, merged: "x" };
        },
      },
    });
    assert.equal(r.number, undefined, what);
    assert.match(String(r.problem), why, what);
    assert.equal(landed, false, what);
    assert.equal(world.refs.has("heads/adr/0008-queues"), false, what);
    assert.equal(world.refs.has(LOCK), false, what);
    assert.equal(world.pulls.size, 0, what);
  }
});

test("reserveAdr: an auto-merge still waiting at the deadline is turned off and the PR closed; nothing reserved", async () => {
  const world = github({ merge: () => "queue" });
  const start = world.clock.t;
  const r = await reserveAdr({
    root: "/nowhere",
    slug: "queues",
    issue: "STA-1945",
    deps: world.deps,
  });
  assert.equal(r.number, undefined);
  assert.match(String(r.problem), /pull\/100 did not land in 10 minutes; nothing reserved$/);
  assert.ok(world.clock.t - start >= LAND_WAIT_MS);
  assert.deepEqual(world.disabled, ["PR_100"]);
  assert.equal(world.pulls.get(100)?.closed, true);
  // GitHub cannot merge it later.
  assert.equal(world.squash(100), false);
  assert.equal(/** @type {any} */ (world.files.get("main")).text, START);
  assert.equal(world.refs.has("heads/adr/0008-queues"), false);
  assert.equal(world.refs.has(LOCK), false);
});

test("reserveAdr: an auto-merge GitHub completes just before it is turned off returns the number", async () => {
  /** @type {ReturnType<typeof github>} */
  let world;
  world = github({ merge: () => "queue", onDisable: () => world.squash(100) });
  const r = await reserveAdr({
    root: "/nowhere",
    slug: "queues",
    issue: "STA-1945",
    deps: world.deps,
  });
  assert.equal(r.number, "0008");
  assert.equal(r.problem, undefined);
  assert.match(/** @type {any} */ (world.files.get("main")).text, /"0008":\n {2}slug: queues/);
});

test("reserveAdr: a PR waiting on checks is landed again until it merges", async () => {
  let calls = 0;
  const world = github({ merge: () => (++calls < 3 ? "wait" : "merge") });
  const r = await reserveAdr({
    root: "/nowhere",
    slug: "queues",
    issue: "STA-1945",
    deps: world.deps,
  });
  assert.equal(r.number, "0008");
  assert.equal(calls, 3);
  assert.deepEqual(world.disabled, []);
  assert.match(/** @type {any} */ (world.files.get("main")).text, /"0008":\n {2}slug: queues/);
});

test("reserveAdr: --owner is recorded in the entry, and an owner that is not one line is refused", async () => {
  const { deps, files } = github();
  const r = await reserveAdr({
    root: "/nowhere",
    slug: "queues",
    issue: "STA-1945",
    owner: "ada",
    deps,
  });
  assert.equal(r.number, "0008");
  assert.match(
    /** @type {any} */ (files.get("main")).text,
    /"0008":\n {2}slug: queues\n {2}status: reserved\n {2}owner: ada\n {2}issue: STA-1945\n$/,
  );
  const bad = await reserveAdr({
    root: "/nowhere",
    slug: "x",
    issue: "STA-1",
    owner: "a: b",
    deps,
  });
  assert.match(String(bad.problem), /is not an owner/);
});

test("reserveAdr: a PR on auto-merge is waited for, and the number returned once it merges", async () => {
  const world = github({ merge: () => "queue" });
  let polls = 0;
  const deps = {
    ...world.deps,
    sleep: async (/** @type {number} */ ms) => {
      await world.deps.sleep(ms);
      // GitHub merges it on the second poll.
      if (++polls === 2) world.squash(100);
    },
  };
  const r = await reserveAdr({ root: "/nowhere", slug: "queues", issue: "STA-1945", deps });
  assert.equal(r.number, "0008");
  assert.equal(polls, 2);
  assert.match(/** @type {any} */ (world.files.get("main")).text, /"0008":\n {2}slug: queues/);
});

test("reserveAdr: a bad slug or issue, or no numbers file, is refused before any lock", async (t) => {
  const { deps, refs } = github();
  const ask = (/** @type {object} */ over) =>
    reserveAdr({ root: "/nowhere", slug: "queues", issue: "STA-1", deps, ...over });
  assert.match(String((await ask({ slug: "Not Kebab" })).problem), /not a kebab-case slug/);
  assert.match(String((await ask({ issue: "1945" })).problem), /not an issue key/);
  const root = mkdtempSync(join(tmpdir(), "flow-adr-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, CONFIG_FILE), JSON.stringify({ version: 1, preset: "neutral" }));
  const noFile = { ...deps, file: undefined };
  assert.match(
    String((await reserveAdr({ root, slug: "queues", issue: "STA-1", deps: noFile })).problem),
    /declares no `queues.adr`/,
  );
  assert.equal(refs.size, 1);
  writeFileSync(join(root, CONFIG_FILE), JSON.stringify({ version: 1, preset: "stackra" }));
  assert.equal(queueFile(root, "adr"), "apps/docs/adr/numbers.yaml");
  // A repository's own preset.yml outside the YAML subset declares no queue instead of crashing.
  mkdirSync(join(root, "own"));
  writeFileSync(join(root, "own", "preset.yml"), "queues:\n\tadr: numbers.yaml\n");
  writeFileSync(join(root, CONFIG_FILE), JSON.stringify({ version: 1, preset: "own" }));
  assert.equal(queueFile(root, "adr"), undefined);
});

test("run: stdout carries only the number; usage, no repository, no connection and a lock refusal are exit codes", async (t) => {
  /** @type {any[][]} */
  const out = [];
  t.mock.method(console, "log", (/** @type {any[]} */ ...a) => out.push(a));
  t.mock.method(console, "error", () => {});
  const bare = mkdtempSync(join(tmpdir(), "flow-adr-run-"));
  const repo = join(bare, "repo");
  t.after(() => rmSync(bare, { recursive: true, force: true }));
  mkdirSync(repo);
  assert.equal(spawnSync("git", ["init", "-q", repo]).status, 0);
  const connected = () => ({ repo: REPO, api: () => ({ ok: false, json: {}, err: "unused" }) });

  for (const args of [
    [],
    ["reserve", "queues"],
    ["make", "queues", "--issue", "STA-1"],
    ["reserve", "a", "b", "--issue", "STA-1"],
    ["reserve", "queues", "--issue", "STA-1", "--owner"],
  ])
    assert.equal(await run(args, { cwd: repo }), 2, args.join(" "));
  const args = ["reserve", "queues", "--issue", "STA-1945"];
  assert.equal(await run(args, { cwd: bare }), 2);
  // A repository whose origin is not on GitHub: the connect refusal.
  assert.equal(await run(args, { cwd: repo }), 2);
  assert.equal(
    await run(args, {
      cwd: repo,
      connectTo: connected,
      reserve: async () => {
        throw new QueueError("cannot read main to make the flow/queue/adr lock");
      },
    }),
    1,
  );
  assert.equal(
    await run(args, { cwd: repo, connectTo: connected, reserve: async () => ({ problem: "no" }) }),
    1,
  );
  assert.deepEqual(out, []);
  /** @type {any} */
  let asked;
  assert.equal(
    await run([...args, "--owner", "ada"], {
      cwd: repo,
      connectTo: connected,
      reserve: async (o) => {
        asked = o;
        return { number: "0008", pr: 100 };
      },
    }),
    0,
  );
  assert.deepEqual(out, [["0008"]]);
  assert.equal(asked.slug, "queues");
  assert.equal(asked.issue, "STA-1945");
  assert.equal(asked.owner, "ada");
});
