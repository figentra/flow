/**
 * Figentra Flow file contract:
 * Purpose: hold the Studio's MCP write surface (master plan Phase 5) to its contract: `spec_create` writes one Draft
 *   spec from the template, naming the person, and refuses a key that has one, a bad slug and a service caller;
 *   `run_start` builds only a tasked, approved spec, only in the EU or US sandbox, on behalf of a person; `run_status`
 *   reads the run back; `run_list` pages a spec's runs newest first, by status; `run_cancel` stops a run that has not
 *   finished; `repo_create` makes a private repository from a template and refuses a taken name, a non-template and a
 *   malformed name; every call refuses a service as its caller; and the server lists the Studio's tools only under
 *   `--studio`.
 * Boundary: temporary repositories, the fake sandbox and the handler driven by request objects; no process, no network.
 * Runtime: node
 * Governing contract: master plan 2026-11-07 Phase 5; Stackra ADR 0209 A8 (STA-2558).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fakeProjectLinker } from "../adapters/project-link/fake.mjs";
import { fakeRepoHost } from "../adapters/repo-host/fake.mjs";
import { fakeSandbox } from "../adapters/sandbox/fake.mjs";
import { handle, TOOLS } from "../commands/mcp.mjs";
import { STUDIO_TOOLS, studioReaders } from "../lib/studio.mjs";

const PERSON = "usr_01ABCDEFGHJKMNPQRSTVWXYZ0";

/** A Flow repository on the stackra preset with the STA tracker. */
const repoOf = (/** @type {{ after: (fn: () => void) => void }} */ t) => {
  const root = mkdtempSync(join(tmpdir(), "flow-studio-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    join(root, "flow.config.json"),
    JSON.stringify({
      version: 1,
      preset: "stackra",
      tracker: { kind: "linear", team: "STA", branchPrefix: "figentra" },
    }),
  );
  return root;
};

/** The Studio's handlers over a fake sandbox with a fixed clock and run ids. */
const studioOf = () => {
  let n = 0;
  const sandbox = fakeSandbox({ now: () => "2026-11-08T10:00:00.000Z", id: () => `run_${++n}` });
  const repos = fakeRepoHost({
    templates: ["figentra/product-template"],
    existing: ["figentra/velora"],
    now: () => "2026-11-08T10:00:00.000Z",
  });
  const projects = fakeProjectLinker({
    projects: [{ id: "prj_academorix", name: "Academorix" }],
    now: () => "2026-11-08T10:00:00.000Z",
  });
  return { sandbox, tools: studioReaders({ sandbox, repos, projects, today: () => "2026-11-08" }) };
};

/** A spec for STA-7 at `status`, of `tier`, with `approval` on its Status line. */
const writeSpec = (root, status, tier = "small", approval = "") => {
  mkdirSync(join(root, ".agents/specs/sta-7-demo"), { recursive: true });
  writeFileSync(
    join(root, ".agents/specs/sta-7-demo/spec.md"),
    `# Feature Specification: Demo\n\n**Status**: ${status}${approval}\n\n**Tier**: ${tier}\n`,
  );
};

test("spec_create: a Draft spec from the template, with the title, the description and the person", (t) => {
  const root = repoOf(t);
  const out = studioOf().tools.spec_create({
    repo: root,
    key: "STA-12",
    slug: "salon-bookings",
    title: "Salon bookings",
    intent: 'Create Velora: "bookings" for salons.\nWith deposits.',
    onBehalfOf: PERSON,
  });
  assert.deepEqual(out, {
    key: "STA-12",
    folder: "sta-12-salon-bookings",
    path: ".agents/specs/sta-12-salon-bookings/spec.md",
    status: "draft",
    requestedBy: PERSON,
  });
  const text = readFileSync(join(root, out.path), "utf8");
  assert.match(text, /^# Feature Specification: Salon bookings$/m);
  assert.match(text, /^\*\*Linear\*\*: STA-12/m);
  assert.match(text, /^\*\*Feature Branch\*\*: `figentra\/sta-12-salon-bookings`/m);
  assert.match(text, /^\*\*Created\*\*: 2026-11-08$/m);
  assert.match(
    text,
    /^\*\*Input\*\*: User description: "Create Velora: 'bookings' for salons\. With deposits\."$/m,
  );
  assert.match(text, new RegExp(`^\\*\\*Requested by\\*\\*: ${PERSON} \\(Studio\\)$`, "m"));
});

test("spec_create: refuses a key with a spec, a slug that is not kebab-case, a service and a non-Flow folder", (t) => {
  const root = repoOf(t);
  const { tools } = studioOf();
  const args = {
    repo: root,
    key: "STA-7",
    slug: "demo",
    title: "Demo",
    intent: "x",
    onBehalfOf: PERSON,
  };
  writeSpec(root, "Draft");
  assert.throws(
    () => tools.spec_create(args),
    /STA-7 already has a spec: \.agents\/specs\/sta-7-demo/,
  );
  assert.throws(
    () => tools.spec_create({ ...args, key: "STA-8", slug: "Not Kebab" }),
    /not kebab-case/,
  );
  assert.throws(
    () => tools.spec_create({ ...args, key: "STA-8", onBehalfOf: "svc_01ABCDEFGHJKMNPQRSTVWXYZ0" }),
    /not a person's public id/,
  );
  assert.throws(
    () => tools.spec_create({ ...args, repo: join(root, "nowhere") }),
    /not a fflow repository/,
  );
});

test("run_start: a tasked, approved spec runs in the sandbox on behalf of the person; run_status reads it", async (t) => {
  const root = repoOf(t);
  const { sandbox, tools } = studioOf();
  writeSpec(root, "Tasked");
  const run = await tools.run_start({ repo: root, key: "STA-7", region: "eu", onBehalfOf: PERSON });
  assert.deepEqual(run, {
    repo: root,
    key: "STA-7",
    folder: "sta-7-demo",
    region: "eu",
    onBehalfOf: PERSON,
    runId: "run_1",
    status: "queued",
    startedAt: "2026-11-08T10:00:00.000Z",
    finishedAt: null,
    detail: "the fake sandbox records the run; nothing builds",
  });
  sandbox.settle("run_1", "passed");
  assert.equal((await tools.run_status({ runId: "run_1" })).status, "passed");
  await assert.rejects(tools.run_status({ runId: "run_9" }), /no run run_9/);
});

test("run_start: refuses an untasked or unapproved spec, a region outside the sandbox and a missing spec", async (t) => {
  const root = repoOf(t);
  const { tools } = studioOf();
  const args = { repo: root, key: "STA-7", region: "us", onBehalfOf: PERSON };
  await assert.rejects(async () => tools.run_start(args), /STA-7 has no spec/);
  writeSpec(root, "Planned");
  await assert.rejects(
    async () => tools.run_start(args),
    /STA-7 is planned; a run builds a tasked spec/,
  );
  writeSpec(root, "Abandoned");
  await assert.rejects(async () => tools.run_start(args), /STA-7 is abandoned/);
  writeSpec(root, "Tasked", "feature");
  await assert.rejects(async () => tools.run_start(args), /STA-7 is not approved/);
  writeSpec(root, "Tasked");
  await assert.rejects(
    async () => tools.run_start({ ...args, region: "me" }),
    /eu or us only, with no real data/,
  );
});

test("mcp: the Studio's tools are listed and called only when the server is given them", async (t) => {
  const root = repoOf(t);
  const { tools: readers } = studioOf();
  const list = async (/** @type {typeof TOOLS} */ tools) =>
    /** @type {any} */ (
      await handle({ jsonrpc: "2.0", id: 1, method: "tools/list" }, readers, {}, tools)
    ).result.tools.map((/** @type {{ name: string }} */ tool) => tool.name);
  assert.deepEqual(
    await list(TOOLS),
    TOOLS.map((tool) => tool.name),
  );
  assert.deepEqual(
    await list([...TOOLS, ...STUDIO_TOOLS]),
    [...TOOLS, ...STUDIO_TOOLS].map((tool) => tool.name),
  );
  const call = { jsonrpc: "2.0", id: 2, method: "tools/call" };
  const params = {
    name: STUDIO_TOOLS[0]?.name,
    arguments: { repo: root, key: "STA-3", slug: "x", title: "X", intent: "y", onBehalfOf: PERSON },
  };
  assert.match(
    /** @type {any} */ (await handle({ ...call, params }, readers)).error.message,
    /unknown tool/,
  );
  const created = /** @type {any} */ (
    await handle({ ...call, params }, readers, {}, [...TOOLS, ...STUDIO_TOOLS])
  );
  assert.equal(JSON.parse(created.result.content[0].text).folder, "sta-3-x");
});

test("run_list: a spec's runs newest first, a page at a time, by status, on behalf of a person", async (t) => {
  const root = repoOf(t);
  const { sandbox, tools } = studioOf();
  writeSpec(root, "Tasked");
  mkdirSync(join(root, ".agents/specs/sta-8-other"), { recursive: true });
  writeFileSync(
    join(root, ".agents/specs/sta-8-other/spec.md"),
    "# Feature Specification: Other\n\n**Status**: Tasked\n\n**Tier**: small\n",
  );
  const start = (/** @type {string} */ key) =>
    tools.run_start({ repo: root, key, region: "eu", onBehalfOf: PERSON });
  await start("STA-7");
  await start("STA-7");
  await start("STA-8");
  await start("STA-7");
  const ids = (/** @type {{ items: { runId: string }[] }} */ page) =>
    page.items.map((run) => run.runId);
  const args = { repo: root, key: "STA-7", onBehalfOf: PERSON };

  const first = await tools.run_list({ ...args, limit: 2 });
  assert.deepEqual(ids(first), ["run_4", "run_2"]);
  assert.equal(first.nextCursor, "run_2");
  const second = await tools.run_list({ ...args, limit: 2, cursor: "run_2" });
  assert.deepEqual(ids(second), ["run_1"]);
  assert.equal(second.nextCursor, null);
  assert.deepEqual(ids(await tools.run_list(args)), ["run_4", "run_2", "run_1"]);

  sandbox.settle("run_1", "passed");
  assert.deepEqual(ids(await tools.run_list({ ...args, status: "passed" })), ["run_1"]);
  assert.deepEqual(await tools.run_list({ ...args, cursor: "run_9" }), {
    items: [],
    nextCursor: null,
  });
  await assert.rejects(
    tools.run_list({ ...args, limit: 0 }),
    /limit 0 is not a whole number from 1 to 100/,
  );
  await assert.rejects(tools.run_list({ ...args, status: "done" }), /status done is not one of/);
  await assert.rejects(
    tools.run_list({ ...args, onBehalfOf: "svc_01ABCDEFGHJKMNPQRSTVWXYZ0" }),
    /not a person's public id/,
  );
});

test("run_cancel: stops a queued run on behalf of a person, never a finished one", async (t) => {
  const root = repoOf(t);
  const { sandbox, tools } = studioOf();
  writeSpec(root, "Tasked");
  await tools.run_start({ repo: root, key: "STA-7", region: "us", onBehalfOf: PERSON });
  await tools.run_start({ repo: root, key: "STA-7", region: "us", onBehalfOf: PERSON });

  const cancelled = await tools.run_cancel({ runId: "run_1", onBehalfOf: PERSON });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.cancelledBy, PERSON);
  assert.equal(cancelled.finishedAt, "2026-11-08T10:00:00.000Z");
  assert.equal((await tools.run_status({ runId: "run_1" })).status, "cancelled");

  await assert.rejects(
    tools.run_cancel({ runId: "run_1", onBehalfOf: PERSON }),
    /run_1 is cancelled; only a queued or running run is cancelled/,
  );
  sandbox.settle("run_2", "passed");
  await assert.rejects(tools.run_cancel({ runId: "run_2", onBehalfOf: PERSON }), /run_2 is passed/);
  await assert.rejects(tools.run_cancel({ runId: "run_9", onBehalfOf: PERSON }), /no run run_9/);
  await assert.rejects(
    tools.run_cancel({ runId: "run_2", onBehalfOf: "svc_01ABCDEFGHJKMNPQRSTVWXYZ0" }),
    /not a person's public id/,
  );
});

test("repo_create: a private repository from a template on behalf of a person; a taken name or a non-template is refused", async () => {
  const { tools } = studioOf();
  const args = {
    owner: "figentra",
    name: "academorix",
    template: "figentra/product-template",
    description: "Academorix:\nclubs and academies",
    onBehalfOf: PERSON,
  };

  assert.deepEqual(await tools.repo_create(args), {
    fullName: "figentra/academorix",
    url: "https://github.com/figentra/academorix",
    defaultBranch: "main",
    template: "figentra/product-template",
    private: true,
    createdBy: PERSON,
    createdAt: "2026-11-08T10:00:00.000Z",
  });
  await assert.rejects(tools.repo_create(args), /figentra\/academorix already exists/);
  await assert.rejects(
    tools.repo_create({ ...args, name: "velora" }),
    /figentra\/velora already exists/,
  );
  await assert.rejects(
    tools.repo_create({ ...args, name: "jute", template: "figentra/velora" }),
    /figentra\/velora is not a template repository/,
  );
  await assert.rejects(tools.repo_create({ ...args, name: "Not Kebab" }), /is not kebab-case/);
  await assert.rejects(
    tools.repo_create({ ...args, name: "jute", template: "product-template" }),
    /is not owner\/repo/,
  );
  await assert.rejects(
    tools.repo_create({ ...args, name: "jute", onBehalfOf: "svc_01ABCDEFGHJKMNPQRSTVWXYZ0" }),
    /not a person's public id/,
  );
});

test("repo_link: links an existing repository to a known project once, on behalf of a person", async () => {
  const { tools } = studioOf();
  const args = { repo: "figentra/velora", project: "prj_academorix", onBehalfOf: PERSON };
  const expected = {
    project: "prj_academorix",
    url: "https://github.com/figentra/velora",
    label: "GitHub: figentra/velora",
    linkedBy: PERSON,
    linkedAt: "2026-11-08T10:00:00.000Z",
  };

  assert.deepEqual(await tools.repo_link(args), expected);
  // Linking again answers the same link, with the first linker kept.
  assert.deepEqual(
    await tools.repo_link({ ...args, onBehalfOf: "usr_01ABCDEFGHJKMNPQRSTVWXYZ9" }),
    expected,
  );
  await assert.rejects(tools.repo_link({ ...args, project: "prj_nope" }), /no project prj_nope/);
  await assert.rejects(
    tools.repo_link({ ...args, repo: "figentra/jute" }),
    /figentra\/jute does not exist/,
  );
  await assert.rejects(
    tools.repo_link({ ...args, repo: "velora" }),
    /repo velora is not owner\/name/,
  );
  await assert.rejects(
    tools.repo_link({ ...args, onBehalfOf: "svc_01ABCDEFGHJKMNPQRSTVWXYZ0" }),
    /not a person's public id/,
  );
});
