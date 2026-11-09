/**
 * Figentra Flow file contract:
 * Purpose: hold the box poster to its contract: `success` only for exit 0, `failure` otherwise, on the checked sha;
 *   nothing posted when the tip moved or no token can be minted; one PR comment updated, not duplicated; the JWT
 *   signed with the App key; and no secret (the key, the JWT, the installation token, a secret-looking environment
 *   value) in any posted body or printed line. STA-2134: a user's ambient token never posts the gate, and no source
 *   file but the poster and the verdict writes `fflow/gate` or the gate's comment, neither through `gh`.
 * Boundary: an injected fetch and a throwaway key generated here; no network.
 * Runtime: node
 * Governing contract: ADR 0022; Stackra ADR 0503; STA-1729 phase 2.
 */
// @covers sta-1729:FR-5 sta-1729:AC-008 sta-1729:AC-009 sta-1729:P-005
import { test } from "node:test";
import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { appJwt, post, redact, stepsOf } from "../lib/gate-post.mjs";
import { ENV_PREFIX, GATE_MARKER as MARKER, STATUS_CONTEXT as CONTEXT } from "../lib/product.mjs";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const SHA = "a".repeat(40);
const TOKEN = "ghs_installationtoken123456";
const JOB = {
  sha: SHA,
  branch: "figentra/sta-1-x",
  repository: "figentra/flow",
  context: CONTEXT,
  marker: MARKER,
  envPrefix: ENV_PREFIX,
  startedAt: "2026-10-31T10:00:00Z",
};
const ENV = {
  [`${ENV_PREFIX}GATE_APP_ID`]: "4242",
  [`${ENV_PREFIX}GATE_PRIVATE_KEY`]: privateKey,
  UNIWIND_AUTH_TOKEN: "uniwind-secret-value",
};
const NOW = Date.parse("2026-10-31T10:03:07Z");

/**
 * A GitHub stand-in: the routes answer as GitHub would; every call is recorded.
 * @param {{ tip?: string, prs?: number[], comments?: object[], failToken?: boolean }} [world]
 */
function github({ tip = SHA, prs = [7], comments = [], failToken = false } = {}) {
  /** @type {{ method: string, url: string, auth: string, body?: any }[]} */
  const calls = [];
  /** @type {import("../lib/gate-post.mjs").Fetch} */
  const fetch = async (url, init = {}) => {
    const method = init.method ?? "GET";
    const body = init.body === undefined ? undefined : JSON.parse(init.body);
    calls.push({ method, url, auth: init.headers?.authorization ?? "", body });
    const ok = (/** @type {unknown} */ json, status = 200) => ({
      ok: true,
      status,
      json: async () => json,
    });
    const path = url.replace("https://api.github.com", "");
    if (path === "/repos/figentra/flow/installation") return ok({ id: 9 });
    if (path === "/app/installations/9/access_tokens")
      return failToken
        ? { ok: false, status: 401, json: async () => ({}) }
        : ok({ token: TOKEN }, 201);
    if (path.startsWith("/repos/figentra/flow/git/ref/heads/")) return ok({ object: { sha: tip } });
    if (path.startsWith("/repos/figentra/flow/pulls?"))
      return ok(prs.map((number) => ({ number })));
    if (path.startsWith("/repos/figentra/flow/issues/7/comments?")) return ok(comments);
    if (path === "/repos/figentra/flow/issues/7/comments")
      return ok({ html_url: "https://c/new" }, 201);
    if (path.startsWith("/repos/figentra/flow/issues/comments/"))
      return ok({ html_url: "https://c/old" });
    if (path === `/repos/figentra/flow/statuses/${SHA}`) return ok({}, 201);
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { calls, fetch };
}

/** Every secret this run touched must be absent from what it sent and printed. */
function assertNoSecret(/** @type {{ body?: any }[]} */ calls, /** @type {string[]} */ lines) {
  const sent = JSON.stringify(calls.map((c) => c.body)) + lines.join("\n");
  for (const secret of [TOKEN, ENV.UNIWIND_AUTH_TOKEN, "BEGIN PRIVATE KEY"])
    assert.equal(sent.includes(secret), false, secret);
}

test("post: a red run names the step it stopped at, from the marks in its log", async () => {
  const { calls, fetch } = github();
  const log = [
    "::gate-step::1762600000 pnpm install --frozen-lockfile",
    "Done in 6s",
    "::gate-step::1762600010 pnpm lint",
    "Found 2 errors.",
  ].join("\n");
  await post({ job: JOB, exit: 1, log, env: ENV, fetch, now: NOW });
  const status = calls.find((c) => c.url.endsWith(`/statuses/${SHA}`));
  assert.equal(status?.body.description, "failed at pnpm lint (exit 1) in 3m07s");
  assert.deepEqual(stepsOf(log), [
    { at: 1762600000, step: "pnpm install --frozen-lockfile" },
    { at: 1762600010, step: "pnpm lint" },
  ]);
  // Without marks, the description stays as before.
  await post({ job: JOB, exit: 1, log: "boom", env: ENV, fetch, now: NOW });
  assert.equal(
    calls.filter((c) => c.url.endsWith(`/statuses/${SHA}`)).at(-1)?.body.description,
    "checks failed (exit 1) in 3m07s",
  );
});

test("post: exit 0 posts success on the checked sha and comments on the PR", async () => {
  const { calls, fetch } = github();
  const result = await post({ job: JOB, exit: 0, env: ENV, fetch, now: NOW });
  assert.equal(result.code, 0);
  const status = calls.find((c) => c.url.endsWith(`/statuses/${SHA}`));
  assert.deepEqual(status?.body, {
    state: "success",
    context: CONTEXT,
    description: "checks passed in 3m07s",
    target_url: "https://c/new",
  });
  assert.equal(status?.auth, `Bearer ${TOKEN}`);
  // The token is narrowed to this repository and to what the poster reads and writes, the branch ref included.
  assert.deepEqual(calls.find((c) => c.url.endsWith("/access_tokens"))?.body, {
    repositories: ["flow"],
    permissions: { contents: "read", statuses: "write", pull_requests: "write" },
  });
  assert.ok(
    calls
      .find((c) => c.method === "POST" && c.url.endsWith("/issues/7/comments"))
      ?.body.body.startsWith(MARKER),
  );
  assertNoSecret(calls, result.lines);
});

test("post: a failure posts failure with a redacted log tail, updating the gate's own comment", async () => {
  const { calls, fetch } = github({
    comments: [{ id: 5, user: { type: "Bot" }, body: `${MARKER}\nold` }],
  });
  const log = `step 1\nusing ${ENV.UNIWIND_AUTH_TOKEN} to install\nError: 3 tests failed`;
  const result = await post({ job: JOB, exit: 1, log, env: ENV, fetch, now: NOW });
  assert.equal(result.code, 1);
  assert.equal(calls.find((c) => c.url.endsWith(`/statuses/${SHA}`))?.body.state, "failure");
  const patched = calls.find((c) => c.method === "PATCH" && c.url.endsWith("/issues/comments/5"));
  assert.match(patched?.body.body ?? "", /3 tests failed/);
  assert.match(patched?.body.body ?? "", /using \*\*\* to install/);
  assert.equal(
    calls.some((c) => c.method === "POST" && c.url.endsWith("/issues/7/comments")),
    false,
  );
  assertNoSecret(calls, result.lines);
});

test("post: nothing is posted when the branch moved, or when no token can be minted", async () => {
  const moved = github({ tip: "b".repeat(40) });
  const stale = await post({ job: JOB, exit: 0, env: ENV, fetch: moved.fetch, now: NOW });
  assert.equal(stale.code, 5);
  assert.equal(
    moved.calls.some((c) => c.method !== "GET" && !c.url.includes("access_tokens")),
    false,
  );

  const denied = github({ failToken: true });
  const none = await post({ job: JOB, exit: 0, env: ENV, fetch: denied.fetch, now: NOW });
  assert.equal(none.code, 4);
  assert.equal(
    denied.calls.some((c) => c.url.includes("/statuses/")),
    false,
  );
  assertNoSecret(denied.calls, none.lines);

  const unset = await post({ job: JOB, exit: 0, env: {}, fetch: denied.fetch, now: NOW });
  assert.equal(unset.code, 4);
  // A workstation has no gate key: the message says where gate posts run instead.
  assert.match(unset.lines.join("\n"), /run on the Testbed box or in CI/);
});

test("post: a branch with no open PR still gets its status", async () => {
  const { calls, fetch } = github({ prs: [] });
  assert.equal((await post({ job: JOB, exit: 0, env: ENV, fetch, now: NOW })).code, 0);
  assert.equal(calls.find((c) => c.url.endsWith(`/statuses/${SHA}`))?.body.target_url, undefined);
});

test("appJwt: RS256 over the App id, verifiable with the public key", () => {
  const jwt = appJwt("4242", privateKey, NOW);
  const [header, payload, signature] = jwt.split(".");
  assert.equal(
    createVerify("RSA-SHA256")
      .update(`${header}.${payload}`)
      .verify(publicKey, signature, "base64url"),
    true,
  );
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  assert.equal(claims.iss, "4242");
  assert.equal(claims.exp - claims.iat, 600);
});

test("redact: secret-looking values (and each line of a key) become ***, others stay", () => {
  const text = `a uniwind-secret-value b ${privateKey.split("\n")[1]} c plain-value`;
  const out = redact(text, { ...ENV, PLAIN: "plain-value" });
  assert.equal(out.includes("uniwind-secret-value"), false);
  assert.equal(out.includes(privateKey.split("\n")[1]), false);
  assert.match(out, /plain-value/);
});

test("post: a user's ambient token (GITHUB_TOKEN, GH_TOKEN) never posts the gate (STA-2134)", async () => {
  const { calls, fetch } = github();
  const env = { GITHUB_TOKEN: "ghp_a-users-token-123", GH_TOKEN: "gho_a-users-token-456" };
  const result = await post({ job: JOB, exit: 0, env, fetch, now: NOW });
  assert.equal(result.code, 4);
  assert.deepEqual(calls, [], "no call at all without the App's own key");
});

test("only the poster and the verdict write fflow/gate or its comment, and neither through gh (STA-2134)", () => {
  const src = fileURLToPath(new URL("..", import.meta.url));
  const files = /** @type {string[]} */ (readdirSync(src, { recursive: true }))
    .filter((f) => f.endsWith(".mjs") && !f.startsWith("__tests__"))
    .map((f) => ({ f: f.split("\\").join("/"), text: readFileSync(`${src}/${f}`, "utf8") }));
  const having = (/** @type {RegExp} */ re) =>
    files
      .filter((x) => re.test(x.text))
      .map((x) => x.f)
      .sort();
  // A commit status write is `POST /repos/<repo>/statuses/<sha>`; approve-check's is `fflow/land`'s, minted.
  assert.deepEqual(having(/\/statuses\/\$\{/), [
    "lib/approve-check.mjs",
    "lib/gate-post.mjs",
    "lib/verdict.mjs",
  ]);
  // The gate's context and comment marker reach a write only through the poster's job file or the verdict.
  assert.deepEqual(having(/context: STATUS_CONTEXT\b/), [
    "commands/gate-run.mjs",
    "lib/verdict.mjs",
  ]);
  assert.deepEqual(having(/\bGATE_MARKER\b/), ["commands/gate-run.mjs", "lib/product.mjs"]);
  for (const f of ["lib/gate-post.mjs", "lib/verdict.mjs", "lib/app-token.mjs"])
    assert.doesNotMatch(
      files.find((x) => x.f === f)?.text ?? "",
      // Imports and reads only: the contracts may name `gh` and `GH_TOKEN` to say they never use them.
      /"node:child_process"|\/github\.mjs"|\/credentials\.mjs"|\.GH_TOKEN\b/,
      `${f} has no path to gh's ambient login`,
    );
});
