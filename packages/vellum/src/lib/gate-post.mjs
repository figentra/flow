/**
 * Figentra Flow file contract:
 * Purpose: the box side of the gate: after the check ran, post the gate's commit status on the head it checked, and
 *   one PR comment with the report, as the configured gate App. `gate run` copies this file into the job's gate folder,
 *   so the box needs no install; it imports only `node:` modules, and reads the status context, the comment marker
 *   and the environment prefix from the job file (the product's name lives in `product.mjs`, AC-042).
 * Boundary: posts only while the branch tip is still the checked commit; never posts `success` unless the check
 *   exited 0; posts nothing when it cannot mint a token. Exit 0 posted green, 1 posted red, 4 could not post, 5 stale.
 * Runtime: node (on the testbed box or a `--box` host)
 * Governing contract: Stackra ADR 0503 (decision 4); STA-1729 phase 2 (the leader's plan stop of 2026-10-31).
 * Secrets: `<prefix>GATE_APP_ID` and `<prefix>GATE_PRIVATE_KEY` from the environment only (`infisical run`). The key,
 *   the JWT and the installation token are never printed, logged, written or put in a comment; the log tail is
 *   redacted of every secret-looking environment value before it is posted.
 */
import { createSign } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const API = "https://api.github.com";

/** Lines of the check's log the comment carries on a failure. */
const TAIL_LINES = 60;

/** Environment names whose values never reach a comment or a log. */
const SECRET_NAME = /TOKEN|KEY|SECRET|PASSWORD|PRIVATE|CREDENTIAL|AUTH/i;

/**
 * The text with every secret-looking environment value (8 characters or more) replaced by `***`.
 * @param {string} text
 * @param {Record<string, string | undefined>} env
 */
export function redact(text, env) {
  let out = text;
  const values = Object.entries(env)
    .filter(
      ([name, value]) => SECRET_NAME.test(name) && typeof value === "string" && value.length >= 8,
    )
    .flatMap(([, value]) => [value, ...value.split("\n").filter((l) => l.trim().length >= 8)])
    .sort((a, b) => b.length - a.length);
  for (const value of values) out = out.split(value).join("***");
  return out;
}

const b64url = (/** @type {string | Buffer} */ data) => Buffer.from(data).toString("base64url");

/**
 * The App's JWT (RS256, valid nine minutes, issued a minute back for clock drift).
 * @param {string} appId
 * @param {string} privateKey
 * @param {number} now milliseconds
 */
export function appJwt(appId, privateKey, now) {
  const iat = Math.floor(now / 1000) - 60;
  const body = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({ iat, exp: iat + 600, iss: appId }))}`;
  return `${body}.${createSign("RSA-SHA256").update(body).sign(privateKey, "base64url")}`;
}

/**
 * @typedef {{ sha: string, branch: string, repository: string, startedAt?: string, context: string, marker: string,
 *             envPrefix: string }} Job
 * @typedef {{ ok: boolean, status: number, json: () => Promise<any> }} Res
 * @typedef {(url: string, init?: { method?: string, headers?: Record<string, string>, body?: string }) => Promise<Res>} Fetch
 */

/**
 * Posts the gate's result. Returns the exit code and the lines to print, none of which holds a secret.
 * @param {{ job: Job, exit: number, log?: string, env: Record<string, string | undefined>, fetch: Fetch, now?: number }} options
 * @returns {Promise<{ code: number, lines: string[] }>}
 */
export async function post({ job, exit, log = "", env, fetch, now = Date.now() }) {
  const lines = [];
  const { context, marker, envPrefix } = job;
  const appId = env[`${envPrefix}GATE_APP_ID`];
  const key = env[`${envPrefix}GATE_PRIVATE_KEY`];
  if (!appId || !key)
    return {
      code: 4,
      lines: [
        `gate: ${envPrefix}GATE_APP_ID or ${envPrefix}GATE_PRIVATE_KEY is not set; nothing posted`,
      ],
    };
  /**
   * One API call; throws a message naming the method, the path and the status, never a header.
   * @param {string} path
   * @param {string} token
   * @param {string} [method]
   * @param {unknown} [body]
   */
  const call = async (path, token, method = "GET", body = undefined) => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) throw new Error(`${method} ${path} answered ${res.status}`);
    return res.status === 204 ? undefined : res.json();
  };

  let token;
  try {
    const jwt = appJwt(appId, key, now);
    const installation = await call(`/repos/${job.repository}/installation`, jwt);
    token = (
      await call(`/app/installations/${installation.id}/access_tokens`, jwt, "POST", {
        repositories: [job.repository.split("/")[1]],
        permissions: { statuses: "write", pull_requests: "write" },
      })
    ).token;
  } catch (error) {
    return {
      code: 4,
      lines: [`gate: no App token (${/** @type {Error} */ (error).message}); nothing posted`],
    };
  }

  try {
    const tip = (await call(`/repos/${job.repository}/git/ref/heads/${job.branch}`, token)).object
      .sha;
    if (tip !== job.sha)
      return {
        code: 5,
        lines: [
          `gate: stale: ${job.branch} is now ${tip.slice(0, 12)}, not ${job.sha.slice(0, 12)}; nothing posted`,
        ],
      };

    const green = exit === 0;
    const seconds = job.startedAt
      ? Math.round((now - Date.parse(job.startedAt)) / 1000)
      : undefined;
    const took =
      seconds === undefined
        ? ""
        : ` in ${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
    const description = (
      green ? `checks passed${took}` : `checks failed (exit ${exit})${took}`
    ).slice(0, 140);

    const owner = job.repository.split("/")[0];
    const prs = await call(
      `/repos/${job.repository}/pulls?state=open&head=${owner}:${encodeURIComponent(job.branch)}`,
      token,
    );
    let url;
    if (prs.length) {
      const tail = redact(log, env).split("\n").slice(-TAIL_LINES).join("\n").trim();
      const body = [
        marker,
        `### ${green ? "✅" : "❌"} ${context}: ${green ? "green" : "red"} on \`${job.sha.slice(0, 12)}\``,
        "",
        description,
        ...(green || !tail
          ? []
          : [
              "",
              "<details><summary>Last lines of the check</summary>",
              "",
              "```text",
              tail,
              "```",
              "</details>",
            ]),
      ].join("\n");
      const comments = await call(
        `/repos/${job.repository}/issues/${prs[0].number}/comments?per_page=100`,
        token,
      );
      const mine = comments.find(
        (/** @type {any} */ c) => c.user?.type === "Bot" && c.body?.startsWith(marker),
      );
      const written = mine
        ? await call(`/repos/${job.repository}/issues/comments/${mine.id}`, token, "PATCH", {
            body,
          })
        : await call(`/repos/${job.repository}/issues/${prs[0].number}/comments`, token, "POST", {
            body,
          });
      url = written.html_url;
    }
    await call(`/repos/${job.repository}/statuses/${job.sha}`, token, "POST", {
      state: green ? "success" : "failure",
      context,
      description,
      ...(url ? { target_url: url } : {}),
    });
    lines.push(
      `gate: posted ${green ? "success" : "failure"} on ${job.sha.slice(0, 12)} (${job.repository})`,
    );
    return { code: green ? 0 : 1, lines };
  } catch (error) {
    return {
      code: 4,
      lines: [`gate: posting failed (${/** @type {Error} */ (error).message})`],
    };
  }
}

/* c8 ignore start: the box entry point; `post` is what the tests hold. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const here = dirname(fileURLToPath(import.meta.url));
  const read = (/** @type {string} */ name) =>
    existsSync(join(here, name)) ? readFileSync(join(here, name), "utf8") : "";
  const exit = Number.parseInt(read("exit").trim() || process.argv[2] || "1", 10);
  const result = await post({
    job: JSON.parse(read("job.json")),
    exit: Number.isNaN(exit) ? 1 : exit,
    log: read("log.txt"),
    env: process.env,
    fetch: /** @type {Fetch} */ (/** @type {unknown} */ (globalThis.fetch)),
  });
  for (const line of result.lines) console.log(line);
  process.exit(result.code);
}
/* c8 ignore stop */
