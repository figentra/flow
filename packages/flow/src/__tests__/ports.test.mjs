/**
 * Figentra Flow file contract:
 * Purpose: hold the ports to their contracts: the credentials port's `env` needs a GitHub token in the environment,
 *   `gh-user` is the caller's own login by choice, `wrapper` refuses a `pnpm` script the repository lacks, a missing
 *   block refuses; network git through a local origin needs no credentials, and a network origin without them is
 *   refused (there is no `bot:git` fallback, AC-045); the secrets port never wraps (the caller's environment holds
 *   the values, Stackra ADR 0525), still reads the retired `infisical` kind as `env`, and refuses an unknown kind.
 * Boundary: temporary folders and repositories; nothing reaches a network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1729 phase A (A1).
 */
// @covers sta-1729:FR-11 sta-1729:AC-034 sta-1729:AC-036 sta-1729:AC-040 sta-1729:AC-044
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { credentialsPort } from "../adapters/credentials.mjs";
import { secretsPort } from "../adapters/secrets.mjs";
import { ConfigError } from "../lib/config.mjs";
import { remote } from "../lib/git.mjs";
import { CONFIG_FILE } from "../lib/product.mjs";
import { repo, sh } from "./__fixtures__/repo.mjs";

test("credentials: env needs a token, gh-user is by choice, a wrapper needs its script, none refuses", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "flow-cred-"));
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
  // An invalid configuration is reported as itself, not as a failed fetch or a missing tip.
  writeFileSync(join(r.root, CONFIG_FILE), JSON.stringify({ credentials: { kind: "env" } }));
  assert.throws(
    () => remote(r.root, ["ls-remote", "origin"]),
    (e) => e instanceof ConfigError && /version/.test(e.message),
  );
});

test("secrets: every kind leaves the command alone (the caller's environment holds the values); an unknown kind refuses", () => {
  for (const block of [
    undefined,
    { kind: "env" },
    { kind: "sops", oidc: { decrypt: `o/r/a@${"a".repeat(40)}`, scope: "ci/flow/gate" } },
    // Retired: read as env, never run.
    { kind: "infisical", paths: { gate: "/ci/gate" }, bin: "~/.local/bin/infisical" },
  ])
    assert.equal(secretsPort(block).wrap("node post.mjs", "gate"), "node post.mjs");
  assert.throws(() => secretsPort({ kind: "vault" }), /unknown kind vault/);
});

test("secrets store: a new 0600 file only, for every kind; no file, no store", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "flow-store-test-"));
  t.after(() => rmSync(dir, { recursive: true }));
  for (const [i, block] of [{ kind: "env" }, { kind: "sops" }, { kind: "infisical" }].entries()) {
    const port = secretsPort(block);
    const file = join(dir, `key-${i}.pem`);
    assert.deepEqual(port.store("X_PRIVATE_KEY", "pem-value", { file }), { ok: true, where: file });
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(
      port.store("X_PRIVATE_KEY", "again", { file }).ok,
      false,
      "never over an existing file",
    );
    const missing = port.store("X_PRIVATE_KEY", "pem-value");
    assert.match(missing.problem ?? "", /--key-file/);
    assert.equal(String(missing.problem).includes("pem-value"), false);
  }
});
