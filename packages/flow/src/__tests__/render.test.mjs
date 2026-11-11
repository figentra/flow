/**
 * Figentra Flow file contract:
 * Purpose: hold `fflow render` (`lib/render-site.mjs`, `commands/render.mjs`) to SITE's render proof:
 *   - every folder with an `index.html` is a page, the root included, narrowed to the configured locales;
 *   - a page fails on more or fewer than one `h1` or `main`, an empty title, no `lang`, `dir` that disagrees with a
 *     right-to-left locale, horizontal overflow or an image without `alt`;
 *   - a configured request fails on its status, its `location` and a missing CSP header;
 *   - the server answers as Pages does: `_redirects` first, a folder's `index.html`, a 301 to the trailing slash,
 *     `_headers` on every response, `404.html` with a 404, nothing outside the root;
 *   - a render collects console errors, page errors, failed requests and 4xx/5xx responses, writes one screenshot
 *     per page and width, and exits 1 on a failure, 1 on no page and 2 on a missing site or Playwright;
 *   - a width opens at its `heights` entry, else 800 px high from 768 px up and 844 px below;
 *   - the options come from `FFLOW_RENDER`'s JSON, the flags winning.
 * Boundary: temporary folders and a server on 127.0.0.1; the browser is a stub, so no Chromium runs here (the
 *   repository's own render job is the real proof).
 * Runtime: node
 * Governing contract: the owner's "live means rendered" rule; SITE's figentra.com render job (figentra#66).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { renderOptions, run } from "../commands/render.mjs";
import { ConfigError } from "../lib/config.mjs";
import {
  pageProblems,
  parseHeaders,
  parseRedirects,
  renderSite,
  requestProblems,
  routesOf,
  serveStatic,
} from "../lib/render-site.mjs";

/** A built site: two locales, a root redirect, a 404 page and the Pages headers. */
function site(t) {
  const dir = mkdtempSync(join(tmpdir(), "flow-render-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const page = (/** @type {string} */ path, /** @type {string} */ html) => {
    mkdirSync(join(dir, path), { recursive: true });
    writeFileSync(join(dir, path, "index.html"), html);
  };
  page("en", "<html lang=en><title>Home</title><main><h1>Hi</h1></main></html>");
  page("en/about", "<html lang=en><title>About</title><main><h1>About</h1></main></html>");
  page("ar", "<html lang=ar dir=rtl><title>الرئيسية</title><main><h1>مرحبا</h1></main></html>");
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "assets", "a.css"), "body{}");
  writeFileSync(join(dir, "404.html"), "<h1>Not here</h1>");
  writeFileSync(join(dir, "_redirects"), "# comment\n/ /en/ 302\n/old /en/about/ 301\n");
  writeFileSync(
    join(dir, "_headers"),
    "/*\n  Content-Security-Policy: default-src 'self'\n  X-Frame-Options: DENY\n",
  );
  return dir;
}

const goodFacts = {
  h1: 1,
  main: 1,
  title: "T",
  lang: "en",
  dir: "",
  overflow: 0,
  imagesWithoutAlt: 0,
};

test("render: every folder with an index.html is a page, narrowed to the locales", (t) => {
  const dir = site(t);
  assert.deepEqual(routesOf(dir), ["/ar/", "/en/", "/en/about/"]);
  assert.deepEqual(routesOf(dir, ["en"]), ["/en/", "/en/about/"]);
  writeFileSync(
    join(dir, "index.html"),
    "<html lang=en><title>Root</title><main><h1>R</h1></main>",
  );
  assert.deepEqual(routesOf(dir), ["/", "/ar/", "/en/", "/en/about/"]);
  assert.deepEqual(routesOf(dir, ["ar"]), ["/ar/"]);
});

test("render: a page misses one h1, one main, a title, lang, the right dir, no overflow, every alt", () => {
  assert.deepEqual(pageProblems(goodFacts), []);
  assert.deepEqual(pageProblems({ ...goodFacts, lang: "ar", dir: "rtl" }), []);
  assert.deepEqual(pageProblems({ ...goodFacts, lang: "ar-SA", dir: "rtl" }), []);
  const bad = pageProblems({
    h1: 2,
    main: 0,
    title: " ",
    lang: "ar",
    dir: "ltr",
    overflow: 14,
    imagesWithoutAlt: 3,
  });
  assert.equal(bad.length, 6);
  assert.match(bad.join("\n"), /2 h1 elements/);
  assert.match(bad.join("\n"), /0 main landmarks/);
  assert.match(bad.join("\n"), /empty title/);
  assert.match(bad.join("\n"), /dir "ltr" for lang "ar"/);
  assert.match(bad.join("\n"), /horizontal overflow of 14px/);
  assert.match(bad.join("\n"), /3 images without alt/);
  assert.deepEqual(pageProblems({ ...goodFacts, lang: "" }), ["no lang on <html>"]);
  assert.deepEqual(pageProblems({ ...goodFacts, dir: "rtl" }), ['dir "rtl" for lang "en"']);
  // the configured right-to-left locales replace the default
  assert.deepEqual(pageProblems({ ...goodFacts, lang: "ar" }, ["he"]), []);
});

test("render: a configured request checks its status, location and CSP header", () => {
  assert.deepEqual(
    requestProblems(
      { url: "/", status: 302, location: "/en/" },
      { status: 302, headers: { location: "/en/" } },
    ),
    [],
  );
  assert.deepEqual(
    requestProblems({ url: "/", status: 302, location: "/en/" }, { status: 200, headers: {} }),
    ["status 200, expected 302", "location (none), expected /en/"],
  );
  assert.deepEqual(
    requestProblems({ url: "/x", status: 200, csp: true }, { status: 200, headers: {} }),
    ["no Content-Security-Policy header"],
  );
});

test("render: the Pages files parse, comments and blanks skipped", () => {
  assert.deepEqual(parseRedirects("# c\n\n/a /b\n/c /d 301\n"), [
    { from: "/a", to: "/b", status: 302 },
    { from: "/c", to: "/d", status: 301 },
  ]);
  assert.deepEqual(parseHeaders("/*\n  A: 1\n  B: two: parts\n/en/*\n  C: 3\n"), [
    { path: "/*", headers: { A: "1", B: "two: parts" } },
    { path: "/en/*", headers: { C: "3" } },
  ]);
});

test("render: the server answers as Pages does, and never outside its root", async (t) => {
  const dir = site(t);
  const server = await serveStatic(dir, 0);
  t.after(() => server.close());
  const address = server.address();
  const origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  const get = (/** @type {string} */ path) => fetch(`${origin}${path}`, { redirect: "manual" });

  const root = await get("/");
  assert.equal(root.status, 302);
  assert.equal(root.headers.get("location"), "/en/");
  assert.equal((await get("/old")).headers.get("location"), "/en/about/");
  const slash = await get("/en/about");
  assert.equal(slash.status, 301);
  assert.equal(slash.headers.get("location"), "/en/about/");
  const page = await get("/en/about/");
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type") ?? "", /^text\/html/);
  assert.equal(page.headers.get("content-security-policy"), "default-src 'self'");
  assert.match(await page.text(), /About/);
  assert.match((await get("/assets/a.css")).headers.get("content-type") ?? "", /^text\/css/);
  const missing = await get("/en/nothing/");
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), /Not here/);
  // a path that climbs out of the root is served from inside it, or not at all
  assert.equal((await get("/../../etc/passwd")).status, 404);
});

/**
 * A stub of Playwright's chromium: each page reads its facts from `facts[route]`, and `events[route]` names the
 * console errors, page errors, failed requests and responses it emits.
 */
function stubPlaywright(facts, events = {}) {
  const shots = [];
  const chromium = {
    launch: async () => ({
      newContext: async () => ({
        newPage: async () => {
          /** @type {Record<string, Function>} */
          const on = {};
          let route = "";
          return {
            on: (name, fn) => (on[name] = fn),
            goto: async (url) => {
              route = new URL(url).pathname;
              for (const e of events[route] ?? []) {
                if (e.console) on.console?.({ type: () => "error", text: () => e.console });
                if (e.pageerror) on.pageerror?.(new Error(e.pageerror));
                if (e.failed)
                  on.requestfailed?.({
                    url: () => e.failed,
                    failure: () => ({ errorText: "net::ERR" }),
                  });
                if (e.status) on.response?.({ status: () => e.status, url: () => `${route}x` });
              }
            },
            evaluate: async () => facts[route] ?? goodFacts,
            screenshot: async ({ path }) => shots.push(path),
            close: async () => {},
          };
        },
        close: async () => {},
        request: {
          get: async (url) => {
            const res = await fetch(url, { redirect: "manual" });
            return { status: () => res.status, headers: () => Object.fromEntries(res.headers) };
          },
        },
      }),
      close: async () => {},
    }),
  };
  return { playwright: { chromium }, shots };
}

test("render: a render collects every problem, writes a screenshot per page and width, checks the requests", async (t) => {
  const dir = site(t);
  const out = mkdtempSync(join(tmpdir(), "flow-render-out-"));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const { playwright, shots } = stubPlaywright(
    { "/ar/": { ...goodFacts, lang: "ar", dir: "rtl" }, "/en/about/": { ...goodFacts, h1: 0 } },
    { "/en/": [{ console: "boom" }, { status: 404 }] },
  );
  const lines = [];
  const result = await renderSite(
    {
      dir,
      out,
      widths: [1280, 390],
      requests: [
        { url: "/", status: 302, location: "/en/" },
        { url: "/en/about/", status: 200, csp: true },
        { url: "/old", status: 302 },
      ],
    },
    { root: dir, say: (l) => lines.push(l), playwright },
  );
  assert.equal(result.pages, 3);
  assert.equal(result.renders, 6);
  assert.equal(shots.length, 6);
  assert.ok(shots.some((s) => s.endsWith("en-about-390.png")));
  const byRoute = (route, at) => result.failures.find((f) => f.route === route && f.at === at);
  assert.deepEqual(byRoute("/en/", "1280px")?.problems, [
    "console error: boom",
    "response 404: /en/x",
  ]);
  assert.deepEqual(byRoute("/en/about/", "390px")?.problems, ["0 h1 elements, expected 1"]);
  assert.equal(byRoute("/ar/", "1280px"), undefined);
  // the redirect is a 301, not the configured 302; the other two requests pass
  assert.deepEqual(byRoute("/old", "request")?.problems, ["status 301, expected 302"]);
  assert.equal(result.failures.filter((f) => f.at === "request").length, 1);
  assert.ok(lines[0].startsWith("3 pages × 2 widths"));
});

/**
 * Record each context's viewport on a stub browser.
 * @param {any} playwright
 * @returns {{ width: number, height: number }[]}
 */
function recordViewports(playwright) {
  const viewports = [];
  const launch = playwright.chromium.launch;
  playwright.chromium.launch = async () => {
    const browser = await launch();
    const newContext = browser.newContext;
    browser.newContext = async (options) => {
      // the requests' probe context opens without a viewport
      if (options?.viewport) viewports.push(options.viewport);
      return newContext(options);
    };
    return browser;
  };
  return viewports;
}

test("render: a width opens at its height by position, else 800 from 768 px up and 844 below", async (t) => {
  const dir = site(t);
  const out = mkdtempSync(join(tmpdir(), "flow-render-out-"));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const plain = stubPlaywright({}).playwright;
  const plainViewports = recordViewports(plain);
  await renderSite(
    { dir, out, widths: [1280, 768, 390] },
    { root: dir, say: () => {}, playwright: plain },
  );
  assert.deepEqual(plainViewports, [
    { width: 1280, height: 800 },
    { width: 768, height: 800 },
    { width: 390, height: 844 },
  ]);
  const set = stubPlaywright({}).playwright;
  const setViewports = recordViewports(set);
  await renderSite({ dir, out, heights: [900] }, { root: dir, say: () => {}, playwright: set });
  assert.deepEqual(setViewports, [
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
  ]);
});

test("render: the command reads FFLOW_RENDER, the flags win, and exits 0, 1 or 2", async (t) => {
  const dir = site(t);
  const env = {
    FFLOW_RENDER: JSON.stringify({
      dir: "nowhere",
      out: "o",
      locales: ["en"],
      widths: [400],
      heights: [700],
    }),
  };
  const opts = renderOptions({ dir }, env, "/repo");
  assert.equal(opts.dir, dir);
  assert.equal(opts.out, "/repo/o");
  assert.deepEqual(opts.locales, ["en"]);
  assert.deepEqual(opts.widths, [400]);
  assert.deepEqual(opts.heights, [700]);
  assert.throws(() => renderOptions({}, {}, "/repo"), ConfigError);
  assert.throws(() => renderOptions({}, { FFLOW_RENDER: "{not json" }, "/repo"), ConfigError);

  const said = [];
  const io = (/** @type {any} */ playwright) => ({
    cwd: dir,
    env: {},
    say: (l) => said.push(l),
    complain: (l) => said.push(l),
    playwright,
  });
  const out = join(dir, "shots");
  assert.equal(await run(io(stubPlaywright({}).playwright), { dir, out }), 0);
  assert.match(said.at(-1), /All 6 renders passed/);
  const failing = stubPlaywright({ "/en/": { ...goodFacts, title: "" } }).playwright;
  assert.equal(await run(io(failing), { dir, out }), 1);
  assert.equal(await run(io(stubPlaywright({}).playwright), { dir: join(dir, "none"), out }), 2);
  const empty = mkdtempSync(join(tmpdir(), "flow-render-empty-"));
  t.after(() => rmSync(empty, { recursive: true, force: true }));
  assert.equal(await run(io(stubPlaywright({}).playwright), { dir: empty, out }), 1);
  // no Playwright to load: a refusal with the fix, not a crash
  assert.equal(await run({ ...io(undefined), cwd: empty }, { dir, out }), 2);
  assert.match(said.at(-1), /Playwright is not installed/);
});
