/**
 * Figentra Flow file contract:
 * Purpose: hold `fflow adr reserve` to its contract: the next number is the numbers file's highest plus one; two
 *   sessions reserving at once get different numbers, each on the default branch before it is returned; a
 *   reservation whose gate or land fails returns no number and releases the lock; one that waits on auto-merge
 *   returns once merged; the stackra preset names the numbers file, and a preset without one is refused.
 * Boundary: an in-memory GitHub, the gate and `land` injected; no network.
 * Runtime: node
 * Governing contract: STA-1945 (FR-17, AC-15, P-023; plan C12).
 */
// @covers sta-1945:FR-17 sta-1945:AC-15 sta-1945:P-023
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { nextNumber, queueFile, reserveAdr, withReservation } from "../commands/adr.mjs";
import { CONFIG_FILE } from "../lib/product.mjs";
import { fakeGitHub } from "./__fixtures__/github.mjs";

const REPO = "o/r";
const FILE = "apps/docs/adr/numbers.yaml";
const START =
  '# the register\n"0001":\n  slug: first\n  status: accepted\n"0007":\n  slug: seventh\n';
const tick = () => new Promise((resolve) => setImmediate(resolve));

/**
 * The fake GitHub with the contents and pulls API, and a `land` that squash-merges a PR's file onto `main` unless
 * `main`'s copy moved since the branch was cut (the conflict a loser would meet).
 * @param {{ merge?: (pr: number) => "merge" | "refuse" | "queue" }} [options]
 */
function github({ merge = () => "merge" } = {}) {
  const clock = { t: Date.parse("2026-11-03T10:00:00Z") };
  const gh = fakeGitHub(clock);
  /** @type {Map<string, { text: string, sha: string }>} the numbers file on each branch */
  const files = new Map([["main", { text: START, sha: "f0" }]]);
  /** @type {Map<number, { head: string, from: string, merged: boolean }>} */
  const pulls = new Map();
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
      return ok({ number });
    }
    const pull = path.match(/\/pulls\/(\d+)$/)?.[1];
    if (method === "GET" && pull) return ok({ merged: pulls.get(Number(pull))?.merged });
    return gh.api(method, path, body);
  };
  /** Squash-merges the PR, or refuses it when `main` moved under it. */
  const squash = (/** @type {number} */ pr) => {
    const p = /** @type {{ head: string, from: string, merged: boolean }} */ (pulls.get(pr));
    if (/** @type {any} */ (files.get("main")).sha !== p.from) return false;
    files.set("main", /** @type {any} */ (files.get(p.head)));
    p.merged = true;
    return true;
  };
  const land = async (/** @type {number} */ pr) => {
    await tick();
    const p = /** @type {{ merged: boolean }} */ (pulls.get(pr));
    if (p.merged) return { code: 0, merged: `m${pr}` };
    const how = merge(pr);
    if (how === "queue") return { code: 0, queued: true };
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
  return { deps, files, pulls, refs: gh.refs, squash, clock };
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

test("reserveAdr: a reservation that does not land returns no number, names its PR and releases the lock", async () => {
  const { deps, files, refs } = github({ merge: () => "refuse" });
  const r = await reserveAdr({ root: "/nowhere", slug: "queues", issue: "STA-1945", deps });
  assert.equal(r.number, undefined);
  assert.match(
    String(r.problem),
    /github\.com\/o\/r\/pull\/100 did not land: the PR conflicts with main; nothing reserved/,
  );
  assert.equal(/** @type {any} */ (files.get("main")).text, START);
  assert.equal(refs.has("heads/flow/queue/adr"), false);

  const red = github();
  const gated = await reserveAdr({
    root: "/nowhere",
    slug: "queues",
    issue: "STA-1945",
    deps: { ...red.deps, gate: async () => 1 },
  });
  assert.equal(gated.number, undefined);
  assert.match(String(gated.problem), /gate run exited 1 .*nothing reserved/);
  assert.equal(red.refs.has("heads/flow/queue/adr"), false);
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
});
