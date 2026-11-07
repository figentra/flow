/**
 * Figentra Flow file contract:
 * Purpose: hold `app create`'s secret handling to the leader's conditions (AC-039): the callback state is spent on
 *   the first valid code and the server closes; the port refuses a key file a repository would track; the PEM,
 *   client secret and webhook secret never reach stdout, stderr or an error message. (The Infisical hand-off is
 *   retired, Stackra ADR 0525: the key is only ever written to a file the human names.)
 * Boundary: temporary folders and repositories, a loopback server; GitHub faked.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1729 phase A (A4).
 */
// @covers sta-1729:AC-039 sta-1729:AC-040
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { secretsPort, trackable } from "../adapters/secrets.mjs";
import { createApp, manifestFor, serveManifest } from "../commands/app.mjs";

const PEM =
  "-----BEGIN RSA PRIVATE KEY-----\nleak-canary-pem-4242\n-----END RSA PRIVATE KEY-----\n";
const CLIENT_SECRET = "leak-canary-client-secret-77";
const WEBHOOK_SECRET = "leak-canary-webhook-secret-99";
test("env store: a key file inside a work tree is refused unless git ignores it; outside one it is written", (t) => {
  const top = mkdtempSync(join(tmpdir(), "flow-env-store-"));
  t.after(() => rmSync(top, { recursive: true }));
  spawnSync("git", ["init", "-q", top]);
  writeFileSync(join(top, ".gitignore"), "*.pem\n");
  const env = secretsPort({ kind: "env" });
  assert.match(trackable(join(top, "key.txt")) ?? "", /not ignored/);
  assert.match(
    env.store("X_KEY", PEM, { file: join(top, "key.txt") }).problem ?? "",
    /not ignored/,
  );
  assert.equal(existsSync(join(top, "key.txt")), false);
  assert.equal(env.store("X_KEY", PEM, { file: join(top, "key.pem") }).ok, true);
  const outside = mkdtempSync(join(tmpdir(), "flow-env-out-"));
  t.after(() => rmSync(outside, { recursive: true }));
  assert.equal(trackable(join(outside, "key.txt")), undefined);
});

test("callback: the state is spent on the first valid code and the server closes", async () => {
  const served = await serveManifest({
    manifest: (redirect) => manifestFor("gate", { name: "g", url: "https://github.com", redirect }),
    target: (state) => `https://github.com/settings/apps/new?state=${state}`,
    timeoutMs: 5_000,
  });
  assert.match(served.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  const state = (await (await fetch(served.url)).text()).match(/state=([0-9a-f]{32})/)?.[1];
  assert.equal((await fetch(`${served.url}callback?state=${state}&code=c1`)).status, 200);
  assert.equal(await served.code, "c1");
  await assert.rejects(
    fetch(`${served.url}callback?state=${state}&code=c2`),
    "a replay finds no server",
  );
});

test("nothing leaks: the PEM and GitHub's secrets reach neither stdout nor stderr, on success or failure", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "flow-app-leak-"));
  t.after(() => rmSync(root, { recursive: true }));
  /** @type {string[]} */
  const output = [];
  const capture = (/** @type {string} */ s) => void output.push(s);
  const conversion = async () => ({
    ok: true,
    status: 201,
    json: async () => ({
      id: 42,
      slug: "x-gate",
      pem: PEM,
      client_secret: CLIENT_SECRET,
      webhook_secret: WEBHOOK_SECRET,
    }),
  });
  const browse = (/** @type {string} */ url) =>
    void fetch(url)
      .then((r) => r.text())
      .then((page) =>
        fetch(`${url}callback?state=${page.match(/state=([0-9a-f]{32})/)?.[1]}&code=c1`),
      );
  const run = (/** @type {any} */ over) =>
    createApp({
      role: "gate",
      root,
      env: {},
      isTTY: true,
      log: capture,
      error: capture,
      fetch: conversion,
      open: browse,
      ...over,
    });
  assert.equal(
    await run({ secrets: { wrap: (c) => c, store: () => ({ ok: true, where: "vault" }) } }),
    0,
  );
  assert.equal(
    await run({
      secrets: { wrap: (c) => c, store: () => ({ ok: false, problem: "store failed" }) },
    }),
    1,
  );
  assert.equal(
    await run({
      fetch: async () => ({ ok: false, status: 422, json: async () => ({ pem: PEM }) }),
    }),
    1,
  );
  const text = output.join("\n");
  assert.ok(text.includes("x-gate"), "the run did print");
  for (const secret of ["leak-canary-pem", CLIENT_SECRET, WEBHOOK_SECRET])
    assert.equal(text.includes(secret), false, `${secret} leaked`);
});
