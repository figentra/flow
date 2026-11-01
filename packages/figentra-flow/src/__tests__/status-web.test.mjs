/**
 * Figentra Flow file contract:
 * Purpose: hold `figentra-flow status --web` to its boundary: the page is self-contained (no external script, style or
 *   font) and draws values as text only; `/status.json` rebuilds the snapshot on each request; only GET and HEAD are
 *   answered (405 otherwise); unknown paths are 404; a failing snapshot is a 500 naming the error.
 * Boundary: a real server on 127.0.0.1 with the snapshot injected; no network beyond loopback.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1729 phase 4.
 */
// @covers sta-1729:FR-7 sta-1729:AC-012
import { test } from "node:test";
import assert from "node:assert/strict";

import { PAGE, statusServer } from "../lib/status-web.mjs";

/**
 * A listening server and its base URL.
 * @param {() => unknown} read
 */
async function serve(read) {
  const server = statusServer(read);
  await new Promise((done) => server.listen(0, "127.0.0.1", () => done(undefined)));
  const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());
  return { server, url: `http://127.0.0.1:${port}` };
}

test("status --web: a self-contained page that draws text only", () => {
  assert.match(PAGE, /<title>Figentra Flow status<\/title>/);
  assert.doesNotMatch(
    PAGE,
    /<(script|link|img)[^>]+(src|href)=/i,
    "nothing is loaded from elsewhere",
  );
  assert.doesNotMatch(
    PAGE,
    /innerHTML|insertAdjacentHTML|document\.write/,
    "values are text, never markup",
  );
});

test("status --web: the page and a fresh snapshot per request; read-only; 404 and 500", async (t) => {
  let reads = 0;
  const { server, url } = await serve(() => {
    reads++;
    if (reads === 3) throw new Error("git is gone");
    return { version: "figentra-flow.status/1", reads };
  });
  t.after(() => server.close());
  const page = await fetch(`${url}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'none'/);
  assert.match(await page.text(), /Figentra Flow status/);
  assert.deepEqual(await (await fetch(`${url}/status.json`)).json(), {
    version: "figentra-flow.status/1",
    reads: 1,
  });
  assert.deepEqual(await (await fetch(`${url}/status.json`)).json(), {
    version: "figentra-flow.status/1",
    reads: 2,
  });
  const failed = await fetch(`${url}/status.json`);
  assert.equal(failed.status, 500);
  assert.match(await failed.text(), /git is gone/);
  assert.equal((await fetch(`${url}/status.json`, { method: "POST" })).status, 405);
  assert.equal((await fetch(`${url}/nope`)).status, 404);
});
