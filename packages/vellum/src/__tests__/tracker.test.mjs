/**
 * Figentra Flow file contract:
 * Purpose: hold the tracker port to AC-037 and the leader's rule for `gate plan`: the key scheme parses, displays and
 *   names branches and folders per tracker (`linear` by team, `github-issues` as `gh-<n>`, any prefix without a
 *   tracker); a repository with no config file keeps the Linear `STA` scheme with a warning, and one with a config but
 *   no tracker has no adapter; `github-issues` maps titles, states, In Progress and Done to the REST calls; a tracker
 *   failure while reporting a spec's stage is a warning, never swallowed.
 * Boundary: temporary repositories and folders; GitHub injected; no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1729 phase A (A2).
 */
// @covers sta-1729:FR-11 sta-1729:AC-036 sta-1729:AC-037
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { githubIssuesTracker } from "../adapters/tracker/github-issues.mjs";
import { keyScheme, trackerFor } from "../adapters/tracker/index.mjs";
import { trackerStage } from "../commands/gate.mjs";
import { CONFIG_FILE } from "../lib/product.mjs";
import { repo, sh } from "./__fixtures__/repo.mjs";

test("key scheme: linear by team, github-issues as gh-<n>, any prefix without a tracker", () => {
  const linear = keyScheme({ kind: "linear", team: "OPS", branchPrefix: "acme" });
  assert.equal(linear.parse("acme/ops-12-fix-it"), "ops-12");
  assert.equal(linear.parse("OPS-7"), "ops-7");
  assert.equal(linear.parse("12"), "ops-12");
  assert.equal(linear.parse("sta-12"), undefined);
  assert.equal(linear.display("ops-12"), "OPS-12");
  assert.equal(linear.branch("ops-12", "fix-it"), "acme/ops-12-fix-it");
  assert.equal(linear.folder("ops-12", "fix-it"), "ops-12-fix-it");
  const gh = keyScheme({ kind: "github-issues", branchPrefix: "work" });
  assert.equal(gh.parse("#42"), "gh-42");
  assert.equal(gh.branch("gh-42", "x"), "work/gh-42-x");
  const any = keyScheme(undefined);
  assert.equal(any.parse("team/abc-9-thing"), "abc-9");
  assert.equal(any.parse("9"), undefined);
});

test("trackerFor: no config file keeps the Linear STA scheme with a warning; a config without a tracker has none", (t) => {
  const r = repo();
  t.after(r.dispose);
  /** @type {string[]} */
  const warnings = [];
  const legacy = trackerFor(r.root, { warn: (s) => void warnings.push(s), env: {} });
  assert.equal(legacy.scheme.prefix, "sta");
  assert.equal(legacy.scheme.branch("sta-3", "x"), "figentra/sta-3-x");
  assert.match(warnings.join(), /deprecated/);
  const dir = mkdtempSync(join(tmpdir(), "vellum-tracker-"));
  t.after(() => rmSync(dir, { recursive: true }));
  writeFileSync(join(dir, CONFIG_FILE), JSON.stringify({ version: 1 }));
  const none = trackerFor(dir, { warn: () => assert.fail("no warning expected") });
  assert.equal(none.tracker, undefined);
  assert.match(none.problem ?? "", /needs "tracker"/);
});

test("github-issues: title, states, In Progress as a label and Done as closing, through the API", async (t) => {
  const r = repo();
  t.after(r.dispose);
  sh(r.root, "remote", "set-url", "origin", "git@github.com:acme/app.git");
  /** @type {{ method: string, path: string, body?: any }[]} */
  const calls = [];
  /** @type {Record<string, any>} */
  const issues = {
    1: { title: "Fix it", state: "open" },
    2: { state: "closed", state_reason: "completed" },
    3: { state: "closed", state_reason: "not_planned" },
  };
  /** @type {import("../lib/github.mjs").Api} */
  const api = (method, path, body) => {
    calls.push({ method, path, body });
    const n = path.match(/issues\/(\d+)/)?.[1] ?? "";
    return { ok: true, json: issues[n] ?? {}, err: "" };
  };
  const tracker = githubIssuesTracker({ kind: "github-issues" }, { root: r.root, api });
  assert.equal(await tracker.title("GH-1"), "Fix it");
  assert.deepEqual(
    [await tracker.state("GH-1"), await tracker.state("GH-2"), await tracker.state("GH-3")],
    ["Open", "Done", "Canceled"],
  );
  calls.length = 0;
  await tracker.inProgress("GH-1", "work/gh-1-fix-it");
  await tracker.done("GH-1", "https://x/commit/abc");
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.path}`),
    [
      "POST /repos/acme/app/issues/1/labels",
      "POST /repos/acme/app/issues/1/comments",
      "POST /repos/acme/app/issues/1/comments",
      "PATCH /repos/acme/app/issues/1",
    ],
  );
  assert.deepEqual(calls[3]?.body, { state: "closed", state_reason: "completed" });
});

test("gate plan's stage report: a tracker failure is a warning, never swallowed; a success comments", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "vellum-stage-"));
  t.after(() => rmSync(dir, { recursive: true }));
  const spec = join(dir, "spec.md");
  writeFileSync(spec, "# Spec\n\n**Linear**: OPS-12\n");
  const scheme = keyScheme({ kind: "linear", team: "OPS", branchPrefix: "acme" });
  /** @type {string[]} */
  const warnings = [];
  const failing = {
    title: async () => "",
    state: async () => "",
    inProgress: async () => {},
    done: async () => {},
    comment: async () => Promise.reject(new Error("tracker down")),
  };
  await trackerStage(spec, "clarified", {
    root: dir,
    scheme,
    tracker: failing,
    warn: (s) => void warnings.push(s),
  });
  assert.match(warnings.join(), /OPS-12 was not told the stage clarified \(tracker down\)/);
  /** @type {string[]} */
  const said = [];
  const working = {
    ...failing,
    comment: async (/** @type {string} */ key, /** @type {string} */ body) =>
      void said.push(`${key}: ${body}`),
  };
  await trackerStage(spec, "clarified", {
    root: dir,
    scheme,
    tracker: working,
    warn: () => assert.fail("no warning expected"),
  });
  assert.deepEqual(said, ["OPS-12: Spec stage: clarified (spec.md)"]);
});
