/**
 * Figentra Flow file contract:
 * Purpose: hold `fflow status --web` to its boundary: the page is self-contained (no external script, style or
 *   font) and draws values as text only; `/status.json` rebuilds the snapshot on each request; only GET and HEAD are
 *   answered (405 otherwise); unknown paths are 404; a failing snapshot is a 500 naming the error; a foreign or
 *   missing Host is 421 and a foreign Origin 403 (DNS rebinding).
 * Boundary: a real server on 127.0.0.1 with the snapshot injected; no network beyond loopback.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1729 phase 4.
 */
// @covers sta-1729:FR-7 sta-1729:AC-012
import { test } from "node:test";
import assert from "node:assert/strict";
import { connect } from "node:net";

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

/**
 * The status code of a hand-written HTTP/1.0 request, so the Host header can be anything or absent.
 * @param {string} url
 * @param {string[]} headers
 * @param {string} [line]
 */
function statusOf(url, headers, line = "GET /status.json HTTP/1.0") {
  const { hostname, port } = new URL(url);
  return new Promise((done, fail) => {
    let reply = "";
    const socket = connect(Number(port), hostname, () =>
      socket.end([line, ...headers, "", ""].join("\r\n")),
    );
    socket.on("data", (chunk) => (reply += chunk));
    socket.on("end", () => done(Number(/^HTTP\/1\.\d (\d+)/.exec(reply)?.[1])));
    socket.on("error", fail);
    socket.setTimeout(5000, () => socket.destroy(new Error("no reply")));
  });
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
    return { version: "fflow.status/1", reads };
  });
  t.after(() => server.close());
  const page = await fetch(`${url}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'none'/);
  assert.match(await page.text(), /Figentra Flow status/);
  assert.deepEqual(await (await fetch(`${url}/status.json`)).json(), {
    version: "fflow.status/1",
    reads: 1,
  });
  assert.deepEqual(await (await fetch(`${url}/status.json`)).json(), {
    version: "fflow.status/1",
    reads: 2,
  });
  const failed = await fetch(`${url}/status.json`);
  assert.equal(failed.status, 500);
  assert.match(await failed.text(), /git is gone/);
  assert.equal((await fetch(`${url}/status.json`, { method: "POST" })).status, 405);
  assert.equal((await fetch(`${url}/nope`)).status, 404);
});

test("status --web: only its own Host and Origin are answered (DNS rebinding)", async (t) => {
  const { server, url } = await serve(() => ({ version: "fflow.status/1" }));
  t.after(() => server.close());
  const { port } = new URL(url);
  const page = await fetch(`${url}/`);
  assert.equal(page.headers.get("x-content-type-options"), "nosniff");
  assert.equal(page.headers.get("cache-control"), "no-store");
  const missing = await fetch(`${url}/nope`);
  assert.equal(missing.headers.get("x-content-type-options"), "nosniff", "a refusal too");
  assert.equal(missing.headers.get("cache-control"), "no-store");
  assert.equal(await statusOf(url, [`Host: 127.0.0.1:${port}`]), 200);
  assert.equal(await statusOf(url, [`Host: localhost:${port}`]), 200);
  assert.equal(
    await statusOf(url, [`Host: localhost:${port}`, `Origin: http://127.0.0.1:${port}`]),
    200,
  );
  assert.equal(await statusOf(url, [`Host: rebind.example:${port}`]), 421, "a foreign Host");
  assert.equal(await statusOf(url, ["Host: 127.0.0.1"]), 421, "the port is part of the Host");
  assert.equal(await statusOf(url, []), 421, "a missing Host");
  assert.equal(
    await statusOf(url, [`Host: 127.0.0.1:${port}`, `Origin: http://rebind.example:${port}`]),
    403,
    "a foreign Origin",
  );
  assert.equal(await statusOf(url, [`Host: 127.0.0.1:${port}`, "Origin: null"]), 403);
  assert.equal(
    await statusOf(
      url,
      [`Host: 127.0.0.1:${port}`, `Origin: http://rebind.example:${port}`],
      "POST /status.json HTTP/1.0",
    ),
    403,
    "the Origin is checked before the method",
  );
});
