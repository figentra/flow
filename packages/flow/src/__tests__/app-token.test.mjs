/**
 * Figentra Flow file contract:
 * Purpose: hold the in-process Flow App token mint to the L2 design: `checkRef` refuses anything but main's approval
 *   workflow on a GitHub-hosted runner for a listed event, before reading the key or any fetch; the App's id and key
 *   come from the environment the job's decrypt step filled (Stackra ADR 0525), and a missing or malformed one mints
 *   nothing; the chain sends exactly the role's permissions for this one repository; the grant check accepts only
 *   GitHub's extra `metadata: read` and revokes any other grant; the GitHub 422 carries its named message; a failed
 *   step mints nothing; `withToken` revokes on a return and a throw; and no key, JWT or token reaches a log, an error
 *   or the result's printable form.
 * Boundary: a fake GitHub (an injected fetch) and a throwaway key generated here; no network.
 * Runtime: node
 * Governing contract: ADR 0523; the L2 design (Tokens and permissions, Tests); STA-1945.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { inspect } from "node:util";

import {
  checkRef,
  EVENTS,
  grantProblem,
  masker,
  mint,
  ROLES,
  withToken,
} from "../lib/app-token.mjs";
import { APPROVE_WORKFLOW, ENV_PREFIX } from "../lib/product.mjs";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const TOKEN = "ghs_installationtoken123456";
const ENV = Object.freeze({
  GITHUB_ACTIONS: "true",
  RUNNER_ENVIRONMENT: "github-hosted",
  GITHUB_REPOSITORY: "figentra/flow",
  GITHUB_REPOSITORY_ID: "321",
  GITHUB_REF: "refs/heads/main",
  GITHUB_WORKFLOW_REF: `figentra/flow/.github/workflows/${APPROVE_WORKFLOW}@refs/heads/main`,
  GITHUB_EVENT_NAME: "pull_request_target",
  // What the job's decrypt step puts in the environment.
  [`${ENV_PREFIX}GATE_APP_ID`]: "4242",
  [`${ENV_PREFIX}GATE_PRIVATE_KEY`]: privateKey,
});
const NOW = Date.parse("2026-11-04T10:00:00Z");
/** Every value that must never be printed, thrown or shown. */
const SECRETS = [TOKEN, ...privateKey.split("\n").filter((l) => l && !l.startsWith("-----"))];

/**
 * A GitHub stand-in; every call is recorded, and `over` changes one answer.
 * @param {{ installation?: object, token?: number, grant?: object, revoke?: number, reject?: boolean }} [over]
 */
function world(over = {}) {
  /** @type {{ method: string, url: string, auth: string, redirect?: string, body?: any }[]} */
  const calls = [];
  /** @type {import("../lib/app-token.mjs").Fetch} */
  const fetch = async (url, init = {}) => {
    const method = init.method ?? "GET";
    const body = init.body === undefined ? undefined : JSON.parse(init.body);
    calls.push({
      method,
      url,
      auth: init.headers?.authorization ?? "",
      redirect: init.redirect,
      body,
    });
    if (over.reject) throw new Error(`connect ECONNREFUSED ${url} ${init.headers?.authorization}`);
    const answer = (/** @type {number} */ status, /** @type {unknown} */ json) => ({
      ok: status < 300,
      status,
      json: async () => json,
    });
    const u = new URL(url);
    if (u.pathname === "/repos/figentra/flow/installation")
      return answer(200, {
        id: 9,
        app_id: 4242,
        app_slug: "figentra-flow",
        account: { login: "figentra" },
        ...over.installation,
      });
    if (u.pathname === "/app/installations/9/access_tokens")
      return answer(over.token ?? 201, {
        token: TOKEN,
        permissions: { ...body.permissions, metadata: "read" },
        repositories: [{ id: 321, full_name: "figentra/flow" }],
        ...over.grant,
      });
    if (u.pathname === "/installation/token" && method === "DELETE")
      return answer(over.revoke ?? 204, undefined);
    return answer(404, { message: "Not Found" });
  };
  return { calls, fetch };
}

const options = (/** @type {object} */ extra = {}) => ({
  defaultBranch: "main",
  env: ENV,
  now: () => NOW,
  mask: () => {},
  ...extra,
});

const noSecret = (/** @type {string} */ text) => {
  for (const s of SECRETS) assert.ok(!text.includes(s), "a secret value leaked");
};

test("checkRef: main's approval workflow for a listed event passes; each other run is refused by name", () => {
  for (const event of EVENTS)
    assert.equal(checkRef({ ...ENV, GITHUB_EVENT_NAME: event }, "main"), "");
  /** @type {[Record<string, string | undefined>, RegExp][]} */
  const cases = [
    [{ GITHUB_ACTIONS: undefined }, /not a GitHub Actions job/],
    [{ RUNNER_ENVIRONMENT: "self-hosted" }, /runner is "self-hosted"/],
    [{ GITHUB_REF: "refs/heads/feature" }, /on "refs\/heads\/feature", not refs\/heads\/main/],
    [{ GITHUB_REF: "refs/pull/7/merge" }, /on "refs\/pull\/7\/merge"/],
    [{ GITHUB_REF: undefined }, /on unset/],
    [
      { GITHUB_WORKFLOW_REF: "figentra/flow/.github/workflows/other.yml@refs/heads/main" },
      /workflow is ".*other\.yml@refs\/heads\/main"/,
    ],
    [
      { GITHUB_WORKFLOW_REF: `figentra/flow/.github/workflows/${APPROVE_WORKFLOW}@refs/heads/x` },
      /workflow is/,
    ],
    [
      { GITHUB_WORKFLOW_REF: `evil/flow/.github/workflows/${APPROVE_WORKFLOW}@refs/heads/main` },
      /workflow is/,
    ],
    [{ GITHUB_EVENT_NAME: "workflow_dispatch" }, /event "workflow_dispatch" is not one of/],
    [{ GITHUB_EVENT_NAME: "pull_request" }, /event "pull_request"/],
    [{ GITHUB_EVENT_NAME: "push" }, /event "push"/],
    [{ GITHUB_REPOSITORY: "figentra" }, /GITHUB_REPOSITORY is not owner\/name/],
    [{ GITHUB_REPOSITORY_ID: "" }, /GITHUB_REPOSITORY_ID is not an id/],
  ];
  for (const [over, message] of cases) assert.match(checkRef({ ...ENV, ...over }, "main"), message);
  assert.match(checkRef(ENV, ""), /default branch is not a branch name/);
  assert.match(checkRef(ENV, "../main"), /default branch is not a branch name/);
  assert.match(checkRef(ENV, /** @type {any} */ (undefined)), /default branch/);
  // A ref that holds control characters is shown escaped, so it cannot forge a workflow command.
  assert.match(checkRef({ ...ENV, GITHUB_REF: "refs/heads/x\n::add-mask::y" }, "main"), /x\\n::/);
});

test("mint: every refusal before the network makes no call, reads no key and mints nothing", async () => {
  const refusals = [
    options({ env: { ...ENV, GITHUB_REF: "refs/pull/7/merge" } }),
    options({ env: { ...ENV, GITHUB_EVENT_NAME: "workflow_dispatch" } }),
    options({ env: { ...ENV, GITHUB_ACTIONS: "false" } }),
    options({ defaultBranch: undefined }),
    // The decrypt step did not run, or was refused.
    options({ env: { ...ENV, [`${ENV_PREFIX}GATE_APP_ID`]: undefined } }),
    options({ env: { ...ENV, [`${ENV_PREFIX}GATE_PRIVATE_KEY`]: "" } }),
    options({ env: { ...ENV, [`${ENV_PREFIX}GATE_APP_ID`]: "42; rm" } }),
  ];
  for (const o of refusals) {
    const { calls, fetch } = world();
    const masked = [];
    await assert.rejects(
      mint("approve", { ...o, fetch, mask: (/** @type {string} */ v) => masked.push(v) }),
      /^Error: app-token: .*nothing minted/,
    );
    assert.deepEqual(calls, []);
    // A refused run never touches the key.
    assert.ok(!masked.includes(privateKey));
  }
  for (const role of ["admin", "__proto__", "constructor", "toString"]) {
    const { calls, fetch } = world();
    await assert.rejects(mint(role, options({ fetch })), /unknown role/);
    assert.deepEqual(calls, []);
  }
});

test("mint: the environment's App id and key, the App JWT, the installation, then exactly the role's token", async () => {
  for (const role of Object.keys(ROLES)) {
    const { calls, fetch } = world();
    const masked = [];
    const minted = await mint(role, options({ fetch, mask: (v) => masked.push(v) }));
    assert.equal(minted.token, TOKEN);
    assert.equal(minted.slug, "figentra-flow");
    const [installation, token] = calls;
    const jwt = installation.auth.replace("Bearer ", "");
    const [h, p, sig] = jwt.split(".");
    assert.ok(createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, sig, "base64url"));
    assert.equal(JSON.parse(Buffer.from(p, "base64url").toString()).iss, "4242");
    assert.equal(token.url, "https://api.github.com/app/installations/9/access_tokens");
    assert.deepEqual(token.body, { repositories: ["flow"], permissions: { ...ROLES[role] } });
    assert.ok(calls.every((c) => c.redirect === "error"));
    assert.deepEqual(masked.sort(), ["4242", privateKey, jwt, TOKEN].sort());
    assert.equal(calls.length, 2);

    await minted.revoke();
    await minted.revoke();
    const revokes = calls.filter((c) => c.method === "DELETE");
    assert.deepEqual(
      revokes.map((c) => [c.url, c.auth]),
      [["https://api.github.com/installation/token", `Bearer ${TOKEN}`]],
    );
    noSecret(JSON.stringify(minted));
    noSecret(inspect(minted));
  }
  assert.ok(Object.isFrozen(ROLES) && Object.values(ROLES).every(Object.isFrozen));
});

test("grant: GitHub's metadata: read is the only extra; anything wider, narrower or elsewhere is revoked", async () => {
  const role = ROLES.approve;
  const repos = [{ id: 321, full_name: "figentra/flow" }];
  assert.equal(
    grantProblem({ permissions: { ...role }, repositories: repos }, role, "figentra/flow", "321"),
    "",
  );
  assert.equal(
    grantProblem(
      { permissions: { ...role, metadata: "read" }, repositories: repos },
      role,
      "figentra/flow",
      "321",
    ),
    "",
  );
  /** @type {[object, RegExp][]} */
  const bad = [
    [{ permissions: { ...role, metadata: "write" } }, /metadata: "write" was granted beyond/],
    [
      { permissions: { ...role, metadata: "read", issues: "read" } },
      /issues: "read" was granted beyond/,
    ],
    [
      { permissions: { ...role, metadata: "read", contents: "write" } },
      /contents: "write" was granted/,
    ],
    [
      { permissions: { ...role, pull_requests: "read" } },
      /pull_requests is granted as "read", not write/,
    ],
    [{ permissions: { statuses: "write" } }, /pull_requests is granted as null/],
    [{ permissions: undefined }, /no permissions/],
    [
      { repositories: [...repos, { id: 322, full_name: "figentra/other" }] },
      /not for exactly one repository/,
    ],
    [{ repositories: [] }, /not for exactly one repository/],
    [{ repositories: undefined }, /not for exactly one repository/],
    [{ repositories: [{ id: 321, full_name: "figentra/other" }] }, /not for figentra\/flow/],
    [{ repositories: [{ id: 999, full_name: "figentra/flow" }] }, /not for figentra\/flow/],
  ];
  for (const [grant, message] of bad) {
    const { calls, fetch } = world({ grant });
    await assert.rejects(mint("approve", options({ fetch })), (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, message);
      assert.match(error.message, /the token was revoked/);
      noSecret(error.message);
      return true;
    });
    assert.deepEqual(
      calls.filter((c) => c.method === "DELETE").map((c) => c.auth),
      [`Bearer ${TOKEN}`],
    );
  }
  // A failed revoke still refuses with the grant's reason, and says the token is still live.
  const { fetch } = world({ grant: { permissions: { contents: "write" } }, revoke: 500 });
  await assert.rejects(
    mint("approve", options({ fetch })),
    /granted as null.*revoking it failed \(it expires within the hour\)$/,
  );
});

test("installation: another account's or another App's refuses before any token is asked for", async () => {
  /** @type {[object, RegExp][]} */
  const cases = [
    [{ account: { login: "attacker" } }, /installation: it is not on figentra; nothing minted/],
    [{ account: undefined }, /it is not on figentra/],
    [{ app_id: 1 }, /another App's; nothing minted/],
    [{ id: "9" }, /it has no id/],
  ];
  for (const [installation, message] of cases) {
    const { calls, fetch } = world({ installation });
    await assert.rejects(mint("merge", options({ fetch })), message);
    assert.ok(!calls.some((c) => c.url.includes("access_tokens")));
  }
});

test("GitHub failures and a key that does not sign carry the named messages, mint nothing, and name no value", async () => {
  /** @type {[any, RegExp][]} */
  const cases = [
    [
      { token: 422 },
      /installation lacks pull_requests: write, statuses: write: the owner grants it/,
    ],
    [{ token: 403 }, /access token: POST \/app\/installations\/9\/access_tokens answered 403/],
    [
      { reject: true },
      /^app-token: installation: GET \/repos\/figentra\/flow\/installation did not answer$/,
    ],
  ];
  for (const [over, message] of cases) {
    const { calls, fetch } = world(over);
    await assert.rejects(mint("approve", options({ fetch })), (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, message);
      noSecret(error.message);
      noSecret(inspect(error));
      return true;
    });
    // Nothing was minted, so nothing is revoked.
    assert.ok(!calls.some((c) => c.method === "DELETE"));
  }
  const { calls, fetch } = world();
  await assert.rejects(
    mint(
      "approve",
      options({ fetch, env: { ...ENV, [`${ENV_PREFIX}GATE_PRIVATE_KEY`]: "not a key" } }),
    ),
    /^Error: app-token: app jwt: FFLOW_GATE_PRIVATE_KEY does not sign$/,
  );
  assert.deepEqual(calls, []);
});

test("a 2xx answer without its value, or with no JSON, fails at its step and mints nothing", async () => {
  const NO_JSON = Symbol("no JSON");
  /** @type {[string, unknown, RegExp][]} */
  const cases = [
    ["access_tokens", { permissions: {}, repositories: [] }, /access token: the token is missing/],
    ["access_tokens", NO_JSON, /access token: POST .* answered no JSON/],
    ["installation", NO_JSON, /installation: GET .* answered no JSON/],
  ];
  for (const [match, json, message] of cases) {
    const { calls, fetch } = world();
    /** @type {import("../lib/app-token.mjs").Fetch} */
    const patched = async (url, init) => {
      const real = await fetch(url, init);
      if (!url.endsWith(match)) return real;
      return {
        ok: true,
        status: 200,
        json: async () => {
          if (json === NO_JSON) throw new SyntaxError("Unexpected token");
          return json;
        },
      };
    };
    await assert.rejects(mint("approve", options({ fetch: patched })), message);
    // No token came back, so nothing is revoked.
    assert.ok(!calls.some((c) => c.method === "DELETE"));
    if (match !== "access_tokens") assert.ok(!calls.some((c) => c.url.includes("access_tokens")));
  }
});

test("withToken: the token is revoked after a return and after a throw", async () => {
  const ok = world();
  assert.equal(
    await withToken(
      "verdict",
      options({ fetch: ok.fetch }),
      async (token, slug) => `${slug}:${token.length}`,
    ),
    `figentra-flow:${TOKEN.length}`,
  );
  assert.equal(ok.calls.filter((c) => c.method === "DELETE").length, 1);
  const thrown = world();
  await assert.rejects(
    withToken("verdict", options({ fetch: thrown.fetch }), async () => {
      throw new Error("use failed");
    }),
    /use failed/,
  );
  assert.equal(thrown.calls.filter((c) => c.method === "DELETE").length, 1);
  // A failed revoke does not hide use's own error; on a return it is thrown, and a second revoke retries.
  const both = world({ revoke: 500 });
  await assert.rejects(
    withToken("verdict", options({ fetch: both.fetch }), async () => {
      throw new Error("use failed");
    }),
    /^Error: use failed$/,
  );
  const minted = await mint("verdict", options({ fetch: both.fetch }));
  await assert.rejects(minted.revoke(), /revoke: DELETE \/installation\/token answered 500/);
  await assert.rejects(minted.revoke(), /answered 500/);
  assert.equal(both.calls.filter((c) => c.method === "DELETE").length, 3);
});

test("logs: only ::add-mask:: lines, and only in Actions; no console line, env write or error holds a value", async (t) => {
  /** @type {string[]} */
  const logged = [];
  for (const name of /** @type {const} */ (["log", "error", "warn", "info", "debug"]))
    t.mock.method(console, name, (/** @type {unknown[]} */ ...args) => {
      logged.push(args.map(String).join(" "));
    });
  /** @type {string[]} */
  const out = [];
  const mask = masker(ENV, (text) => out.push(text));
  const env = Object.freeze({ ...ENV });
  const processEnv = { ...process.env };
  const { fetch } = world();
  const minted = await mint("approve", {
    defaultBranch: "main",
    env,
    fetch,
    mask,
    now: () => NOW,
  });
  await minted.revoke();
  const failing = world({ grant: { permissions: { contents: "write" } } });
  await assert.rejects(
    mint("approve", { defaultBranch: "main", env, fetch: failing.fetch, mask }),
    (error) => {
      assert.ok(error instanceof Error);
      noSecret(String(error.stack));
      return true;
    },
  );
  t.mock.restoreAll();
  assert.deepEqual(logged, []);
  assert.deepEqual(env, ENV);
  assert.deepEqual({ ...process.env }, processEnv);
  const lines = out.join("").split("\n").filter(Boolean);
  assert.ok(lines.every((l) => l.startsWith("::add-mask::")));
  for (const value of SECRETS)
    assert.ok(lines.includes(`::add-mask::${value}`), "a value went unmasked");
  // The key is masked line by line; its PEM armour is not.
  assert.ok(!lines.some((l) => l.includes("-----")));
  // Outside Actions the masker writes nothing.
  const quiet = [];
  masker({ ...ENV, GITHUB_ACTIONS: "" }, (text) => quiet.push(text))(TOKEN);
  assert.deepEqual(quiet, []);
  // A key stored on one line, armour and body together, is still masked; a bare armour line is not.
  const oneLine = [];
  masker(ENV, (text) => oneLine.push(text))(
    "-----BEGIN PRIVATE KEY----- MIIEabc -----END PRIVATE KEY-----\n-----END PRIVATE KEY-----",
  );
  assert.deepEqual(oneLine, [
    "::add-mask::-----BEGIN PRIVATE KEY----- MIIEabc -----END PRIVATE KEY-----\n",
  ]);
});
