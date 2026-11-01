/**
 * Figentra Flow file contract:
 * Purpose: hold STA-1856 to its contract: the owner-only list takes each category and leaves ordinary code; the
 *   workflow's pattern agrees with it; the rendered approval workflow is pinned to the environment, names the preset's
 *   secret names and no value, and approves only at the checked head; `sync` renders each preset's stewards (neutral:
 *   git, ci, tracker; stackra: git, ci, linear) and a repository override wins.
 * Boundary: temporary folders; no network, no GitHub.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1856.
 */
// @covers sta-1856:FR-1 sta-1856:FR-4 sta-1856:FR-5 sta-1856:FR-6
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sync } from "../commands/sync.mjs";
import { approveWorkflow } from "../lib/approve-workflow.mjs";
import { ownerOnlyPaths, ownerOnlyPattern } from "../lib/owner-only.mjs";
import { approveSecrets } from "../lib/render.mjs";

const OWNER = [
  ".github/workflows/ci.yml",
  ".github/actions/setup/action.yml",
  ".github/rulesets/main.json",
  ".github/CODEOWNERS",
  "pnpm-workspace.yaml",
  "figentra-flow.config.json",
  ".agents/hooks/_rules.mjs",
  ".claude/settings.json",
  "services/a/.env.example",
  "certs/signing.p12",
  "apps/console/src/billing/plan.ts",
  "docs/legal/terms.md",
  "LICENSE",
  ".github/NOTICE",
];
const ORDINARY = [
  "packages/ui/src/button.tsx",
  "packages/ui/LICENSE",
  ".agents/agents/git-steward.md",
  "package.json",
  ".github/pull_request_template.md",
  "src/lib/billing-notes.mjs",
];

test("owner-only: every category is the owner's, ordinary code is not, and the workflow's pattern agrees", () => {
  assert.deepEqual(ownerOnlyPaths([...OWNER, ...ORDINARY]), OWNER);
  const re = new RegExp(ownerOnlyPattern());
  assert.deepEqual(
    OWNER.filter((p) => !re.test(p)),
    [],
  );
  assert.deepEqual(
    ORDINARY.filter((p) => re.test(p)),
    [],
  );
});

test("approval workflow: environment-scoped secrets by name, pinned head, no checkout, the owner-only pattern", () => {
  const text = approveWorkflow({ appId: "A_ID", privateKey: "A_KEY" });
  assert.match(text, /^ {4}environment: figentra-flow-approve$/m);
  assert.match(text, /app-id: \$\{\{ secrets\.A_ID \}\}/);
  assert.match(text, /private-key: \$\{\{ secrets\.A_KEY \}\}/);
  assert.match(text, /permission-pull-requests: write/);
  assert.match(text, /-f commit_id="\$sha" -f event=APPROVE/);
  assert.match(text, /\[ "\$sha" = "\$EXPECTED_HEAD" \]/);
  assert.ok(text.includes(`OWNER_ONLY: '${ownerOnlyPattern()}'`));
  assert.doesNotMatch(text, /actions\/checkout|pull_request_target|--admin/);
  assert.doesNotMatch(
    text,
    /^\s+sha:/m,
    "the dispatch input is `head`: a `sha` field reads as a deploy",
  );
});

test("sync renders each preset's stewards and the approval workflow with its secret names", (t) => {
  /** @type {[string, string[], string][]} */
  const presets = [
    ["neutral", ["ci-steward", "git-steward", "tracker-steward"], "FIGENTRA_FLOW_APPROVE_APP_ID"],
    ["stackra", ["ci-steward", "git-steward", "linear-steward"], "STACKRA_BOT_APP_ID"],
  ];
  for (const [preset, ids, appId] of presets) {
    const root = mkdtempSync(join(tmpdir(), `flow-stewards-${preset}-`));
    t.after(() => rmSync(root, { recursive: true }));
    writeFileSync(join(root, "figentra-flow.config.json"), JSON.stringify({ version: 1, preset }));
    const { files } = sync(root, { direct: true, log: () => {} });
    assert.deepEqual(
      files.filter((f) => f.startsWith(".claude/agents/")),
      ids.map((id) => `.claude/agents/${id}.md`),
    );
    for (const id of ids)
      assert.match(
        readFileSync(join(root, `.claude/agents/${id}.md`), "utf8"),
        new RegExp(`^name: ${id}$`, "m"),
      );
    assert.equal(approveSecrets(root).appId, appId);
    assert.match(
      readFileSync(join(root, ".github/workflows/figentra-flow-approve.yml"), "utf8"),
      new RegExp(`secrets\\.${appId} `),
    );
  }
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
