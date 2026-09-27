/**
 * A real git repository in os.tmpdir() holding one managed spec
 * (IN_PROGRESS, no approvals) and no Approval Policy.
 */

import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHECKSUM_FORM, computeChecksum } from "@vellum/protocol";
import { appendLedgerEntry, readLedger } from "@vellum/storage";

export const SLUG = "001-demo";

const BODIES = {
  requirements: `# Requirements

### Requirement 1: One

#### Acceptance Criteria

1.1 WHEN a thing happens, THE System SHALL do one thing.
`,
  design: `# Design

**Property 1: First**
**Validates: Requirements 1.1**
`,
  tasks: `# Tasks

- [ ] 1 Build the first thing <!-- criteria: 1.1 --> <!-- properties: P1 -->
`,
} as const;

export type Kind = keyof typeof BODIES;

export function withFrontmatter(body: string): string {
  return [
    "---",
    "version: 1",
    `checksum: ${computeChecksum(body)}`,
    "state: IN_PROGRESS",
    "createdAt: 2026-09-26T10:00:00Z",
    "updatedAt: 2026-09-26T10:00:00Z",
    "---",
    body,
  ].join("\n");
}

export class Fixture {
  readonly base: string;
  readonly repo: string;
  readonly specDir: string;
  readonly ledgerPath: string;
  readonly env: NodeJS.ProcessEnv;

  constructor() {
    this.base = mkdtempSync(join(tmpdir(), "vellum-mcp-"));
    this.repo = join(this.base, "repo");
    this.specDir = join(this.repo, ".agents", "specs", SLUG);
    this.ledgerPath = join(this.specDir, ".sdlc", "ledger.jsonl");
    const gitconfig = join(this.base, "gitconfig");
    writeFileSync(gitconfig, "");
    // The server runs git through the same process environment.
    process.env.GIT_CONFIG_GLOBAL = gitconfig;
    process.env.GIT_CONFIG_NOSYSTEM = "1";
    this.env = { ...process.env };

    mkdirSync(join(this.specDir, ".sdlc"), { recursive: true });
    execFileSync("git", ["init", "-q", this.repo]);
    this.git(["config", "user.name", "Alice"]);
    this.git(["config", "user.email", "alice@example.com"]);
    this.git(["config", "commit.gpgsign", "false"]);
    for (const kind of Object.keys(BODIES) as Kind[])
      this.writeArtifact(kind, BODIES[kind]);
    writeFileSync(this.ledgerPath, "");
    this.commit("initial");
  }

  git(args: readonly string[]): string {
    return execFileSync("git", [...args], {
      cwd: this.repo,
      encoding: "utf8",
      env: this.env,
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

  writeArtifact(kind: Kind, body: string): void {
    this.write(`.agents/specs/${SLUG}/${kind}.md`, withFrontmatter(body));
  }

  commit(message: string): void {
    this.git(["add", "-A"]);
    this.git(["commit", "-q", "--allow-empty", "-m", message]);
  }

  /** Append an (unsigned, so invalid) approval record for `kind` through the programmatic interface. */
  async appendApproval(kind: Kind): Promise<void> {
    const ledger = await readLedger(this.ledgerPath);
    await appendLedgerEntry(this.ledgerPath, {
      kind: "approval",
      id: (ledger[ledger.length - 1]?.id ?? 0) + 1,
      timestamp: "2026-09-26T10:05:00Z",
      artifact: `${kind}.md`,
      artifact_version: 1,
      artifact_checksum: computeChecksum(BODIES[kind]),
      checksum_form: CHECKSUM_FORM,
      identity: "alice@example.com",
      identity_key: "",
      session_type: "human",
      approval_signal: { commit: null, message_prefix: "approve:" },
    });
  }

  dispose(): void {
    rmSync(this.base, { recursive: true, force: true });
  }
}
