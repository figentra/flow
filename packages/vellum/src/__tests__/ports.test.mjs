/**
 * Vellum file contract:
 * Purpose: hold the credentials and secrets ports to their contracts: `env` needs a token in the environment,
 *   `gh-user` is the caller's own login by choice, `wrapper` refuses a `pnpm` script the repository lacks, a missing
 *   block refuses; network git through a local origin needs no credentials, and a network origin without them is
 *   refused unless the deprecated `bot:git` script exists; the secrets port wraps only with `infisical`, and only with
 *   a path for the scope.
 * Boundary: temporary folders and repositories; nothing reaches a network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1729 phase A (A1).
 */
// @covers sta-1729:FR-11 sta-1729:AC-034 sta-1729:AC-036 sta-1729:AC-040
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { credentialsPort } from "../adapters/credentials.mjs";
import { secretsPort } from "../adapters/secrets.mjs";
import { ConfigError } from "../lib/config.mjs";
import { remote } from "../lib/git.mjs";
import { repo, sh } from "./__fixtures__/repo.mjs";

test("credentials: env needs a token, gh-user is by choice, a wrapper needs its script, none refuses", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "vellum-cred-"));
  t.after(() => rmSync(dir, { recursive: true }));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ scripts: { "bot:gh": "x", "bot:git": "y" } }),
  );
  assert.throws(() => credentialsPort({ kind: "env" }, { root: dir, env: {} }), /set GH_TOKEN/);
  assert.deepEqual(credentialsPort({ kind: "env" }, { root: dir, env: { GH_TOKEN: "t" } }), {
    gh: ["gh"],
    git: ["git"],
  });
  assert.deepEqual(credentialsPort({ kind: "gh-user" }, { root: dir }), {
    gh: ["gh"],
    git: ["git"],
  });
  assert.deepEqual(
    credentialsPort(
      { kind: "wrapper", gh: ["pnpm", "bot:gh", "--"], git: ["pnpm", "bot:git", "--"] },
      { root: dir },
    ),
    {
      gh: ["pnpm", "bot:gh", "--"],
      git: ["pnpm", "bot:git", "--"],
    },
  );
  assert.throws(
    () => credentialsPort({ kind: "wrapper", gh: ["pnpm", "bot:other", "--"] }, { root: dir }),
    /`bot:other` is not a script/,
  );
  assert.throws(() => credentialsPort(undefined, { root: dir }), ConfigError);
});

test("network git: a local origin needs no credentials; a network origin without them is refused", (t) => {
  const r = repo();
  t.after(r.dispose);
  assert.equal(remote(r.root, ["ls-remote", "origin", "refs/heads/main"]).ok, true);
  sh(r.root, "remote", "set-url", "origin", "git@github.com:someone/thing.git");
  const refused = remote(r.root, ["fetch", "-q", "origin"]);
  assert.equal(refused.ok, false);
  assert.match(refused.err, /network git needs "credentials"/);
});

test("secrets: env leaves the command alone; infisical wraps with the scope's path and refuses without one", () => {
  assert.equal(secretsPort(undefined).wrap("node post.mjs", "gate"), "node post.mjs");
  assert.equal(secretsPort({ kind: "env" }).wrap("node post.mjs", "gate"), "node post.mjs");
  const infisical = secretsPort({ kind: "infisical", paths: { gate: "/ci/gate" } });
  assert.equal(
    infisical.wrap("node post.mjs", "gate"),
    "infisical run --silent --path=/ci/gate -- node post.mjs",
  );
  assert.throws(() => infisical.wrap("x", "review"), /set paths\.review/);
  const box = secretsPort({
    kind: "infisical",
    auth: "universal-auth",
    projectId: "abc-123",
    env: "prod",
    paths: { gate: "/ci/gate" },
  });
  assert.equal(
    box.wrap("node post.mjs", "gate"),
    'infisical run --silent --token="$(infisical login --method=universal-auth --silent --plain)" --projectId=abc-123 --env=prod --path=/ci/gate -- node post.mjs',
  );
  assert.throws(
    () => secretsPort({ kind: "infisical", projectId: "x; y", paths: {} }),
    /projectId is not an id/,
  );
  assert.throws(
    () => secretsPort({ kind: "infisical", paths: { gate: "/ci; rm -rf /" } }).wrap("x", "gate"),
    /is not a path/,
  );
});
