/**
 * Figentra Flow file contract:
 * Purpose: hold the stage gates (state machine, plan, tasks, lane, branch, bug lane, install check), the v2 templates
 *   and the Linear task parser to their contract (moved from core's spec-gate tests; core keeps its wiring).
 * Boundary: pure functions plus one dry-run child process; no network, no repository writes; node:test and node:assert.
 * Runtime: node
 * Governing contract: ADR 0022 (tests live in tests folders); ADR 0182 (testing strategy).
 */
// @covers sta-1729:AC-028 sta-163:FR-001 sta-163:FR-002 sta-163:FR-003 sta-163:FR-004 sta-163:FR-005 sta-163:FR-008
// @covers sta-163:P-001 sta-163:P-002 sta-163:P-003 sta-163:P-005 sta-163:P-006 sta-163:P-007
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  approvedAt,
  checkApproval,
  checkCriteria,
  checkDesign,
  checkTraceTasks,
  DESIGN_SECTIONS,
  checkBranch,
  checkBug,
  checkForeignStatus,
  checkLane,
  checkSpec,
  checkStage,
  checkTasks,
  checkTier,
  computedTier,
  isOwnSpec,
  refsKeys,
  specDir,
  tierOf,
} from "../commands/gate.mjs";
import { keyScheme } from "../adapters/tracker/index.mjs";
import { labelsFor, specLinks, unlinkedTasks } from "../commands/linear.mjs";
import { init } from "../commands/init.mjs";
import { FLOW_ASSETS } from "../lib/flow-dir.mjs";
import { installProblems } from "../lib/render.mjs";
import { CONFIG_FILE } from "../lib/product.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, "../../bin/fflow.mjs");
const impact = (v = "none") =>
  [
    "Apps touched",
    "Services touched",
    "Packages touched",
    "Cross-service events",
    "Tenancy and data",
    "Secrets",
    "ADR needed",
    "New dependencies",
    "Deploy modes",
    "Licence tier",
    "Docs to update",
    "Lane",
    "Change risk",
  ]
    .map((f) => `- **${f}**: ${v}`)
    .join("\n");
const spec = ({ status = "complete", linear = "STA-12", body = impact(), stage = "Draft" } = {}) =>
  `# Feature Specification: X\n\n**Status**: ${stage}\n\n**Linear**: ${linear}\n\n**Clarifications status**: ${status}\n\n## Impact\n\n${body}\n\n## Requirements\n\n## Status history\n\n- d · Draft → ${stage}\n`;

// The fixture is a Done spec with plan and tasks; each test breaks one thing and expects one precise message.
const FIX = join(HERE, "__fixtures__/sdd/sta-901-widget");
const fixture = (name) => readFileSync(join(FIX, name), "utf8");
const known = new Set(["tests", "spec-task"]);
const stageOf = (text, over = {}) =>
  checkStage("sta-901-widget", text, {
    files: ["spec.md", "plan.md", "tasks.md"],
    plan: fixture("plan.md"),
    tasks: fixture("tasks.md"),
    known,
    ...over,
  });
const at = (status) =>
  fixture("spec.md")
    .replace("**Status**: Done", `**Status**: ${status}`)
    .replaceAll(/- 2026-10-20 · .*→ (?!Draft|Clarified).*\n/g, (l) =>
      l.includes(`→ ${status}`) ? l : "",
    );

test("a Draft spec passes with open questions; later stages need their rules and artifacts", () => {
  const draft = spec({ status: "pending", linear: "STA-n", body: impact("[open]") });
  assert.deepEqual(checkStage("sta-12-x", draft), []);
  assert.match(checkStage("001-x", draft)[0], /<key>-<slug>/);
  assert.match(checkStage("sta-12-x", spec({ linear: "STA-13" })).join(), /does not match/);
  assert.match(checkStage("sta-12-x", spec({ stage: "Bogus" }))[0], /Status/);
  assert.match(checkStage("sta-12-x", spec({ stage: "Ready" }))[0], /Status/);
  assert.match(
    checkStage("sta-12-x", spec({ status: "pending", stage: "Clarified" })).join(),
    /Clarifications/,
  );
  assert.deepEqual(checkStage("sta-12-x", spec({ stage: "Clarified" })), []);
  assert.match(
    checkStage("sta-12-x", spec({ stage: "Clarified" }).replace("Draft → Clarified", "x")).join(),
    /Status history.*Clarified/,
  );
  assert.match(checkStage("sta-12-x", spec({ stage: "Planned" })).join(), /needs plan\.md/);
  assert.deepEqual(checkStage("sta-12-x", spec({ stage: "Abandoned", status: "pending" })), []);
});

test("the fixture passes at every stage from Clarified to Done", () => {
  for (const s of ["Clarified", "Planned", "Tasked", "Implementing", "Done"])
    assert.deepEqual(stageOf(at(s)), [], s);
});

test("Planned: constitution rows, deploy modes and FR validation", () => {
  const planned = at("Planned");
  const plan = fixture("plan.md");
  assert.match(
    stageOf(planned, { plan: plan.replace("| PASS   |", "| TODO   |") }).join(),
    /Constitution Check `Boundaries` is `TODO`/,
  );
  assert.match(
    stageOf(planned, { plan: plan.replace("no tenant data", "") }).join(),
    /`Tenancy` is N\/A without a reason/,
  );
  assert.match(
    stageOf(planned, { plan: plan.replace(/^\| Air-gapped.*\n/m, "") }).join(),
    /`air-gapped` row/,
  );
  assert.match(
    stageOf(planned, { plan: plan.replace("FR-001, FR-002", "FR-001") }).join(),
    /FR-002 is validated by no P-###/,
  );
  const exampleOnly = planned.replace("SHALL refuse it.", "SHALL refuse it. (example-only)");
  assert.deepEqual(stageOf(exampleOnly, { plan: plan.replace("FR-001, FR-002", "FR-001") }), []);
});

test("Tasked: the tasks lint names the line and the problem", () => {
  const tasks = fixture("tasks.md");
  const lint = (t) => checkTasks(t, { spec: fixture("spec.md"), plan: fixture("plan.md"), known });
  assert.deepEqual(lint(tasks), []);
  assert.match(lint(tasks.replace("T002 [P]", "T001 [P]")).join(), /T001 repeats line/);
  assert.match(lint(tasks.replace("covers: FR-002 ", "")).join(), /T002 has no `covers:`/);
  assert.match(
    lint(tasks.replace("covers: FR-002", "covers: FR-009")).join(),
    /covers FR-009, which/,
  );
  assert.match(
    lint(tasks.replace("route: tests", "route: nope")).join(),
    /route `nope` is not a task type/,
  );
  assert.match(
    lint(tasks.replace("deps: T001", "deps: T042")).join(),
    /depends on T042, which does not exist/,
  );
  assert.match(
    lint(tasks.replace("route: tests", "route: tests — deps: T002")).join(),
    /dependency cycle/,
  );
  assert.match(
    lint(tasks.replace("covers: FR-002", "covers: SC-001")).join(),
    /FR-002 is covered by no task/,
  );
  assert.match(
    lint(tasks.replace("src/build.ts", "src/__tests__/build.test.ts")).join(),
    /\[P\] tasks T001 and T002 share/,
  );
  assert.match(stageOf(at("Tasked"), { files: ["spec.md", "plan.md"] }).join(), /needs tasks\.md/);
});

test("Implementing needs a ticked task; Done needs them all", () => {
  const none = fixture("tasks.md").replaceAll("- [x]", "- [ ]");
  assert.match(stageOf(at("Implementing"), { tasks: none }).join(), /no task is ticked/);
  const one = fixture("tasks.md").replace("- [x] T002", "- [ ] T002");
  assert.deepEqual(stageOf(at("Implementing"), { tasks: one }), []);
  assert.match(stageOf(at("Done"), { tasks: one }).join(), /T002 are unticked/);
});

// @covers sta-1945:FR-25 sta-1945:AC-27 sta-1945:P-030
test("optional and checkpoint tasks: the lint accepts them, Done skips an open optional task", () => {
  const extra = (optional, checkpoint) =>
    `${fixture("tasks.md")}- [${optional}] T004* Polish in \`packages/foundation/widget/README.md\` — covers: FR-001 — route: spec-task\n- [${checkpoint}] T005 Checkpoint: \`pnpm verify\` [STA-904]\n`;
  const lint = (t) => checkTasks(t, { spec: fixture("spec.md"), plan: fixture("plan.md"), known });
  assert.deepEqual(lint(extra(" ", " ")), []);
  assert.deepEqual(stageOf(at("Done"), { tasks: extra(" ", "x") }), []);
  assert.match(stageOf(at("Done"), { tasks: extra(" ", " ") }).join(), /T005 are unticked/);
  // queued and in progress are not done
  assert.match(stageOf(at("Done"), { tasks: extra("x", "-") }).join(), /T005 are unticked/);
  assert.match(stageOf(at("Done"), { tasks: extra("x", "~") }).join(), /T005 are unticked/);
  const early = fixture("tasks.md").replace(
    "- [x] T001",
    "- [x] T009 Checkpoint: pnpm test\n- [x] T001",
  );
  assert.match(lint(early).join(), /T009 is a checkpoint, but T001 follows it in its phase/);
  assert.match(
    lint(`${fixture("tasks.md")}- [ ] T005* Checkpoint: pnpm verify\n`).join(),
    /T005 is a checkpoint, which cannot be optional/,
  );
  assert.match(
    lint(`${fixture("tasks.md")}- [ ] T005 Checkpoint:\n`).join(),
    /T005 is a checkpoint with no command/,
  );
  assert.match(
    lint(
      `${fixture("tasks.md")}- [ ] T005 Checkpoint: pnpm verify — covers: FR-001 — route: tests\n`,
    ).join(),
    /T005 is a checkpoint, which covers nothing and names no route or role/,
  );
  // a tiered spec's tasks: a checkpoint needs no acceptance criterion and no file
  assert.deepEqual(
    checkTraceTasks(
      "- [ ] T001 Do in `a.mjs` — covers: AC-001\n- [ ] T002 Checkpoint: `pnpm verify`\n",
      "- **AC-001**: WHEN x THE y SHALL z.\n",
      "tasks.md",
    ),
    [],
  );
});

test("lane: feat commits need a spec through the branch or Refs keys", () => {
  const specKeys = new Set(["sta-163"]);
  const taskKeys = new Set(["sta-170"]);
  const feat = "feat(x): y\n\nRefs: STA-5";
  assert.deepEqual(checkLane({ commits: ["chore: x"], branch: "figentra/sta-5-x" }), []);
  assert.match(
    checkLane({ commits: [feat], branch: "figentra/sta-5-x", specKeys, taskKeys }).join(),
    /feat commit\(s\).*STA-5/,
  );
  assert.deepEqual(checkLane({ commits: [feat], branch: "figentra/sta-163-x", specKeys }), []);
  assert.deepEqual(checkLane({ commits: ["feat: y\n\nRefs: STA-170"], taskKeys }), []);
});

test("branch: the tracker's shape or allow-listed", () => {
  assert.deepEqual(checkBranch("figentra/sta-163-sdd-gates"), []);
  assert.deepEqual(checkBranch("renovate/node-24"), []);
  assert.deepEqual(checkBranch("changeset-release/main"), []);
  assert.deepEqual(checkBranch("delegate/sta-163-t1"), []);
  assert.match(
    checkBranch("spec/notifications").join(),
    /not `figentra\|delegate\/sta-<n>-<slug>`/,
  );
  assert.match(checkBranch("chore/foo").join(), /not `figentra\|delegate\/sta-<n>-<slug>`/);
});

test("ready rule: only the PR's own spec (the branch key's folder) must be at Tasked", () => {
  assert.equal(isOwnSpec("sta-163-sdd-gates", "figentra/sta-163-x"), true);
  assert.equal(isOwnSpec("sta-35-notifications", "figentra/sta-163-x"), false);
  assert.equal(isOwnSpec("sta-16-x", "figentra/sta-163-x"), false);
  assert.equal(isOwnSpec("sta-35-notifications", "chore/foo"), false);
});

const statusSpec = (s) => `# X\n\n**Status**: ${s}\n**Linear**: STA-35\n`;
test("foreign status: another spec's Status line moves only with a Refs naming its key", () => {
  const base = {
    folder: "sta-35-notifications",
    before: statusSpec("Draft"),
    branch: "figentra/sta-170-x",
  };
  assert.deepEqual(
    checkForeignStatus({ ...base, after: statusSpec("Draft"), commits: ["fix: y"] }),
    [],
  );
  assert.match(
    checkForeignStatus({
      ...base,
      after: statusSpec("Clarified"),
      commits: ["fix: y\n\nRefs: STA-170"],
    }).join(),
    /sta-35-notifications: .*Draft.*Clarified.*Refs: STA-35`/,
  );
  assert.deepEqual(
    checkForeignStatus({
      ...base,
      after: statusSpec("Clarified"),
      commits: ["docs: y\n\nRefs: STA-170, STA-35"],
    }),
    [],
  );
  // A key in the subject or body, not on a Refs: trailer, does not count; STA-350 is not STA-35.
  assert.equal(
    checkForeignStatus({
      ...base,
      after: statusSpec("Clarified"),
      commits: ["docs: STA-35\n\nRefs: STA-350"],
    }).length,
    1,
  );
  // The PR's own spec and a newly added spec are exempt.
  assert.deepEqual(
    checkForeignStatus({ ...base, branch: "figentra/sta-35-x", after: statusSpec("Planned") }),
    [],
  );
  assert.deepEqual(checkForeignStatus({ ...base, before: "", after: statusSpec("Draft") }), []);
  // Removing the line is a change too.
  assert.equal(checkForeignStatus({ ...base, after: "# X\n" }).length, 1);
  assert.deepEqual(
    [...refsKeys(["feat: a\n\nRefs: STA-1, sta-2", "fix: STA-3"])],
    ["sta-1", "sta-2"],
  );
});

test("branch never blocks: a chore-lane PR's `chore/foo` branch only warns (check-pr owns the label escape)", () => {
  const env = { ...process.env, STACKRA_BRANCH: "chore/foo" };
  const r = spawnSync(process.execPath, [BIN, "gate", "branch"], {
    encoding: "utf8",
    env,
  });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /warning: branch `chore\/foo`.*chore-lane/);
  const ok = spawnSync(process.execPath, [BIN, "gate", "branch"], {
    encoding: "utf8",
    env: { ...env, STACKRA_BRANCH: "figentra/sta-163-x" },
  });
  assert.equal(ok.status, 0);
  assert.equal(ok.stderr, "");
});

test("bug lane: the folder is keyed and a regression test covers sta-n:BUG", () => {
  assert.deepEqual(checkBug("sta-44-crash", "/** @covers sta-44:BUG */"), []);
  assert.match(checkBug("sta-44-crash", "nothing").join(), /@covers sta-44:BUG/);
  assert.match(checkBug("44-crash", "").join(), /not `<key>-<slug>`/);
});

test("specDir names the folder from the branch key, reuses an existing one, and refuses without a key", () => {
  const root = mkdtempSync(join(tmpdir(), "spec-dir-"));
  try {
    assert.deepEqual(specDir({ root, branch: "figentra/sta-7-foo", slug: "foo" }), {
      dir: ".agents/specs/sta-7-foo",
    });
    assert.match(specDir({ root, branch: "figentra/sta-7-foo" }).error, /--slug/);
    assert.match(specDir({ root, branch: "main", slug: "foo" }).error, /no issue key/);
    mkdirSync(join(root, ".agents/specs/sta-7-bar"), { recursive: true });
    assert.deepEqual(specDir({ root, key: "STA-7" }), { dir: ".agents/specs/sta-7-bar" });
    assert.deepEqual(specDir({ root, branch: "delegate/sta-7-t1" }), {
      dir: ".agents/specs/sta-7-bar",
    });
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("another tracker's scheme: keys, branches, folders, lanes, bugs and specDir follow it (AC-037)", () => {
  const ops = keyScheme({
    kind: "linear",
    team: "OPS",
    branchPrefix: "acme",
    otherBranchPrefixes: ["bot"],
  });
  assert.deepEqual(checkBranch("acme/ops-4-fix", ops), []);
  assert.deepEqual(checkBranch("bot/ops-4-fix", ops), []);
  assert.match(checkBranch("figentra/sta-4-fix", ops).join(), /not `acme\|bot\/ops-<n>-<slug>`/);
  assert.equal(isOwnSpec("ops-4-fix", "acme/ops-4-fix", ops), true);
  assert.equal(isOwnSpec("sta-4-fix", "figentra/sta-4-fix", ops), false);
  assert.deepEqual([...refsKeys(["fix: a\n\nRefs: OPS-9, STA-2"], ops)], ["ops-9"]);
  const feat = "feat: y\n\nRefs: OPS-9";
  assert.deepEqual(checkLane({ commits: [feat], specKeys: new Set(["ops-9"]), scheme: ops }), []);
  assert.match(
    checkLane({ commits: [feat], specKeys: new Set(["sta-9"]), scheme: ops }).join(),
    /OPS-9/,
  );
  assert.deepEqual(checkBug("ops-44-crash", "/** @covers ops-44:BUG */", ops), []);
  assert.match(checkBug("sta-44-crash", "", ops).join(), /not `<key>-<slug>`/);
  assert.match(
    checkStage("ops-12-x", "**Status**: Draft\n**Issue**: OPS-13\n", { keys: ops }).join(),
    /OPS-13 does not match the folder key OPS-12/,
  );
  assert.deepEqual(
    checkStage("ops-12-x", "**Status**: Draft\n**Issue**: OPS-12\n", { keys: ops }),
    [],
  );
  const gh = keyScheme({ kind: "github-issues", branchPrefix: "work" });
  const root = mkdtempSync(join(tmpdir(), "spec-dir-gh-"));
  try {
    assert.deepEqual(specDir({ root, branch: "work/gh-7-foo", slug: "foo", keys: gh }), {
      dir: ".agents/specs/gh-7-foo",
    });
    assert.deepEqual(specDir({ root, key: "#7", slug: "foo", keys: gh }), {
      dir: ".agents/specs/gh-7-foo",
    });
    assert.match(specDir({ root, branch: "figentra/sta-7-foo", keys: gh }).error, /no issue key/);
  } finally {
    rmSync(root, { recursive: true });
  }
});

// @covers sta-1729:FR-11
test("install check: a synced repository passes; a hand edit, a stale lock, a missing file and spec-kit leftovers fail (ADR 0510)", () => {
  const root = mkdtempSync(join(tmpdir(), "flow-install-"));
  try {
    assert.deepEqual(installProblems(root), [], "nothing to check before init");
    writeFileSync(join(root, CONFIG_FILE), JSON.stringify({ version: 1, preset: "stackra" }));
    assert.equal(init(root), true);
    assert.equal(init(root), false, "an existing .flow/ is refused");
    assert.ok(readFileSync(join(root, ".flow/constitution.md"), "utf8").length > 0);
    assert.equal(readFileSync(join(root, ".flow/.gitignore"), "utf8"), "current.json\n");
    assert.deepEqual(installProblems(root), []);
    const skill = join(root, ".claude/skills/flow-plan/SKILL.md");
    assert.match(readFileSync(skill, "utf8"), /^---\nname: flow-plan\n/);
    assert.match(readFileSync(skill, "utf8"), /generated-by: fflow/);
    assert.match(readFileSync(skill, "utf8"), /derived-from: github\/spec-kit 1\.0\.10 \(MIT\)/);
    writeFileSync(skill, "hand edit\n");
    assert.match(installProblems(root).join(), /flow-plan\/SKILL\.md differs from what/);
    assert.match(installProblems(root, "9.9.9").join(), /9\.9\.9 is installed/);
    rmSync(skill);
    assert.match(installProblems(root).join(), /flow-plan\/SKILL\.md is missing/);
    mkdirSync(join(root, ".specify"));
    mkdirSync(join(root, ".claude/skills/speckit-plan"), { recursive: true });
    const found = installProblems(root).join("\n");
    assert.match(found, /^\.specify is spec-kit's/m);
    assert.match(found, /^\.claude\/skills\/speckit-plan is spec-kit's/m);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("a clarified, linked, fully answered spec passes", () => {
  assert.deepEqual(checkSpec(spec()), []);
});

test("pending clarifications, a placeholder Linear key and open markers each block planning", () => {
  assert.match(checkSpec(spec({ status: "pending" }))[0], /Clarifications status/);
  assert.match(checkSpec(spec({ linear: "STA-n" }))[0], /Linear/);
  assert.match(checkSpec(`${spec()}[NEEDS CLARIFICATION: x]`).join(), /NEEDS CLARIFICATION/);
});

test("an unanswered or missing Impact line blocks planning", () => {
  assert.match(checkSpec(spec({ body: impact("[apps]") })).join(), /unanswered/);
  assert.match(checkSpec(spec({ body: "- **Secrets**: none" })).join(), /Apps touched.*missing/);
  assert.match(
    checkSpec("**Linear**: STA-1\n**Clarifications status**: complete\n").join(),
    /Impact/,
  );
});

test("HTML comments are ignored", () => {
  assert.match(checkSpec(spec({ status: "pending" }) + "<!-- complete -->").join(), /Clarif/);
});

test("spec-linear labels the issues an agent creates `agent`", () => {
  assert.deepEqual(labelsFor({ CLAUDECODE: "1" }), ["agent"]);
  assert.deepEqual(labelsFor({}), []);
});

test("spec-linear parses links and finds unlinked tasks", () => {
  assert.deepEqual(specLinks(`# Feature Specification: Foo\n**Linear**: STA-7\n`), {
    key: "STA-7",
    project: undefined,
    title: "Foo",
  });
  const tasks = unlinkedTasks(
    "- [ ] T001 One\n- [x] T002 Two [STA-9]\n- [ ] T003 [P] Three\n- [-] T004* Four\n- [~] T005 Five\nnote",
  );
  assert.deepEqual(
    tasks.map((t) => t.id),
    ["T001", "T003", "T004", "T005"],
  );
});

test("spec-gate plan exits 1 on a pending spec, and spec-linear --dry-run needs no token", () => {
  const dir = mkdtempSync(join(tmpdir(), "spec-gate-"));
  try {
    writeFileSync(join(dir, "spec.md"), spec({ status: "pending" }));
    writeFileSync(join(dir, "tasks.md"), "- [ ] T001 One\n");
    const gate = spawnSync(process.execPath, [BIN, "gate", "plan", join(dir, "spec.md")]);
    assert.equal(gate.status, 1);
    const env = { ...process.env, LINEAR_API_KEY: "" };
    const dry = spawnSync(
      process.execPath,
      [BIN, "linear", "tasks", join(dir, "tasks.md"), "--dry-run"],
      { encoding: "utf8", env },
    );
    assert.equal(dry.status, 0);
    assert.match(dry.stdout, /would create sub-issue of STA-12: T001 One/);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

const presetTemplate = (n) =>
  readFileSync(join(FLOW_ASSETS, "presets/stackra/templates", n), "utf8");

test("the v2 templates carry the state machine, Impact v2, Amendments, Status history and the task line format", () => {
  const specT = presetTemplate("spec-template.md");
  assert.match(specT, /Draft → Clarified → Planned → Tasked → Implementing → Done/);
  for (const h of [
    "## Impact",
    "## Amendments",
    "## Status history",
    "**Analyze**",
    "verified by:",
  ])
    assert.ok(specT.includes(h), h);
  for (const f of ["Licence tier", "Docs to update", "Lane", "Change risk"])
    assert.ok(specT.includes(`- **${f}**:`), f);
  assert.match(
    presetTemplate("plan-template.md"),
    /## Constitution Check[\s\S]*## Deploy modes[\s\S]*Validates: FR-001/,
  );
  assert.match(
    presetTemplate("tasks-template.md"),
    /— covers: FR-003, P-002 — route: spec-task — deps: T010/,
  );
});

// ADR 0502: tiers, the diff's floor and the approval stops (the same rules as core's @stackra/repo-checks).
const tiered = (status, tier, extra = "") =>
  `**Status**: ${status}\n\n**Tier**: ${tier}\n\n**Linear**: STA-901\n\n${extra}`;

test("tiers: the declared tier, the diff's floor and the tier rule", () => {
  assert.equal(tierOf("**Tier**: Big"), "big");
  assert.equal(tierOf("**Status**: Draft"), undefined);
  assert.equal(computedTier([{ status: "M", path: "packages/data/x/src/a.ts" }]).tier, "trivial");
  assert.equal(
    computedTier([
      { status: "A", path: "services/o/src/modules/o/database/migrations/0002-x.migration.ts" },
    ]).tier,
    "feature",
  );
  assert.equal(
    computedTier([{ status: "M", path: "services/o/src/modules/o/access/o.permissions.ts" }]).tier,
    "feature",
  );
  assert.equal(
    computedTier([{ status: "M", path: "packages/commerce/ledger/src/a.ts" }]).tier,
    "feature",
  );
  assert.equal(computedTier([{ status: "A", path: "services/pay/package.json" }]).tier, "big");
  assert.equal(
    computedTier([{ status: "M", path: "apps/docs/src/docs/payments.mdx" }]).tier,
    "trivial",
  );
  assert.deepEqual(checkTier({ declared: "feature", computed: "feature" }), []);
  assert.match(
    checkTier({ declared: "small", computed: "feature", reasons: ["a migration: m"] }).join(),
    /spec declares small/,
  );
  assert.match(checkTier({ computed: "big" }).join(), /branch has no spec \(trivial\)/);
});

test("approval stops: feature before Tasked, big before Planned and Tasked", () => {
  assert.deepEqual(approvedAt("**Status**: Planned — Approved by owner 2026-10-31", "planned"), {
    who: "owner",
    date: "2026-10-31",
  });
  const approver = "**Approver**: leader";
  const planned = `${approver}\n\n## Status history\n\n- 2026-10-31: Clarified → Planned — Approved by leader 2026-10-31\n`;
  assert.deepEqual(checkApproval(tiered("Planned", "feature", approver)), []);
  assert.match(checkApproval(tiered("Tasked", "feature", approver)).join(), /Planned approval/);
  assert.deepEqual(checkApproval(tiered("Tasked", "feature", planned)), []);
  assert.match(checkApproval(tiered("Planned", "big", approver)).join(), /Clarified approval/);
  assert.match(checkApproval(tiered("Planned", "feature")).join(), /Approver/);
  assert.deepEqual(checkApproval(tiered("Tasked", "small")), []);
});

// ADR 0502 decision 7: Kiro depth (EARS criteria, the nine design sections, tasks traced to criteria and files).
const CRITERIA =
  "## Acceptance criteria\n\n- **AC-001**: WHEN a pass is issued THE wallet SHALL show it\n";
const TASK = "- [ ] T001 Show the pass in `src/wallet.ts` — covers: AC-001 — route: spec-task";
const DESIGN = (level) =>
  `${level === "###" ? "## Design\n\n" : ""}${DESIGN_SECTIONS.map((n) => `${level} ${n}\n\nnone\n`).join("\n")}`;

test("criteria: EARS lines with AC ids", () => {
  assert.deepEqual(checkCriteria(CRITERIA), []);
  for (const ok of [
    "IF the card is declined THEN THE checkout SHALL show the reason",
    "WHILE the device is offline THE queue SHALL keep the call",
    "WHERE loyalty is enabled THE receipt SHALL show the points",
    "THE ledger SHALL never change a posted line",
  ])
    assert.deepEqual(checkCriteria(`## Acceptance criteria\n\n- **AC-001**: ${ok}\n`), []);
  assert.match(checkCriteria("## Impact\n").join(), /## Acceptance criteria/);
  assert.match(
    checkCriteria("## Acceptance criteria\n\n- **AC-001**: the wallet shows it\n").join(),
    /AC-001 is not EARS/,
  );
});

test("design: nine sections, each with something under it", () => {
  assert.deepEqual(checkDesign(DESIGN("##"), "plan.md", "##"), []);
  assert.deepEqual(checkDesign(DESIGN("##").replace("## Rollout\n\nnone\n", ""), "plan.md", "##"), [
    "plan.md: the design has no `## Rollout` section (ADR 0502)",
  ]);
  assert.match(
    checkDesign(
      DESIGN("##").replace("## Contracts\n\nnone\n", "## Contracts\n\n"),
      "plan.md",
      "##",
    ).join(),
    /`## Contracts` is empty/,
  );
});

test("trace: each task covers an AC and names a file; each AC is covered", () => {
  assert.deepEqual(checkTraceTasks(TASK, CRITERIA, "tasks.md"), []);
  assert.deepEqual(
    checkTraceTasks(
      "- [ ] T001 Write it — covers: FR-001 — route: spec-task",
      CRITERIA,
      "tasks.md",
    ),
    [
      "tasks.md:1: T001 covers no acceptance criterion (AC-###) of spec.md (ADR 0502)",
      "tasks.md:1: T001 names no file in backticks (ADR 0502)",
      "tasks.md: AC-001 is covered by no task",
    ],
  );
});
