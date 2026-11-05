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
// FR-30 and P-034 are not claimed: its scope clause (scope drift, task trees) is built, but contract drift (T047)
// and edited approvals (T048) are not yet.
// @covers sta-1945:FR-26 sta-1945:FR-27 sta-1945:FR-28 sta-1945:FR-29
// @covers sta-1945:AC-28 sta-1945:AC-29 sta-1945:AC-30 sta-1945:AC-31 sta-1945:AC-32
// @covers sta-1945:P-032 sta-1945:P-033
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
  DOCUMENT_GATES_SINCE,
  checkBug,
  checkComponents,
  clarifiedBefore,
  checkForeignStatus,
  checkLane,
  checkPlaceholders,
  checkScope,
  checkSources,
  checkSmallDesign,
  checkSpec,
  checkStage,
  checkTaskTrees,
  checkTasks,
  checkTier,
  checkVague,
  computedTier,
  isOwnSpec,
  qualityWords,
  TREE_GATES_SINCE,
  refsKeys,
  specDir,
  tierOf,
} from "../commands/gate.mjs";
import { keyScheme } from "../adapters/tracker/index.mjs";
import {
  labelsFor,
  specLinks,
  taskTitle,
  TITLE_LIMIT,
  unlinkedTasks,
} from "../commands/linear.mjs";
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

test("a Draft spec gets the approval's spec checks as warnings, and `gate check` prints them and exits 0", () => {
  const draft = spec({ status: "pending", linear: "STA-n", body: impact("[open]") });
  /** @type {string[]} */
  const warned = [];
  assert.deepEqual(checkStage("sta-12-x", draft, { warn: (w) => warned.push(w) }), []);
  assert.match(warned.join("\n"), /at approval: `\*\*Clarifications status\*\*` is not `complete`/);
  assert.match(warned.join("\n"), /at approval: `\*\*Linear\*\*`.*has no issue key/);
  // the same text at Clarified fails on what the Draft warned
  const clarified = checkStage(
    "sta-12-x",
    draft.replace("**Status**: Draft", "**Status**: Clarified"),
  );
  assert.match(clarified.join(), /Clarifications status/);
  const quiet = [];
  checkStage("sta-12-x", spec(), { warn: (w) => quiet.push(w) });
  assert.deepEqual(quiet, [], "a clean Draft warns nothing");
  const dir = join(mkdtempSync(join(tmpdir(), "spec-gate-")), "sta-12-x");
  try {
    mkdirSync(dir);
    writeFileSync(join(dir, "spec.md"), draft);
    const r = spawnSync(process.execPath, [BIN, "gate", "check", dir], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.match(
      r.stderr,
      /spec-gate: warning: .*sta-12-x: at approval: `\*\*Clarifications status\*\*`/,
    );
  } finally {
    rmSync(dirname(dir), { recursive: true });
  }
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
    assert.match(specDir({ root, branch: "figentra/sta-7-foo" }).fix ?? "", /--slug/);
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
    // The provenance header is the front matter's first line (STA-1945 FR-3).
    assert.match(readFileSync(skill, "utf8"), /^---\n# Generated by fflow .*\nname: flow-plan\n/);
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

test("spec-linear titles a task with its id and first clause, at most 120 characters", () => {
  assert.equal(taskTitle("T001", "One"), "T001 One");
  assert.equal(
    taskTitle("T004", "Add the gate: it runs every shard (FR-15) and posts one status"),
    "T004 Add the gate",
  );
  const long = taskTitle("T090", `${"word ".repeat(60)}end`);
  assert.ok(long.length <= TITLE_LIMIT, `${long.length} > ${TITLE_LIMIT}`);
  assert.ok(long.startsWith("T090 word") && long.endsWith("…"));
  assert.ok(!/\s…$/.test(long), "cut at a word, not after a space");
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

// STA-1945 FR-26 to FR-30: documents specific enough to check.
const REQUIREMENTS =
  "- **FR-001**: WHEN a pass is issued THE wallet SHALL show it fast.\n- **FR-002**: WHEN a pass expires THE wallet SHALL hide it.\n";
/** A spec of `tier` at `stage` with two FRs, the criteria and `extra` under its requirements. */
const documented = (tier, stage, extra = "") =>
  spec({ stage })
    .replace("**Linear**", `**Tier**: ${tier}\n\n**Linear**`)
    .replace("## Requirements\n", `## Requirements\n\n${REQUIREMENTS}\n${extra}\n${CRITERIA}\n`);
const SOURCES = "### Sources\n\n- `src/wallet.ts` and STA-12: FR-1 to FR-2\n";

test("placeholders: template text, an empty mandatory section and an open question are refused (FR-28)", () => {
  assert.deepEqual(checkPlaceholders("## Summary\n\nThe wallet shows a pass.\n"), []);
  assert.deepEqual(checkPlaceholders("## Summary\n\nCreated on [DATE].\n"), [
    "the template placeholder `[DATE]` remains",
  ]);
  assert.deepEqual(checkPlaceholders("## Summary\n\nThe template's `[DATE]` field.\n"), []);
  assert.deepEqual(checkPlaceholders("- [ ] T001 [P] Do it\n- [x] T002 Done\n"), []);
  assert.deepEqual(
    checkPlaceholders(
      "## Requirements _(mandatory)_\n\n<!-- guidance -->\n\n## Out of scope\n\nx\n",
    ),
    ["the mandatory section `Requirements _(mandatory)_` is empty"],
  );
  assert.deepEqual(
    checkPlaceholders("## Requirements _(mandatory)_\n\n### Functional\n\n- **FR-001**: x\n"),
    [],
  );
  assert.deepEqual(checkPlaceholders("## Open questions\n\nNone.\n"), []);
  assert.deepEqual(checkPlaceholders("## Open questions\n\nNone: D5 decided them all.\n"), []);
  assert.deepEqual(
    checkPlaceholders("## Open questions\n\n#### Decided\n\n- ~~Which port?~~ Decided: 8080\n"),
    [],
  );
  assert.deepEqual(checkPlaceholders("## Open questions\n\n- Which port?\n- Who owns it?\n"), [
    'an open question remains: "Which port?" (decide it before the approval)',
    'an open question remains: "Who owns it?" (decide it before the approval)',
  ]);
});

test("sources: a `### Sources` section that cites every live FR, alone or in a range (FR-26)", () => {
  assert.deepEqual(checkSources(REQUIREMENTS), [
    "spec.md: no `### Sources` section naming the files, ADRs, commands and issues the spec rests on (FR-26)",
  ]);
  assert.match(checkSources(`${REQUIREMENTS}\n### Sources\n\nNone.\n`).join(), /no `### Sources`/);
  assert.deepEqual(checkSources(`${REQUIREMENTS}\n${SOURCES}`), []);
  // a subsection is part of the section; the next `###` ends it
  assert.deepEqual(
    checkSources(
      `${REQUIREMENTS}\n### Sources\n\n#### Files\n\n- \`src/wallet.ts\`: FR-1 to FR-2\n\n### Next\n\nFR-9\n`,
    ),
    [],
  );
  assert.deepEqual(
    checkSources(`${REQUIREMENTS}\n### Sources\n\n- x: FR-1\n\n### Next\n\nFR-2\n`).length,
    1,
  );
  assert.deepEqual(checkSources(`${REQUIREMENTS}\n### Sources\n\n- ADR 0502: FR-001\n`), [
    'spec.md: FR-002 cites no source (name it in `### Sources`, alone or in a range such as "FR-1 to FR-12")',
  ]);
  assert.deepEqual(
    checkSources(
      `${REQUIREMENTS}- ~~**FR-003**~~: (A-1) struck.\n\n### Sources\n\n- x: FR-1, FR-2\n`,
    ),
    [],
  );
});

test("components: each component of a plan has a folder tree and its interfaces (FR-27)", () => {
  const tree = "```text\nsrc/wallet.ts (new)\n```\n";
  const code = "```ts\nexport function show(pass: Pass): void;\n```\n";
  const plan = (/** @type {string} */ body) =>
    `## Summary\n\nx\n\n## Components and responsibilities\n\n### C1 Wallet\n\n${body}\n## Files and folders\n\nx\n`;
  assert.deepEqual(checkComponents(plan(`${tree}\n${code}`)), []);
  assert.deepEqual(checkComponents(plan(code)), [
    "plan.md: component `C1 Wallet` has no folder tree (a ```text block of every file it adds) (FR-27)",
  ]);
  const noInterface =
    "plan.md: component `C1 Wallet` has no interface declarations (a fenced block in the repository's language) (FR-27)";
  assert.deepEqual(checkComponents(plan(tree)), [noInterface]);
  // a diagram, data or shell block declares no interface
  for (const lang of ["mermaid", "yaml", "json", "sh", "md"])
    assert.deepEqual(
      checkComponents(plan(`${tree}\n\`\`\`${lang}\nx\n\`\`\`\n`)),
      [noInterface],
      lang,
    );
  assert.deepEqual(checkComponents("## Summary\n\nx\n"), []);
  // fences indented in a list item count; a ````md block quoting a ``` one is one block
  const indent = (/** @type {string} */ s) => s.replaceAll(/^(?=.)/gm, "  ");
  assert.deepEqual(
    checkComponents(plan(`- The tree:\n${indent(tree)}- The interface:\n${indent(code)}`)),
    [],
  );
  assert.deepEqual(checkComponents(plan(`\`\`\`\`md\n${tree}\`\`\`\`\n\n${code}`)), [
    "plan.md: component `C1 Wallet` has no folder tree (a ```text block of every file it adds) (FR-27)",
  ]);
});

test("vague words: listed terms in FR and AC lines fail a big spec and warn on the others (FR-29)", () => {
  const text = [
    "- **AC-001**: WHEN a pass is issued THE wallet SHALL show it fast",
    "  and refresh it as needed",
    "- ~~**FR-002**~~: (A-1) fast, struck",
    "- **FR-003**: THE `fast` flag SHALL exist for breakfast",
    "- **SC-001**: fast",
    "",
    "Fast prose is not a requirement.",
  ].join("\n");
  const found = [
    'spec.md: AC-001 uses the vague term "fast" (state a measurable value; the preset\'s quality-words.yml has an example) (FR-29)',
    'spec.md: AC-001 uses the vague term "as needed" (state a measurable value; the preset\'s quality-words.yml has an example) (FR-29)',
  ];
  const words = ["fast", "as needed"];
  assert.deepEqual(checkVague(text, words, "big"), { problems: found, warnings: [] });
  assert.deepEqual(checkVague(text, words, "feature"), { problems: [], warnings: found });
  assert.deepEqual(checkVague(text, [], "big"), { problems: [], warnings: [] });
  assert.deepEqual(checkVague("- **NFR-1**: THE API SHALL be fast.", words, "big").problems, [
    'spec.md: NFR-1 uses the vague term "fast" (state a measurable value; the preset\'s quality-words.yml has an example) (FR-29)',
  ]);
  const listed = qualityWords();
  for (const w of ["fast", "as needed", "user-friendly"]) assert.ok(listed.includes(w), w);
});

test("checkStage: Sources at Clarified, placeholders at the approval stop, vague words by tier", () => {
  const over = { team: null, words: ["fast"] };
  assert.deepEqual(
    checkStage("sta-12-x", documented("big", "Clarified", SOURCES), { ...over, words: [] }),
    [],
  );
  assert.match(
    checkStage("sta-12-x", documented("small", "Clarified"), over).join(),
    /no `### Sources` section/,
  );
  assert.match(
    checkStage("sta-12-x", documented("big", "Clarified", SOURCES), over).join(),
    /FR-001 uses the vague term "fast"/,
  );
  /** @type {string[]} */
  const warned = [];
  const feature = checkStage("sta-12-x", documented("feature", "Clarified", SOURCES), {
    ...over,
    warn: (w) => warned.push(w),
  });
  assert.doesNotMatch(feature.join(), /vague/);
  assert.match(warned.join(), /FR-001 uses the vague term "fast"/);
  // big stops at Clarified; feature first stops at Planned.
  const dated = `${SOURCES}\nCreated on [DATE].\n`;
  assert.match(
    checkStage("sta-12-x", documented("big", "Clarified", dated), over).join(),
    /spec\.md: the template placeholder `\[DATE\]` remains/,
  );
  assert.doesNotMatch(
    checkStage("sta-12-x", documented("feature", "Clarified", dated), over).join(),
    /placeholder/,
  );
  // A big Draft warns of the placeholder its Clarified approval would fail on, and still passes.
  /** @type {string[]} */
  const early = [];
  assert.deepEqual(
    checkStage("sta-12-x", documented("big", "Draft", dated), {
      ...over,
      warn: (w) => early.push(w),
    }),
    [],
  );
  assert.match(
    early.join("\n"),
    /at approval: spec\.md: the template placeholder `\[DATE\]` remains/,
  );
  // At Planned the feature spec is approved, and so is the plan: its placeholders, questions and components.
  const planned = { ...over, words: [], files: ["spec.md", "plan.md"] };
  assert.match(
    checkStage("sta-12-x", documented("feature", "Planned", dated), planned).join(),
    /spec\.md: the template placeholder `\[DATE\]` remains/,
  );
  const plan =
    "## Components and responsibilities\n\n### C1 Wallet\n\n```text\nsrc/wallet.ts (new)\n```\n\n```mermaid\nsequenceDiagram\n```\n\nCreated on [DATE].\n\n## Open questions\n\n- Which port?\n";
  for (const tier of ["feature", "big"]) {
    const found = checkStage("sta-12-x", documented(tier, "Planned", SOURCES), {
      ...planned,
      plan,
    }).join("\n");
    assert.match(found, /plan\.md: the template placeholder `\[DATE\]` remains/, tier);
    assert.match(found, /plan\.md: an open question remains: "Which port\?"/, tier);
    assert.match(found, /plan\.md: component `C1 Wallet` has no interface declarations/, tier);
  }
});

test("checkStage: a spec last clarified before the document gates keeps its old rules", () => {
  const over = { team: null, words: ["fast"] };
  const on = (/** @type {string} */ day) =>
    checkStage(
      "sta-12-x",
      documented("big", "Clarified").replace("- d · Draft →", `- ${day} · Draft →`),
      over,
    ).join();
  assert.doesNotMatch(on("2026-11-01"), /Sources|vague/);
  assert.match(on(DOCUMENT_GATES_SINCE), /no `### Sources` section/);
  assert.match(on(DOCUMENT_GATES_SINCE), /vague term "fast"/);
  // a later re-clarification (after an amendment) is held to the new rules
  assert.equal(
    clarifiedBefore(
      "- 2026-11-01: Draft → Clarified\n- 2026-11-03: Draft → Clarified\n",
      "2026-11-03",
    ),
    false,
  );
  assert.equal(clarifiedBefore("- 2026-11-01: Draft → Clarified\n", "2026-11-03"), true);
  assert.equal(clarifiedBefore("- d · Draft → Clarified\n", "2026-11-03"), false);
});

test("gate ci: scope drift in the branch's own spec fails a big tier and warns on a feature one (FR-30, T049)", (t) => {
  /** @type {NodeJS.ProcessEnv} */
  const env = {
    ...process.env,
    NO_COLOR: "1",
    STACKRA_BRANCH: "figentra/sta-12-x",
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
  };
  delete env.SPEC_GATE_REQUIRE_READY;
  /** A repository whose main holds the spec at `tier`, and a branch that adds a named file and an unnamed one. */
  const ci = (/** @type {string} */ tier) => {
    const repo = mkdtempSync(join(tmpdir(), "flow-scope-"));
    t.after(() => rmSync(repo, { recursive: true, force: true }));
    const sh = (/** @type {string} */ cmd, /** @type {string[]} */ args) =>
      spawnSync(cmd, args, { cwd: repo, encoding: "utf8", env });
    const folder = join(repo, ".agents/specs/sta-12-x");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "spec.md"), `# X\n\n**Status**: Tasked\n\n**Tier**: ${tier}\n`);
    writeFileSync(join(folder, "tasks.md"), "- [ ] T001 Build `src/a.mjs` — covers: AC-001\n");
    sh("git", ["init", "-q", "-b", "main"]);
    sh("git", ["add", "-A"]);
    sh("git", ["commit", "-q", "-m", "chore: spec"]);
    sh("git", ["switch", "-q", "-c", "figentra/sta-12-x"]);
    mkdirSync(join(repo, "src"));
    writeFileSync(join(repo, "src/a.mjs"), "\n");
    writeFileSync(join(repo, "src/b.mjs"), "\n");
    sh("git", ["add", "-A"]);
    sh("git", ["commit", "-q", "-m", "chore: build"]);
    return sh(process.execPath, [BIN, "gate", "ci", "--base=main"]);
  };
  const big = ci("big");
  assert.equal(big.status, 1, big.stderr);
  assert.match(big.stderr, /spec-gate: scope drift: `src\/b\.mjs` is named by no task/);
  assert.doesNotMatch(big.stderr, /src\/a\.mjs/);
  const feature = ci("feature");
  assert.equal(feature.status, 0, feature.stderr);
  assert.match(
    feature.stderr,
    /spec-gate: warning: scope drift: `src\/b\.mjs` is named by no task/,
  );
});

test("scope: a changed file no task names is drift, failing on big and warning otherwise (FR-30)", () => {
  const tasks =
    "- [ ] T001 Build `src/a.mjs` and `docs/` — covers: AC-001 — route: spec-task\n- [ ] ~~T002~~ Was `src/c.mjs` — covers: AC-001\n";
  const changed = [
    "src/a.mjs",
    "src/b.mjs",
    "src/c.mjs",
    "docs/guide.md",
    "src/__tests__/a.test.mjs",
    ".changeset/a.md",
    "pnpm-lock.yaml",
    ".agents/specs/sta-12-x/plan.md",
  ];
  const drift = [
    "scope drift: `src/b.mjs` is named by no task (amend the spec to add it) (FR-30)",
    "scope drift: `src/c.mjs` is named by no task (amend the spec to add it) (FR-30)",
  ];
  const big = "**Status**: Tasked\n\n**Tier**: big\n";
  assert.deepEqual(checkScope(big, tasks, changed), { problems: drift, warnings: [] });
  assert.deepEqual(checkScope(big.replace("big", "feature"), tasks, changed), {
    problems: [],
    warnings: drift,
  });
  assert.deepEqual(checkScope(`**Tier**: small\n\n## Tasks\n\n${tasks}`, "", changed), {
    problems: [],
    warnings: drift,
  });
  const none = { problems: [], warnings: [] };
  assert.deepEqual(checkScope("**Status**: Tasked\n", tasks, changed), none);
  assert.deepEqual(checkScope(big, "", changed), none);
});

// @covers sta-1945:FR-27 sta-1945:AC-29 sta-1945:P-032
test("small design: a small spec's one-page design keeps the folder tree and the interfaces from Planned (FR-27)", () => {
  const over = { team: null, words: [] };
  const tree = "### Files and folders\n\n```text\nsrc/wallet.ts (new)\n```\n";
  const code = "### Contracts\n\n```ts\nexport function show(pass: Pass): void;\n```\n";
  const noTree =
    "spec.md ## Design: the design has no folder tree (a ```text block of every file it adds) (FR-27)";
  const noInterface =
    "spec.md ## Design: the design has no interface declarations (a fenced block in the repository's language) (FR-27)";
  const small = (/** @type {string} */ design, history = "- d · Draft → Planned") =>
    checkStage(
      "sta-12-x",
      `${documented("small", "Planned", SOURCES).replace("- d · Draft → Planned", history)}\n${design}`,
      over,
    ).filter((p) => p.endsWith("(FR-27)"));
  assert.deepEqual(small(DESIGN("###")), [noTree, noInterface]);
  const full = DESIGN("###")
    .replace("### Files and folders\n\nnone\n", tree)
    .replace("### Contracts\n\nnone\n", code);
  assert.deepEqual(small(full), []);
  // a mermaid diagram declares no interface, as in a plan's component
  assert.deepEqual(
    small(full.replace("```ts\nexport function show(pass: Pass): void;", "```mermaid\ngraph LR")),
    [noInterface],
  );
  // a spec last clarified before the document gates keeps its old rules
  assert.deepEqual(
    small(DESIGN("###"), "- 2026-11-01 · Draft → Clarified\n- d · Clarified → Planned"),
    [],
  );
  assert.deepEqual(checkSmallDesign(full), []);
  assert.deepEqual(checkSmallDesign(""), [noTree, noInterface]);
});

// FR-30's task-tree part only (see scope-drift.test.mjs), so FR-30 itself is not claimed.
// @covers sta-1945:AC-32
test("task trees: each task names only files of the plan's folder trees, failing big and warning otherwise (FR-30)", () => {
  const plan = [
    "## Components and responsibilities",
    "",
    "### C1 Wallet",
    "",
    "```text",
    "packages/wallet/",
    "├── src/",
    "│   ├── pass.ts          (new)",
    "│   └── {show,hide}.ts   (changed)",
    "└── docs/",
    "```",
    "",
    "## Files and folders",
    "",
    "```text",
    "README.md",
    "```",
    "",
    "## Data models and migrations",
    "",
    "```text",
    "src/elsewhere.ts",
    "```",
    "",
  ].join("\n");
  const tasks = [
    "- [ ] T001 Pass in `packages/wallet/src/pass.ts` and `packages/wallet/src/show.ts` — covers: AC-001",
    "- [ ] T002 Guide in `packages/wallet/docs/guide.md`, `packages/wallet/docs/`, `README.md` and `packages/wallet/src/__tests__/pass.test.ts` — covers: AC-001",
    "- [ ] T003 Record in `.agents/specs/sta-12-x/tasks.md` through `gate ci`, `checkScope` and `/flow-tasks` — covers: AC-001",
    "- [ ] T004 Stray `src/elsewhere.ts`, `packages/wallet/src/pass.js` and `packages/wallet/src/` — covers: AC-001",
    "- [ ] ~~T005~~ Was `src/gone.ts` — covers: AC-001",
  ].join("\n");
  const outside = (/** @type {string} */ path) =>
    `tasks.md:4: T004 names \`${path}\`, which no folder tree of plan.md holds (add it to the tree, or amend the task) (FR-30)`;
  const found = [
    outside("src/elsewhere.ts"),
    outside("packages/wallet/src/pass.js"),
    outside("packages/wallet/src/"),
  ];
  assert.deepEqual(checkTaskTrees("**Tier**: big\n", plan, tasks, "sta-12-x"), {
    problems: found,
    warnings: [],
  });
  assert.deepEqual(checkTaskTrees("**Tier**: feature\n", plan, tasks, "sta-12-x"), {
    problems: [],
    warnings: found,
  });
  // a small spec's tasks and trees are both in spec.md
  const small = checkTaskTrees(
    "**Tier**: small\n\n## Design\n\n### Files and folders\n\n```text\nsrc/pass.ts (new)\n```\n\n## Tasks\n\n- [ ] T001 In `src/pass.ts` and `src/hide.ts` — covers: AC-001\n",
    "",
    "",
    "sta-12-x",
  );
  assert.deepEqual(small.problems, []);
  assert.equal(small.warnings.length, 1);
  assert.match(
    small.warnings[0],
    /T001 names `src\/hide\.ts`, which no folder tree of spec\.md ## Design holds/,
  );
  const none = { problems: [], warnings: [] };
  assert.deepEqual(checkTaskTrees("**Status**: Tasked\n", plan, tasks, "sta-12-x"), none);
  // a spec last clarified before the cut-over was tasked without the rule
  const dated = (/** @type {string} */ day) =>
    `**Tier**: big\n\n## Status history\n\n- ${day}: Draft → Clarified\n`;
  assert.deepEqual(checkTaskTrees(dated("2026-11-03"), plan, tasks, "sta-12-x"), none);
  assert.deepEqual(
    checkTaskTrees(dated(TREE_GATES_SINCE), plan, tasks, "sta-12-x").problems,
    found,
  );
  // another spec's folder is not exempt, and a big spec without a plan is left to the stage gate
  assert.deepEqual(checkTaskTrees("**Tier**: big\n", plan, tasks, "sta-13-y").problems, [
    "tasks.md:3: T003 names `.agents/specs/sta-12-x/tasks.md`, which no folder tree of plan.md holds (add it to the tree, or amend the task) (FR-30)",
    ...found,
  ]);
  assert.deepEqual(checkTaskTrees("**Tier**: big\n", "", tasks, "sta-12-x"), none);
});
