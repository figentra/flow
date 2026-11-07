/**
 * Figentra Flow file contract:
 * Purpose: hold `fflow release` to its rules: changesets are read from their frontmatter, each package's
 *   next version follows its highest bump, the AC-054 findings are reported, a version PR that lacks a next version is
 *   stale, a skipped publish's notice is surfaced, and a registry 404 means never published. The preflight passes
 *   only when every item holds, names each failed one with its fix, skips the network rows offline and reads a stale
 *   lockfile importer.
 * Boundary: a scratch git repository, a fake GitHub `api` and a fake `fetch`; no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1729 (FR-8, AC-013, AC-054); STA-1845; STA-1945.
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
  lockfileProblems,
  nextVersions,
  packagesOf,
  preflight,
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

/** A lockfile whose importers match `manifests`. @param {Record<string, any>} manifests */
const lockOf = (manifests) =>
  [
    "lockfileVersion: '9.0'",
    "",
    "importers:",
    "",
    ...Object.entries(manifests).flatMap(([dir, m]) => [
      `  ${dir}:`,
      ...Object.entries(m.dependencies ?? {}).flatMap(([n, spec], i) => [
        ...(i ? [] : ["    dependencies:"]),
        `      ${n}:`,
        `        specifier: '${spec}'`,
        "        version: 1.0.0",
      ]),
      "",
    ]),
    "packages:",
    "",
    "  undici@1.0.0:",
    "    resolution: {integrity: sha512-x}",
    "",
  ].join("\n");

/** A committed scratch repository on `main`: a private root and `@x/a` 0.1.0 with a minor changeset. */
function releaseRepo() {
  const root = mkdtempSync(join(tmpdir(), "flow-preflight-"));
  const sh = (/** @type {string[]} */ args) =>
    spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t.test", ...args], {
      cwd: root,
      encoding: "utf8",
    }).stdout.trim();
  sh(["init", "-q", "-b", "main"]);
  const a = {
    name: "@x/a",
    version: "0.1.0",
    publishConfig: { registry: "https://r.test/" },
    dependencies: { undici: "catalog:" },
  };
  mkdirSync(join(root, "packages/a"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "root", private: true }));
  writeFileSync(join(root, "packages/a/package.json"), JSON.stringify(a));
  writeFileSync(join(root, "pnpm-lock.yaml"), lockOf({ ".": {}, "packages/a": a }));
  mkdirSync(join(root, ".changeset"));
  writeFileSync(join(root, ".changeset/one.md"), '---\n"@x/a": minor\n---\n\nA change.\n');
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  writeFileSync(
    join(root, ".github/workflows/release.yml"),
    "jobs:\n  release:\n    with:\n      registry: https://r.test/\n",
  );
  sh(["add", "-A"]);
  sh(["commit", "-qm", "init"]);
  return {
    root,
    a,
    head: sh(["rev-parse", "HEAD"]),
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

const b64 = (/** @type {string} */ s) => ({ content: Buffer.from(s).toString("base64") });

/**
 * GitHub for `releaseRepo`: main at `main`, the version PR #9 at `pr1`, the gate required by the ruleset.
 * @param {{ main: string, a: any, test?: string, behind?: number, version?: string, lock?: string }} o
 */
function releaseApi({ main, a, test = "success", behind = 0, version = "0.2.0", lock }) {
  const green = {
    check_runs: [
      {
        id: 1,
        name: "verify",
        status: "completed",
        conclusion: "success",
        app: { slug: "github-actions" },
      },
      {
        id: 2,
        name: "test",
        status: "completed",
        conclusion: test,
        app: { slug: "github-actions" },
      },
    ],
  };
  const gate = [{ context: "fflow/gate", state: "success", creator: { login: "gate[bot]" } }];
  const atHead = { ...a, version };
  return fakeApi({
    "/repos/o/r/branches/main": { commit: { sha: main } },
    "/repos/o/r/rules/branches/main": [
      {
        type: "required_status_checks",
        parameters: { required_status_checks: [{ context: "fflow/gate" }] },
      },
    ],
    [`/repos/o/r/commits/${main}/statuses`]: gate,
    [`/repos/o/r/commits/${main}/check-runs`]: green,
    "/repos/o/r/commits/pr1/statuses": gate,
    "/repos/o/r/commits/pr1/check-runs": green,
    "/repos/o/r/pulls": [{ number: 9, base: { ref: "main" }, head: { sha: "pr1" } }],
    [`/repos/o/r/compare/${main}...pr1`]: {
      behind_by: behind,
      merge_base_commit: { sha: behind ? "old" : main },
    },
    "/repos/o/r/contents/packages/a/package.json?ref=pr1": b64(JSON.stringify(atHead)),
    "/repos/o/r/contents/package.json?ref=pr1": b64(
      JSON.stringify({ name: "root", private: true }),
    ),
    "/repos/o/r/contents/pnpm-lock.yaml?ref=pr1": b64(
      lock ?? lockOf({ ".": {}, "packages/a": atHead }),
    ),
  });
}

/** A registry holding `versions` of every package. @param {string[]} versions */
const registryWith = (versions) => /** @type {any} */ async () => ({
  ok: true,
  status: 200,
  json: async () => ({ versions: Object.fromEntries(versions.map((v) => [v, {}])) }),
});

const config = { apps: { gate: { login: "gate[bot]" } } };

test("release preflight: every item holds, so the owner may merge", async (t) => {
  const r = releaseRepo();
  t.after(r.dispose);
  const rows = await preflight({
    root: r.root,
    branch: "main",
    offline: false,
    api: releaseApi({ main: r.head, a: r.a }),
    repo: "o/r",
    config,
    get: registryWith(["0.1.0"]),
  });
  assert.deepEqual(
    rows.filter((row) => row.status !== "pass"),
    [],
  );
  assert.deepEqual(
    rows.map((row) => row.id),
    [
      "branch",
      "clean",
      "up-to-date",
      "main-checks",
      "changesets",
      "version-pr",
      "version-pr-checks",
      "publish-config",
      "registry",
      "lockfile",
    ],
  );
  assert.match(rows[3].detail, /fflow\/gate, verify, test green/);
});

test("release preflight: each failed item is named with its fix", async (t) => {
  const r = releaseRepo();
  t.after(r.dispose);
  // A local edit: the checkout is dirty, and the Release workflow now names another registry.
  writeFileSync(
    join(r.root, ".github/workflows/release.yml"),
    "jobs:\n  release:\n    with:\n      registry: https://other.test/\n",
  );
  const stale = lockOf({ ".": {}, "packages/a": { dependencies: { undici: "^1.0.0" } } });
  const rows = await preflight({
    root: r.root,
    branch: "main",
    offline: false,
    api: releaseApi({
      main: "f".repeat(40),
      a: r.a,
      test: "failure",
      behind: 2,
      version: "0.1.1",
      lock: stale,
    }),
    repo: "o/r",
    config,
    get: registryWith(["0.1.0", "0.2.0"]),
  });
  const failed = Object.fromEntries(
    rows.filter((row) => row.status === "fail").map((row) => [row.id, row]),
  );
  assert.deepEqual(Object.keys(failed), [
    "clean",
    "up-to-date",
    "main-checks",
    "version-pr",
    "version-pr-checks",
    "publish-config",
    "registry",
    "lockfile",
  ]);
  for (const row of Object.values(failed)) assert.ok(row.fix, `${row.id} names its fix`);
  assert.match(failed["main-checks"].detail, /test failed/);
  assert.match(failed["version-pr"].detail, /2 commits behind main/);
  assert.match(failed["version-pr"].detail, /it has @x\/a@0\.1\.1, the changesets imply 0\.2\.0/);
  assert.match(
    failed["publish-config"].detail,
    /@x\/a publishes to https:\/\/r\.test\/, not https:\/\/other\.test\//,
  );
  assert.match(failed.registry.detail, /@x\/a@0\.2\.0 is already on https:\/\/r\.test\//);
  assert.match(
    failed.lockfile.detail,
    /packages\/a dependencies undici: package\.json has catalog:, pnpm-lock\.yaml \^1\.0\.0/,
  );
});

test("release preflight: offline, the network rows are skipped, not passed", async (t) => {
  const r = releaseRepo();
  t.after(r.dispose);
  spawnSync("git", ["checkout", "-q", "-b", "work"], { cwd: r.root });
  const rows = await preflight({ root: r.root, branch: "main", offline: true });
  const by = Object.fromEntries(rows.map((row) => [row.id, row]));
  for (const id of ["up-to-date", "main-checks", "version-pr", "version-pr-checks", "registry"])
    assert.equal(by[id].status, "skip", id);
  assert.equal(by.branch.status, "fail");
  assert.equal(by.branch.fix, "git switch main");
  for (const id of ["clean", "changesets", "publish-config", "lockfile"])
    assert.equal(by[id].status, "pass", id);
  assert.match(by.lockfile.detail, /at HEAD/);
});

test("release preflight: a lockfile without the released package's importer, or unreadable, is a problem", () => {
  const read = (/** @type {string} */ path) =>
    path === "package.json" ? JSON.stringify({ name: "root" }) : undefined;
  assert.deepEqual(lockfileProblems(lockOf({ ".": {} }), read, ["packages/a"]), [
    "pnpm-lock.yaml has no importer for packages/a",
  ]);
  assert.deepEqual(lockfileProblems("lockfileVersion: '9.0'\n", read, []), [
    "pnpm-lock.yaml has no importers",
  ]);
  assert.deepEqual(lockfileProblems(lockOf({ "packages/b": {} }), read, []), [
    "pnpm-lock.yaml's importer packages/b has no readable packages/b/package.json",
  ]);
});
