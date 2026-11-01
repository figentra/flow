/**
 * Figentra Flow file contract:
 * Purpose: hold `figentra-flow release` to its rules: changesets are read from their frontmatter, each package's
 *   next version follows its highest bump, the AC-054 findings are reported, a version PR that lacks a next version is
 *   stale, a skipped publish's notice is surfaced, and a registry 404 means never published.
 * Boundary: a scratch git repository, a fake GitHub `api` and a fake `fetch`; no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1729 (FR-8, AC-013, AC-054); STA-1845.
 */
// @covers sta-1729:FR-8 sta-1729:AC-013 sta-1729:AC-054
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  bumped,
  changesetsOf,
  lastRelease,
  nextVersions,
  packagesOf,
  published,
  releaseProblems,
  versionPr,
} from "../commands/release.mjs";

function scratch() {
  const root = mkdtempSync(join(tmpdir(), "flow-release-"));
  spawnSync("git", ["init", "-q"], { cwd: root });
  const pkg = (/** @type {string} */ dir, /** @type {object} */ m) => {
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, "package.json"), JSON.stringify(m));
  };
  pkg(".", { name: "root", private: true });
  pkg("packages/a", {
    name: "@x/a",
    version: "0.1.0",
    publishConfig: { registry: "https://r.test/" },
  });
  pkg("packages/b", { name: "@x/b", version: "1.2.3" });
  mkdirSync(join(root, ".changeset"));
  const cs = (/** @type {string} */ f, /** @type {string} */ front) =>
    writeFileSync(join(root, ".changeset", f), `---\n${front}\n---\n\nA change.\n`);
  cs("README.md", "");
  cs("one.md", '"@x/a": patch');
  cs("two.md", '"@x/a": minor\n"@x/b": patch');
  cs("three.md", "'@x/gone': major");
  spawnSync("git", ["add", "-A"], { cwd: root });
  return { root, dispose: () => rmSync(root, { recursive: true, force: true }) };
}

test("release: bumps follow changesets, a major from 0.x is 1.0.0", () => {
  assert.equal(bumped("0.1.0", "patch"), "0.1.1");
  assert.equal(bumped("0.1.0", "minor"), "0.2.0");
  assert.equal(bumped("0.9.4", "major"), "1.0.0");
  assert.equal(bumped("1.2.3-beta.1", "patch"), "1.2.4");
});

test("release: changesets, packages and next versions from a repository", (t) => {
  const r = scratch();
  t.after(r.dispose);
  const changesets = changesetsOf(r.root);
  assert.deepEqual(
    changesets.map((c) => c.file),
    [".changeset/one.md", ".changeset/three.md", ".changeset/two.md"],
    "the README is not a changeset",
  );
  assert.deepEqual(changesets[2].bumps, { "@x/a": "minor", "@x/b": "patch" });
  const packages = packagesOf(r.root);
  assert.deepEqual([...packages.keys()].sort(), ["@x/a", "@x/b", "root"]);
  const next = nextVersions(changesets, packages);
  assert.deepEqual(
    next.get("@x/a"),
    { bump: "minor", from: "0.1.0", to: "0.2.0" },
    "the highest bump wins",
  );
  assert.deepEqual(next.get("@x/b"), { bump: "patch", from: "1.2.3", to: "1.2.4" });
  assert.equal(next.get("@x/gone")?.to, undefined);

  const problems = releaseProblems({
    changesets,
    packages,
    next,
    published: new Map([["@x/a", ["0.1.0", "0.2.0"]]]),
  });
  assert.deepEqual(problems, [
    ".changeset/three.md names @x/gone, which this repository does not have",
    "@x/a@0.2.0 is already on https://r.test/",
    "@x/b names no registry (publishConfig.registry, its scope in .npmrc or the Release workflow's `registry:`), so it would go to the default one",
  ]);
});

/** A fake API answering by path prefix. @param {Record<string, any>} routes */
const fakeApi = (routes) => (/** @type {string} */ _m, /** @type {string} */ path) => {
  const key = Object.keys(routes).find((k) => path.startsWith(k));
  return key
    ? { ok: true, json: routes[key], err: "" }
    : { ok: false, json: undefined, err: "HTTP 404" };
};

test("release: a package without publishConfig takes its .npmrc scope, else the Release workflow's registry", (t) => {
  const r = scratch();
  t.after(r.dispose);
  mkdirSync(join(r.root, ".github/workflows"), { recursive: true });
  writeFileSync(
    join(r.root, ".github/workflows/release.yml"),
    "jobs:\n  release:\n    with:\n      registry: https://wf.test/\n",
  );
  assert.equal(packagesOf(r.root).get("@x/b")?.registry, "https://wf.test/");
  assert.equal(packagesOf(r.root).get("@x/a")?.registry, "https://r.test/", "publishConfig wins");
  writeFileSync(join(r.root, ".npmrc"), "@x:registry=https://scope.test/\n");
  assert.equal(packagesOf(r.root).get("@x/b")?.registry, "https://scope.test/");
});

test("release: a version PR lacking a next version is stale", () => {
  const next = new Map([
    ["@x/a", { to: "0.2.0" }],
    ["@x/gone", {}],
  ]);
  const api = fakeApi({
    "/repos/o/r/pulls": [{ number: 30, html_url: "u", body: "## @x/a@0.1.0" }],
  });
  assert.deepEqual(versionPr(api, "o/r", "main", next), {
    number: 30,
    url: "u",
    stale: ["@x/a@0.2.0"],
  });
  const current = fakeApi({
    "/repos/o/r/pulls": [{ number: 30, html_url: "u", body: "## @x/a@0.2.0" }],
  });
  assert.deepEqual(versionPr(current, "o/r", "main", next).stale, []);
  assert.deepEqual(versionPr(fakeApi({ "/repos/o/r/pulls": [] }), "o/r", "main", next), {});
});

test("release: the last Release run carries its skip notice, not GitHub's runner notices", () => {
  const api = fakeApi({
    "/repos/o/r/actions/workflows/release.yml/runs": {
      workflow_runs: [{ id: 7, html_url: "run", head_sha: "abc", conclusion: "success" }],
    },
    "/repos/o/r/actions/runs/7/jobs": { jobs: [{ id: 9, name: "Release setup" }] },
    "/repos/o/r/check-runs/9/annotations": [
      {
        annotation_level: "notice",
        message: "STACKRA_BOT_APP_ID and STACKRA_BOT_PRIVATE_KEY are not both set",
      },
      { annotation_level: "warning", message: "The ubuntu-latest label will migrate to Ubuntu 26" },
    ],
  });
  assert.deepEqual(lastRelease(api, "o/r", "main"), {
    url: "run",
    sha: "abc",
    conclusion: "success",
    notices: ["Release setup: STACKRA_BOT_APP_ID and STACKRA_BOT_PRIVATE_KEY are not both set"],
  });
  assert.deepEqual(lastRelease(fakeApi({}), "o/r", "main"), { notices: [], err: "HTTP 404" });
});

test("release: the registry's versions; 404 is never published, a failure is a note", async () => {
  /** @type {string[]} */
  const asked = [];
  const answer =
    (/** @type {number} */ status, /** @type {any} */ doc) =>
    /** @type {any} */
    async (/** @type {string} */ url) => {
      asked.push(url);
      return { ok: status === 200, status, json: async () => doc };
    };
  assert.deepEqual(
    await published(
      "https://r.test/",
      "@x/a",
      answer(200, { versions: { "0.1.0": {} }, "dist-tags": { latest: "0.1.0" } }),
    ),
    { versions: ["0.1.0"], latest: "0.1.0" },
  );
  assert.equal(asked[0], "https://r.test/@x%2fa");
  assert.deepEqual(await published("https://r.test", "@x/a", answer(404, {})), { versions: [] });
  assert.match(
    (await published("https://r.test", "@x/a", answer(500, {}))).err ?? "",
    /answered 500/,
  );
  const down = /** @type {any} */ (
    async () => {
      throw new Error("ENOTFOUND");
    }
  );
  assert.match(
    (await published("https://r.test", "@x/a", down)).err ?? "",
    /unreachable: ENOTFOUND/,
  );
});
