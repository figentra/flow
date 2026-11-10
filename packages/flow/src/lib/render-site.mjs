/**
 * Figentra Flow file contract:
 * Purpose: the render proof `fflow render` runs (the job `ci.render` adds to the standard CI): serve a built site the
 *   way Cloudflare Pages does, open every page at each width in Playwright's Chromium, and fail on a console error,
 *   a page error, a failed request or a 4xx/5xx response, or when a page misses the basics a reader needs (one `h1`,
 *   one `main`, a title, `lang` set and `dir="rtl"` exactly for a right-to-left locale, no horizontal overflow, every
 *   image with `alt`). The configured requests (a redirect, a 404, a header) are checked too, and every page leaves
 *   a full-page screenshot for the job's artifact. Ported from SITE's figentra.com render job (figentra#66).
 * Boundary: reads the built folder and writes only the screenshots under `out`. Playwright is not a dependency of
 *   Flow: the job installs a pinned version outside the workspace and puts it on `NODE_PATH`, and `loadPlaywright`
 *   resolves it from there. The server binds 127.0.0.1 only.
 * Runtime: node
 * Governing contract: the owner's "live means rendered" rule (zero console errors in a real browser render);
 *   WCAG 2.2 AA basics.
 * Secrets: none.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { extname, join, normalize, relative } from "node:path";

/** The widths a page opens at when the config names none: a desktop and a phone. */
export const WIDTHS = [1280, 390];

/** From this width up a viewport is a laptop screen (800 px high); below it, a phone's (844 px). */
export const PHONE_BELOW = 768;

/**
 * The height a width opens at when the config names none: 1280×800 and 390×844 for the default widths.
 * @param {number} width
 */
export const heightFor = (width) => (width >= PHONE_BELOW ? 800 : 844);

/** The locales written right to left; a page in one of them must carry `dir="rtl"`. */
export const RTL = ["ar", "fa", "he", "ur"];

/** The content types the server answers with; anything else is `application/octet-stream`. */
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

/**
 * Every page route under `dir`: a folder holding an `index.html`, as `/en/about/`, the root `/` included. With
 * `prefixes`, only the routes under one of them (`["en", "ar"]` keeps `/en/…` and `/ar/…`).
 * @param {string} dir
 * @param {string[]} [prefixes]
 * @returns {string[]}
 */
export function routesOf(dir, prefixes = []) {
  /** @type {string[]} */
  const out = [];
  const walk = (/** @type {string} */ at) => {
    if (existsSync(join(at, "index.html"))) {
      const rel = relative(dir, at).split("\\").join("/");
      out.push(rel === "" ? "/" : `/${rel}/`);
    }
    for (const entry of readdirSync(at)) {
      const full = join(at, entry);
      if (statSync(full).isDirectory()) walk(full);
    }
  };
  walk(dir);
  const keep = prefixes.length
    ? out.filter((r) => prefixes.some((p) => r.startsWith(`/${p}/`)))
    : out;
  return keep.toSorted();
}

/**
 * @typedef {{ h1: number, main: number, title: string, lang: string, dir: string, overflow: number,
 *   imagesWithoutAlt: number }} PageFacts
 */

/**
 * What a rendered page misses, from the facts the browser read off it.
 * @param {PageFacts} facts
 * @param {string[]} [rtl] the right-to-left locales
 * @returns {string[]}
 */
export function pageProblems(facts, rtl = RTL) {
  const problems = [];
  if (facts.h1 !== 1) problems.push(`${facts.h1} h1 elements, expected 1`);
  if (facts.main !== 1) problems.push(`${facts.main} main landmarks, expected 1`);
  if (facts.title.trim() === "") problems.push("empty title");
  const base = facts.lang.split("-")[0]?.toLowerCase() ?? "";
  if (base === "") problems.push("no lang on <html>");
  else if (rtl.includes(base) !== (facts.dir === "rtl"))
    problems.push(`dir "${facts.dir}" for lang "${facts.lang}"`);
  if (facts.overflow > 1) problems.push(`horizontal overflow of ${facts.overflow}px`);
  if (facts.imagesWithoutAlt > 0) problems.push(`${facts.imagesWithoutAlt} images without alt`);
  return problems;
}

/** @typedef {{ url: string, status: number, location?: string, csp?: boolean }} RequestCheck */

/**
 * What a configured request got wrong.
 * @param {RequestCheck} check
 * @param {{ status: number, headers: Record<string, string> }} response headers with lower-case names
 * @returns {string[]}
 */
export function requestProblems(check, response) {
  const problems = [];
  if (response.status !== check.status)
    problems.push(`status ${response.status}, expected ${check.status}`);
  if (check.location !== undefined && response.headers.location !== check.location)
    problems.push(`location ${response.headers.location ?? "(none)"}, expected ${check.location}`);
  if (check.csp && !response.headers["content-security-policy"])
    problems.push("no Content-Security-Policy header");
  return problems;
}

/**
 * A Pages `_redirects` file: `from to [status]` lines, comments and blanks skipped.
 * @param {string} text
 * @returns {{ from: string, to: string, status: number }[]}
 */
export function parseRedirects(text) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"))
    .map((l) => {
      const [from = "", to = "", status] = l.split(/\s+/);
      return { from, to, status: Number(status ?? 302) };
    });
}

/**
 * A Pages `_headers` file: a path line, then indented `Name: value` lines.
 * @param {string} text
 * @returns {{ path: string, headers: Record<string, string> }[]}
 */
export function parseHeaders(text) {
  /** @type {{ path: string, headers: Record<string, string> }[]} */
  const rules = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) rules.push({ path: line.trim(), headers: {} });
    else if (rules.length > 0) {
      const at = line.indexOf(":");
      if (at > 0) rules.at(-1).headers[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
  }
  return rules;
}

/** Whether a `_headers` path (`/*`, `/en/*` or an exact path) matches `path`. */
const matches = (/** @type {string} */ pattern, /** @type {string} */ path) =>
  pattern.endsWith("/*")
    ? path.startsWith(pattern.slice(0, -1)) || path === pattern.slice(0, -2)
    : pattern === path;

/**
 * Serve `root` on 127.0.0.1:`port` as Pages does: `_redirects` first, then a file, a folder's `index.html` (a folder
 * path without its trailing slash is redirected to it), `_headers` on every response, and `404.html` with a 404 for
 * anything else. A test double for CI, never a production server.
 * @param {string} root
 * @param {number} port 0 picks a free one
 * @returns {Promise<import("node:http").Server>}
 */
export function serveStatic(root, port) {
  const read = (/** @type {string} */ name) =>
    existsSync(join(root, name)) ? readFileSync(join(root, name), "utf8") : "";
  const redirects = parseRedirects(read("_redirects"));
  const headerRules = parseHeaders(read("_headers"));
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = decodeURIComponent(url.pathname);
    /** @type {Record<string, string>} */
    const extra = {};
    for (const rule of headerRules)
      if (matches(rule.path, path)) Object.assign(extra, rule.headers);
    const redirect = redirects.find((r) => r.from === path);
    if (redirect) {
      res.writeHead(redirect.status, { location: redirect.to, ...extra });
      res.end();
      return;
    }
    // Never outside `root`: `..` segments are dropped before the join.
    let file = join(root, normalize(path).replace(/^(\.\.[/\\])+/, ""));
    if (existsSync(file) && statSync(file).isDirectory()) {
      if (!path.endsWith("/")) {
        res.writeHead(301, { location: `${path}/${url.search}`, ...extra });
        res.end();
        return;
      }
      file = join(file, "index.html");
    }
    const found = existsSync(file) && statSync(file).isFile();
    const notFound = join(root, "404.html");
    const body = found
      ? readFileSync(file)
      : existsSync(notFound)
        ? readFileSync(notFound)
        : "Not found";
    res.writeHead(found ? 200 : 404, {
      "content-type": found
        ? (TYPES[/** @type {keyof typeof TYPES} */ (extname(file))] ?? "application/octet-stream")
        : "text/html; charset=utf-8",
      "content-length": Buffer.byteLength(body),
      ...extra,
    });
    res.end(body);
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

/**
 * Playwright, from `NODE_PATH` (the job installs it outside the workspace), else from the repository.
 * @param {string} root
 * @returns {any}
 */
export function loadPlaywright(root) {
  const require = createRequire(join(root, "package.json"));
  return require("playwright");
}

/**
 * @typedef {{ dir: string, out: string, locales?: string[], rtl?: string[], widths?: number[], heights?: number[],
 *   requests?: RequestCheck[] }} RenderOptions
 * @typedef {{ route: string, at: string, problems: string[] }} RenderFailure
 */

/**
 * Render every page of `options.dir` at each width and check the configured requests.
 * @param {RenderOptions} options
 * @param {{ root: string, say: (line: string) => void, playwright?: any }} io
 * @returns {Promise<{ pages: number, renders: number, failures: RenderFailure[] }>}
 */
export async function renderSite(options, io) {
  const { chromium } = io.playwright ?? loadPlaywright(io.root);
  const widths = options.widths?.length ? options.widths : WIDTHS;
  const pages = routesOf(options.dir, options.locales ?? []);
  mkdirSync(options.out, { recursive: true });
  const server = await serveStatic(options.dir, 0);
  const address = server.address();
  const origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  const browser = await chromium.launch();
  /** @type {RenderFailure[]} */
  const failures = [];
  io.say(`${pages.length} pages × ${widths.length} widths`);
  try {
    for (const [i, width] of widths.entries()) {
      // `heights` pairs with the widths by position; a width without one gets `heightFor`'s.
      const height = options.heights?.[i] ?? heightFor(width);
      const context = await browser.newContext({ viewport: { width, height } });
      for (const route of pages) {
        const page = await context.newPage();
        /** @type {string[]} */
        const problems = [];
        page.on("console", (/** @type {any} */ msg) => {
          if (msg.type() === "error") problems.push(`console error: ${msg.text()}`);
        });
        page.on("pageerror", (/** @type {Error} */ err) =>
          problems.push(`page error: ${err.message}`),
        );
        page.on("requestfailed", (/** @type {any} */ req) =>
          problems.push(`request failed: ${req.url()} (${req.failure()?.errorText})`),
        );
        page.on("response", (/** @type {any} */ res) => {
          if (res.status() >= 400) problems.push(`response ${res.status()}: ${res.url()}`);
        });
        try {
          await page.goto(`${origin}${route}`, { waitUntil: "networkidle" });
          /** @type {PageFacts} */
          const facts = await page.evaluate(() => ({
            h1: document.querySelectorAll("h1").length,
            main: document.querySelectorAll("main").length,
            title: document.title,
            lang: document.documentElement.lang,
            dir: document.documentElement.dir,
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            imagesWithoutAlt: [...document.images].filter((i) => !i.hasAttribute("alt")).length,
          }));
          problems.push(...pageProblems(facts, options.rtl ?? RTL));
          const name =
            route === "/" ? "index" : route.replaceAll(/^\/|\/$/g, "").replaceAll("/", "-");
          await page.screenshot({
            path: join(options.out, `${name}-${width}.png`),
            fullPage: true,
          });
        } catch (error) {
          problems.push(`navigation: ${/** @type {Error} */ (error).message}`);
        }
        await page.close();
        if (problems.length) failures.push({ route, at: `${width}px`, problems });
        io.say(`${problems.length ? "FAIL" : "ok  "} ${String(width).padStart(5)}px ${route}`);
      }
      await context.close();
    }
    const probe = await browser.newContext();
    for (const check of options.requests ?? []) {
      const response = await probe.request.get(`${origin}${check.url}`, { maxRedirects: 0 });
      const problems = requestProblems(check, {
        status: response.status(),
        headers: response.headers(),
      });
      if (problems.length) failures.push({ route: check.url, at: "request", problems });
      io.say(`${problems.length ? "FAIL" : "ok  "} request ${check.url}`);
    }
    await probe.close();
  } finally {
    await browser.close();
    server.close();
  }
  return { pages: pages.length, renders: pages.length * widths.length, failures };
}
