/**
 * Figentra Flow file contract:
 * Purpose: hold `figentra-flow app create` to AC-039: an agent, CI or non-terminal session is refused; the manifest
 *   asks for no webhook and only the role's permissions; the local page posts it to GitHub and only the callback with
 *   the one-time state yields the code; the conversion keeps the id, slug and key; the key goes to the secrets port and
 *   never to the output.
 * Boundary: a real server on 127.0.0.1 and GitHub's conversion faked; no network beyond loopback.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1729 phase A (A4).
 */
// @covers sta-1729:FR-11 sta-1729:AC-039
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { convert, createApp, manifestFor, refusal, serveManifest } from "../commands/app.mjs";

const PEM =
  "-----BEGIN RSA PRIVATE KEY-----\nfake-key-material-000\n-----END RSA PRIVATE KEY-----\n";

test("refusal: an agent or CI session, or no terminal, may not create an App", () => {
  assert.match(refusal({ CLAUDECODE: "1" }, true) ?? "", /owner's act.*CLAUDECODE/);
  assert.match(refusal({ CI: "true" }, true) ?? "", /CI is set/);
  assert.match(refusal({}, false) ?? "", /not a TTY/);
  assert.equal(refusal({}, true), undefined);
});

test("manifest: no webhook, private, only the role's permissions", () => {
  const gate = manifestFor("gate", {
    name: "x-gate",
    url: "https://github.com/acme",
    redirect: "http://127.0.0.1:1/callback",
  });
  assert.equal(gate.public, false);
  assert.equal(gate.hook_attributes.active, false);
  assert.deepEqual(gate.default_events, []);
  assert.deepEqual(gate.default_permissions, {
    contents: "read",
    statuses: "write",
    pull_requests: "write",
  });
  assert.deepEqual(
    manifestFor("review", { name: "r", url: "u", redirect: "r" }).default_permissions,
    { contents: "read", pull_requests: "write", issues: "write" },
  );
});

test("serve: the page posts the manifest to GitHub; only the callback with the state yields the code", async () => {
  const served = await serveManifest({
    manifest: (redirect) =>
      manifestFor("gate", { name: "x-gate", url: "https://github.com", redirect }),
    target: (state) => `https://github.com/settings/apps/new?state=${state}`,
    timeoutMs: 5_000,
  });
  const page = await (await fetch(served.url)).text();
  const state = page.match(/state=([0-9a-f]{32})/)?.[1];
  assert.ok(state, "the form's action carries the state");
  assert.match(page, /&quot;redirect_url&quot;:&quot;http:\/\/127\.0\.0\.1:\d+\/callback&quot;/);
  assert.equal(
    (await fetch(`${served.url}callback?state=${"0".repeat(32)}&code=evil`)).status,
    400,
  );
  assert.equal((await fetch(`${served.url}callback?state=${state}&code=abc-123`)).status, 200);
  assert.equal(await served.code, "abc-123");
});

test("convert: posts the code to GitHub and keeps only id, slug and key", async () => {
  /** @type {string[]} */
  const urls = [];
  const fake = async (/** @type {string} */ url) => {
    urls.push(url);
    return {
      ok: true,
      status: 201,
      json: async () => ({
        id: 42,
        slug: "x-gate",
        pem: PEM,
        client_secret: "cs",
        webhook_secret: "ws",
      }),
    };
  };
  assert.deepEqual(await convert("abc-123", fake), { id: 42, slug: "x-gate", pem: PEM });
  assert.deepEqual(urls, ["https://api.github.com/app-manifests/abc-123/conversions"]);
  await assert.rejects(convert("../x", fake), /malformed/);
});

test("create: the key reaches the secrets port only; the output names the App and the config to set", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "flow-app-"));
  t.after(() => rmSync(root, { recursive: true }));
  /** @type {[string, string, any][]} */
  const stored = [];
  /** @type {string[]} */
  const out = [];
  const code = await createApp({
    role: "gate",
    root,
    env: {},
    isTTY: true,
    log: (s) => void out.push(s),
    secrets: {
      wrap: (c) => c,
      store: (name, value, options) => (
        stored.push([name, value, options]),
        { ok: true, where: "vault" }
      ),
    },
    fetch: async () => ({
      ok: true,
      status: 201,
      json: async () => ({ id: 42, slug: "x-gate", pem: PEM }),
    }),
    // the "browser": load the page, then come back through the callback with its state
    open: (url) =>
      void fetch(url)
        .then((r) => r.text())
        .then((page) =>
          fetch(`${url}callback?state=${page.match(/state=([0-9a-f]{32})/)?.[1]}&code=c1`),
        ),
  });
  assert.equal(code, 0);
  assert.deepEqual(
    stored.map(([name, , options]) => [name, options.scope]),
    [
      ["FIGENTRA_FLOW_GATE_PRIVATE_KEY", "gate"],
      ["FIGENTRA_FLOW_GATE_APP_ID", "gate"],
    ],
  );
  assert.equal(stored[0][1], PEM);
  assert.equal(
    out.join("\n").includes("fake-key-material"),
    false,
    "the key never reaches the output",
  );
  assert.match(out.join("\n"), /"login": "x-gate\[bot\]"/);
  assert.equal(
    await createApp({ role: "gate", root, env: { CI: "1" }, isTTY: true, log: () => {} }),
    2,
  );
});
