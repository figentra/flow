/**
 * Figentra Flow file contract:
 * Purpose: hold the credentials and secrets ports to their contracts: `env` needs a token in the environment,
 *   `gh-user` is the caller's own login by choice, `wrapper` refuses a `pnpm` script the repository lacks, a missing
 *   block refuses; network git through a local origin needs no credentials, and a network origin without them is
 *   refused unless the deprecated `bot:git` script exists; the secrets port wraps only with `infisical`, and only with
 *   a path for the scope.
 * Boundary: temporary folders and repositories; nothing reaches a network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1729 phase A (A1).
 */
// @covers sta-1729:FR-11 sta-1729:AC-034 sta-1729:AC-036 sta-1729:AC-040 sta-1729:AC-044
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { credentialsPort } from "../adapters/credentials.mjs";
import { secretsPort } from "../adapters/secrets.mjs";
import { ConfigError } from "../lib/config.mjs";
import { remote } from "../lib/git.mjs";
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
    domain: "https://eu.infisical.com/api",
    paths: { gate: "/ci/gate" },
  });
  assert.equal(
    box.wrap("node post.mjs", "gate"),
    'INFISICAL_TOKEN="$(infisical login --method=universal-auth --silent --plain --domain=https://eu.infisical.com/api)" infisical run --silent --domain=https://eu.infisical.com/api --projectId=abc-123 --env=prod --path=/ci/gate -- node post.mjs',
  );
  assert.throws(
    () => secretsPort({ kind: "infisical", domain: "http://x;y", paths: {} }),
    /not an https URL/,
  );
  assert.throws(
    () => secretsPort({ kind: "infisical", projectId: "x; y", paths: {} }),
    /projectId is not an id/,
  );
  assert.throws(
    () => secretsPort({ kind: "infisical", paths: { gate: "/ci; rm -rf /" } }).wrap("x", "gate"),
    /is not a path/,
  );
  assert.throws(
    () => secretsPort({ kind: "infisical", bin: "$(id)/x", paths: {} }),
    /bin is not a box path/,
  );
  assert.throws(
    () => secretsPort({ kind: "infisical", envFile: "~/.ci-env", paths: {} }),
    /envFile needs "auth"/,
  );
});

test("secrets: envFile's identity reaches only the login, never the run, the poster, argv or output", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "flow-envfile-"));
  t.after(() => rmSync(dir, { recursive: true }));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const id = "cid-fake-555";
  const secret = "csec-fake-777";
  const token = "tok-fake-999";
  // The box's file: the identity among unrelated lines, one with `export `, none of which may be taken.
  writeFileSync(
    join(dir, "ci-env"),
    `OTHER=keep-out\nINFISICAL_UNIVERSAL_AUTH_CLIENT_ID=${id}\nexport INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET=${secret}\n`,
  );
  // `login` prints a token only with both identity values; `run` must see neither of them, nor OTHER.
  writeFileSync(
    join(bin, "infisical"),
    [
      "#!/bin/sh",
      'printf "%s\\n" "$*" >> "$ARGV_LOG"',
      'if [ "$1" = login ]; then',
      `  [ "$INFISICAL_UNIVERSAL_AUTH_CLIENT_ID" = "${id}" ] && [ "$INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET" = "${secret}" ] || exit 7`,
      `  printf "%s" "${token}"; exit 0`,
      "fi",
      'if [ "$1" = run ]; then',
      `  [ "$INFISICAL_TOKEN" = "${token}" ] || exit 9`,
      '  [ -z "$INFISICAL_UNIVERSAL_AUTH_CLIENT_ID$INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET$OTHER" ] || exit 8',
      '  while [ "$1" != "--" ]; do shift; done; shift',
      '  exec "$@"',
      "fi",
      "exit 2",
      "",
    ].join("\n"),
  );
  chmodSync(join(bin, "infisical"), 0o755);
  const log = join(dir, "argv.log");
  const wrapped = secretsPort({
    kind: "infisical",
    auth: "universal-auth",
    bin: join(bin, "infisical"),
    envFile: join(dir, "ci-env"),
    paths: { gate: "/ci/gate" },
  }).wrap("echo poster-ran", "gate");
  // PATH without the fake CLI: `bin` alone finds it.
  const r = spawnSync(
    "sh",
    ["-c", `${wrapped}; echo "after:$INFISICAL_UNIVERSAL_AUTH_CLIENT_ID"`],
    {
      encoding: "utf8",
      env: { PATH: "/usr/bin:/bin", ARGV_LOG: log },
    },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "poster-ran\nafter:\n", "the identity outlived the subshell");
  for (const text of [r.stdout, r.stderr, readFileSync(log, "utf8"), wrapped])
    for (const value of [id, secret, token])
      assert.equal(text.includes(value), false, "a value leaked");
});

test("secrets: the universal-auth token reaches only the run process's environment, never output or argv (AC-044)", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "flow-infisical-"));
  t.after(() => rmSync(dir, { recursive: true }));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const token = "tok-fake-1234567890";
  // A stand-in for the infisical CLI: `login` prints a token; `run` records its argv, checks the token arrived in
  // its environment, and runs the wrapped command.
  writeFileSync(
    join(bin, "infisical"),
    [
      "#!/bin/sh",
      'printf "%s\\n" "$*" >> "$ARGV_LOG"',
      'if [ "$1" = login ]; then printf "%s" "' + token + '"; exit 0; fi',
      'if [ "$1" = run ]; then',
      '  [ "$INFISICAL_TOKEN" = "' +
        token +
        '" ] || { echo "no token in the environment" >&2; exit 9; }',
      '  while [ "$1" != "--" ]; do shift; done; shift',
      '  exec "$@"',
      "fi",
      "exit 2",
      "",
    ].join("\n"),
  );
  chmodSync(join(bin, "infisical"), 0o755);
  const log = join(dir, "argv.log");
  const wrapped = secretsPort({
    kind: "infisical",
    auth: "universal-auth",
    projectId: "p1",
    env: "prod",
    paths: { gate: "/ci/gate" },
  }).wrap("echo poster-ran", "gate");
  const r = spawnSync("sh", ["-c", wrapped], {
    encoding: "utf8",
    env: { PATH: `${bin}:${process.env.PATH}`, ARGV_LOG: log },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "poster-ran\n");
  for (const text of [r.stdout, r.stderr, readFileSync(log, "utf8"), wrapped])
    assert.equal(text.includes(token), false, "the token leaked");
  assert.match(
    readFileSync(log, "utf8"),
    /^login --method=universal-auth --silent --plain\nrun --silent --projectId=p1 --env=prod --path=\/ci\/gate -- echo poster-ran$/m,
  );
});
