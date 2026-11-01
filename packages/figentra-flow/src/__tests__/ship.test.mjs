/**
 * Figentra Flow file contract:
 * Purpose: hold `figentra-flow ship` to its rules: only dev and staging ship; production is refused by name and
 *   points at `runway promote`; a refused dispatch says whether the workflow lacks the `environment` input. The binary
 *   refuses production with exit 2 before it reads any configuration.
 * Boundary: pure functions, plus one `ship production` run of the binary in an empty folder; no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1729 (FR-8, AC-014, AC-015).
 */
// @covers sta-1729:FR-8 sta-1729:AC-014 sta-1729:AC-015
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { dispatchProblem, environmentProblems, SHIP_ENVIRONMENTS } from "../commands/ship.mjs";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "../../bin/figentra-flow.mjs");

test("ship: dev and staging ship, nothing else", () => {
  assert.deepEqual(SHIP_ENVIRONMENTS, ["dev", "staging"]);
  for (const env of SHIP_ENVIRONMENTS) assert.deepEqual(environmentProblems(env), []);
  assert.match(environmentProblems("preview")[0] ?? "", /not an environment ship deploys/);
  assert.match(environmentProblems(undefined)[0] ?? "", /^usage: /);
});

test("ship: production is refused by name and points at runway promote", () => {
  for (const env of ["production", "prod", "Production", "PROD"]) {
    const [problem] = environmentProblems(env);
    assert.match(problem ?? "", /production is never shipped/);
    assert.match(problem ?? "", /runway promote <sha>/);
  }
});

test("ship: a refused dispatch names the missing environment input or workflow", () => {
  assert.match(
    dispatchProblem("deploy.yml", 'gh: Unexpected inputs provided: ["environment"] (HTTP 422)'),
    /takes no workflow_dispatch input `environment`/,
  );
  assert.match(
    dispatchProblem("deploy.yml", "gh: Not Found (HTTP 404)"),
    /has no \.github\/workflows\/deploy\.yml/,
  );
  assert.match(
    dispatchProblem("deploy.yml", "gh: Bad credentials (HTTP 401)"),
    /dispatch .* failed/,
  );
});

test("ship: `ship production` exits 2 before reading any configuration", () => {
  const r = spawnSync(process.execPath, [BIN, "ship", "production"], {
    cwd: mkdtempSync(join(tmpdir(), "flow-ship-")),
    encoding: "utf8",
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /production is never shipped/);
});
