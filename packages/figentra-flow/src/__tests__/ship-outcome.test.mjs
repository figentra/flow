/**
 * Figentra Flow file contract:
 * Purpose: hold a ship's outcome to STA-2137: the dispatched run is the earliest new run (not listed before the
 *   dispatch, created after it) whose deploy job names the environment, so a ship never adopts another ship's run; a
 *   completed run's `runway-outcome-<env>` artifact (`runway-outcome.json`, `runway.outcome/v1` as products'
 *   deploy.yml writes it, and the deploy manifest, copied from `ProductDeploy`'s shape) gives the status, revision,
 *   KV rows and uploads; a run without the artifact is `no outcome artifact` and never done; a run still going at the
 *   last poll is pending, and `fflow status` finds a pending ship's run later; the record takes the entry; the ledger
 *   shows each ship row's own outcome.
 * Boundary: the GitHub API is an in-memory stub and the zip is built here; no network. The `shipsOf` test makes a
 *   temporary git repository (`__fixtures__/repo.mjs`).
 * Runtime: node
 * Governing contract: STA-2137.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

import { ledger, render } from "../commands/ledger.mjs";
import { emptyRecord, recordProblems, updateRecord } from "../lib/record.mjs";
import {
  findRun,
  followRun,
  NO_OUTCOME,
  outcomeArtifact,
  readOutcome,
  runIds,
  shipsOf,
  shipState,
  unzipFile,
} from "../lib/ship-outcome.mjs";
import { repo } from "./__fixtures__/repo.mjs";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__/runway");
const MANIFEST = readFileSync(join(FIXTURES, "deploy-staging.json"));
const OUTCOME = readFileSync(join(FIXTURES, "runway-outcome.json"));
const SHA = "4f1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c";

/** A zip of `files` ([name, bytes] pairs), each deflated (8) or stored (0). */
function zipOf(/** @type {[string, Buffer][]} */ files, method = 8) {
  /** @type {Buffer[]} */
  const locals = [];
  /** @type {Buffer[]} */
  const centrals = [];
  let offset = 0;
  for (const [name, data] of files) {
    const body = method === 8 ? deflateRawSync(data) : data;
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, n, body);
    centrals.push(central, n);
    offset += 30 + n.length + body.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

/** The artifact's zip as products' deploy.yml uploads it, the outcome changed by `change`. */
const outcomeZip = (/** @type {Record<string, unknown>} */ change = {}) =>
  zipOf([
    [
      "runway-outcome.json",
      Buffer.from(JSON.stringify({ ...JSON.parse(String(OUTCOME)), ...change })),
    ],
    ["deploy-staging.json", MANIFEST],
    ["build.json", Buffer.from("{}")],
  ]);

/**
 * A stub API: the runs listed, each run by id, each run's jobs (`envs`: the environment its deploy job names), the
 * artifacts of run 7 (`artifacts`) and artifact 9's zip.
 * @param {{ runs?: any[], envs?: Record<number, string>, artifacts?: any[], zip?: Buffer }} state
 * @returns {import("../lib/github.mjs").Api}
 */
const stubApi =
  ({ runs = [], envs = {}, artifacts = [], zip }) =>
  (method, path, _body, options) => {
    assert.equal(method, "GET");
    if (path.includes("/actions/workflows/deploy.yml/runs?"))
      return { ok: true, json: { workflow_runs: runs }, err: "" };
    const id = path.match(/\/actions\/runs\/(\d+)$/)?.[1];
    if (id) return { ok: true, json: runs.find((r) => String(r.id) === id), err: "" };
    const jobs = path.match(/\/actions\/runs\/(\d+)\/jobs\?/)?.[1];
    if (jobs) {
      const env = envs[Number(jobs)];
      const names = ["Registry probe", ...(env ? [`Deploy (${env})`] : []), "Promote (production)"];
      return { ok: true, json: { jobs: names.map((name) => ({ name })) }, err: "" };
    }
    // The real name, not the module's constant: a wrong constant on both sides would pass.
    if (path.endsWith("/actions/runs/7/artifacts?name=runway-outcome-staging"))
      return { ok: true, json: { artifacts }, err: "" };
    if (path.includes("/artifacts?name=")) return { ok: true, json: { artifacts: [] }, err: "" };
    if (path.endsWith("/actions/artifacts/9/zip")) {
      assert.equal(options?.raw, true);
      return { ok: Boolean(zip), json: undefined, err: "", bytes: zip };
    }
    return { ok: false, json: undefined, err: `unexpected ${path}` };
  };

test("ship outcome: unzipFile reads a deflated or stored entry, after any wrapper lines", () => {
  const zip = zipOf([["deploy-staging.json", MANIFEST]]);
  assert.deepEqual(
    unzipFile(zip, (n) => n === "deploy-staging.json"),
    MANIFEST,
  );
  assert.deepEqual(
    unzipFile(Buffer.concat([Buffer.from("wrapper: token ok\n"), zip]), () => true),
    MANIFEST,
  );
  assert.deepEqual(
    unzipFile(zipOf([["a.json", MANIFEST]], 0), () => true),
    MANIFEST,
  );
  // The second entry of a three-file artifact, by its central directory offset.
  assert.deepEqual(
    unzipFile(outcomeZip(), (n) => n === "deploy-staging.json"),
    MANIFEST,
  );
  assert.equal(
    unzipFile(zip, (n) => n === "other.json"),
    undefined,
  );
  assert.equal(
    unzipFile(Buffer.from("not a zip"), () => true),
    undefined,
  );
});

test("ship outcome: the artifact is named for its environment, as products' deploy.yml uploads it", () => {
  assert.equal(outcomeArtifact("staging"), "runway-outcome-staging");
});

const since = Date.parse("2026-11-06T10:00:00Z");
const at = { workflow: "deploy.yml", branch: "main", since, env: "staging" };

test("ship outcome: the dispatched run is the earliest new run after the dispatch that deploys its environment", () => {
  const runs = [
    { ...done, id: 8, created_at: "2026-11-06T10:01:00Z" },
    done,
    { ...done, id: 5, created_at: "2026-11-06T09:00:00Z" },
  ];
  const envs = { 5: "staging", 7: "staging", 8: "staging" };
  assert.equal(findRun(stubApi({ runs, envs }), "figentra/pay", at)?.id, 7);
  // A run listed before the dispatch is never this ship's, whatever its environment.
  assert.equal(findRun(stubApi({ runs, envs }), "figentra/pay", { ...at, before: [7] })?.id, 8);
  assert.deepEqual(runIds(stubApi({ runs }), "figentra/pay", "deploy.yml", "main"), [8, 7, 5]);
});

test("ship outcome: dev then staging within a minute: the staging ship takes its own run", () => {
  // The dev run (7) was not listed yet when the staging ship took its list, so both are new to it.
  const runs = [
    { ...done, id: 8, status: "queued", conclusion: null, created_at: "2026-11-06T10:00:40Z" },
    { ...done, created_at: "2026-11-06T10:00:05Z" },
  ];
  const api = stubApi({ runs, envs: { 7: "dev", 8: "staging" } });
  assert.equal(findRun(api, "figentra/pay", at)?.id, 8);
  assert.equal(findRun(api, "figentra/pay", { ...at, env: "dev" })?.id, 7);
});

test("ship outcome: two sessions shipping at once never take each other's run", () => {
  const theirs = { ...done, id: 7, status: "in_progress", conclusion: null };
  const ours = { ...done, id: 8, status: "in_progress", conclusion: null };
  // Before either deploy job exists, a running run names no environment: neither session takes one yet.
  assert.equal(findRun(stubApi({ runs: [ours, theirs] }), "figentra/pay", at), undefined);
  // Once the jobs name them, each takes its own.
  const api = stubApi({ runs: [ours, theirs], envs: { 7: "dev", 8: "staging" } });
  assert.equal(findRun(api, "figentra/pay", at)?.id, 8);
  assert.equal(findRun(api, "figentra/pay", { ...at, env: "dev" })?.id, 7);
  // A completed run whose deploy job never ran (no environment named) can still be read: it has no outcome.
  assert.equal(findRun(stubApi({ runs: [{ ...done, id: 9 }] }), "figentra/pay", at)?.id, 9);
});

test("ship outcome: a deployed outcome at the dispatched revision is a success, with the manifest's writes", () => {
  const api = stubApi({ runs: [done], artifacts: artifact, zip: outcomeZip() });
  const ship = readOutcome(api, "figentra/pay", done, "staging", SHA);
  assert.deepEqual(ship, {
    env: "staging",
    run: 7,
    url: done.html_url,
    conclusion: "success",
    outcome: "success",
    sha: SHA,
    written: 3,
    uploaded: 2,
  });
  assert.equal(shipState(ship.outcome), "done");
  // The artifact of another environment is not read: no outcome.
  assert.equal(readOutcome(api, "figentra/pay", done, "dev", SHA).outcome, NO_OUTCOME);
});

test("ship outcome: a failed or cancelled outcome, or one of another revision or environment, is a failure", () => {
  /** @param {Record<string, unknown>} change */
  const read = (change) =>
    readOutcome(
      stubApi({ runs: [done], artifacts: artifact, zip: outcomeZip(change) }),
      "figentra/pay",
      done,
      "staging",
      SHA,
    );
  assert.deepEqual(
    [read({ status: "failed" }), read({ status: "cancelled" })].map((s) => [s.outcome, s.problem]),
    [
      ["failure", "runway failed"],
      ["failure", "runway cancelled"],
    ],
  );
  const other = "0".repeat(40);
  const moved = read({ sourceSha: other });
  assert.equal(moved.outcome, "failure");
  assert.equal(moved.sha, other);
  assert.match(String(moved.problem), /deployed 000000000000, not 4f1c2d3e4f5a/);
  assert.equal(read({ environment: "dev" }).outcome, "failure");
  assert.equal(shipState("failure"), "failed");
  // An outcome file of another schema is no outcome.
  assert.equal(read({ schema: "other/v9" }).outcome, NO_OUTCOME);
});

test("ship outcome: a run without the artifact is `no outcome artifact`, never a success", () => {
  const ship = readOutcome(stubApi({ runs: [done] }), "figentra/pay", done, "staging", SHA);
  assert.equal(ship.outcome, NO_OUTCOME);
  assert.equal(ship.conclusion, "success");
  assert.equal(shipState(ship.outcome), "failed");
  // An artifact whose zip is corrupt reads the same.
  const bad = stubApi({ runs: [done], artifacts: artifact, zip: Buffer.from("PK\x03\x04junk") });
  assert.equal(readOutcome(bad, "figentra/pay", done, "staging", SHA).outcome, NO_OUTCOME);
  // An artifact with the manifest but no outcome file reads the same.
  const bare = stubApi({
    runs: [done],
    artifacts: artifact,
    zip: zipOf([["deploy-staging.json", MANIFEST]]),
  });
  assert.equal(readOutcome(bare, "figentra/pay", done, "staging", SHA).outcome, NO_OUTCOME);
});

test("ship outcome: followRun waits for the run, and a run still going at the last poll is pending", async () => {
  /** @type {any[]} */
  const runs = [];
  let polls = 0;
  const sleep = async () => {
    polls++;
    // Listed at the second poll, completed at the third.
    if (polls === 2) runs.push({ ...done, status: "in_progress", conclusion: null });
    if (polls === 3) runs[0] = done;
  };
  const api = stubApi({ runs, envs: { 7: "staging" }, artifacts: artifact, zip: outcomeZip() });
  const options = { ...at, sha: SHA, before: [5], sleep };
  const ship = await followRun(api, "figentra/pay", { ...options, polls: 10 });
  assert.equal(ship.outcome, "success");
  assert.equal(polls, 3);

  polls = 0;
  runs.length = 0;
  const early = await followRun(api, "figentra/pay", { ...options, polls: 2 });
  assert.deepEqual(early, { env: "staging", run: 7, url: done.html_url, outcome: "pending" });
  assert.equal(shipState(early.outcome), "active");
});

test("ship outcome: status finds a pending ship's run that was not listed while the ship waited", (t) => {
  const r = repo();
  t.after(r.dispose);
  /** @type {import("../lib/ship-outcome.mjs").Ship} */
  const pending = {
    env: "staging",
    at: "2026-11-06T10:00:30Z",
    outcome: "pending",
    sha: SHA,
    workflow: "deploy.yml",
    branch: "main",
    before: [5],
  };
  updateRecord(r.root, "sta-9", (rec) => ({ ...rec, ships: [pending] }));
  const runs = [done, { ...done, id: 5 }];
  const api = stubApi({
    runs,
    envs: { 5: "staging", 7: "staging" },
    artifacts: artifact,
    zip: outcomeZip(),
  });
  const [ship] = shipsOf(r.root, "figentra/pay", api);
  assert.equal(ship.key, "sta-9");
  assert.equal(ship.run, 7);
  assert.equal(ship.outcome, "success");
  // Offline, the record's pending entry is shown as it is.
  assert.equal(shipsOf(r.root, "figentra/pay")[0].outcome, "pending");
});

test("ship outcome: the record takes a ship, and each ledger row shows its own ship's outcome", () => {
  const ship = {
    env: "dev",
    at: "2026-11-05T10:00:00Z",
    outcome: "success",
    run: 6,
    sha: SHA,
    written: 3,
    uploaded: 2,
  };
  const later = { ...ship, env: "staging", at: "2026-11-06T10:00:00Z", run: 7 };
  const record = {
    ...emptyRecord("sta-9"),
    stage: /** @type {const} */ ("ship"),
    state: /** @type {const} */ ("done"),
    history: [
      {
        stage: /** @type {const} */ ("ship"),
        state: /** @type {const} */ ("done"),
        at: "2026-11-05T10:05:00Z",
      },
      {
        stage: /** @type {const} */ ("ship"),
        state: /** @type {const} */ ("failed"),
        at: "2026-11-05T11:00:00Z",
      },
      {
        stage: /** @type {const} */ ("ship"),
        state: /** @type {const} */ ("done"),
        at: "2026-11-06T10:05:00Z",
      },
    ],
    ships: [ship, { ...ship, at: "2026-11-05T10:55:00Z", outcome: "failure" }, later],
  };
  assert.deepEqual(recordProblems(record), []);
  assert.notDeepEqual(recordProblems({ ...record, ships: [{ env: "staging" }] }), []);
  const text = render(ledger([{ repo: "pay", key: "sta-9", from: "main", record }]));
  assert.match(text, /shipped STA-9 pay \(dev success\)/);
  assert.match(text, /shipped STA-9 pay \(staging success\)/);
});
