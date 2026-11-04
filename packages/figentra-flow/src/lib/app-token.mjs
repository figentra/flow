/**
 * Figentra Flow file contract:
 * Purpose: mint a narrowed Flow App installation token inside main's approval job, in one process (L2 design, ADR
 *   0523): the job's OIDC token logs in to Infisical, which hands back the App's id and key at the gate path; the App
 *   JWT then mints a token for this one repository with one role's permissions, which is checked and returned in memory.
 * Boundary: refuses before any network call unless the job is GitHub Actions on a GitHub-hosted runner, on the default
 *   branch, running the default branch's approval workflow, for one of the listed events (`checkRef`). Refuses
 *   unless the installation belongs to the repository's owner and is the App's own, and unless the grant is exactly
 *   the role's permissions (plus GitHub's `metadata: read`) on exactly this repository; a refused grant is revoked
 *   before the throw. Redirects are refused. The identity's id is `secrets.oidc.identityId`, else the Actions
 *   variable `<prefix>OIDC_IDENTITY_ID` the workflow passes (Infisical plan K7). The verdict, approve and merge jobs use it.
 * Runtime: node (GitHub Actions); Node built-ins only.
 * Governing contract: ADR 0523; the L2 design (Tokens and permissions); STA-1945.
 * Secrets: `<prefix>GATE_APP_ID` and `<prefix>GATE_PRIVATE_KEY` from Infisical (the pre-0.2.2 prefix's names when
 *   the new ones answer 404), the OIDC JWT, the Infisical access token, the App JWT and the installation token: each
 *   is masked (`::add-mask::`) as it arrives and lives only in this process's memory, never in the environment,
 *   `GITHUB_OUTPUT`, a file or a log. Errors name the step, the method, the path and the HTTP status, never a value.
 */
import { appJwt } from "./gate-post.mjs";
import { netFetch } from "./net.mjs";
import {
  APPROVE_WORKFLOW,
  ENV_PREFIX,
  LEGACY_ENV_PREFIX,
  OIDC_IDENTITY_VARIABLE,
} from "./product.mjs";

const API = "https://api.github.com";

/** The events main's approval workflow mints for; `workflow_dispatch` is not one (the fallback holds its own key). */
export const EVENTS = Object.freeze([
  "pull_request_target",
  "status",
  "workflow_run",
  "issue_comment",
  "schedule",
]);

/** Each role's permissions, frozen so no configuration can widen them. */
export const ROLES = Object.freeze({
  approve: Object.freeze({ pull_requests: "write", statuses: "write" }),
  merge: Object.freeze({ contents: "write", pull_requests: "write" }),
  // The owner path only: an owner-approved PR that touches workflows.
  "merge-workflows": Object.freeze({
    contents: "write",
    pull_requests: "write",
    workflows: "write",
  }),
  verdict: Object.freeze({ statuses: "write" }),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SAFE = /^[\w.-]+$/;
const REPO = /^[\w.-]+\/[\w.-]+$/;
const BRANCH = /^(?!.*\.\.)[\w.-]+(?:\/[\w.-]+)*$/;
const HTTPS = /^https:\/\/[\w.-]+(?::\d+)?(?:\/[\w./-]*)?$/;
const SECRET_PATH = /^\/[\w./-]*$/;
// Only a whole armour line; a key stored on one line, armour and body together, is masked.
const ARMOUR = /^-----(?:BEGIN|END) [A-Z ]+-----$/;

/**
 * @typedef {{ identityId?: string, audience: string, domain: string, projectId: string, env: string, path: string }} Oidc
 * @typedef {{ ok: boolean, status: number, json: () => Promise<any> }} Res
 * @typedef {(url: string, init?: { method?: string, headers?: Record<string, string>, body?: string,
 *             redirect?: "error" }) => Promise<Res>} Fetch
 * @typedef {{ token: string, slug: string, revoke: () => Promise<void> }} Minted
 */

const fail = (/** @type {string} */ message) => new Error(`app-token: ${message}`);

/**
 * The refusal when this process is not main's approval job, or "" when it is. Pure; no network.
 * @param {Record<string, string | undefined>} env
 * @param {string} defaultBranch the default branch rendered at sync
 */
export function checkRef(env, defaultBranch) {
  const shown = (/** @type {string | undefined} */ v) =>
    v === undefined ? "unset" : JSON.stringify(v);
  if (env.GITHUB_ACTIONS !== "true") return "not a GitHub Actions job";
  if (env.RUNNER_ENVIRONMENT !== "github-hosted")
    return `the runner is ${shown(env.RUNNER_ENVIRONMENT)}, not github-hosted`;
  if (typeof defaultBranch !== "string" || !BRANCH.test(defaultBranch))
    return `the default branch is not a branch name: ${shown(defaultBranch)}`;
  const repo = env.GITHUB_REPOSITORY;
  if (!repo || !REPO.test(repo)) return `GITHUB_REPOSITORY is not owner/name: ${shown(repo)}`;
  if (!/^\d+$/.test(env.GITHUB_REPOSITORY_ID ?? ""))
    return `GITHUB_REPOSITORY_ID is not an id: ${shown(env.GITHUB_REPOSITORY_ID)}`;
  const ref = `refs/heads/${defaultBranch}`;
  if (env.GITHUB_REF !== ref) return `the run is on ${shown(env.GITHUB_REF)}, not ${ref}`;
  const workflow = `${repo}/.github/workflows/${APPROVE_WORKFLOW}@${ref}`;
  if (env.GITHUB_WORKFLOW_REF !== workflow)
    return `the workflow is ${shown(env.GITHUB_WORKFLOW_REF)}, not ${workflow}`;
  if (!EVENTS.includes(env.GITHUB_EVENT_NAME ?? ""))
    return `the event ${shown(env.GITHUB_EVENT_NAME)} is not one of ${EVENTS.join(", ")}`;
  return "";
}

/**
 * The refusal when the Infisical coordinates are incomplete or malformed, or "".
 * @param {Partial<Oidc> | undefined} oidc
 */
function checkOidc(oidc) {
  if (!oidc) return "no secrets.oidc";
  if (!UUID.test(oidc.identityId ?? ""))
    return `secrets.oidc.identityId, or the Actions variable ${OIDC_IDENTITY_VARIABLE}, is not a uuid`;
  if (!SAFE.test(oidc.audience ?? "")) return "secrets.oidc.audience is not a name";
  if (!HTTPS.test(oidc.domain ?? "")) return "secrets.domain is not an https URL";
  if (!SAFE.test(oidc.projectId ?? "")) return "secrets.projectId is not an id";
  if (!SAFE.test(oidc.env ?? "")) return "secrets.env is not an id";
  if (!SECRET_PATH.test(oidc.path ?? "")) return "secrets.paths.gate is not a path";
  return "";
}

/**
 * In Actions, `::add-mask::` each line of a value (a PEM key's armour aside), so the runner hides it from every
 * later log line; outside Actions it writes nothing.
 * @param {Record<string, string | undefined>} env
 * @param {(text: string) => unknown} [write]
 */
export function masker(env, write = (text) => process.stdout.write(text)) {
  return (/** @type {string} */ value) => {
    if (env.GITHUB_ACTIONS !== "true") return;
    for (const line of value.split(/\r?\n/))
      if (line.trim() && !ARMOUR.test(line.trim())) write(`::add-mask::${line}\n`);
  };
}

/**
 * Mints a token for `role` (one of `ROLES`) on this repository. Call `revoke()` in a `finally`, or use `withToken`.
 * @param {string} role
 * @param {{ oidc?: Oidc, defaultBranch?: string, env?: Record<string, string | undefined>, fetch?: Fetch,
 *           now?: () => number, mask?: (value: string) => void }} [options]
 * @returns {Promise<Minted>}
 */
export async function mint(role, options = {}) {
  const { oidc, defaultBranch, env = process.env, now = Date.now } = options;
  const fetch = options.fetch ?? /** @type {Fetch} */ (/** @type {unknown} */ (netFetch));
  const mask = options.mask ?? masker(env);
  if (!Object.hasOwn(ROLES, role)) throw fail(`unknown role ${JSON.stringify(role)}`);
  // Infisical plan K7: without a config identityId, the id comes from the Actions variable the workflow passes.
  const withId = oidc && {
    ...oidc,
    identityId: oidc.identityId || env[OIDC_IDENTITY_VARIABLE] || "",
  };
  const refused = checkRef(env, /** @type {string} */ (defaultBranch)) || checkOidc(withId);
  if (refused) throw fail(`refused: ${refused}; nothing minted`);
  const o = /** @type {Oidc} */ (withId);
  const repo = /** @type {string} */ (env.GITHUB_REPOSITORY);
  const [owner, name] = repo.split("/");

  /**
   * One call; resolves to the JSON body (undefined on 204) or throws naming the step, method, path and status.
   * @param {string} step
   * @param {string} url
   * @param {{ method?: string, token?: string, body?: unknown }} [init]
   */
  const call = async (step, url, { method = "GET", token, body } = {}) => {
    const path = new URL(url).pathname;
    let res;
    try {
      res = await fetch(url, {
        method,
        redirect: "error",
        headers: {
          accept: "application/json",
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
          ...(url.startsWith(API) ? { "x-github-api-version": "2022-11-28" } : {}),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw fail(`${step}: ${method} ${path} did not answer`);
    }
    if (!res.ok)
      throw Object.assign(fail(`${step}: ${method} ${path} answered ${res.status}`), {
        status: res.status,
      });
    if (res.status === 204) return undefined;
    try {
      return await res.json();
    } catch {
      throw fail(`${step}: ${method} ${path} answered no JSON`);
    }
  };
  const text = (/** @type {unknown} */ v, /** @type {string} */ what) => {
    if (typeof v !== "string" || !v) throw fail(`${what} is missing from the answer`);
    mask(v);
    return v;
  };

  // 2. The job's OIDC token, for the configured audience.
  const requestUrl = env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!requestUrl?.startsWith("https://") || !requestToken)
    throw fail("oidc: the job has no id-token: write permission; nothing minted");
  const oidcUrl = new URL(requestUrl);
  oidcUrl.searchParams.set("audience", o.audience);
  const jwt = text(
    (await call("oidc", oidcUrl.href, { token: requestToken }))?.value,
    "oidc: the token",
  );

  // 3. Infisical login with the job's claims.
  const domain = o.domain.replace(/\/+$/, "");
  let access;
  try {
    access = await call("infisical login", `${domain}/api/v1/auth/oidc-auth/login`, {
      method: "POST",
      body: { identityId: o.identityId, jwt },
    });
  } catch (error) {
    const status = /** @type {{ status?: number }} */ (error).status;
    if (status === 401 || status === 403)
      throw fail(
        `infisical login answered ${status}: Infisical refused this job's claims (only ${defaultBranch}'s ${APPROVE_WORKFLOW} may read ${o.path}); nothing minted`,
      );
    throw error;
  }
  const accessToken = text(access?.accessToken, "infisical login: the access token");

  // 4. The App's id and key at the gate path.
  const secret = async (/** @type {string} */ key) => {
    const query = new URLSearchParams({
      workspaceId: o.projectId,
      environment: o.env,
      secretPath: o.path,
    });
    const body = await call("infisical secret", `${domain}/api/v3/secrets/raw/${key}?${query}`, {
      token: accessToken,
    });
    return text(body?.secret?.secretValue, `infisical secret: ${key}`);
  };
  // Infisical may still hold the names from before 0.2.2: a 404 on the new name tries the old one once, and when that
  // fails too the new name's error is the one thrown.
  const named = async (/** @type {string} */ name) => {
    try {
      return await secret(`${ENV_PREFIX}${name}`);
    } catch (error) {
      if (/** @type {{ status?: number }} */ (error).status !== 404) throw error;
      try {
        return await secret(`${LEGACY_ENV_PREFIX}${name}`);
      } catch {
        throw error;
      }
    }
  };
  const appId = await named("GATE_APP_ID");
  if (!/^\d+$/.test(appId)) throw fail(`infisical secret: ${ENV_PREFIX}GATE_APP_ID is not an id`);
  const key = await named("GATE_PRIVATE_KEY");

  // 5. The App JWT.
  let appToken;
  try {
    appToken = appJwt(appId, key, now());
  } catch {
    throw fail(`app jwt: ${ENV_PREFIX}GATE_PRIVATE_KEY does not sign`);
  }
  mask(appToken);

  // 6. The installation, which must be this App's on the repository's owner.
  const installation = await call("installation", `${API}/repos/${repo}/installation`, {
    token: appToken,
  });
  if (installation?.account?.login !== owner)
    throw fail(`installation: it is not on ${owner}; nothing minted`);
  if (String(installation.app_id) !== appId)
    throw fail("installation: it is another App's; nothing minted");
  if (!Number.isInteger(installation.id)) throw fail("installation: it has no id");

  // 7. The token: this repository, this role's permissions.
  const permissions = ROLES[/** @type {keyof typeof ROLES} */ (role)];
  let grant;
  try {
    grant = await call(
      "access token",
      `${API}/app/installations/${installation.id}/access_tokens`,
      { method: "POST", token: appToken, body: { repositories: [name], permissions } },
    );
  } catch (error) {
    if (/** @type {{ status?: number }} */ (error).status === 422)
      throw fail(
        `access token answered 422: the Flow App installation lacks ${Object.entries(permissions)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ")}: the owner grants it in the App's settings`,
      );
    throw error;
  }
  const token = text(grant?.token, "access token: the token");
  let live = true;
  const revoke = async () => {
    if (!live) return;
    await call("revoke", `${API}/installation/token`, { method: "DELETE", token });
    // Only after GitHub confirms, so a failed revoke can be retried.
    live = false;
  };

  // 8. The grant must be exactly what was asked, on exactly this repository.
  const problem = grantProblem(grant, permissions, repo, String(env.GITHUB_REPOSITORY_ID));
  if (problem) {
    const revoked = await revoke().then(
      () => true,
      () => false,
    );
    throw fail(
      `access token: ${problem}; ${revoked ? "the token was revoked" : "revoking it failed (it expires within the hour)"}`,
    );
  }
  const minted = { slug: String(installation.app_slug ?? ""), revoke };
  // Not enumerable, so a stray console.log or JSON.stringify of the result never shows it.
  Object.defineProperty(minted, "token", { value: token, enumerable: false });
  return /** @type {Minted} */ (minted);
}

/**
 * Why the grant is not exactly `permissions` (GitHub's own `metadata: read` aside) on exactly `repo`, or "".
 * @param {any} grant
 * @param {Readonly<Record<string, string>>} permissions
 * @param {string} repo
 * @param {string} repoId
 */
export function grantProblem(grant, permissions, repo, repoId) {
  const granted = grant?.permissions;
  if (!granted || typeof granted !== "object") return "the answer has no permissions";
  for (const [k, v] of Object.entries(permissions))
    if (granted[k] !== v)
      return `${k} is granted as ${JSON.stringify(granted[k] ?? null)}, not ${v}`;
  for (const [k, v] of Object.entries(granted))
    if (!Object.hasOwn(permissions, k) && !(k === "metadata" && v === "read"))
      return `${k}: ${JSON.stringify(v)} was granted beyond the role`;
  const repos = grant.repositories;
  if (!Array.isArray(repos) || repos.length !== 1)
    return "the token is not for exactly one repository";
  if (repos[0]?.full_name !== repo || String(repos[0]?.id) !== repoId)
    return `the token is not for ${repo}`;
  return "";
}

/**
 * Mints `role`'s token, hands it to `use`, and revokes it on a return or a throw alike; when `use` throws, its error
 * is the one thrown, even if the revoke fails too.
 * @template T
 * @param {string} role
 * @param {Parameters<typeof mint>[1]} options
 * @param {(token: string, slug: string) => Promise<T>} use
 * @returns {Promise<T>}
 */
export async function withToken(role, options, use) {
  const minted = await mint(role, options);
  let result;
  try {
    result = await use(minted.token, minted.slug);
  } catch (error) {
    await minted.revoke().catch(() => {});
    throw error;
  }
  await minted.revoke();
  return result;
}
