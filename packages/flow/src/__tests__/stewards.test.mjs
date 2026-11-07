/**
 * Figentra Flow file contract:
 * Purpose: hold STA-1856 to its contract:
 *   - the owner-only list takes each category in any letter case and leaves ordinary code alone;
 *   - a package.json's root scripts and a dependency moved off its catalog are findings;
 *   - CODEOWNERS maps every owner-only glob to the owner, with no catch-all;
 *   - the rendered workflow runs the pinned check in its environment with the approver's own secret names, and holds
 *     no value; it carries `approve.tolerate` (empty by default) and refuses one naming `Baseline` or `fflow/gate`;
 *   - `sync` renders each preset's stewards (neutral: git, ci, tracker; stackra: git, ci, linear), CODEOWNERS only
 *     with an owner, and refuses a secret name that is not one;
 *   - the gate status's trusted source is the gate App's login as a string, or with its aliases (a rename, ADR 0523)
 *     the list of logins;
 *   - a repository override wins.
 * Boundary: temporary folders; no network, no GitHub.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1856.
 */
// @covers sta-1856:FR-1 sta-1856:FR-4 sta-1856:FR-5 sta-1856:FR-6 sta-1856:FR-7 sta-1945:FR-22
// @covers sta-1856:AC-002 sta-1856:AC-011 sta-1856:AC-012 sta-1856:AC-013 sta-1856:P-001 sta-1856:P-005
// @covers sta-1942:AC-009 sta-1942:P-004
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sync } from "../commands/sync.mjs";
import { approveWorkflow } from "../lib/approve-workflow.mjs";
import { codeowners, OWNER_ONLY, ownerOnlyPaths, packageFindings } from "../lib/owner-only.mjs";
import { approveSecrets, lockedIntegrity } from "../lib/render.mjs";

const OWNER = [
  ".github/workflows/ci.yml",
  ".GitHub/Workflows/CI.yml",
  ".github/actions/setup/action.yml",
  "tools/ship/action.yaml",
  "workers/static/wrangler.jsonc",
  "apps/mobile/eas.json",
  ".changeset/config.json",
  ".github/rulesets/main.json",
  ".github/CODEOWNERS",
  "pnpm-workspace.yaml",
  "packages/x/.npmrc",
  "flow.config.json",
  "presets/ours/third-party.yml",
  ".agents/hooks/_rules.mjs",
  ".claude/settings.json",
  "services/a/.env.example",
  "certs/signing.p12",
  "apps/console/src/Billing/plan.ts",
  "docs/legal/terms.md",
  "LICENSE",
  "packages/ui/LICENSE.md",
  ".github/NOTICE",
];
const ORDINARY = [
  "packages/ui/src/button.tsx",
  ".agents/agents/git-steward.md",
  "package.json",
  ".github/pull_request_template.md",
  "src/lib/billing-notes.mjs",
];

test("owner-only: every category in any case is the owner's, ordinary code is not, and a repository adds its own", () => {
  assert.deepEqual(ownerOnlyPaths([...OWNER, ...ORDINARY]), OWNER);
  assert.deepEqual(ownerOnlyPaths(["scripts/deploy.sh"], ["scripts/deploy*"]), [
    "scripts/deploy.sh",
  ]);
});

test("owner-only: the root scripts and a dependency moved off its catalog are findings; other changes are not", () => {
  const before = JSON.stringify({
    scripts: { build: "x" },
    dependencies: { a: "catalog:", b: "workspace:*" },
  });
  assert.deepEqual(packageFindings("package.json", before, before), []);
  assert.deepEqual(
    packageFindings(
      "package.json",
      before,
      JSON.stringify({ scripts: { build: "y" }, dependencies: { a: "catalog:" } }),
    ),
    ["package.json: the root scripts changed"],
  );
  assert.deepEqual(
    packageFindings(
      "packages/x/package.json",
      before,
      JSON.stringify({ scripts: {}, dependencies: { a: "1.2.3" } }),
    ),
    ['packages/x/package.json: a moved off its catalog to "1.2.3" (dependencies)'],
  );
  // Moved to another section, still a swap.
  assert.deepEqual(
    packageFindings(
      "packages/x/package.json",
      before,
      JSON.stringify({ devDependencies: { a: "^1.0.0" } }),
    ),
    ['packages/x/package.json: a moved off its catalog to "^1.0.0" (devDependencies)'],
  );
  // The root's version pickers are the owner's, like its scripts.
  assert.deepEqual(
    packageFindings(
      "package.json",
      before,
      JSON.stringify({
        scripts: { build: "x" },
        dependencies: { a: "catalog:", b: "workspace:*" },
        pnpm: { overrides: { a: "1.0.0" } },
        packageManager: "pnpm@1.0.0",
      }),
    ),
    ["package.json: the root pnpm changed", "package.json: the root packageManager changed"],
  );
  assert.deepEqual(packageFindings("packages/x/package.json", undefined, before), []);
  assert.deepEqual(packageFindings("package.json", before, "{"), [
    "package.json is not valid JSON",
  ]);
});

test("CODEOWNERS: every owner-only glob to the owner, anchored at the root unless it matches at any depth; no catch-all", () => {
  const text = codeowners("figentra-usr", ["deploy/**"]);
  const lines = text.split("\n").filter((l) => l && !l.startsWith("#"));
  assert.equal(lines.length, OWNER_ONLY.length + 2);
  assert.ok(
    lines.includes("/package.json @figentra-usr"),
    "GitHub cannot see which fields changed",
  );
  assert.match(text, /case-sensitively/);
  assert.ok(lines.includes("/.github/workflows/** @figentra-usr"));
  assert.ok(lines.includes("**/.npmrc @figentra-usr"));
  assert.ok(lines.includes("/deploy/** @figentra-usr"));
  assert.equal(
    lines.some((l) => l.startsWith("* ")),
    false,
  );
});

test("approval workflow: the pinned check, in its environment, with the approver's secret names and no value", () => {
  const text = approveWorkflow({
    version: "9.9.9",
    integrity: "sha512-AbC+/9==",
    appId: "A_ID",
    privateKey: "A_KEY",
    trusted: { "fflow/gate": "figentra-gate[bot]" },
    ownerOnly: ["it's/**"],
  });
  assert.match(text, /^ {4}environment: fflow-approve$/m);
  assert.match(text, /app-id: \$\{\{ secrets\.A_ID \}\}/);
  assert.match(text, /private-key: \$\{\{ secrets\.A_KEY \}\}/);
  assert.match(text, /permission-pull-requests: write/);
  assert.match(text, /@figentra-oss\/flow@9\.9\.9/);
  assert.match(text, /node flow\/package\/src\/lib\/approve-check\.mjs/);
  // The tarball is checked against the lockfile's integrity before anything in it runs.
  assert.match(text, /INTEGRITY: 'sha512-AbC\+\/9=='/);
  assert.match(text, /npm pack --silent .*@figentra-oss\/flow@9\.9\.9/);
  assert.match(text, /\[ "\$got" = "\$INTEGRITY" \] \|\| \{/);
  assert.ok(text.indexOf('"$INTEGRITY" ]') < text.indexOf("node flow/"));
  assert.doesNotMatch(text, /npm install/);
  assert.throws(
    () => approveWorkflow({ version: "1", integrity: "sha1-x", appId: "A", privateKey: "B" }),
    /not a sha512 integrity/,
  );
  assert.match(text, /TRUSTED: '\{"fflow\/gate":"figentra-gate\[bot\]"\}'/);
  assert.match(text, /OWNER_ONLY_EXTRA: '\["it''s\/\*\*"\]'/);
  // STA-1945 FR-22: a red main excuses nothing unless `approve.tolerate` lists the check.
  assert.match(text, /^ {10}TOLERATE: '\[\]'$/m);
  assert.match(
    approveWorkflow({ version: "1", appId: "A", privateKey: "B", tolerate: ["lint", "it's"] }),
    /^ {10}TOLERATE: '\["lint","it''s"\]'$/m,
  );
  for (const never of ["Baseline", "fflow/gate"])
    assert.throws(
      () => approveWorkflow({ version: "1", appId: "A", privateKey: "B", tolerate: [never] }),
      new RegExp(`approve\\.tolerate lists ${never}, which a red main never excuses`),
    );
  assert.doesNotMatch(text, /actions\/checkout|pull_request_target|--admin/);
  assert.doesNotMatch(
    text,
    /^\s+sha:/m,
    "the dispatch input is `head`: a `sha` field reads as a deploy",
  );
});

test("sync renders each preset's stewards, the workflow with the approver's names, and CODEOWNERS only with an owner", (t) => {
  /** @type {[string, string[], string | undefined][]} */
  const presets = [
    ["neutral", ["ci-steward", "git-steward", "tracker-steward"], undefined],
    ["stackra", ["ci-steward", "git-steward", "linear-steward"], "figentra-usr"],
  ];
  for (const [preset, ids, owner] of presets) {
    const root = mkdtempSync(join(tmpdir(), `flow-stewards-${preset}-`));
    t.after(() => rmSync(root, { recursive: true }));
    writeFileSync(
      join(root, "flow.config.json"),
      JSON.stringify({ version: 1, preset, ...(owner ? { apps: { owner } } : {}) }),
    );
    const { files } = sync(root, { direct: true, log: () => {} });
    const agents = files.filter((f) => f.startsWith(".claude/agents/"));
    // The stackra preset also carries core's role agents (STA-1945, preset-content.test.mjs); neutral only its stewards.
    if (preset === "neutral")
      assert.deepEqual(
        agents,
        ids.map((id) => `.claude/agents/${id}.md`),
      );
    for (const id of ids) assert.ok(agents.includes(`.claude/agents/${id}.md`), id);
    for (const id of ids)
      assert.match(
        readFileSync(join(root, `.claude/agents/${id}.md`), "utf8"),
        new RegExp(`^name: ${id}$`, "m"),
      );
    assert.equal(approveSecrets(root).appId, "FFLOW_APPROVER_APP_ID");
    // No owner, no approval path: neither the workflow nor CODEOWNERS.
    const workflow = join(root, ".github/workflows/fflow-approve.yml");
    assert.equal(existsSync(workflow), Boolean(owner));
    assert.equal(existsSync(join(root, ".github/CODEOWNERS")), Boolean(owner));
    if (owner) assert.match(readFileSync(workflow, "utf8"), /secrets\.FFLOW_APPROVER_APP_ID /);
    if (owner) assert.match(readFileSync(workflow, "utf8"), /^ {10}TOLERATE: '\[\]'$/m);
  }
});

test("sync renders the config's approve.tolerate into the workflow", (t) => {
  const root = mkdtempSync(join(tmpdir(), "flow-tolerate-"));
  t.after(() => rmSync(root, { recursive: true }));
  writeFileSync(
    join(root, "flow.config.json"),
    JSON.stringify({
      version: 1,
      preset: "stackra",
      apps: { owner: "figentra-usr" },
      approve: { tolerate: ["lint"] },
    }),
  );
  sync(root, { direct: true, log: () => {} });
  assert.match(
    readFileSync(join(root, ".github/workflows/fflow-approve.yml"), "utf8"),
    /^ {10}TOLERATE: '\["lint"\]'$/m,
  );
});

test("sync trusts the gate status from the gate App's login, or from each of its logins after a rename", (t) => {
  /** @type {[object, string][]} the gate block and the TRUSTED value it renders */
  const cases = [
    [{ login: "figentra-gate[bot]" }, `'{"fflow/gate":"figentra-gate[bot]"}'`],
    [
      { login: "figentra-gate[bot]", aliases: ["figentra-flow[bot]"] },
      `'{"fflow/gate":["figentra-gate[bot]","figentra-flow[bot]"]}'`,
    ],
  ];
  for (const [gate, trusted] of cases) {
    const root = mkdtempSync(join(tmpdir(), "flow-trusted-"));
    t.after(() => rmSync(root, { recursive: true }));
    writeFileSync(
      join(root, "flow.config.json"),
      JSON.stringify({ version: 1, preset: "neutral", apps: { gate, owner: "figentra-usr" } }),
    );
    sync(root, { direct: true, log: () => {} });
    const text = readFileSync(join(root, ".github/workflows/fflow-approve.yml"), "utf8");
    assert.ok(text.includes(`          TRUSTED: ${trusted}\n`), JSON.stringify(gate));
  }
});

test("sync refuses a preset whose approval secret name is not a secret name", (t) => {
  const root = mkdtempSync(join(tmpdir(), "flow-secret-name-"));
  t.after(() => rmSync(root, { recursive: true }));
  mkdirSync(join(root, "presets/ours"), { recursive: true });
  writeFileSync(
    join(root, "presets/ours/preset.yml"),
    'preset:\n  id: "ours"\napprove:\n  app_id: "bad name"\n',
  );
  writeFileSync(
    join(root, "flow.config.json"),
    JSON.stringify({ version: 1, preset: "presets/ours" }),
  );
  assert.throws(() => approveSecrets(root), /approve names "bad name", not a secret name/);
});

test("a repository's own agent overrides the preset's", (t) => {
  const root = mkdtempSync(join(tmpdir(), "flow-agent-override-"));
  t.after(() => rmSync(root, { recursive: true }));
  mkdirSync(join(root, ".flow/overrides/agents"), { recursive: true });
  writeFileSync(
    join(root, ".flow/overrides/agents/git-steward.md"),
    "---\nname: git-steward\n---\n\nOurs.\n",
  );
  sync(root, { log: () => {} });
  assert.match(readFileSync(join(root, ".agents/agents/git-steward.md"), "utf8"), /Ours\./);
});

test("lockfile integrity: from pnpm-lock.yaml, else package-lock.json, else none", (t) => {
  const root = mkdtempSync(join(tmpdir(), "flow-integrity-"));
  t.after(() => rmSync(root, { recursive: true }));
  assert.equal(lockedIntegrity(root, "@figentra-oss/flow", "1.2.3"), "");
  writeFileSync(
    join(root, "package-lock.json"),
    JSON.stringify({
      packages: {
        "node_modules/@figentra-oss/flow": { version: "1.2.3", integrity: "sha512-npm==" },
      },
    }),
  );
  assert.equal(lockedIntegrity(root, "@figentra-oss/flow", "1.2.3"), "sha512-npm==");
  writeFileSync(
    join(root, "pnpm-lock.yaml"),
    "packages:\n\n  '@figentra-oss/flow@1.2.3':\n    resolution: {integrity: sha512-pnpm+/==}\n    engines: {node: '>=24'}\n",
  );
  assert.equal(lockedIntegrity(root, "@figentra-oss/flow", "1.2.3"), "sha512-pnpm+/==");
  assert.equal(lockedIntegrity(root, "@figentra-oss/flow", "1.2.4"), "");
});
