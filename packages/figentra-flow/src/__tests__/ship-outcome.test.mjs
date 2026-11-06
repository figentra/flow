/**
 * Figentra Flow file contract:
 * Purpose: hold a ship's outcome to STA-2137: the dispatched run is the earliest at the tip after the dispatch; a
 *   completed run's `runway-outcome` artifact (Runway's deploy manifest, the fixture copied from `ProductDeploy`'s
 *   shape) gives the environment, revision, KV rows and uploads; a run without the artifact is `no outcome artifact`
 *   and never done; a run still going at the last poll is pending; the record takes the entry; the ledger shows it.
 * Boundary: the GitHub API is an in-memory stub and the zip is built here; no network, no git.
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
import { emptyRecord, recordProblems } from "../lib/record.mjs";
import {
  findRun,
  followRun,
  NO_OUTCOME,
  OUTCOME_ARTIFACT,
  readOutcome,
  shipState,
  unzipFile,
} from "../lib/ship-outcome.mjs";

const MANIFEST = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "__fixtures__/runway/deploy-staging.json"),
);
const SHA = "4f1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c";

/** A one-file zip, deflated (8) or stored (0). */
function zipOf(/** @type {string} */ name, /** @type {Buffer} */ data, method = 8) {
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
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + n.length, 12);
  end.writeUInt32LE(30 + n.length + body.length, 16);
  return Buffer.concat([local, n, body, central, n, end]);
}

/**
 * A stub API: the runs listed, each run by id, the artifacts of run 7 (`artifacts`) and artifact 9's zip.
 * @param {{ runs?: any[], artifacts?: any[], zip?: Buffer }} state
 * @returns {import("../lib/github.mjs").Api}
 */
const stubApi =
  ({ runs = [], artifacts = [], zip }) =>
  (method, path, _body, options) => {
    assert.equal(method, "GET");
    if (path.includes("/actions/workflows/deploy.yml/runs?"))
      return { ok: true, json: { workflow_runs: runs }, err: "" };
    const id = path.match(/\/actions\/runs\/(\d+)$/)?.[1];
    if (id) return { ok: true, json: runs.find((r) => String(r.id) === id), err: "" };
    if (path.endsWith(`/actions/runs/7/artifacts?name=${OUTCOME_ARTIFACT}`))
      return { ok: true, json: { artifacts }, err: "" };
    if (path.endsWith("/actions/artifacts/9/zip")) {
      assert.equal(options?.raw, true);
      return { ok: Boolean(zip), json: undefined, err: "", bytes: zip };
    }
    return { ok: false, json: undefined, err: `unexpected ${path}` };
  };

const done = {
  id: 7,
  status: "completed",
  conclusion: "success",
  head_sha: SHA,
  created_at: "2026-11-06T10:00:05Z",
  html_url: "https://github.com/figentra/pay/actions/runs/7",
};
const artifact = [{ id: 9, name: OUTCOME_ARTIFACT, expired: false }];

test("ship outcome: unzipFile reads a deflated or stored entry, after any wrapper lines", () => {
  const zip = zipOf("deploy-staging.json", MANIFEST);
  assert.deepEqual(
    unzipFile(zip, (n) => n === "deploy-staging.json"),
    MANIFEST,
  );
  assert.deepEqual(
    unzipFile(Buffer.concat([Buffer.from("wrapper: token ok\n"), zip]), () => true),
    MANIFEST,
  );
  assert.deepEqual(
    unzipFile(zipOf("a.json", MANIFEST, 0), () => true),
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

test("ship outcome: the dispatched run is the earliest at the tip created after the dispatch", () => {
  const runs = [
    { ...done, id: 8, created_at: "2026-11-06T10:01:00Z" },
    { ...done, id: 6, head_sha: "other" },
    done,
    { ...done, id: 5, created_at: "2026-11-06T09:00:00Z" },
  ];
  const since = Date.parse("2026-11-06T10:00:00Z");
  const found = findRun(stubApi({ runs }), "figentra/pay", {
    workflow: "deploy.yml",
    branch: "main",
    sha: SHA,
    since,
  });
  assert.equal(found?.id, 7);
});

test("ship outcome: a successful run's manifest gives the revision and the writes", () => {
  const api = stubApi({
    runs: [done],
    artifacts: artifact,
    zip: zipOf("deploy-staging.json", MANIFEST),
  });
  const ship = readOutcome(api, "figentra/pay", done, "staging");
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
  // A manifest of another environment, or a failed run, is no success.
  assert.equal(readOutcome(api, "figentra/pay", done, "dev").outcome, NO_OUTCOME);
  const failed = { ...done, conclusion: "failure" };
  assert.equal(readOutcome(api, "figentra/pay", failed, "staging").outcome, "failure");
  assert.equal(shipState("failure"), "failed");
});

test("ship outcome: a run without the artifact is `no outcome artifact`, never a success", () => {
  const ship = readOutcome(stubApi({ runs: [done] }), "figentra/pay", done, "staging");
  assert.equal(ship.outcome, NO_OUTCOME);
  assert.equal(ship.conclusion, "success");
  assert.equal(shipState(ship.outcome), "failed");
  // An artifact whose zip is corrupt reads the same.
  const bad = stubApi({ runs: [done], artifacts: artifact, zip: Buffer.from("PK\x03\x04junk") });
  assert.equal(readOutcome(bad, "figentra/pay", done, "staging").outcome, NO_OUTCOME);
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
  const api = stubApi({ runs, artifacts: artifact, zip: zipOf("deploy-staging.json", MANIFEST) });
  const options = {
    workflow: "deploy.yml",
    branch: "main",
    sha: SHA,
    since: Date.parse("2026-11-06T10:00:00Z"),
    env: "staging",
    sleep,
  };
  const ship = await followRun(api, "figentra/pay", { ...options, polls: 10 });
  assert.equal(ship.outcome, "success");
  assert.equal(polls, 3);

  polls = 0;
  runs.length = 0;
  const early = await followRun(api, "figentra/pay", { ...options, polls: 2 });
  assert.deepEqual(early, { env: "staging", run: 7, url: done.html_url, outcome: "pending" });
  assert.equal(shipState(early.outcome), "active");
});

test("ship outcome: the record takes a ship, and the ledger shows its outcome", () => {
  const ship = {
    env: "staging",
    at: "2026-11-06T10:05:00Z",
    outcome: "success",
    run: 7,
    sha: SHA,
    written: 3,
    uploaded: 2,
  };
  const record = {
    ...emptyRecord("sta-9"),
    stage: /** @type {const} */ ("ship"),
    state: /** @type {const} */ ("done"),
    history: [
      { stage: /** @type {const} */ ("ship"), state: /** @type {const} */ ("done"), at: ship.at },
    ],
    ships: [ship],
  };
  assert.deepEqual(recordProblems(record), []);
  assert.notDeepEqual(recordProblems({ ...record, ships: [{ env: "staging" }] }), []);
  const text = render(ledger([{ repo: "pay", key: "sta-9", from: "main", record }]));
  assert.match(text, /shipped STA-9 pay \(staging success\)/);
});
