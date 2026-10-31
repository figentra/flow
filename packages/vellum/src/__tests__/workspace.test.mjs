/**
 * Vellum file contract:
 * Purpose: hold the workspace list to its contract: written and read back unchanged, empty when missing, and the
 *   repositories under a folder found with their GitHub slug.
 * Boundary: temporary folders; no network.
 * Runtime: node
 * Governing contract: ADR 0022; Stackra ADR 0503; STA-1729.
 */
// @covers sta-1729:FR-7 sta-1729:AC-012
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { findRepos, readWorkspace, workspaceFile, writeWorkspace } from "../lib/workspace.mjs";
import { repo, sh } from "./__fixtures__/repo.mjs";

test("workspace: round trip through VELLUM_WORKSPACE, and empty when the file is missing", () => {
  const file = join(
    realpathSync(mkdtempSync(join(tmpdir(), "vellum-ws-"))),
    "nested",
    "workspace.yaml",
  );
  assert.equal(workspaceFile({ VELLUM_WORKSPACE: file }), file);
  assert.deepEqual(readWorkspace(file), []);
  const repos = [
    { path: "/a/core", github: "figentra/stackra" },
    { path: "/a/with space", github: "" },
  ];
  writeWorkspace(repos, file);
  assert.deepEqual(readWorkspace(file), repos);
});

test("workspace: finds the repositories under a folder with their GitHub slug", (t) => {
  const r = repo();
  t.after(r.dispose);
  sh(r.root, "remote", "set-url", "origin", "git@github.com:figentra/vellum.git");
  const top = dirname(r.root);
  mkdirSync(join(top, ".hidden", ".git"), { recursive: true });
  assert.deepEqual(findRepos([top]), [{ path: r.root, github: "figentra/vellum" }]);
});
