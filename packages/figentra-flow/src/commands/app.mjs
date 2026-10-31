/**
 * Figentra Flow file contract:
 * Purpose: `figentra-flow app create gate|review [--org <login>] [--name <app name>] [--key-file <path>]` (AC-039):
 *   create the repository's gate or review GitHub App by GitHub's App-manifest flow, for a human only. It serves a
 *   one-page form on 127.0.0.1 that posts the manifest to GitHub, receives the code on the local callback (checked
 *   against a one-time state), converts it at `POST /app-manifests/{code}/conversions`, hands the App id and private
 *   key straight to the secrets port's `store`, and prints the App's slug and login for the configuration.
 * Boundary: refuses when stdin is not a terminal or an agent or CI session is detected: creating an identity is the
 *   owner's act. The manifest asks for no webhook and only the permissions the role needs. The local server listens
 *   on 127.0.0.1 only and closes after one callback or ten minutes.
 * Runtime: node
 * Governing contract: STA-1729 phase A (A4).
 * Secrets: the conversion's private key passes from the response to `store` and nowhere else: never printed, logged
 *   or written by this file. The client secret and webhook secret it also returns are dropped unread.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";

import { secretsPort } from "../adapters/secrets.mjs";
import { loadConfig } from "../lib/config.mjs";
import { CONFIG_FILE, ENV_PREFIX, NAME } from "../lib/product.mjs";

/** The two Apps a repository's gate needs, with only the permissions each one uses. */
export const ROLES = {
  gate: {
    permissions: { contents: "read", statuses: "write", pull_requests: "write" },
    configKey: "apps.gate",
  },
  review: {
    permissions: { contents: "read", pull_requests: "write", issues: "write" },
    configKey: "apps.review",
  },
};

/** Environment names that mark an agent or automation session. */
const AGENT_MARKERS = [
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "OPENCODE",
  "CODEX_SANDBOX",
  "CI",
  "GITHUB_ACTIONS",
];

/**
 * Why this session may not create an App, or undefined when a human at a terminal runs it.
 * @param {Record<string, string | undefined>} env
 * @param {boolean} isTTY
 */
export function refusal(env, isTTY) {
  const marker = AGENT_MARKERS.find((m) => env[m]);
  if (marker) return `app create is the owner's act; this session is automated (${marker} is set)`;
  if (!isTTY) return "app create needs a human at a terminal (stdin is not a TTY)";
  return undefined;
}

/**
 * The App manifest for a role.
 * @param {"gate" | "review"} role
 * @param {{ name: string, url: string, redirect: string }} options
 */
export function manifestFor(role, { name, url, redirect }) {
  return {
    name,
    url,
    redirect_url: redirect,
    public: false,
    hook_attributes: { url, active: false },
    default_events: [],
    default_permissions: ROLES[role].permissions,
  };
}

/** The HTML page that posts the manifest to GitHub as soon as it loads. */
const formPage = (/** @type {string} */ target, /** @type {any} */ manifest) => {
  const attr = (/** @type {string} */ s) =>
    s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return `<!doctype html><meta charset="utf-8"><title>${attr(manifest.name)}</title>
<form method="post" action="${attr(target)}"><input type="hidden" name="manifest" value="${attr(JSON.stringify(manifest))}">
<p>Creating the GitHub App <b>${attr(manifest.name)}</b>. <button>Continue to GitHub</button></p></form>
<script>document.forms[0].submit()</script>`;
};

/**
 * Serves the form and waits for GitHub's callback; resolves with the code once the state matches.
 * @param {{ manifest: (redirect: string) => any, target: (state: string) => string, timeoutMs?: number }} options
 * @returns {Promise<{ url: string, code: Promise<string> }>}
 */
export function serveManifest({ manifest, target, timeoutMs = 10 * 60_000 }) {
  const state = randomBytes(16).toString("hex");
  return new Promise((ready) => {
    /** @type {(code: string) => void} */
    let resolve = () => {};
    /** @type {(error: Error) => void} */
    let reject = () => {};
    const code = new Promise((res, rej) => ((resolve = res), (reject = rej)));
    const server = createServer((req, res) => {
      const at = new URL(req.url ?? "/", "http://127.0.0.1");
      const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());
      if (at.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(formPage(target(state), manifest(`http://127.0.0.1:${port}/callback`)));
        return;
      }
      if (
        at.pathname === "/callback" &&
        at.searchParams.get("state") === state &&
        at.searchParams.get("code")
      ) {
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        res.end(
          `The App is created; return to the terminal (${NAME} finishes there). You may close this tab.\n`,
        );
        server.close();
        clearTimeout(timer);
        resolve(/** @type {string} */ (at.searchParams.get("code")));
        return;
      }
      res.writeHead(400).end();
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new Error("no callback from GitHub within ten minutes"));
    }, timeoutMs);
    server.listen(0, "127.0.0.1", () => {
      const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());
      ready({ url: `http://127.0.0.1:${port}/`, code });
    });
  });
}

/**
 * Converts the manifest code into the App, keeping only what the gate needs.
 * @param {string} code
 * @param {(url: string, init: any) => Promise<{ ok: boolean, status: number, json: () => Promise<any> }>} fetch
 * @returns {Promise<{ id: number, slug: string, pem: string }>}
 */
export async function convert(code, fetch) {
  if (!/^[\w-]+$/.test(code)) throw new Error("the callback's code is malformed");
  const r = await fetch(`https://api.github.com/app-manifests/${code}/conversions`, {
    method: "POST",
    headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
  });
  if (!r.ok) throw new Error(`GitHub refused the conversion (HTTP ${r.status})`);
  const app = await r.json();
  return { id: app.id, slug: app.slug, pem: app.pem };
}

/**
 * Creates the App and stores its id and key through the secrets port.
 * @param {{ role: "gate" | "review", root: string, org?: string, name?: string, keyFile?: string,
 *           env?: Record<string, string | undefined>, isTTY?: boolean, fetch?: any, open?: (url: string) => void,
 *           log?: (s: string) => void, secrets?: import("../adapters/secrets.mjs").Secrets }} options
 * @returns {Promise<number>}
 */
export async function createApp(options) {
  const {
    role,
    root,
    org,
    env = process.env,
    isTTY = Boolean(process.stdin.isTTY),
    fetch = globalThis.fetch,
    log = console.log,
  } = options;
  const refused = refusal(env, isTTY);
  if (refused) return (console.error(`${NAME} app create: ${refused}`), 2);
  const loaded = loadConfig(root);
  if (loaded.errors.length) return (console.error(loaded.errors.join("\n")), 2);
  const secrets = options.secrets ?? secretsPort(loaded.config.secrets);
  const name = options.name ?? `${NAME}-${role}${org ? `-${org}` : ""}`;
  const url = org ? `https://github.com/${org}` : "https://github.com";
  const base = org
    ? `https://github.com/organizations/${org}/settings/apps/new`
    : "https://github.com/settings/apps/new";
  const served = await serveManifest({
    manifest: (redirect) => manifestFor(role, { name, url, redirect }),
    target: (state) => `${base}?state=${state}`,
  });
  log(`${NAME} app create: open ${served.url} to create the ${role} App on GitHub`);
  (options.open ?? openBrowser)(served.url);
  const app = await convert(await served.code, fetch);
  const prefix = `${ENV_PREFIX}${role.toUpperCase()}_`;
  const key = secrets.store(`${prefix}PRIVATE_KEY`, app.pem, {
    scope: role,
    file: options.keyFile,
  });
  if (!key.ok) {
    console.error(
      `${NAME} app create: ${key.problem}. The App ${app.slug} exists without a stored key: generate a new key in its settings, or delete it and rerun.`,
    );
    return 1;
  }
  log(`${NAME} app create: stored ${prefix}PRIVATE_KEY (${key.where})`);
  // The id is not a secret; a port that keeps only files (env) leaves it to the human.
  const id = secrets.store(`${prefix}APP_ID`, String(app.id), { scope: role });
  log(
    id.ok
      ? `${NAME} app create: stored ${prefix}APP_ID (${id.where})`
      : `${NAME} app create: set ${prefix}APP_ID=${app.id} where the poster runs`,
  );
  log(`${NAME} app create: the App is ${app.slug} (id ${app.id}, login ${app.slug}[bot])`);
  log(
    role === "gate"
      ? `${NAME} app create: set "apps": { "gate": { "slug": "${app.slug}", "login": "${app.slug}[bot]" } } in ${CONFIG_FILE}, then install the App on the repository`
      : `${NAME} app create: set "apps": { "review": { "slug": "${app.slug}" } } in ${CONFIG_FILE}, then install the App on the repository`,
  );
  return 0;
}

/** Opens a URL in the default browser, best effort; the URL is printed either way. */
function openBrowser(/** @type {string} */ url) {
  const program =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  spawn(program, [url], { stdio: "ignore", detached: true })
    .on("error", () => {})
    .unref();
}

/** `figentra-flow app create gate|review [--org <login>] [--name <name>] [--key-file <path>]`. */
export async function run(/** @type {string[]} */ args) {
  const [verb, role] = args;
  const opt = (/** @type {string} */ name) =>
    args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined;
  if (verb !== "create" || (role !== "gate" && role !== "review")) {
    console.error(
      `usage: ${NAME} app create gate|review [--org <login>] [--name <name>] [--key-file <path>]`,
    );
    return 2;
  }
  return createApp({
    role,
    root: process.cwd(),
    org: opt("org"),
    name: opt("name"),
    keyFile: opt("key-file"),
  });
}
