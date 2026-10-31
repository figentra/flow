/**
 * Vellum file contract:
 * Purpose: hold the stage gates (state machine, plan, tasks, lane, branch, bug lane, tripwire), the v2 templates
 *   and the Linear task parser to their contract (moved from core's spec-gate tests; core keeps its wiring).
 * Boundary: pure functions plus one dry-run child process; no network, no repository writes; node:test and node:assert.
 * Runtime: node
 * Governing contract: ADR 0022 (tests live in tests folders); ADR 0182 (testing strategy).
 */
// @covers sta-163:FR-001 sta-163:FR-002 sta-163:FR-003 sta-163:FR-004 sta-163:FR-005 sta-163:FR-008
// @covers sta-163:P-001 sta-163:P-002 sta-163:P-003 sta-163:P-005 sta-163:P-006 sta-163:P-007
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  approvedAt,
  checkApproval,
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
  REPLACED,
  specDir,
  tierOf,
  tripwire,
  WRAPPED,
} from "../commands/gate.mjs";
import { labelsFor, specLinks, unlinkedTasks } from "../commands/linear.mjs";
import { init } from "../commands/init.mjs";
import { ASSETS, installSkills } from "../commands/sync.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, "../../bin/vellum.mjs");
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
/** A repository as `vellum init` and the skill fallback of `vellum sync` leave it, with the preset source in place. */
const ROOT = mkdtempSync(join(tmpdir(), "vellum-root-"));
init(ROOT);
installSkills(ROOT);
cpSync(join(ASSETS, "presets"), join(ROOT, ".agents/speckit/presets"), { recursive: true });
process.on("exit", () => rmSync(ROOT, { recursive: true, force: true }));
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
  assert.match(checkStage("001-x", draft)[0], /sta-<n>-<slug>/);
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

test("lane: feat commits need a spec through the branch or Refs keys", () => {
  const specKeys = new Set(["163"]);
  const taskKeys = new Set(["170"]);
  const feat = "feat(x): y\n\nRefs: STA-5";
  assert.deepEqual(checkLane({ commits: ["chore: x"], branch: "figentra/sta-5-x" }), []);
  assert.match(
    checkLane({ commits: [feat], branch: "figentra/sta-5-x", specKeys, taskKeys }).join(),
    /feat commit\(s\).*STA-5/,
  );
  assert.deepEqual(checkLane({ commits: [feat], branch: "figentra/sta-163-x", specKeys }), []);
  assert.deepEqual(checkLane({ commits: ["feat: y\n\nRefs: STA-170"], taskKeys }), []);
});

test("branch: Linear-named or allow-listed", () => {
  assert.deepEqual(checkBranch("figentra/sta-163-sdd-gates"), []);
  assert.deepEqual(checkBranch("renovate/node-24"), []);
  assert.deepEqual(checkBranch("changeset-release/main"), []);
  assert.match(checkBranch("spec/notifications").join(), /not `figentra\/sta-<n>-<slug>`/);
  assert.match(checkBranch("chore/foo").join(), /not `figentra\/sta-<n>-<slug>`/);
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
    /sta-35-notifications: .*Draft.*Clarified.*Refs: STA-35/,
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
  assert.deepEqual([...refsKeys(["feat: a\n\nRefs: STA-1, sta-2", "fix: STA-3"])], ["1", "2"]);
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
  assert.match(checkBug("44-crash", "").join(), /not `sta-<n>-<slug>`/);
});

test("specDir names the folder from the branch key, reuses an existing one, and refuses without a key", () => {
  const root = mkdtempSync(join(tmpdir(), "spec-dir-"));
  try {
    assert.deepEqual(specDir({ root, branch: "figentra/sta-7-foo", slug: "foo" }), {
      dir: ".agents/specs/sta-7-foo",
    });
    assert.match(specDir({ root, branch: "figentra/sta-7-foo" }).error, /--slug/);
    assert.match(specDir({ root, branch: "main", slug: "foo" }).error, /no STA key/);
    mkdirSync(join(root, ".agents/specs/sta-7-bar"), { recursive: true });
    assert.deepEqual(specDir({ root, key: "STA-7" }), { dir: ".agents/specs/sta-7-bar" });
    assert.deepEqual(specDir({ root, branch: "delegate/sta-7-t1" }), {
      dir: ".agents/specs/sta-7-bar",
    });
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("tripwire: the repository passes, and an upgrade that drops the wrap or resets numbering fails", () => {
  assert.deepEqual(tripwire(ROOT), []);
  const root = mkdtempSync(join(tmpdir(), "spec-trip-"));
  try {
    for (const p of [
      ".specify/scripts/bash",
      ".specify/init-options.json",
      ".specify/workflows/workflow-registry.json",
      ...[...WRAPPED, ...Object.keys(REPLACED)].flatMap((n) => [
        `.claude/skills/speckit-${n}/SKILL.md`,
        `.opencode/commands/speckit.${n}.md`,
      ]),
    ])
      cpSync(join(ROOT, p), join(root, p), { recursive: true });
    assert.deepEqual(tripwire(root), []);
    // The wrap stays, but the core resolution rule changed.
    const skill = join(root, ".claude/skills/speckit-specify/SKILL.md");
    writeFileSync(
      skill,
      readFileSync(skill, "utf8").replace(
        /explicitly provided `SPECIFY_FEATURE_DIRECTORY`/,
        "set the dir",
      ),
    );
    assert.match(tripwire(root).join(), /SKILL\.md: core specify/);
    rmSync(join(root, ".claude/skills/speckit-plan"), { recursive: true });
    assert.match(tripwire(root).join(), /speckit-plan\/SKILL\.md is missing/);
    writeFileSync(join(root, ".specify/init-options.json"), '{"feature_numbering":"sequential"}');
    writeFileSync(join(root, ".opencode/commands/speckit.specify.md"), "vanilla core text\n");
    writeFileSync(join(root, ".specify/scripts/bash/setup-plan.sh"), "#!/bin/sh\n");
    const problems = tripwire(root).join("\n");
    assert.match(problems, /feature_numbering/);
    assert.match(problems, /speckit\.specify\.md lost the Stackra wrap/);
    assert.match(problems, /as-is/);
    assert.match(problems, /setup-plan\.sh/);
    // The replaced commands keep their markers, and the bundled workflow stays disabled.
    writeFileSync(join(root, ".opencode/commands/speckit.taskstoissues.md"), "GitHub issues\n");
    writeFileSync(
      join(root, ".specify/workflows/workflow-registry.json"),
      '{"workflows":{"speckit":{"source":"bundled"}}}',
    );
    const more = tripwire(root).join("\n");
    assert.match(more, /speckit\.taskstoissues\.md lost the Stackra wrap/);
    assert.match(more, /workflow is enabled/);
    // The installed preset must equal its source.
    for (const p of [
      ".agents/speckit/presets/stackra/preset.yml",
      ".specify/presets/stackra/preset.yml",
    ])
      cpSync(join(ROOT, p), join(root, p), { recursive: true });
    assert.doesNotMatch(tripwire(root).join(), /differs from/);
    writeFileSync(join(root, ".specify/presets/stackra/preset.yml"), "hand edit\n");
    assert.match(tripwire(root).join(), /\.specify\/presets\/stackra\/preset\.yml differs from/);
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
  const tasks = unlinkedTasks("- [ ] T001 One\n- [x] T002 Two [STA-9]\n- [ ] T003 [P] Three\nnote");
  assert.deepEqual(
    tasks.map((t) => t.id),
    ["T001", "T003"],
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

const presetTemplate = (n) => readFileSync(join(ASSETS, "presets/stackra/templates", n), "utf8");

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
