/**
 * A real git repository in os.tmpdir() holding one managed spec, an Approval
 * Policy listing a throwaway SSH key generated per fixture, and helpers to
 * run the CLI against it. No key material leaves the temp directory.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHECKSUM_FORM, computeChecksum, computeChecksumInForm } from "@vellum/protocol";
import { appendLedgerEntry, readLedger, sshPublicKeyFingerprint } from "@vellum/storage";
import type { CliContext } from "../context.js";
import { run } from "../run.js";

export const SLUG = "001-demo";

export const REQUIREMENTS = `# Requirements

### Requirement 1: One

#### Acceptance Criteria

1.1 WHEN a thing happens, THE System SHALL do one thing.
1.2 WHEN another thing happens, THE System SHALL do another thing.
`;

export const DESIGN = `# Design

**Property 1: First**
**Validates: Requirements 1.1**

**Property 2: Second**
**Validates: Requirements 1.2**
`;

export const TASKS = `# Tasks

- [ ] 1 Build the first thing <!-- criteria: 1.1 --> <!-- properties: P1 -->
- [ ] 2 Build the second thing <!-- criteria: 1.2 --> <!-- properties: P2 -->
`;

/** An artifact file with Lifecycle Frontmatter whose checksum matches `body`. */
export function withFrontmatter(body: string, version = 1): string {
  return [
    "---",
    `version: ${version}`,
    `checksum: ${computeChecksum(body)}`,
    "state: IN_PROGRESS",
    "createdAt: 2026-09-26T10:00:00Z",
    "updatedAt: 2026-09-26T10:00:00Z",
    "---",
    body,
  ].join("\n");
}

/** Captured result of one CLI run. */
export interface CliResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

export class Fixture {
  readonly root: string;
  readonly repo: string;
  readonly specDir: string;
  readonly ledgerPath: string;
  private readonly gitEnv: NodeJS.ProcessEnv;

  constructor() {
    this.root = mkdtempSync(join(tmpdir(), "vellum-cli-"));
    this.repo = join(this.root, "repo");
    this.specDir = join(this.repo, ".agents", "specs", SLUG);
    this.ledgerPath = join(this.specDir, ".sdlc", "ledger.jsonl");
    const gitconfig = join(this.root, "gitconfig");
    writeFileSync(gitconfig, "");
    // The CLI runs git through the same process environment.
    process.env.GIT_CONFIG_GLOBAL = gitconfig;
    process.env.GIT_CONFIG_NOSYSTEM = "1";
    this.gitEnv = { ...process.env };

    for (const name of ["alice", "mallory"]) {
      execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", name, "-f", this.key(name)]);
    }

    mkdirSync(join(this.specDir, ".sdlc"), { recursive: true });
    mkdirSync(join(this.repo, ".sdlc"), { recursive: true });
    execFileSync("git", ["init", "-q", this.repo]);
    this.git(["config", "user.name", "Alice"]);
    this.git(["config", "user.email", "alice@example.com"]);
    this.git(["config", "commit.gpgsign", "false"]);

    const alicePub = readFileSync(`${this.key("alice")}.pub`, "utf8").trim();
    this.write(
      ".sdlc/policy.json",
      JSON.stringify(
        {
          schema_version: "1.0",
          repository: "fixture",
          approval: {
            schema_version: "1.0",
            approvers: [
              {
                email: "alice@example.com",
                authorised_for: ["standard"],
                keys: [
                  { type: "ssh", fingerprint: sshPublicKeyFingerprint(alicePub), public_key: alicePub },
                ],
              },
            ],
            requirements: { standard: { count: 1 } },
          },
        },
        null,
        2,
      ),
    );
    this.writeArtifact("requirements", REQUIREMENTS);
    this.writeArtifact("design", DESIGN);
    this.writeArtifact("tasks", TASKS);
    writeFileSync(this.ledgerPath, "");
    this.write("package.json", "{}\n");
    this.commit("initial");
  }

  key(name: string): string {
    return join(this.root, `${name}_key`);
  }

  git(args: readonly string[]): string {
    return execFileSync("git", [...args], {
      cwd: this.repo,
      encoding: "utf8",
      env: this.gitEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  write(path: string, content: string): void {
    const full = join(this.repo, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }

  read(path: string): string {
    return readFileSync(join(this.repo, path), "utf8");
  }

  writeArtifact(kind: "requirements" | "design" | "tasks", body: string): void {
    this.write(`.agents/specs/${SLUG}/${kind}.md`, withFrontmatter(body));
  }

  /** Commit everything, unsigned. */
  commit(message: string): string {
    this.git(["add", "-A"]);
    this.git(["commit", "-q", "--allow-empty", "-m", message]);
    return this.git(["rev-parse", "HEAD"]).trim();
  }

  /**
   * Write an approval record for each kind through the programmatic
   * interface (what `vellum approve` writes; the command itself refuses a
   * non-terminal session) and commit only the ledger files, signed with
   * `signer`'s key, or unsigned when `signer` is null. With `v012`, each
   * record is written exactly as Vellum 0.1.2 wrote one: the checksum in
   * form 1 and no `checksum_form`.
   */
  async approve(
    kinds: readonly ("requirements" | "design" | "tasks")[],
    signer: string | null,
    options: { alsoCommit?: string; v012?: boolean } = {},
  ): Promise<void> {
    for (const kind of kinds) {
      const ledger = await readLedger(this.ledgerPath);
      const body = this.read(`.agents/specs/${SLUG}/${kind}.md`).split("\n---\n").slice(1).join("\n---\n");
      await appendLedgerEntry(this.ledgerPath, {
        kind: "approval",
        id: (ledger[ledger.length - 1]?.id ?? 0) + 1,
        timestamp: "2026-09-26T10:05:00Z",
        artifact: `${kind}.md`,
        artifact_version: 1,
        ...(options.v012
          ? { artifact_checksum: computeChecksumInForm(body, 1) }
          : { artifact_checksum: computeChecksum(body), checksum_form: CHECKSUM_FORM }),
        identity: "alice@example.com",
        identity_key: "",
        session_type: "human",
        approval_signal: { commit: null, message_prefix: "approve:" },
      });
    }
    const paths = [
      `.agents/specs/${SLUG}/.sdlc/ledger.jsonl`,
      `.agents/specs/${SLUG}/.sdlc/ledger.head.json`,
      ...(options.alsoCommit ? [options.alsoCommit] : []),
    ];
    this.git(["add", ...paths]);
    const sign =
      signer === null
        ? []
        : ["-c", "gpg.format=ssh", "-c", `user.signingkey=${this.key(signer)}`, "commit", "-S"];
    this.git([...(sign.length > 0 ? sign : ["commit"]), "-q", "-m", `approve: ${kinds.join(", ")}`]);
  }

  /** Run the CLI in the repository with captured output. */
  async cli(argv: readonly string[], overrides: Partial<CliContext> = {}): Promise<CliResult> {
    let stdout = "";
    let stderr = "";
    const ctx: CliContext = {
      json: false,
      cwd: this.repo,
      ci: false,
      interactive: false,
      assistantSession: null,
      stdout: { write: (chunk: string) => (stdout += chunk) },
      stderr: { write: (chunk: string) => (stderr += chunk) },
      ...overrides,
    };
    const status = await run(argv, ctx);
    return { status, stdout, stderr };
  }

  async ledger() {
    return readLedger(this.ledgerPath);
  }

  dispose(): void {
    rmSync(this.root, { recursive: true, force: true });
  }
}
