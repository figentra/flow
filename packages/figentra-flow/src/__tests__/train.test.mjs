/**
 * Figentra Flow file contract:
 * Purpose: hold `fflow train` to STA-1746: open makes the milestone and label; add boards only an open PR on
 *   the default branch that is green on its exact head, and after the cut-off holds it for the next train; close cuts
 *   off; build merges in board order with merge commits, ejects a conflicting member and goes on, and on red bisects
 *   the prefixes to eject the first breaking member (or stops when eject is manual); depart refuses unless the gate is
 *   green on the tip's exact sha, the move is a fast-forward and every `after` upstream is published, then closes the
 *   milestone and opens the next train; status reports it all; `--dry-run` writes nothing.
 * Boundary: temporary repositories with a local bare origin; GitHub and the gate runner are fakes; no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1746.
 */
// @covers sta-1746:AC-001 sta-1746:AC-002 sta-1746:AC-003 sta-1746:AC-004 sta-1746:AC-005 sta-1746:AC-006
// @covers sta-1746:AC-007 sta-1746:AC-008 sta-1746:AC-009 sta-1746:AC-010 sta-1746:AC-011 sta-1746:AC-012
// @covers sta-1746:AC-013 sta-1746:AC-014 sta-1746:AC-015 sta-1746:P-001 sta-1746:P-002 sta-1746:P-003
// @covers sta-1746:P-004
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  DEFAULTS,
  bump,
  cutOff,
  nextVersion,
  stateOf,
  stateText,
  trainAdd,
  trainBuild,
  trainClose,
  trainDepart,
  trainEject,
  trainOpen,
  trainStatus,
} from "../commands/train.mjs";
import { SCHEMA, validate } from "../lib/config.mjs";
import { commit, repo, sh } from "./__fixtures__/repo.mjs";

const GATE_APP = "figentra-gate[bot]";
const REPO = "figentra/flow";
const green = () => [{ context: "fflow/gate", state: "success", creator: { login: GATE_APP } }];
const red = () => [
  {
    context: "fflow/gate",
    state: "failure",
    creator: { login: GATE_APP },
    description: "checks failed (exit 1)",
    target_url: "https://box/report",
  },
];

/**
 * A GitHub stand-in: milestones, PRs, statuses, refs and releases per repository, every call recorded.
 * @param {{ milestones?: Record<string, any[]>, prs?: Record<number, any>, statuses?: Record<string, any[]>,
 *           refs?: Record<string, string>, compare?: string, releases?: Record<string, any[]> }} [seed]
 */
function hub(seed = {}) {
  const milestones = seed.milestones ?? {};
  const prs = seed.prs ?? {};
  const statuses = seed.statuses ?? {};
  const refs = seed.refs ?? {};
  /** @type {{ method: string, path: string, body?: any }[]} */
  const calls = [];
  const ok = (/** @type {unknown} */ json) => ({ ok: true, json, err: "" });
  const missing = { ok: false, json: undefined, err: "gh: Not Found (HTTP 404)" };
  /** @type {import("../lib/github.mjs").Api} */
  const api = (method, path, body) => {
    calls.push({ method, path, body });
    let m;
    if ((m = path.match(/^\/repos\/([^/]+\/[^/]+)\/milestones\?/)))
      return ok(milestones[m[1]] ?? []);
    if (method === "POST" && (m = path.match(/^\/repos\/([^/]+\/[^/]+)\/milestones$/))) {
      const list = (milestones[m[1]] ??= []);
      const made = {
        number: list.length + 1,
        state: "open",
        created_at: new Date().toISOString(),
        .../** @type {object} */ (body),
      };
      list.push(made);
      return ok(made);
    }
    if (method === "PATCH" && (m = path.match(/^\/repos\/([^/]+\/[^/]+)\/milestones\/(\d+)$/))) {
      Object.assign(
        milestones[m[1]].find((x) => x.number === Number(m[2])),
        body,
      );
      return ok({});
    }
    if ((m = path.match(/\/pulls\/(\d+)$/))) return prs[m[1]] ? ok(prs[m[1]]) : missing;
    if ((m = path.match(/\/commits\/(\w+)\/statuses/))) return ok(statuses[m[1]] ?? []);
    if ((m = path.match(/\/git\/ref\/heads\/(.+)$/)))
      return refs[m[1]] ? ok({ object: { sha: refs[m[1]] } }) : missing;
    if (path.includes("/compare/")) return ok({ status: seed.compare ?? "ahead" });
    if ((m = path.match(/^\/repos\/([^/]+\/[^/]+)\/releases/)))
      return ok(seed.releases?.[m[1]] ?? []);
    return ok({});
  };
  const writes = () => calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.path}`);
  return { api, calls, writes, milestones };
}

/** A milestone holding train `version` with `state`. */
const milestone = (/** @type {string} */ version, /** @type {object} */ state = {}, over = {}) => ({
  number: 1,
  title: `train:${version}`,
  state: "open",
  created_at: "2026-11-01T00:00:00Z",
  description: stateText(version, { ...stateOf(""), ...state }),
  ...over,
});

const pr = (/** @type {number} */ number, /** @type {string} */ sha, over = {}) => ({
  number,
  state: "open",
  title: `feat: change ${number}`,
  base: { ref: "main" },
  head: { sha, ref: `figentra/sta-${number}-x` },
  ...over,
});

/**
 * @param {ReturnType<typeof hub>} h
 * @param {{ root?: string, cfg?: object, dry?: boolean, gate?: (dir: string, ref: string) => Promise<number> }} [over]
 */
function ctx(h, over = {}) {
  /** @type {string[]} */
  const logs = [];
  return {
    logs,
    root: over.root ?? "/nonexistent",
    repo: REPO,
    base: "main",
    cfg: { ...DEFAULTS, ...over.cfg },
    gateApp: GATE_APP,
    dry: over.dry ?? false,
    deps: {
      api: h.api,
      log: (/** @type {string} */ s) => void logs.push(s),
      warn: (/** @type {string} */ s) => void logs.push(s),
      gate: over.gate ?? (async () => 0),
    },
  };
}

const trainOf = (/** @type {ReturnType<typeof hub>} */ h, i = 0) =>
  stateOf(h.milestones[REPO][i].description);

test("state, versions and the cut-off: the state line round-trips; changesets give the highest bump", () => {
  const state = {
    members: [3, 1],
    ejected: [{ pr: 2, reason: "red" }],
    waiting: [9],
    closed: true,
  };
  assert.deepEqual(stateOf(stateText("1.2.3", state)), state);
  assert.deepEqual(stateOf("written by hand"), {
    members: [],
    ejected: [],
    waiting: [],
    closed: false,
  });
  assert.equal(bump("0.2.1", "patch"), "0.2.2");
  assert.equal(bump("0.2.1", "minor"), "0.3.0");
  assert.equal(bump("0.2.1", "major"), "1.0.0");
  const sets = ['---\n"@x/a": patch\n"@x/b": minor\n---\n\nnote', "---\nunknown: major\n---\n"];
  assert.equal(nextVersion(sets, { "@x/a": "0.2.1", "@x/b": "0.2.1" }), "0.3.0");
  assert.equal(nextVersion([], { "@x/a": "0.2.1" }), undefined);
  const t = {
    number: 1,
    version: "1.0.0",
    open: true,
    created: "2026-11-01T00:00:00Z",
    state: stateOf(""),
  };
  const at = Date.parse("2026-11-01T00:00:00Z");
  assert.equal(cutOff(t, DEFAULTS), false);
  assert.equal(cutOff(t, { ...DEFAULTS, cutoff: 24 }, at + 23 * 3_600_000), false);
  assert.equal(cutOff(t, { ...DEFAULTS, cutoff: 24 }, at + 24 * 3_600_000), true);
});

test("config: the train block is validated; its settings default when absent", () => {
  const train = { cutoff: 48, eject: "manual", after: ["figentra/stackra"], label: "train:" };
  assert.deepEqual(validate(SCHEMA, { version: 1, train }), []);
  assert.match(
    validate(SCHEMA, { version: 1, train: { cutoff: 0, eject: "skip", colour: "red" } }).join("\n"),
    /train\.cutoff: must be at least 1[\s\S]*train\.eject: must be one of bisect, manual[\s\S]*train\.colour: is not a known key/,
  );
  assert.deepEqual(DEFAULTS, { label: "train:", eject: "bisect", after: [] });
});

test("open: makes the milestone and the label; refuses a second open train; --dry-run writes nothing", async () => {
  const dry = hub();
  assert.equal((await trainOpen(ctx(dry, { dry: true }), "1.0.0")).code, 0);
  assert.deepEqual(dry.writes(), []);

  const h = hub();
  const r = await trainOpen(ctx(h), "1.0.0");
  assert.equal(r.code, 0);
  assert.deepEqual(h.writes(), [`POST /repos/${REPO}/labels`, `POST /repos/${REPO}/milestones`]);
  assert.equal(h.milestones[REPO][0].title, "train:1.0.0");
  const again = await trainOpen(ctx(h), "1.1.0");
  assert.equal(again.code, 1);
  assert.match(again.problems?.join() ?? "", /train 1\.0\.0 is open/);
  assert.equal((await trainOpen(ctx(hub()), "next")).code, 2);
});

test("add: refuses a PR that is not green on its exact head, or not on the default branch", async () => {
  const head = "a".repeat(40);
  const older = "b".repeat(40);
  const cases = [
    [{ statuses: { [older]: green() } }, /no fflow\/gate on the head a{12}/],
    [{ statuses: { [head]: red() } }, /fflow\/gate is failure on the head/],
    [
      { statuses: { [head]: [{ ...green()[0], creator: { login: "someone" } }] } },
      /posted by someone/,
    ],
    [{ statuses: { [head]: green() }, base: "figentra/sta-4-x" }, /based on `figentra\/sta-4-x`/],
    [{ statuses: { [head]: green() }, state: "closed" }, /the PR is closed/],
  ];
  for (const [seed, reason] of cases) {
    const s = /** @type {any} */ (seed);
    const h = hub({
      milestones: { [REPO]: [milestone("1.0.0")] },
      prs: {
        7: pr(7, head, {
          ...(s.base ? { base: { ref: s.base } } : {}),
          ...(s.state ? { state: s.state } : {}),
        }),
      },
      statuses: s.statuses,
    });
    const r = await trainAdd(ctx(h), 7);
    assert.equal(r.code, 1);
    assert.match(r.problems?.join("\n") ?? "", /** @type {RegExp} */ (reason));
    assert.deepEqual(h.writes(), []);
  }
});

test("add: a green PR boards in order with the label and milestone; after the cut-off it waits for the next train", async () => {
  const seed = () => ({
    milestones: { [REPO]: [milestone("1.0.0", { members: [3] })] },
    prs: { 7: pr(7, "a".repeat(40)) },
    statuses: { ["a".repeat(40)]: green() },
  });
  const dry = hub(seed());
  assert.equal((await trainAdd(ctx(dry, { dry: true }), 7)).code, 0);
  assert.deepEqual(dry.writes(), []);

  const h = hub(seed());
  assert.equal((await trainAdd(ctx(h), 7)).code, 0);
  assert.deepEqual(h.writes(), [
    `POST /repos/${REPO}/issues/7/labels`,
    `PATCH /repos/${REPO}/issues/7`,
    `PATCH /repos/${REPO}/milestones/1`,
  ]);
  assert.deepEqual(h.calls.find((c) => c.path.endsWith("/issues/7/labels"))?.body, {
    labels: ["train:1.0.0"],
  });
  assert.deepEqual(trainOf(h).members, [3, 7]);
  assert.equal((await trainAdd(ctx(h), 7)).code, 1);

  const late = hub(seed());
  assert.equal((await trainClose(ctx(late))).code, 0);
  assert.equal((await trainAdd(ctx(late), 7)).code, 0);
  assert.deepEqual(trainOf(late), { members: [3], ejected: [], waiting: [7], closed: true });
  assert.equal(
    late.calls.some((c) => c.path.endsWith("/issues/7/labels")),
    false,
  );
});

test("close: cuts the train off once; --dry-run writes nothing", async () => {
  const h = hub({ milestones: { [REPO]: [milestone("1.0.0")] } });
  assert.equal((await trainClose(ctx(h, { dry: true }))).code, 0);
  assert.deepEqual(h.writes(), []);
  assert.equal((await trainClose(ctx(h))).code, 0);
  assert.equal(trainOf(h).closed, true);
  assert.equal((await trainClose(ctx(h))).code, 1);
});

/**
 * A repository whose PRs `n` add the given files, each pushed to origin as `refs/pull/<n>/head`, and a hub with a
 * cut-off train holding them in order, every head green.
 * @param {Record<number, Record<string, string>>} changes
 */
function station(changes) {
  const r = repo();
  /** @type {Record<number, any>} */
  const prs = {};
  /** @type {Record<string, any[]>} */
  const statuses = {};
  for (const [n, files] of Object.entries(changes)) {
    sh(r.root, "checkout", "-q", "-b", `pr-${n}`, "main");
    for (const [name, text] of Object.entries(files)) commit(r.root, name, text);
    const head = sh(r.root, "rev-parse", "HEAD");
    sh(r.root, "push", "-q", "origin", `HEAD:refs/pull/${n}/head`);
    sh(r.root, "checkout", "-q", "main");
    prs[n] = pr(Number(n), head);
    statuses[head] = green();
  }
  const members = Object.keys(changes).map(Number);
  const h = hub({
    milestones: { [REPO]: [milestone("1.0.0", { members, closed: true })] },
    prs,
    statuses,
  });
  /** @type {string[]} */
  const gated = [];
  /** A box that is red while `bad.txt` is in the checked-out tree. */
  const gate = async (/** @type {string} */ dir, /** @type {string} */ ref) => {
    gated.push(`${ref}@${sh(dir, "rev-parse", "HEAD")}`);
    return existsSync(join(dir, "bad.txt")) ? 1 : 0;
  };
  return { r, h, prs, gate, gated };
}

/** The files at origin's `train/1.0.0`. */
const trainFiles = (/** @type {string} */ origin) =>
  sh(origin, "ls-tree", "--name-only", "train/1.0.0").split("\n");

test("build: merges in board order with merge commits, ejects a conflicting member with a comment, and goes on", async (t) => {
  const s = station({ 1: { "a.txt": "one\n" }, 2: { "a.txt": "two\n" }, 3: { "c.txt": "c\n" } });
  t.after(s.r.dispose);
  const c = ctx(s.h, { root: s.r.root, gate: s.gate });
  const r = await trainBuild(c);
  assert.equal(r.code, 0, JSON.stringify(r));
  assert.deepEqual(trainOf(s.h).members, [1, 3]);
  assert.match(trainOf(s.h).ejected[0].reason, /conflicts with main and #1 on the train/);
  const comment = s.h.calls.find((x) => x.path.endsWith("/issues/2/comments"));
  assert.match(comment?.body.body, /Ejected from train 1\.0\.0.*conflicts/s);
  assert.ok(
    s.h.calls.some(
      (x) => x.method === "DELETE" && x.path.endsWith("/issues/2/labels/train%3A1.0.0"),
    ),
  );
  // One gate run, on the tip; the tip is two merge commits on main, no member rewritten.
  assert.equal(s.gated.length, 1);
  assert.equal(s.gated[0], `train/1.0.0@${r.tip}`);
  assert.deepEqual(trainFiles(s.r.origin).sort(), [
    "README.md",
    "a.txt",
    "c.txt",
    "flow.config.json",
  ]);
  const parents = sh(s.r.origin, "rev-list", "--parents", "-n", "1", "train/1.0.0").split(" ");
  assert.equal(parents.length, 3);
  assert.equal(parents[2], s.prs[3].head.sha);
  assert.equal(existsSync(join(s.r.root, ".claude", "worktrees", "train-1.0.0")), false);
});

test("build: on red, bisect gates prefixes, ejects the first breaking member with the red status, and rebuilds green", async (t) => {
  const s = station({
    1: { "a.txt": "a\n" },
    2: { "bad.txt": "x\n" },
    3: { "c.txt": "c\n" },
    4: { "d.txt": "d\n" },
  });
  t.after(s.r.dispose);
  const c = ctx(s.h, { root: s.r.root, gate: s.gate });
  const r = await trainBuild(c);
  assert.equal(r.code, 0, JSON.stringify(r));
  assert.deepEqual(trainOf(s.h).members, [1, 3, 4]);
  assert.deepEqual(
    trainOf(s.h).ejected.map((e) => e.pr),
    [2],
  );
  assert.match(
    trainOf(s.h).ejected[0].reason,
    /turns red with it: fflow\/gate failed on [0-9a-f]{12}/,
  );
  // The tip (red), prefix 2 (red), prefix 1 (green), then the rebuilt tip (green): four gate runs.
  assert.equal(s.gated.length, 4);
  assert.equal(s.gated.at(-1), `train/1.0.0@${r.tip}`);
  assert.equal(trainFiles(s.r.origin).includes("bad.txt"), false);
  assert.ok(trainFiles(s.r.origin).includes("d.txt"));
});

test("build: eject manual stops on red and ejects nothing; a boarding train or --dry-run builds nothing", async (t) => {
  const s = station({ 1: { "bad.txt": "x\n" }, 2: { "c.txt": "c\n" } });
  t.after(s.r.dispose);
  const r = await trainBuild(ctx(s.h, { root: s.r.root, gate: s.gate, cfg: { eject: "manual" } }));
  assert.equal(r.code, 1);
  assert.match(r.problems?.join() ?? "", /eject is manual.*train eject <pr>/);
  assert.deepEqual(trainOf(s.h).members, [1, 2]);
  assert.equal(s.gated.length, 1);

  assert.equal((await trainEject(ctx(s.h, { dry: true }), 1)).code, 0);
  assert.deepEqual(trainOf(s.h).members, [1, 2]);
  assert.equal((await trainEject(ctx(s.h), 1)).code, 0);
  assert.deepEqual(trainOf(s.h).members, [2]);

  const boarding = hub({ milestones: { [REPO]: [milestone("1.0.0", { members: [1] })] } });
  assert.match((await trainBuild(ctx(boarding))).problems?.join() ?? "", /still boarding/);
  const dry = hub({ milestones: { [REPO]: [milestone("1.0.0", { members: [1], closed: true })] } });
  assert.equal((await trainBuild(ctx(dry, { dry: true }))).code, 0);
  assert.deepEqual(dry.writes(), []);
});

const TIP = "f".repeat(40);
/** A cut-off train 1.0.0 built at TIP, with #9 waiting for the next one. */
const built = (/** @type {object} */ over = {}) =>
  hub({
    milestones: { [REPO]: [milestone("1.0.0", { members: [1, 2], waiting: [9], closed: true })] },
    refs: { "train/1.0.0": TIP },
    statuses: { [TIP]: green(), ["9".repeat(40)]: green() },
    prs: { 9: pr(9, "9".repeat(40)) },
    ...over,
  });

test("depart: refuses unless fflow/gate is green on the tip's exact sha", async () => {
  for (const statuses of [{}, { ["e".repeat(40)]: green() }, { [TIP]: red() }]) {
    const h = built({ statuses });
    const r = await trainDepart(ctx(h));
    assert.equal(r.code, 1);
    assert.match(
      r.problems?.join() ?? "",
      /train\/1\.0\.0: (no fflow\/gate on the head f{12}|fflow\/gate is failure)/,
    );
    assert.deepEqual(h.writes(), []);
  }
  const unbuilt = built({ refs: {} });
  assert.match(
    (await trainDepart(ctx(unbuilt))).problems?.join() ?? "",
    /train\/1\.0\.0 does not exist/,
  );
});

test("depart: a fast-forward only, then the milestone closes and the next train opens with the waiting PRs", async (t) => {
  for (const status of ["diverged", "behind", "identical"]) {
    const h = built({ compare: status });
    const r = await trainDepart(ctx(h));
    assert.equal(r.code, 1);
    assert.match(
      r.problems?.join() ?? "",
      new RegExp(`not a fast-forward of main \\(${status}\\)`),
    );
    assert.deepEqual(h.writes(), []);
  }
  const dry = built();
  assert.equal((await trainDepart(ctx(dry, { dry: true }))).code, 0);
  assert.deepEqual(dry.writes(), []);

  // The next version comes from the changesets; the departed one's are still there, so it moves on by a patch.
  const r = repo({ "package.json": '{ "name": "a", "version": "0.9.0" }\n' });
  t.after(r.dispose);
  mkdirSync(join(r.root, ".changeset"));
  writeFileSync(join(r.root, ".changeset", "x.md"), '---\n"a": major\n---\n\nx\n');
  const h = hub({
    milestones: { [REPO]: [milestone("1.0.0", { members: [1, 2], waiting: [9], closed: true })] },
    refs: { "train/1.0.0": TIP },
    statuses: { [TIP]: green(), ["9".repeat(40)]: green() },
    prs: { 9: pr(9, "9".repeat(40)) },
  });
  const done = await trainDepart(ctx(h, { root: r.root }));
  assert.equal(done.code, 0, JSON.stringify(done));
  const ff = h.calls.find((c) => c.method === "PATCH" && c.path.endsWith("/git/refs/heads/main"));
  assert.deepEqual(ff?.body, { sha: TIP, force: false });
  assert.equal(h.milestones[REPO][0].state, "closed");
  assert.equal(h.milestones[REPO][1].title, "train:1.0.1");
  assert.deepEqual(stateOf(h.milestones[REPO][1].description).members, [9]);
  // Nothing writes before the fast-forward.
  assert.equal(h.writes()[0], `PATCH /repos/${REPO}/git/refs/heads/main`);
});

test("depart: a refused fast-forward stops; a failed step after it only warns (exit 3)", async () => {
  const h = built();
  const refusing = /** @type {import("../lib/github.mjs").Api} */ (
    (method, path, body) =>
      method === "PATCH" && path.endsWith("/git/refs/heads/main")
        ? { ok: false, json: undefined, err: "gh: Update is not a fast forward (HTTP 422)" }
        : h.api(method, path, body)
  );
  const r = await trainDepart({ ...ctx(h), deps: { ...ctx(h).deps, api: refusing } });
  assert.equal(r.code, 1);
  assert.match(r.problems?.join() ?? "", /not a fast forward/);
  assert.equal(h.milestones[REPO][0].state, "open");

  // No changeset and no version: the next train cannot open; the departure stands and warns.
  const after = built();
  const warned = await trainDepart(ctx(after));
  assert.equal(warned.code, 3);
  assert.equal(after.milestones[REPO][0].state, "closed");
});

test("depart: train.after holds the train until the upstream train's version is published", async () => {
  const upstream = {
    "figentra/stackra": [
      milestone("0.3.0", { closed: true }, { state: "closed" }),
      milestone("0.3.1", {}, { number: 2 }),
    ],
  };
  const cfg = { after: ["figentra/stackra"] };
  const held = built({ milestones: { [REPO]: built().milestones[REPO], ...upstream } });
  const r = await trainDepart(ctx(held, { cfg }));
  assert.equal(r.code, 1);
  assert.match(
    r.problems?.join() ?? "",
    /after figentra\/stackra: its train 0\.3\.0 is not published yet/,
  );
  assert.deepEqual(held.writes(), []);

  const freed = built({
    milestones: { [REPO]: built().milestones[REPO], ...upstream },
    releases: { "figentra/stackra": [{ tag_name: "@stackra/core@0.3.0", draft: false }] },
  });
  const go = await trainDepart(ctx(freed, { cfg, dry: true }));
  assert.equal(go.code, 0, JSON.stringify(go));
});

test("status: the members with their gates, the ejections, the waiting PRs, the tip and the upstream chain", async () => {
  const h = hub({
    milestones: {
      [REPO]: [
        milestone("1.0.0", { members: [1], ejected: [{ pr: 2, reason: "red" }], waiting: [9] }),
      ],
      "figentra/stackra": [milestone("0.3.0", {}, { state: "closed" })],
    },
    prs: { 1: pr(1, "1".repeat(40)) },
    statuses: { ["1".repeat(40)]: green() },
  });
  const c = ctx(h, { cfg: { after: ["figentra/stackra"] } });
  assert.equal((await trainStatus(c)).code, 0);
  const out = c.logs.join("\n");
  assert.match(out, /train 1\.0\.0 \(boarding\), milestone #1/);
  assert.match(out, /#1 feat: change 1: fflow\/gate success on 1{12}/);
  assert.match(out, /ejected #2: red/);
  assert.match(out, /waiting for the next train: #9/);
  assert.match(out, /train\/1\.0\.0: not built/);
  assert.match(out, /after figentra\/stackra: its train 0\.3\.0 is not published yet/);
  assert.deepEqual(h.writes(), []);
});
