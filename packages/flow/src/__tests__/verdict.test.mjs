/**
 * Figentra Flow file contract:
 * Purpose: hold the github-actions verdict to the L2 design (PR F):
 *   - `verdict.mjs` posts the gate's status from the run's `check` job with a `verdict` token, and refuses (posts
 *     nothing, exits 0) another path, event or repository, a fork, an unfinished run, a moved head, a bad run id or a
 *     frozen automation variable; a missing `check` job is a failure; it never calls an artifacts endpoint; a PR that
 *     changes `.github/workflows/**` is pending unless the owner approved that head; an API or mint failure exits 1;
 *   - the approval workflow without `verdict` is today's file byte for byte; with it, it adds only the gate's
 *     `workflow_run`, every job's `if:` carries the default ref and the automation guard, `id-token: write` is only in
 *     the verdict job, which runs in the approval environment with a per-head concurrency group that never cancels,
 *     the pinned integrity, mise and then the decrypt of the gate App's id and key before the script, no checkout,
 *     artifact download or cache, and no event text in a `run:` block;
 *   - `sync` renders the verdict job only for a `github-actions` runner with a `sops` `secrets.oidc`.
 * Boundary: a fake GitHub (an injected REST function) and temporary folders; no network.
 * Runtime: node
 * Governing contract: ADR 0523; the L2 design (verdict, PR F; Tests); STA-1945.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sync } from "../commands/sync.mjs";
import { approveWorkflow } from "../lib/approve-workflow.mjs";
import {
  APPROVE_ENVIRONMENT,
  APPROVE_WORKFLOW,
  AUTOMATION_VARIABLE,
  ENV_PREFIX,
  NAME,
  STATUS_CONTEXT,
} from "../lib/product.mjs";
import { decide, main } from "../lib/verdict.mjs";

const SHA = "b".repeat(40);
const REPO = "figentra/flow";
const GATE_PATH = `.github/workflows/${NAME}-gate.yml`;
/** A `sops` secrets.oidc: the decrypt action pinned to a commit and the gate App's scope. */
const DECRYPT = {
  decrypt: `figentra/stackra/.github/actions/secrets-decrypt@${"c".repeat(40)}`,
  scope: "ci/flow/gate",
};
/** The decrypt step every keyed job runs before its script. */
const DECRYPT_STEP = `      - name: Gate App key
        uses: ${DECRYPT.decrypt}
        with:
          scope: ${DECRYPT.scope}
          names: ${ENV_PREFIX}GATE_APP_ID,${ENV_PREFIX}GATE_PRIVATE_KEY
`;
const ENV = Object.freeze({
  AUTOMATION: "on",
  GITHUB_REPOSITORY: REPO,
  GITHUB_REPOSITORY_ID: "321",
  RUN_ID: "77",
  GATE_PATH,
  OWNER: "figentra-usr",
  DEFAULT_BRANCH: "main",
});

/**
 * A GitHub with one gate run on `SHA` and its open PR; `over` changes one answer. Any artifacts call fails the test.
 * @param {{ run?: object, pulls?: object[], jobs?: object[], files?: object[], reviews?: object[],
 *           fail?: string, post?: number }} [over]
 */
function world(over = {}) {
  /** @type {{ method: string, path: string, body?: any }[]} */
  const calls = [];
  /** @type {string[]} */
  const minted = [];
  const answer = (/** @type {number} */ status, /** @type {unknown} */ json) => ({
    ok: status < 300,
    status,
    json,
  });
  /** @type {import("../lib/approve-check.mjs").Rest} */
  const read = async (method, path, body) => {
    calls.push({ method, path, body });
    assert.doesNotMatch(path, /artifacts/, "the verdict never reads artifacts");
    if (over.fail && path.startsWith(over.fail)) return answer(500, { message: "boom" });
    const p = path.split("?")[0];
    if (p === `/repos/${REPO}/actions/runs/77`)
      return answer(200, {
        id: 77,
        path: GATE_PATH,
        event: "pull_request",
        status: "completed",
        head_sha: SHA,
        html_url: `https://github.com/${REPO}/actions/runs/77`,
        repository: { id: 321 },
        head_repository: { id: 321 },
        ...over.run,
      });
    if (p === `/repos/${REPO}/commits/${SHA}/pulls`)
      return answer(
        200,
        over.pulls ?? [{ number: 5, state: "open", head: { sha: SHA, repo: { id: 321 } } }],
      );
    if (p === `/repos/${REPO}/actions/runs/77/jobs`)
      return answer(200, { jobs: over.jobs ?? [{ name: "check", conclusion: "success" }] });
    if (p === `/repos/${REPO}/pulls/5/files`)
      return answer(200, over.files ?? [{ filename: "src/a.mjs" }]);
    if (p === `/repos/${REPO}/pulls/5/reviews`) return answer(200, over.reviews ?? []);
    return answer(404, { message: "Not Found" });
  };
  /** @type {(token: string) => import("../lib/approve-check.mjs").Rest} */
  const write = (token) => async (method, path, body) => {
    calls.push({ method, path, body: { .../** @type {object} */ (body), token } });
    return answer(over.post ?? 201, {});
  };
  /** @type {any} */
  const withToken = async (
    /** @type {string} */ role,
    /** @type {any} */ options,
    /** @type {(t: string) => Promise<unknown>} */ use,
  ) => {
    minted.push(role);
    // The key comes from the job's environment (the decrypt step), not from anything verdict.mjs passes.
    assert.deepEqual(Object.keys(options).sort(), ["defaultBranch", "env"]);
    assert.equal(options.defaultBranch, "main");
    return use("ghs_verdict");
  };
  const posts = () => calls.filter((c) => c.method !== "GET");
  return { calls, minted, posts, deps: { read, write, withToken, log: () => {} } };
}

test("verdict: a green check job posts success on the head with a verdict token", async () => {
  const w = world();
  assert.equal(await main(ENV, w.deps), 0);
  assert.deepEqual(w.minted, ["verdict"]);
  assert.deepEqual(w.posts(), [
    {
      method: "POST",
      path: `/repos/${REPO}/statuses/${SHA}`,
      body: {
        state: "success",
        context: STATUS_CONTEXT,
        description: "check passed",
        target_url: `https://github.com/${REPO}/actions/runs/77`,
        token: "ghs_verdict",
      },
    },
  ]);
  assert.ok(w.calls.some((c) => c.path.includes("/jobs?filter=latest")));
});

test("verdict: another path, event or repository, a fork, an unfinished run, a moved head or a bad id posts nothing", async () => {
  /** @type {[string, object, Record<string, string>?][]} */
  const cases = [
    ["another path", { run: { path: ".github/workflows/other.yml" } }],
    ["another event", { run: { event: "push" } }],
    ["another repository", { run: { repository: { id: 9 } } }],
    ["a fork", { run: { head_repository: { id: 9 } } }],
    ["unfinished", { run: { status: "in_progress" } }],
    ["moved head", { pulls: [{ number: 5, state: "open", head: { sha: "c".repeat(40) } }] }],
    [
      "closed PR",
      { pulls: [{ number: 5, state: "closed", head: { sha: SHA, repo: { id: 321 } } }] },
    ],
    ["a bad id", {}, { RUN_ID: "77; rm -rf /" }],
  ];
  for (const [name, over, env] of cases) {
    const w = world(over);
    assert.equal(await main({ ...ENV, ...env }, w.deps), 0, name);
    assert.deepEqual(w.posts(), [], name);
    assert.deepEqual(w.minted, [], `${name}: nothing minted`);
  }
  // The ref GitHub may suffix to the path is not part of the file.
  const suffixed = world({ run: { path: `${GATE_PATH}@refs/pull/5/merge` } });
  assert.equal(await main(ENV, suffixed.deps), 0);
  assert.equal(suffixed.posts().length, 1);
});

test("verdict: a failed or missing check job is a failure", async () => {
  for (const [jobs, description] of /** @type {[object[], string][]} */ ([
    [[{ name: "check", conclusion: "failure" }], "check ended failure"],
    [[{ name: "other", conclusion: "success" }], "the run has no check job"],
    [[], "the run has no check job"],
  ])) {
    const w = world({ jobs });
    assert.equal(await main(ENV, w.deps), 0);
    assert.equal(w.posts()[0].body.state, "failure");
    assert.equal(w.posts()[0].body.description, description);
  }
});

test("verdict: a PR that changes the workflows is pending unless the owner approved that head", async () => {
  const files = [{ filename: "README.md" }, { filename: ".github/workflows/fflow-gate.yml" }];
  const at = (/** @type {string} */ state, /** @type {object} */ extra = {}) => ({
    user: { login: "figentra-usr", type: "User" },
    state,
    commit_id: SHA,
    ...extra,
  });
  /** @type {[string, object, string][]} */
  const cases = [
    ["no review", { files }, "pending"],
    ["approved at the head", { files, reviews: [at("APPROVED")] }, "success"],
    ["approved, then a comment", { files, reviews: [at("APPROVED"), at("COMMENTED")] }, "success"],
    [
      "approved at an older head",
      { files, reviews: [at("APPROVED", { commit_id: "c".repeat(40) })] },
      "pending",
    ],
    ["approved, then dismissed", { files, reviews: [at("DISMISSED")] }, "pending"],
    [
      "approved, then changes requested",
      { files, reviews: [at("APPROVED"), at("CHANGES_REQUESTED")] },
      "pending",
    ],
    [
      "another user approved",
      { files, reviews: [at("APPROVED", { user: { login: "x", type: "User" } })] },
      "pending",
    ],
    [
      "renamed out of workflows",
      { files: [{ filename: "a.yml", previous_filename: ".github/workflows/x.yml" }] },
      "pending",
    ],
  ];
  for (const [name, over, state] of cases) {
    const w = world(over);
    assert.equal(await main(ENV, w.deps), 0, name);
    assert.equal(w.posts()[0]?.body.state, state, name);
  }
  const pending = world({ files });
  await main(ENV, pending.deps);
  assert.equal(
    pending.posts()[0].body.description,
    "the gate workflow changed: the owner reviews it",
  );
});

test("verdict: a list GitHub cuts off counts as changing the workflows", async () => {
  const files = Array.from({ length: 100 }, (_, i) => ({ filename: `f${i}` }));
  const w = world({ files });
  assert.equal(await main(ENV, w.deps), 0);
  assert.equal(w.posts()[0].body.state, "pending");
});

test("verdict: any automation value but on or merge-only, or none, is the freeze", async () => {
  for (const value of [undefined, "", "frozen", "off", "ON"]) {
    const w = world();
    assert.equal(await main({ ...ENV, AUTOMATION: value }, w.deps), 0, String(value));
    assert.deepEqual(w.calls, [], `${value}: not even a read`);
  }
  const w = world();
  assert.equal(await main({ ...ENV, AUTOMATION: "merge-only" }, w.deps), 0);
  assert.equal(w.posts().length, 1);
});

test("verdict: an API or mint failure exits 1 and names the path, never a value", async () => {
  /** @type {string[]} */
  const logs = [];
  const broken = world({ fail: `/repos/${REPO}/actions/runs/77` });
  assert.equal(await main(ENV, { ...broken.deps, log: (s) => logs.push(s) }), 1);
  assert.match(logs.join("\n"), /GET \/repos\/figentra\/flow\/actions\/runs\/77 answered 500/);
  const post = world({ post: 422 });
  assert.equal(await main(ENV, post.deps), 1);
  const mint = world();
  assert.equal(
    await main(ENV, {
      ...mint.deps,
      withToken: async () => {
        throw new Error("app-token: refused");
      },
    }),
    1,
  );
});

test("verdict: off main's approval job, a user's GITHUB_TOKEN posts nothing; the mint refuses (STA-2134)", async () => {
  const w = world();
  const { withToken: _, ...deps } = w.deps;
  /** @type {string[]} */
  const logs = [];
  const workstation = { ...ENV, GITHUB_TOKEN: "ghp_a-users-token-123" };
  assert.equal(await main(workstation, { ...deps, log: (s) => logs.push(s) }), 1);
  assert.deepEqual(w.posts(), [], "the user's token only reads");
  assert.match(logs.join("\n"), /app-token: refused: not a GitHub Actions job/);
  assert.doesNotMatch(logs.join("\n"), /ghp_/);
});

test("verdict: decide reads the run, its PR, its latest jobs, files and nothing else", async () => {
  const w = world();
  const v = await decide({
    api: w.deps.read,
    repo: REPO,
    repoId: "321",
    runId: "77",
    gatePath: GATE_PATH,
    owner: "figentra-usr",
  });
  assert.deepEqual(v, {
    sha: SHA,
    state: "success",
    description: "check passed",
    url: `https://github.com/${REPO}/actions/runs/77`,
  });
  assert.deepEqual(
    w.calls.map((c) => c.path.split("?")[0]),
    [
      `/repos/${REPO}/actions/runs/77`,
      `/repos/${REPO}/commits/${SHA}/pulls`,
      `/repos/${REPO}/actions/runs/77/jobs`,
      `/repos/${REPO}/pulls/5/files`,
    ],
  );
});

const BASE = {
  version: "9.9.9",
  integrity: "sha512-AbC+/9==",
  appId: "A_ID",
  privateKey: "A_KEY",
  trusted: { [STATUS_CONTEXT]: "figentra-gate[bot]" },
  ownerOnly: ["it's/**"],
};
const VERDICT = {
  gatePath: GATE_PATH,
  owner: "figentra-usr",
  defaultBranch: "main",
  oidc: DECRYPT,
};

/** Each job's block, by name. */
const jobsOf = (/** @type {string} */ yaml) =>
  Object.fromEntries(
    yaml
      .split(/^jobs:$/m)[1]
      .split(/^(?= {2}[\w-]+:$)/m)
      .filter((b) => b.trim())
      .map((b) => [b.trim().split(":")[0], b]),
  );

test("approval workflow: without verdict it is today's file, byte for byte", () => {
  const today = readFileSync(
    new URL("./__fixtures__/approve-workflow-today.txt", import.meta.url),
    "utf8",
  );
  assert.equal(approveWorkflow(BASE), today);
});

test("approval workflow: the verdict job's triggers, guards, permissions, environment and concurrency", () => {
  const yaml = approveWorkflow({ ...BASE, verdict: VERDICT });
  const on = yaml.split(/^on:$/m)[1].split(/^permissions:/m)[0];
  assert.deepEqual(
    [...on.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]),
    ["workflow_dispatch", "workflow_run"],
  );
  assert.match(on, new RegExp(`workflows: \\["${STATUS_CONTEXT}"\\]\\n {4}types: \\[completed\\]`));
  assert.match(yaml, /^permissions: \{\}$/m);
  assert.doesNotMatch(yaml, /^concurrency:/m, "no workflow-wide group to starve verdicts");
  const jobs = jobsOf(yaml);
  assert.deepEqual(Object.keys(jobs), ["approve", "verdict"]);
  const guard = `github.ref == 'refs/heads/main' && (vars.${AUTOMATION_VARIABLE} == 'on' || vars.${AUTOMATION_VARIABLE} == 'merge-only')`;
  assert.match(jobs.approve, /^ {4}if: github\.event_name == 'workflow_dispatch' && /m);
  assert.match(jobs.verdict, /^ {4}if: github\.event_name == 'workflow_run' && /m);
  for (const [name, block] of Object.entries(jobs)) {
    assert.ok(block.includes(guard), `${name} carries the ref and automation guard`);
    assert.match(block, new RegExp(`^ {4}environment: ${APPROVE_ENVIRONMENT}$`, "m"), name);
    assert.match(block, /INTEGRITY: 'sha512-AbC\+\/9=='/, name);
    assert.ok(block.indexOf('"$INTEGRITY" ]') < block.indexOf("node flow/"), name);
  }
  assert.equal(/id-token: write/.test(jobs.approve), false);
  assert.match(
    jobs.verdict,
    /^ {4}permissions:\n {6}actions: read\n {6}contents: read\n {6}pull-requests: read\n {6}id-token: write\n {4}steps:/m,
  );
  assert.match(
    jobs.verdict,
    new RegExp(
      `concurrency:\\n {6}group: ${NAME}-verdict-\\$\\{\\{ github\\.event\\.workflow_run\\.head_sha \\}\\}\\n {6}cancel-in-progress: false`,
    ),
  );
  assert.match(jobs.approve, new RegExp(`group: ${NAME}-approve-\\$\\{\\{ inputs\\.pr \\}\\}`));
  assert.match(jobs.verdict, /node flow\/package\/src\/lib\/verdict\.mjs/);
  assert.match(jobs.verdict, /RUN_ID: \$\{\{ github\.event\.workflow_run\.id \}\}/);
  // mise (for the decrypt's sops), then the decrypt, then the script; the approve job decrypts nothing.
  const mise = jobs.verdict.indexOf("jdx/mise-action@");
  const decrypt = jobs.verdict.indexOf(DECRYPT_STEP);
  assert.ok(mise > 0 && decrypt > mise && decrypt < jobs.verdict.indexOf("Post "));
  assert.ok(!jobs.approve.includes(DECRYPT.decrypt));
  assert.doesNotMatch(jobs.verdict, /OIDC:|OIDC_IDENTITY/);
  assert.ok(jobs.verdict.includes(`GATE_PATH: ${GATE_PATH}\n`));
  assert.doesNotMatch(jobs.verdict, /secrets\./, "the verdict job names no secret");
  assert.doesNotMatch(
    yaml,
    /actions\/checkout|download-artifact|upload-artifact|cache:(?! false$)|pull_request_target|workflow_call|repository_dispatch|\bpush:/m,
  );
  for (const [, ref] of yaml.matchAll(/uses: [\w/-]+@(\S+)/g)) assert.match(ref, /^[0-9a-f]{40}$/);
  // No event text inside a run block: it reaches node through env only.
  for (const [, run] of yaml.matchAll(/^ {8}run: \|\n((?: {10}.*\n)+)/gm))
    assert.doesNotMatch(run, /\$\{\{/);
});

test("approval workflow: gates on different heads never share a verdict group", () => {
  const yaml = approveWorkflow({ ...BASE, verdict: VERDICT });
  const groups = [...yaml.matchAll(/group: (.+)$/gm)].map((m) => m[1]);
  assert.ok(groups.includes(`${NAME}-verdict-\${{ github.event.workflow_run.head_sha }}`));
  assert.equal(
    [...yaml.matchAll(/cancel-in-progress: (\w+)/g)].every((m) => m[1] === "false"),
    true,
  );
});

test("approval workflow: verdict inputs that are not plain names refuse", () => {
  for (const bad of [
    { defaultBranch: "main' || true" },
    { gatePath: "x.yml" },
    { gatePath: ".github/workflows/a b.yml" },
    { owner: "o'wner" },
    { oidc: undefined },
    { oidc: { ...DECRYPT, decrypt: "figentra/stackra/.github/actions/secrets-decrypt@main" } },
    { oidc: { ...DECRYPT, decrypt: `${DECRYPT.decrypt}\n      - run: id` } },
    { oidc: { ...DECRYPT, scope: "ci/flow/gate\n          names: X" } },
  ])
    assert.throws(() => approveWorkflow({ ...BASE, verdict: { ...VERDICT, ...bad } }), /verdict:/);
});

test("sync renders the verdict job only for a github-actions runner with a sops secrets.oidc", (t) => {
  const secrets = { kind: "sops", oidc: DECRYPT };
  /** @type {[string, object, boolean][]} */
  const cases = [
    ["github-actions with oidc", { runner: { kind: "github-actions" }, secrets }, true],
    ["command runner", { runner: { kind: "command", run: ["x", "{command}"] }, secrets }, false],
    ["no oidc", { runner: { kind: "github-actions" }, secrets: { kind: "sops" } }, false],
    [
      "retired infisical",
      { runner: { kind: "github-actions" }, secrets: { kind: "infisical", paths: { gate: "/g" } } },
      false,
    ],
  ];
  for (const [name, extra, rendered] of cases) {
    const root = mkdtempSync(join(tmpdir(), "flow-verdict-sync-"));
    t.after(() => rmSync(root, { recursive: true }));
    writeFileSync(
      join(root, "flow.config.json"),
      JSON.stringify({ version: 1, preset: "neutral", apps: { owner: "figentra-usr" }, ...extra }),
    );
    sync(root, { direct: true, log: () => {} });
    const text = readFileSync(join(root, ".github/workflows", APPROVE_WORKFLOW), "utf8");
    assert.equal(/^ {2}verdict:$/m.test(text), rendered, name);
    if (rendered) {
      assert.ok(text.includes(DECRYPT_STEP), name);
      assert.ok(text.includes(`GATE_PATH: ${GATE_PATH}\n`), name);
      assert.ok(text.includes("OWNER: 'figentra-usr'"), name);
    }
  }
});
