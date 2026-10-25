/**
 * The CLI against a real git repository per test: every command either does
 * what it says — verified by reading the repository afterwards — or refuses.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { checkLedgerIntegrity } from "@vellum/engine";
import { computeChecksum, computeChecksumInForm } from "@vellum/protocol";
import { appendLedgerEntry, readLedgerHead, sshPublicKeyFingerprint } from "@vellum/storage";
import { DESIGN, Fixture, REQUIREMENTS, SLUG, TASKS, withFrontmatter } from "./fixture.js";

function hasSshKeygen(): boolean {
  try {
    execFileSync("which", ["ssh-keygen"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const SSH = hasSshKeygen();
if (!SSH) console.warn("cli.integration.test: SKIPPING — ssh-keygen is not installed");

const TASKS_PATH = `.agents/specs/${SLUG}/tasks.md`;
const ALL = ["requirements", "design", "tasks"] as const;

describe.skipIf(!SSH)("vellum CLI against a temp repository", () => {
  let fx: Fixture;

  beforeEach(() => {
    fx = new Fixture();
  });

  afterEach(() => {
    fx.dispose();
  });

  const marker = (taskId: string) =>
    new RegExp(`^- \\[(.)\\] ${taskId} `, "m").exec(fx.read(TASKS_PATH))?.[1];

  describe("status", () => {
    it("reports no valid approval before any, and one each after signed approvals", async () => {
      const before = await fx.cli(["status", SLUG, "--json"]);
      expect(before.status).toBe(0);
      const report = JSON.parse(before.stdout).specs[0];
      expect(report.recordedState).toBe("IN_PROGRESS");
      // No approval yet: the requirements approval is the first precondition to fail
      expect(report.effectiveState).toBe("IN_REVIEW");
      expect(report.effective.failedPrecondition).toContain("IN_REVIEW → REQUIREMENTS_APPROVED");
      expect(report.approvals.requirements).toEqual({ current: 0, required: 1, complete: false });
      expect(report.verification).toEqual({
        required: 2,
        completed: 0,
        failed: 0,
        complete: false,
      });
      expect(report.ledger).toEqual({ entries: 0, valid: true, failures: [] });

      await fx.approve(ALL, "alice");
      const after = JSON.parse((await fx.cli(["status", "001", "--json"])).stdout).specs[0];
      expect(after.approvals.requirements).toEqual({ current: 1, required: 1, complete: true });
      expect(after.approvals.tasks).toEqual({ current: 1, required: 1, complete: true });
      // Approved, but no task started yet
      expect(after.effectiveState).toBe("PLAN_APPROVED");
    });

    it("names the effective state and its failed precondition in human output", async () => {
      const result = await fx.cli(["status"]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Recorded state: IN_PROGRESS");
      expect(result.stdout).toContain("Effective state: IN_REVIEW");
      expect(result.stdout).toContain("failed precondition: IN_REVIEW → REQUIREMENTS_APPROVED");
    });

    it("exits 2 naming the fragment when no spec matches", async () => {
      const result = await fx.cli(["status", "999"]);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("no spec matches '999'");
    });
  });

  describe("check", () => {
    it("fails a spec recorded ahead of its content, then passes once the content supports it, writing nothing", async () => {
      const tree = () => fx.git(["status", "--porcelain", "--untracked-files=all"]);

      const before = tree();
      const unapproved = await fx.cli(["check"]);
      expect(unapproved.status).toBe(1);
      expect(unapproved.stdout).toContain("[STATE_MISMATCH]");
      expect(unapproved.stdout).toContain(
        "records IN_PROGRESS but its effective state is IN_REVIEW",
      );
      expect(tree()).toBe(before);

      await fx.approve(ALL, "alice");
      const approved = JSON.parse((await fx.cli(["check", SLUG, "--json"])).stdout);
      expect(approved.exitStatus).toBe(1);
      expect(approved.specs[0].effective.state).toBe("PLAN_APPROVED");

      expect((await fx.cli(["task", "start", SLUG, "1"])).status).toBe(0);
      fx.commit("start task 1");
      const started = await fx.cli(["check", SLUG]);
      expect(started.stderr).toBe("");
      expect(started.stdout).toContain("Check mode: PASS");
      expect(started.status).toBe(0);
    });

    it("is INCONCLUSIVE (exit 2) when there is no spec to check, rather than a PASS that examined nothing", async () => {
      fx.git(["rm", "-rq", ".agents/specs"]);
      const result = await fx.cli(["check"]);
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("no spec to check");
    });

    it("fails a spec whose ledger was edited, naming the entry", async () => {
      await fx.approve(["requirements"], "alice");
      writeFileSync(
        fx.ledgerPath,
        readFileSync(fx.ledgerPath, "utf8").replace("alice@", "mallory@"),
      );

      const result = await fx.cli(["check", SLUG, "--json"]);
      expect(result.status).toBe(1);
      const report = JSON.parse(result.stdout);
      expect(report.summary.ledgerFailures).toBe(1);
      expect(report.findings.some((f: { rule: string }) => f.rule === "LEDGER_INTEGRITY")).toBe(
        true,
      );
    });

    it("passes a legacy spec and exits 2 naming a fragment that matches nothing", async () => {
      fx.write(".agents/specs/002-legacy/requirements.md", "# Legacy\n");
      const legacy = JSON.parse((await fx.cli(["check", "002", "--json"])).stdout);
      expect(legacy.specs[0]).toMatchObject({ id: "002-legacy", legacy: true, outcome: "pass" });

      const none = await fx.cli(["check", "999"]);
      expect(none.status).toBe(2);
      expect(none.stderr).toContain("no spec matches '999'");
    });
  });

  describe("lint", () => {
    it("passes a well-formed spec and says what it examined", async () => {
      const result = await fx.cli(["lint", SLUG]);
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(
        "PASS: 0 finding(s); examined 1 spec(s), 3 artifact(s), 2 task line(s)",
      );
    });

    it("fails an artifact edited without its checksum, and a fourth file in the spec", async () => {
      const design = fx.read(`.agents/specs/${SLUG}/design.md`);
      fx.write(`.agents/specs/${SLUG}/design.md`, design.replace("First", "Changed"));
      fx.write(`.agents/specs/${SLUG}/notes.md`, "scratch\n");

      const result = await fx.cli(["lint", SLUG, "--json"]);
      expect(result.status).toBe(1);
      const rules = JSON.parse(result.stdout).findings.map((f: { rule: string }) => f.rule);
      expect(rules).toContain("CHECKSUM_MISMATCH");
      expect(rules).toContain("SPEC_EXTRA_FILE");
    });

    it("with --type validates only that artifact", async () => {
      const design = fx.read(`.agents/specs/${SLUG}/design.md`);
      fx.write(`.agents/specs/${SLUG}/design.md`, design.replace("First", "Changed"));
      expect((await fx.cli(["lint", SLUG, "--type=tasks"])).status).toBe(0);
      expect((await fx.cli(["lint", SLUG, "--type=design"])).status).toBe(1);
    });

    it("fails an unresolved clarification marker in requirements.md or design.md, naming the line", async () => {
      fx.writeArtifact(
        "requirements",
        REQUIREMENTS.replace(
          "do one thing",
          "do one thing within [NEEDS CLARIFICATION: how fast?]",
        ),
      );
      const result = await fx.cli(["lint", SLUG, "--json"]);
      expect(result.status).toBe(1);
      const findings = JSON.parse(result.stdout).findings as {
        file: string;
        line: number;
        rule: string;
        message: string;
      }[];
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        file: `.agents/specs/${SLUG}/requirements.md`,
        rule: "NEEDS_CLARIFICATION",
      });
      expect(findings[0]!.message).toContain("how fast?");
      expect(
        fx.read(`.agents/specs/${SLUG}/requirements.md`).split("\n")[findings[0]!.line - 1],
      ).toContain("NEEDS CLARIFICATION");
      expect((await fx.cli(["lint", SLUG, "--type=tasks"])).status).toBe(0);
    });

    it("checks the tasks.md wave graph: an undefined task and an omitted leaf fail", async () => {
      const plan = (waves: string) =>
        `# Tasks\n\n- [ ] 1 Build the first thing <!-- criteria: 1.1 --> <!-- properties: P1 -->\n- [ ] 2 Build the second thing <!-- criteria: 1.2 --> <!-- properties: P2 -->\n\n## Task Dependency Graph\n\n\`\`\`json\n${waves}\n\`\`\`\n`;
      fx.writeArtifact("tasks", plan(`{ "waves": [ { "id": 0, "tasks": ["1", "2"] } ] }`));
      expect((await fx.cli(["lint", SLUG])).status).toBe(0);

      fx.writeArtifact("tasks", plan(`{ "waves": [ { "id": 0, "tasks": ["1", "7"] } ] }`));
      const result = await fx.cli(["lint", SLUG, "--json"]);
      expect(result.status).toBe(1);
      const messages = JSON.parse(result.stdout).findings.map(
        (f: { rule: string; message: string }) => `${f.rule}: ${f.message}`,
      );
      expect(messages).toEqual([
        "WAVE_GRAPH_INVALID: Incomplete leaf task 2 appears in no wave of the Task Dependency Graph",
        "WAVE_TASK_UNDEFINED: Wave 0 names task 7, which tasks.md does not define",
      ]);
    });

    it("is INCONCLUSIVE (exit 2) when there is nothing under management to examine", async () => {
      fx.write(".agents/specs/002-legacy/requirements.md", "# Legacy\n");
      const result = await fx.cli(["lint", "002"]);
      expect(result.status).toBe(2);
      expect(result.stdout).toContain("legacy spec, not validated: 002-legacy");
    });
  });

  describe("task start and task complete", () => {
    it("refuses to start before the artifacts hold valid approvals, writing nothing", async () => {
      const result = await fx.cli(["task", "start", SLUG, "1"]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("failed the pre-execution check");
      expect(await fx.ledger()).toEqual([]);
      expect(marker("1")).toBe(" ");
    });

    it("complete runs the command, records evidence, flips the marker and keeps the chain valid", async () => {
      await fx.approve(ALL, "alice");
      const start = await fx.cli(["task", "start", SLUG, "1"]);
      expect(start.stderr).toBe("");
      expect(start.status).toBe(0);
      expect(marker("1")).toBe("-");

      const head = fx.git(["rev-parse", "HEAD"]).trim();
      const result = await fx.cli(["task", "complete", SLUG, "1", "--command=echo verified"]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Task 1 verified: exit status 0");
      expect(marker("1")).toBe("x");

      const ledger = await fx.ledger();
      const evidence = ledger[ledger.length - 1] as unknown as Record<string, unknown>;
      expect(evidence).toMatchObject({
        kind: "evidence",
        task_id: "1",
        command: "echo verified",
        exit_status: 0,
        commit: head,
        uncommitted: false,
        timed_out: false,
        output_sha256: createHash("sha256").update("verified\n").digest("hex"),
      });
      expect(evidence).not.toHaveProperty("stdout");
      expect(checkLedgerIntegrity(ledger, await readLedgerHead(fx.ledgerPath))).toEqual({
        valid: true,
        failures: [],
      });
    });

    it("records IN_PROGRESS at the first start and VERIFIED at the last completion, keeping every approval (decision 16)", async () => {
      const states = () =>
        ALL.map((kind) => /^state: (\S+)$/m.exec(fx.read(`.agents/specs/${SLUG}/${kind}.md`))?.[1]);
      for (const kind of ALL) {
        const path = `.agents/specs/${SLUG}/${kind}.md`;
        fx.write(path, fx.read(path).replace("state: IN_PROGRESS", "state: PLAN_IN_REVIEW"));
      }
      fx.commit("record PLAN_IN_REVIEW");
      await fx.approve(ALL, "alice");

      const start = await fx.cli(["task", "start", SLUG, "1"]);
      expect(start.status).toBe(0);
      expect(start.stdout).toContain("Recorded Lifecycle State: PLAN_IN_REVIEW → IN_PROGRESS.");
      expect(states()).toEqual(["IN_PROGRESS", "IN_PROGRESS", "IN_PROGRESS"]);

      const first = await fx.cli(["task", "complete", SLUG, "1", "--command=true"]);
      expect(first.status).toBe(0);
      expect(first.stdout).not.toContain("Recorded Lifecycle State");
      expect(states()).toEqual(["IN_PROGRESS", "IN_PROGRESS", "IN_PROGRESS"]);

      expect((await fx.cli(["task", "start", SLUG, "2"])).status).toBe(0);
      const last = await fx.cli(["task", "complete", SLUG, "2", "--command=true"]);
      expect(last.status).toBe(0);
      expect(last.stdout).toContain("Recorded Lifecycle State: IN_PROGRESS → VERIFIED.");
      expect(states()).toEqual(["VERIFIED", "VERIFIED", "VERIFIED"]);

      fx.commit("record task evidence");
      expect((await fx.cli(["verify", SLUG])).status).toBe(0);
      const check = await fx.cli(["check", SLUG]);
      expect(check.stdout).toContain("Check mode: PASS");
      expect(check.status).toBe(0);
    });

    it("a failing command records the failed attempt and leaves the marker", async () => {
      await fx.approve(ALL, "alice");
      await fx.cli(["task", "start", SLUG, "2"]);

      const result = await fx.cli([
        "task",
        "complete",
        SLUG,
        "2",
        "--command",
        "echo broken >&2; exit 3",
      ]);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("Task 2 FAILED: exit status 3");
      expect(result.stderr).toContain("broken");
      expect(marker("2")).toBe("-");
      const ledger = await fx.ledger();
      expect(ledger[ledger.length - 1]).toMatchObject({
        kind: "evidence",
        task_id: "2",
        exit_status: 3,
      });
    });

    it("does not set [x] when the working tree differs from HEAD outside the spec", async () => {
      await fx.approve(ALL, "alice");
      await fx.cli(["task", "start", SLUG, "1"]);
      fx.write("src/new.ts", "export {};\n");

      const result = await fx.cli(["task", "complete", SLUG, "1", "--command=true"]);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("src/new.ts");
      expect(marker("1")).toBe("-");
      const ledger = await fx.ledger();
      expect(ledger[ledger.length - 1]).toMatchObject({ exit_status: 0, uncommitted: true });
    });

    it("refuses to complete a task that was never started", async () => {
      const result = await fx.cli(["task", "complete", SLUG, "1", "--command=true"]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("has no Task Binding");
      expect(await fx.ledger()).toEqual([]);
    });

    it("stops a command at its timeout and records exit status 124", async () => {
      await fx.approve(ALL, "alice");
      await fx.cli(["task", "start", SLUG, "1"]);
      const result = await fx.cli([
        "task",
        "complete",
        SLUG,
        "1",
        "--command=sleep 30",
        "--timeout=1",
      ]);
      expect(result.status).toBe(1);
      const ledger = await fx.ledger();
      expect(ledger[ledger.length - 1]).toMatchObject({ exit_status: 124, timed_out: true });
    }, 15_000);

    it("has no --exit option: a caller cannot report an exit status", async () => {
      const result = await fx.cli(["task", "complete", SLUG, "1", "--command=true", "--exit=0"]);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("no --exit option");
    });
  });

  describe("approve", () => {
    it("refuses outside an interactive terminal, writing nothing", async () => {
      const result = await fx.cli(["approve", SLUG, "requirements"]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("an approval requires a human");
      expect(await fx.ledger()).toEqual([]);
    });

    it("refuses in a detected assistant session even on a terminal", async () => {
      const result = await fx.cli(["approve", SLUG, "requirements"], {
        interactive: true,
        assistantSession: "CLAUDECODE",
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("assistant session");
      expect(await fx.ledger()).toEqual([]);
    });

    it("on a terminal, writes a record that is not valid until a signed commit adds it", async () => {
      const result = await fx.cli(["approve", SLUG, "requirements"], { interactive: true });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("It is NOT valid yet");
      const ledger = await fx.ledger();
      expect(ledger[0]).toMatchObject({
        kind: "approval",
        identity: "alice@example.com",
        artifact: "requirements.md",
        checksum_form: 2,
        approval_signal: { commit: null },
      });

      const uncommitted = JSON.parse((await fx.cli(["verify", SLUG, "--json"])).stdout);
      expect(JSON.stringify(uncommitted.specs[0].findings)).toContain("not committed");
    });

    it("records the signing key's fingerprint as identity_key, never its path or the home directory", async () => {
      fx.git(["config", "gpg.format", "ssh"]);
      fx.git(["config", "user.signingkey", fx.key("alice")]);
      const result = await fx.cli(["approve", SLUG, "requirements"], { interactive: true });
      expect(result.status).toBe(0);

      const alice = sshPublicKeyFingerprint(readFileSync(`${fx.key("alice")}.pub`, "utf8"));
      expect(alice).toMatch(/^SHA256:/);
      expect((await fx.ledger())[0]).toMatchObject({ kind: "approval", identity_key: alice });
      const lines = readFileSync(fx.ledgerPath, "utf8");
      expect(lines).not.toContain(fx.root);
      expect(lines).not.toContain(homedir());
      expect(lines).not.toContain(fx.key("alice"));
    });

    it("refuses to approve a plan that leaves a criterion uncovered or a property uncited, naming each and writing nothing", async () => {
      fx.writeArtifact(
        "tasks",
        TASKS.replace("<!-- criteria: 1.2 --> <!-- properties: P2 -->", ""),
      );
      const result = await fx.cli(["approve", SLUG, "tasks"], { interactive: true });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("vellum approve: refused — tasks.md cannot be approved");
      expect(result.stderr).toContain(
        "Criterion 1.2 is referenced by no task's requirements trailer",
      );
      expect(result.stderr).toContain("Property P2 is cited by no task");
      expect(result.stdout).toBe("");
      expect(await fx.ledger()).toEqual([]);

      // A rejection of the same plan is still recorded.
      const rejected = await fx.cli(
        ["approve", SLUG, "tasks", "--reject", "--rationale=criterion 1.2 has no task"],
        { interactive: true },
      );
      expect(rejected.status).toBe(0);
      expect(await fx.ledger()).toHaveLength(1);
    });

    it("approves a plan that covers every criterion and cites every property", async () => {
      const result = await fx.cli(["approve", SLUG, "tasks"], { interactive: true });
      expect(result.status).toBe(0);
      expect((await fx.ledger())[0]).toMatchObject({ kind: "approval", artifact: "tasks.md" });
    });

    it("explains in --help that the signed commit, not the command, makes it valid", async () => {
      const result = await fx.cli(["approve", "--help"]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("NOT valid when this command finishes");
    });
  });

  describe("verify --strict", () => {
    async function completeAll(): Promise<void> {
      for (const id of ["1", "2"]) {
        expect((await fx.cli(["task", "start", SLUG, id])).status).toBe(0);
        expect((await fx.cli(["task", "complete", SLUG, id, "--command=true"])).status).toBe(0);
      }
      fx.commit("record task evidence");
    }

    it("passes a spec approved by signed commits with every task evidenced", async () => {
      await fx.approve(ALL, "alice");
      await completeAll();

      const result = await fx.cli(["verify", SLUG, "--strict"]);
      expect(result.stdout).toContain("Result: PASS");
      expect(result.status).toBe(0);
    });

    it("fails an approval whose commit is unsigned", async () => {
      await fx.approve(ALL, null);
      await completeAll().catch(() => undefined);

      const result = await fx.cli(["verify", SLUG, "--strict", "--json"]);
      expect(result.status).toBe(1);
      const messages = JSON.stringify(JSON.parse(result.stdout).specs[0].findings);
      expect(messages).toContain("UNSIGNED_COMMIT");
    });

    it("fails an approval signed by a key the policy does not list for the approver", async () => {
      await fx.approve(ALL, "mallory");

      const result = await fx.cli(["verify", SLUG, "--strict", "--json"]);
      expect(result.status).toBe(1);
      expect(JSON.stringify(JSON.parse(result.stdout).specs[0].findings)).toContain(
        "SIGNER_NOT_AUTHORIZED",
      );
    });

    it("fails an approval whose signed commit carries Claude Code's Co-Authored-By trailer", async () => {
      await fx.approve(ALL, "alice", { trailer: "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" });

      const result = await fx.cli(["verify", SLUG, "--json"]);
      expect(result.status).toBe(1);
      expect(JSON.stringify(JSON.parse(result.stdout).specs[0].findings)).toContain("FROM_ASSISTANT");
    });

    it("fails an approval whose signed commit also changes other files", async () => {
      fx.write("src/feature.ts", "export const x = 1;\n");
      await fx.approve(ALL, "alice", { alsoCommit: "src/feature.ts" });

      const result = await fx.cli(["verify", SLUG, "--json"]);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        "an Approval Signal commit may change only the spec's ledger",
      );
    });

    it("fails once an approved artifact is edited after approval", async () => {
      await fx.approve(ALL, "alice");
      await completeAll();
      expect((await fx.cli(["verify", SLUG, "--strict"])).status).toBe(0);

      fx.writeArtifact("requirements", REQUIREMENTS.replace("do one thing", "do two things"));
      fx.commit("edit requirements after approval");

      const result = await fx.cli(["verify", SLUG, "--strict", "--json"]);
      expect(result.status).toBe(1);
      expect(JSON.stringify(JSON.parse(result.stdout).specs[0].findings)).toContain(
        "CHECKSUM_MISMATCH",
      );
    });

    it("fails a ledger whose last entries were removed", async () => {
      await fx.approve(ALL, "alice");
      await completeAll();
      const lines = readFileSync(fx.ledgerPath, "utf8")
        .split("\n")
        .filter((l) => l !== "");
      writeFileSync(fx.ledgerPath, `${lines.slice(0, -2).join("\n")}\n`);

      const result = await fx.cli(["verify", SLUG, "--json"]);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("LEDGER_INTEGRITY");
    });

    it("is INCONCLUSIVE (exit 2) when no spec is in progress", async () => {
      fx.writeArtifact("requirements", REQUIREMENTS);
      const draft = fx
        .read(`.agents/specs/${SLUG}/requirements.md`)
        .replace("IN_PROGRESS", "DRAFT");
      fx.write(`.agents/specs/${SLUG}/requirements.md`, draft);
      const result = await fx.cli(["verify"]);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("no spec to verify");
    });

    describe("against the target branch's Approval Policy (criterion 7.10)", () => {
      let base: string;

      /** On a branch off `base`, list mallory's key for alice in the policy and commit it. */
      function addMalloryKeyOnBranch(): void {
        base = fx.git(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
        fx.git(["checkout", "-q", "-b", "feature"]);
        const policy = JSON.parse(fx.read(".sdlc/policy.json"));
        const malloryPub = readFileSync(`${fx.key("mallory")}.pub`, "utf8").trim();
        policy.approval.approvers[0].keys.push({
          type: "ssh",
          fingerprint: sshPublicKeyFingerprint(malloryPub),
          public_key: malloryPub,
        });
        fx.write(".sdlc/policy.json", JSON.stringify(policy, null, 2));
        fx.commit("list another key for alice");
      }

      it("does not count an approval signed by a key the change itself added to the policy", async () => {
        addMalloryKeyOnBranch();
        await fx.approve(ALL, "mallory");
        await completeAll();

        // Judged by the working tree's policy, the change approves itself.
        expect((await fx.cli(["verify", SLUG])).status).toBe(0);

        const result = await fx.cli(["verify", SLUG, "--json"], { targetBranch: base });
        expect(result.status).toBe(1);
        expect(JSON.stringify(JSON.parse(result.stdout).specs[0].findings)).toContain(
          "SIGNER_NOT_AUTHORIZED",
        );
      });

      it("passes approvals signed by a key the target branch lists, naming the policy it used", async () => {
        addMalloryKeyOnBranch();
        await fx.approve(ALL, "alice");
        await completeAll();

        const result = await fx.cli(["verify", SLUG], { targetBranch: base });
        expect(result.stdout).toContain(`Approval Policy: ${base}:.sdlc/policy.json (the target branch's)`);
        expect(result.stdout).toContain("Result: PASS");
        expect(result.status).toBe(0);
      });

      it("counts no approval when the target branch has no policy, even if the change adds one", async () => {
        base = fx.git(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
        fx.git(["checkout", "-q", "-b", "without-policy"]);
        fx.git(["rm", "-q", ".sdlc/policy.json"]);
        fx.commit("no policy yet");
        fx.git(["checkout", "-q", base]);
        await fx.approve(ALL, "alice");
        await completeAll();

        const result = await fx.cli(["verify", SLUG], { targetBranch: "without-policy" });
        expect(result.stdout).toContain("Approval Policy: missing (without-policy:.sdlc/policy.json)");
        expect(result.status).toBe(1);
      });

      it("is INCONCLUSIVE, never the working tree's policy, when the target branch is not in the clone", async () => {
        await fx.approve(ALL, "alice");
        await completeAll();

        const result = await fx.cli(["verify", SLUG], { targetBranch: "not-fetched" });
        expect(result.status).toBe(2);
        expect(result.stderr).toContain("the target branch not-fetched is not in this clone");
      });

      it("reads the remote-tracking branch before a local branch of the same name", async () => {
        addMalloryKeyOnBranch();
        // A local branch named like the target, carrying the change's policy.
        fx.git(["branch", "-q", "release", "feature"]);
        fx.git(["update-ref", "refs/remotes/origin/release", base]);
        await fx.approve(ALL, "mallory");
        await completeAll();

        const result = await fx.cli(["verify", SLUG, "--json"], { targetBranch: "release" });
        expect(result.status).toBe(1);
        expect(result.stdout).toContain("SIGNER_NOT_AUTHORIZED");
      });
    });
  });

  describe("doctor", () => {
    it("passes a healthy repository and marks unimplemented categories NOT_CHECKED", async () => {
      const result = await fx.cli(["doctor", "--json"]);
      expect(result.status).toBe(0);
      const diagnostics = JSON.parse(result.stdout).diagnostics as {
        category: string;
        outcome: string;
      }[];
      expect(diagnostics.find((d) => d.category === "Approval Policy")?.outcome).toBe("PASS");
      expect(diagnostics.find((d) => d.category === "Ledger integrity")?.outcome).toBe("PASS");
      expect(diagnostics.find((d) => d.category === "Repository hooks")?.outcome).toBe(
        "NOT_CHECKED",
      );
    });

    it("fails a damaged ledger and an untracked spec document", async () => {
      await fx.approve(["requirements"], "alice");
      writeFileSync(
        fx.ledgerPath,
        readFileSync(fx.ledgerPath, "utf8").replace("alice@", "mallory@"),
      );
      fx.write(`.agents/specs/${SLUG}/draft.md`, "notes\n");

      const result = await fx.cli(["doctor"]);
      expect(result.status).toBe(1);
      expect(result.stdout).toMatch(/FAIL\s+Ledger integrity/);
      expect(result.stdout).toMatch(/FAIL\s+Untracked spec documents: .*draft\.md/);
    });
  });

  describe("adopt and stamp", () => {
    const SPEC = `.agents/specs/${SLUG}`;
    const file = (kind: string) => `${SPEC}/${kind}.md`;
    /** The spec as spec-new leaves it: bare Markdown, no Machine Folder. */
    const legacy = (kinds: Partial<Record<(typeof ALL)[number], string>>) => {
      fx.git(["rm", "-rq", SPEC]);
      rmSync(`${fx.repo}/${SPEC}`, { recursive: true, force: true });
      for (const [kind, body] of Object.entries(kinds)) fx.write(file(kind), body);
    };
    const fm = (kind: string) =>
      Object.fromEntries(
        (/^---\n([\s\S]*?)\n---\n/.exec(fx.read(file(kind)))?.[1] ?? "")
          .split("\n")
          .map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()]),
      );
    const status = async () =>
      JSON.parse((await fx.cli(["status", SLUG, "--json"])).stdout).specs[0];
    const tree = () => {
      const hash = createHash("sha256");
      for (const kind of ALL) {
        try {
          hash.update(fx.read(file(kind)));
        } catch {
          hash.update(`no ${kind}`);
        }
      }
      return `${hash.digest("hex")} ${existsSync(fx.ledgerPath)}`;
    };

    it("status names the adopt command for a bare spec; adopt adds frontmatter, bodies unchanged, and one adoption entry", async () => {
      legacy({ requirements: REQUIREMENTS });
      expect(await status()).toEqual({
        specId: SLUG,
        legacy: true,
        legacyStage: "design",
        next: `npx vellum adopt ${SLUG}`,
      });
      expect((await fx.cli(["status", SLUG])).stdout).toContain(
        `Adopt it: npx vellum adopt ${SLUG}`,
      );

      const result = await fx.cli(["adopt", SLUG]);
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(
        `Adopted ${SLUG}: Recorded Lifecycle State IN_REVIEW, no approvals.`,
      );
      const text = fx.read(file("requirements"));
      expect(text.endsWith(`\n---\n${REQUIREMENTS}`)).toBe(true);
      expect(fm("requirements")).toMatchObject({ version: "1", state: "IN_REVIEW" });

      const ledger = await fx.ledger();
      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toMatchObject({
        kind: "adoption",
        id: 1,
        predecessor_digest: null,
        from: "legacy",
        to: "managed",
      });
      expect(checkLedgerIntegrity(ledger, await readLedgerHead(fx.ledgerPath)).valid).toBe(true);

      const spec = await status();
      expect(spec).toMatchObject({ recordedState: "IN_REVIEW", effectiveState: "IN_REVIEW" });
      expect(spec.artifacts.requirements).toMatchObject({ version: 1, checksumCurrent: true });
      expect(spec.approvals.requirements).toMatchObject({ current: 0 });
      expect((await fx.cli(["lint", SLUG, "--json"])).stdout).not.toContain("LEDGER_SCHEMA");

      // A second adopt changes nothing.
      const before = tree();
      const again = await fx.cli(["adopt", SLUG]);
      expect(again.status).toBe(0);
      expect(again.stdout).toContain("already adopted");
      expect(tree()).toBe(before);
      expect(await fx.ledger()).toHaveLength(1);
    });

    it("adopt records the in-review state of the latest artifact present", async () => {
      legacy({ requirements: REQUIREMENTS, design: DESIGN, tasks: TASKS });
      const result = await fx.cli(["adopt", SLUG, "--json"]);
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        command: "adopt",
        result: "ADOPTED",
        recordedState: "PLAN_IN_REVIEW",
      });
      for (const kind of ALL)
        expect(fm(kind)).toMatchObject({ version: "1", state: "PLAN_IN_REVIEW" });
    });

    it("adopt refuses a later artifact without an earlier one, naming it and writing nothing", async () => {
      legacy({ design: DESIGN });
      const before = tree();
      const result = await fx.cli(["adopt", SLUG]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("design.md exists without requirements.md");
      expect(tree()).toBe(before);
      expect((await status()).adoptionProblem).toContain(
        "design.md exists without requirements.md",
      );
    });

    it("stamp refuses a spec that is not adopted, naming adopt", async () => {
      legacy({ requirements: REQUIREMENTS });
      const result = await fx.cli(["stamp", SLUG]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`run npx vellum adopt ${SLUG}`);
    });

    it("stamp gives an artifact written after adoption its frontmatter and raises the recorded state, appending nothing", async () => {
      legacy({ requirements: REQUIREMENTS });
      expect((await fx.cli(["adopt", SLUG])).status).toBe(0);
      fx.write(file("design"), DESIGN);

      const unreadable = await status();
      expect(unreadable.result).toBe("INCONCLUSIVE");
      expect(unreadable.next).toBe(`npx vellum stamp ${SLUG}`);
      const adoptAgain = await fx.cli(["adopt", SLUG]);
      expect(adoptAgain.status).toBe(1);
      expect(adoptAgain.stderr).toContain(`run npx vellum stamp ${SLUG}`);

      const result = await fx.cli(["stamp", SLUG]);
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(fx.read(file("design")).endsWith(`\n---\n${DESIGN}`)).toBe(true);
      expect(fm("design")).toMatchObject({ version: "1", state: "DESIGN_IN_REVIEW" });
      expect(fm("requirements")).toMatchObject({ version: "1", state: "DESIGN_IN_REVIEW" });
      expect(await fx.ledger()).toHaveLength(1);

      const current = await fx.cli(["stamp", SLUG, "--json"]);
      expect(JSON.parse(current.stdout)).toMatchObject({ result: "CURRENT", artifacts: [] });
    });

    it("approve refuses a stale frontmatter checksum naming stamp; after stamp it binds the new version", async () => {
      await fx.approve(["requirements"], "alice");
      const text = fx.read(file("design"));
      fx.write(
        file("design"),
        text.replace("**Property 2: Second**", "**Property 2: Second, reworded**"),
      );

      const refused = await fx.cli(["approve", SLUG, "design"], { interactive: true });
      expect(refused.status).toBe(1);
      expect(refused.stderr).toContain("the frontmatter of design.md is stale");
      expect(refused.stderr).toContain(`npx vellum stamp ${SLUG}`);
      expect(await fx.ledger()).toHaveLength(1);

      const stamped = await fx.cli(["stamp", SLUG]);
      expect(stamped.status).toBe(0);
      expect(stamped.stdout).toContain("design.md: v2");
      expect(fm("design")).toMatchObject({ version: "2" });
      // The recorded state (IN_PROGRESS) is ahead of DESIGN_IN_REVIEW: it is not lowered.
      expect(fm("requirements").state).toBe("IN_PROGRESS");

      const approved = await fx.cli(["approve", SLUG, "design"], { interactive: true });
      expect(approved.status).toBe(0);
      expect((await fx.ledger()).at(-1)).toMatchObject({
        kind: "approval",
        artifact: "design.md",
        artifact_version: 2,
      });
    });
  });

  describe("a spec approved and started under Vellum 0.1.2 (checksum form 1)", () => {
    const SPEC = `.agents/specs/${SLUG}`;
    /** Wrapped prose (design's Property lines read as one paragraph) and blank-line runs: the form-1 and form-2 checksums differ. */
    const WRAPPED = {
      requirements: REQUIREMENTS.replace(
        "# Requirements\n",
        "# Requirements\n\nA demo spec whose introduction\nwraps.\n\n\n",
      ),
      design: DESIGN,
      tasks: TASKS.replace("# Tasks\n", "# Tasks\n\nBuild both things,\nin order.\n\n\n"),
    };
    /** An artifact file exactly as 0.1.2 stamped it: the frontmatter checksum in form 1. */
    const v012File = (body: string) =>
      withFrontmatter(body).replace(computeChecksum(body), computeChecksumInForm(body, 1));
    const fm = (kind: string) => fx.read(`${SPEC}/${kind}.md`).split("\n---\n")[0]!;

    beforeEach(async () => {
      for (const kind of ALL) {
        expect(computeChecksumInForm(WRAPPED[kind], 1)).not.toBe(computeChecksum(WRAPPED[kind]));
        fx.write(`${SPEC}/${kind}.md`, v012File(WRAPPED[kind]));
      }
      fx.commit("spec as Vellum 0.1.2 left it");
      await fx.approve(ALL, "alice", { v012: true });
      const ledger = await fx.ledger();
      expect(ledger.every((e) => !("checksum_form" in e))).toBe(true);
      // Task 1 was started under 0.1.2: a form-1 Task Binding.
      await appendLedgerEntry(fx.ledgerPath, {
        kind: "task_binding",
        id: ledger.length + 1,
        timestamp: "2026-09-26T10:10:00Z",
        task_id: "1",
        requirements_version: 1,
        requirements_checksum: computeChecksumInForm(WRAPPED.requirements, 1),
        design_version: 1,
        design_checksum: computeChecksumInForm(WRAPPED.design, 1),
        plan_version: 1,
        plan_checksum: computeChecksumInForm(WRAPPED.tasks, 1),
      });
    });

    it("keeps its approvals: status counts them and lint accepts the form-1 frontmatter", async () => {
      const status = JSON.parse((await fx.cli(["status", SLUG, "--json"])).stdout).specs[0];
      for (const kind of ALL) {
        expect(status.approvals[kind]).toEqual({ current: 1, required: 1, complete: true });
      }
      expect(status.artifacts.requirements).toMatchObject({
        checksumCurrent: false,
        checksumEarlierForm: true,
      });
      const human = await fx.cli(["status", SLUG]);
      expect(human.stdout).toContain("frontmatter checksum is in an earlier form (body unchanged)");

      const lint = await fx.cli(["lint", SLUG]);
      expect(lint.status).toBe(0);
    });

    it("completes the task 0.1.2 started, and starts the next with a form-2 binding", async () => {
      const complete = await fx.cli(["task", "complete", SLUG, "1", "--command=true"]);
      expect(complete.stderr).not.toContain("refused");
      expect(complete.status).toBe(0);

      const start = await fx.cli(["task", "start", SLUG, "2"]);
      expect(start.stderr).toBe("");
      expect(start.status).toBe(0);
      expect((await fx.ledger()).at(-1)).toMatchObject({
        kind: "task_binding",
        task_id: "2",
        requirements_checksum: computeChecksum(WRAPPED.requirements),
        checksum_form: 2,
      });
    });

    it("stops counting an approval once the approved content changes", async () => {
      fx.write(
        `${SPEC}/requirements.md`,
        v012File(WRAPPED.requirements).replace("do one thing", "do two things"),
      );
      const start = await fx.cli(["task", "start", SLUG, "2"]);
      expect(start.status).toBe(1);
      expect(start.stderr).toContain("Requirements approval invalidated");
      const complete = await fx.cli(["task", "complete", SLUG, "1", "--command=true"]);
      expect(complete.status).toBe(1);
      expect(complete.stderr).toContain("requirements.md changed since task 1 started");
    });

    it("approve asks for stamp, which moves the form without a new version; approvals still count", async () => {
      const refused = await fx.cli(["approve", SLUG, "requirements"], { interactive: true });
      expect(refused.status).toBe(1);
      expect(refused.stderr).toContain("records its checksum in an earlier form");
      expect(refused.stderr).toContain(`npx vellum stamp ${SLUG}`);

      const stamped = await fx.cli(["stamp", SLUG]);
      expect(stamped.status).toBe(0);
      for (const kind of ALL) {
        expect(fm(kind)).toContain("version: 1\n");
        expect(fm(kind)).toContain(`checksum: ${computeChecksum(WRAPPED[kind])}`);
      }
      const status = JSON.parse((await fx.cli(["status", SLUG, "--json"])).stdout).specs[0];
      for (const kind of ALL) {
        expect(status.approvals[kind]).toEqual({ current: 1, required: 1, complete: true });
        expect(status.artifacts[kind]).toMatchObject({ version: 1, checksumCurrent: true });
      }

      const approved = await fx.cli(["approve", SLUG, "requirements"], { interactive: true });
      expect(approved.status).toBe(0);
      expect((await fx.ledger()).at(-1)).toMatchObject({
        kind: "approval",
        artifact_checksum: computeChecksum(WRAPPED.requirements),
        checksum_form: 2,
      });
    });
  });

  describe("context", () => {
    it("prints the task's briefing with the criteria and Properties it cites, writing nothing", async () => {
      const before = fx.git(["status", "--porcelain", "--untracked-files=all"]);
      const result = await fx.cli(["context", SLUG, "1"]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(`# Task 1 — ${SLUG}`);
      expect(result.stdout).toContain("SHALL do one thing");
      expect(result.stdout).not.toContain("SHALL do another thing");
      expect(fx.git(["status", "--porcelain", "--untracked-files=all"])).toBe(before);
    });

    it("with --json prints the briefing document", async () => {
      const result = await fx.cli(["context", "demo", "2", "--json"]);
      expect(result.status).toBe(0);
      const doc = JSON.parse(result.stdout);
      expect(doc.spec).toBe(SLUG);
      expect(doc.task.id).toBe("2");
      expect(doc.criteria.map((c: { id: string }) => c.id)).toEqual(["1.2"]);
      expect(doc.properties.map((p: { id: string }) => p.id)).toEqual(["P2"]);
      expect(doc.missing).toEqual([]);
    });

    it("exits 1 for a task tasks.md does not define, and 2 for a usage error or unmatched spec", async () => {
      const undefinedTask = await fx.cli(["context", SLUG, "9"]);
      expect(undefinedTask.status).toBe(1);
      expect(undefinedTask.stderr).toContain(`${SLUG}/tasks.md defines no task 9`);
      expect((await fx.cli(["context", SLUG])).status).toBe(2);
      expect((await fx.cli(["context", "nope", "1"])).status).toBe(2);
    });
  });

  describe("command surface", () => {
    it("exits 2 with 'not implemented' for sync, and a usage error for adopt or stamp without a spec", async () => {
      const sync = await fx.cli(["sync"]);
      expect(sync.status).toBe(2);
      expect(sync.stderr).toContain("not implemented");
      expect(sync.stdout).toBe("");
      for (const command of ["adopt", "stamp"]) {
        const result = await fx.cli([command]);
        expect(result.status).toBe(2);
        expect(result.stderr).toContain(`usage: vellum ${command} <spec>`);
      }
    });

    it("exits 2 for an unknown command, listing the implemented ones", async () => {
      const result = await fx.cli(["frobnicate"]);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("Implemented commands: status, lint, verify");
    });

    it("exits 2 for an option the command does not declare", async () => {
      const result = await fx.cli(["status", "--fast"]);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("no option --fast");
    });

    it("lists in help only commands that exist, and names the ones that do not", async () => {
      const result = await fx.cli(["--help"]);
      expect(result.status).toBe(0);
      expect(result.stdout).not.toMatch(/^\s+sync\b/m);
      expect(result.stdout).toMatch(/^\s+check \[spec\]/m);
      expect(result.stdout).toMatch(/^\s+adopt <spec>/m);
      expect(result.stdout).toMatch(/^\s+stamp <spec>/m);
      expect(result.stdout).toContain("Not implemented in this version (exit 2): sync.");
    });
  });
});
