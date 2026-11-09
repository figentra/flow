/**
 * Figentra Flow file contract:
 * Purpose: hold `fflow status --divergence` to STA-1945 FR-9 and AC-11: per repository, the lock's Flow version and
 *   preset (name, version, digest), the preset lag, the overrides by kind, the replacements and disables with owner
 *   and review date (and those past it), and the drift from the lock; a repository without a lock is "not synced",
 *   never skipped; the report writes nothing, prints as text or `--json`, exits 1 on drift or an expired override,
 *   and refuses to mix with `--metrics`, `--web` or `--by`.
 * Boundary: temporary folders; no git remote, no GitHub, no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945 FR-9, AC-11, P-014.
 */
// @covers sta-1945:FR-9 sta-1945:AC-11 sta-1945:P-014
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { refusal, renderDivergence, status } from "../commands/status.mjs";
import { sync } from "../commands/sync.mjs";
import { divergence } from "../lib/divergence.mjs";
import { readLock } from "../lib/lock.mjs";
import { VERSION } from "../lib/product.mjs";
import { governed, snapshot } from "./__fixtures__/governed.mjs";

const quiet = { log: () => {} };
const LATER = new Date("2027-02-01T00:00:00Z");

/** A synced neutral repository with one `disable` override due for review on 2027-01-31. */
function synced(/** @type {{ after: (fn: () => void) => void }} */ t) {
  const root = governed(t);
  const off = join(root, ".flow/overrides/agents/ci.yml");
  mkdirSync(dirname(off), { recursive: true });
  writeFileSync(
    off,
    "kind: disable\ntarget: .agents/agents/ci-steward.md\nreason: r\nowner: o\nreview: 2027-01-31\n",
  );
  sync(root, { ...quiet, direct: true });
  return root;
}

/** A console `Io` that keeps what is printed. */
function io(/** @type {boolean} */ json = false) {
  /** @type {unknown[]} */
  const out = [];
  const keep = (/** @type {unknown} */ x) => out.push(x);
  return {
    out,
    io: /** @type {any} */ ({
      cwd: process.cwd(),
      json,
      verbose: false,
      output: { title: keep, line: keep, warn: keep, json: keep },
    }),
  };
}

const OPTIONS = { offline: false, metrics: false, since: "30d", web: false, port: 4747 };

test("divergence: the lock's versions and preset, no lag, the overrides by kind, and no drift", (t) => {
  const root = synced(t);
  const before = snapshot(root);
  const d = divergence(root, { now: new Date("2027-01-01T00:00:00Z") });
  assert.deepEqual(snapshot(root), before, "divergence writes nothing");
  const lock = readLock(root);
  assert.deepEqual(
    { ...d, preset: d.preset?.name },
    {
      repo: root,
      synced: true,
      flow: VERSION,
      preset: "neutral",
      profile: lock?.profile,
      lag: undefined,
      overrides: { disable: 1 },
      reviewed: [{ id: "ci", kind: "disable", owner: "o", review: "2027-01-31", state: "ok" }],
      expired: [],
      drift: [],
      problems: [],
    },
  );
  assert.match(d.preset?.digest ?? "", /^sha256:/);
});

test("divergence: lag against a later preset, an override past its review date, and drift from the lock", (t) => {
  const root = synced(t);
  const owned = Object.keys(readLock(root)?.files ?? {})[0];
  writeFileSync(join(root, owned), `${readFileSync(join(root, owned), "utf8")}hand edit\n`);
  const d = divergence(root, { latest: "9.9.9", now: LATER });
  assert.deepEqual(d.lag, { locked: VERSION, latest: "9.9.9" });
  assert.equal(d.reviewed[0].state, "expired");
  assert.deepEqual(d.expired, ["ci"]);
  assert.match(d.drift.join("\n"), new RegExp(`${owned.replaceAll(".", "\\.")} differs`));
  const text = renderDivergence(d).join("\n");
  assert.match(text, /preset lag: locked .*, latest 9\.9\.9/);
  assert.match(text, /overrides: disable 1; past review: ci/);
  assert.match(text, /disable ci: owner o, review 2027-01-31 \(expired\)/);
  assert.match(text, /^drift:$/m);
});

test("divergence: a repository without a lock is reported as not synced, never skipped", (t) => {
  const root = governed(t);
  const d = divergence(root);
  assert.equal(d.synced, false);
  assert.equal(d.lag, undefined);
  assert.deepEqual(renderDivergence(d), ["not synced (no .flow/lock.json)"]);
});

test("status --divergence: text and --json per repository; exit 1 on an expired override or drift", async (t) => {
  const root = synced(t);
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2027-01-01T00:00:00Z").getTime() });
  const text = io();
  assert.equal(await status(text.io, { ...OPTIONS, repo: root, divergence: true }), 0);
  assert.equal(text.out[0], root);
  assert.ok(text.out.includes("  drift: none"));
  const json = io(true);
  await status(json.io, { ...OPTIONS, repo: root, divergence: true });
  const [doc] = /** @type {any[]} */ (json.out);
  assert.equal(doc.repos.length, 1);
  assert.equal(doc.repos[0].path, root);
  assert.equal(doc.repos[0].preset.name, "neutral");
  // the review date passes: past review is a failure, as `check` makes it
  t.mock.timers.tick(31 * 86_400_000);
  assert.equal(await status(io().io, { ...OPTIONS, repo: root, divergence: true }), 1);
});

test("status --divergence: refused with --metrics, --web or --by", () => {
  for (const extra of [{ metrics: true }, { web: true }, { by: "role" }])
    assert.match(
      refusal({ ...OPTIONS, divergence: true, ...extra })?.message ?? "",
      /--divergence is its own report/,
    );
  assert.equal(refusal({ ...OPTIONS, divergence: true }), undefined);
});
