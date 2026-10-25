/**
 * @vellum/storage — Git Operations
 *
 * Thin adapter over `git` CLI using child_process.execFileSync.
 * NOT isomorphic-git - requires git CLI on system.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { GitReader, GitWriter, GitStatus, GitCommit } from "@vellum/protocol";
import { brand, isValidGitSha } from "@vellum/protocol";

/**
 * Create a Git reader/writer for a repository.
 */
export function createGitOps(workingDir: string): GitReader & GitWriter {
  return new GitOpsImpl(workingDir);
}

class GitOpsImpl implements GitReader, GitWriter {
  constructor(private readonly workingDir: string) {
    if (!existsSync(join(workingDir, ".git"))) {
      throw new Error(`Not a git repository: ${workingDir}`);
    }
  }

  async getHead(): Promise<ReturnType<typeof brand<string, "CommitSha">>> {
    const sha = this.execGit(["rev-parse", "HEAD"]).trim();
    if (!isValidGitSha(sha)) {
      throw new Error(`Invalid HEAD SHA: ${sha}`);
    }
    return brand<string, "CommitSha">(sha);
  }

  async getCommit(sha: ReturnType<typeof brand<string, "CommitSha">>): Promise<GitCommit | null> {
    try {
      const format = "%H%n%an%n%ae%n%cn%n%ce%n%s%n%aI%n%GG";
      const output = this.execGit(["log", "-1", "--format=" + format, unbrand(sha)]);

      const lines = output.split("\n");
      const [
        fullSha,
        authorName,
        authorEmail,
        committerName,
        committerEmail,
        message,
        timestamp,
        signature,
      ] = lines;

      // Parse session metadata from trailers if present
      const sessionMetadata = this.parseSessionMetadata(message ?? "");

      return {
        sha: brand<string, "CommitSha">(fullSha ?? ""),
        author: { name: authorName ?? "", email: authorEmail ?? "" },
        committer: { name: committerName ?? "", email: committerEmail ?? "" },
        message: message ?? "",
        timestamp: timestamp ?? "",
        ...(signature && signature.trim() ? { signature: signature.trim() } : {}),
        ...(sessionMetadata ? { sessionMetadata } : {}),
      };
    } catch {
      return null;
    }
  }

  async isAncestor(
    ancestor: ReturnType<typeof brand<string, "CommitSha">>,
    descendant: ReturnType<typeof brand<string, "CommitSha">>,
  ): Promise<boolean> {
    try {
      this.execGit(["merge-base", "--is-ancestor", unbrand(ancestor), unbrand(descendant)]);
      return true;
    } catch {
      return false;
    }
  }

  async log(options?: { file?: string; limit?: number }): Promise<readonly GitCommit[]> {
    const format = "%H%n%an%n%ae%n%cn%n%ce%n%s%n%aI%n%GG%n---COMMIT---";
    const args = ["log", "--format=" + format];

    if (options?.limit) {
      args.push(`-${options.limit}`);
    }

    if (options?.file) {
      args.push("--", options.file);
    }

    const output = this.execGit(args);
    const commits = output
      .split("---COMMIT---\n")
      .filter((c) => c.trim())
      .map((commitStr) => this.parseCommitLog(commitStr))
      .filter((c): c is GitCommit => c !== null);

    return Object.freeze(commits);
  }

  async show(ref: string, path: string): Promise<string> {
    try {
      return this.execGit(["show", `${ref}:${path}`]);
    } catch {
      throw new Error(`File not found at ${ref}:${path}`);
    }
  }

  async status(): Promise<GitStatus> {
    const porcelain = this.execGit(["status", "--porcelain"]);
    const branch = this.execGit(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
    const head = await this.getHead();

    const modified: string[] = [];
    const staged: string[] = [];
    const untracked: string[] = [];

    for (const line of porcelain.split("\n")) {
      if (!line) continue;

      const index = line[0];
      const workTree = line[1];
      const path = line.slice(3);

      if (index !== " " && index !== "?") {
        staged.push(path);
      }

      if (workTree !== " " && workTree !== "?") {
        modified.push(path);
      }

      if (index === "?" && workTree === "?") {
        untracked.push(path);
      }
    }

    return {
      branch,
      head,
      modified: Object.freeze(modified),
      staged: Object.freeze(staged),
      untracked: Object.freeze(untracked),
      isClean: modified.length === 0 && staged.length === 0 && untracked.length === 0,
    };
  }

  async getCommitsUpTo(
    sha: ReturnType<typeof brand<string, "CommitSha">>,
  ): Promise<readonly GitCommit[]> {
    const commits = await this.log();
    const result: GitCommit[] = [];

    for (const commit of commits) {
      result.push(commit);
      if (commit.sha === sha) {
        break;
      }
    }

    return Object.freeze(result);
  }

  async createEmptyCommit(
    message: string,
    options?: { gpgSign?: boolean },
  ): Promise<ReturnType<typeof brand<string, "CommitSha">>> {
    const args = ["commit", "--allow-empty", "-m", message];

    if (options?.gpgSign) {
      args.push("-S");
    }

    this.execGit(args);
    return await this.getHead();
  }

  // GitWriter implementation
  async add(files: readonly string[]): Promise<void> {
    if (files.length === 0) return;
    this.execGit(["add", ...files]);
  }

  async commit(
    message: string,
    options?: { signoff?: boolean },
  ): Promise<ReturnType<typeof brand<string, "CommitSha">>> {
    const args = ["commit", "-m", message];
    if (options?.signoff) {
      args.push("--signoff");
    }
    this.execGit(args);
    return await this.getHead();
  }

  async tag(name: string, message: string): Promise<void> {
    this.execGit(["tag", "-a", name, "-m", message]);
  }

  private execGit(args: string[]): string {
    try {
      return execFileSync("git", args, {
        cwd: this.workingDir,
        encoding: "utf-8",
        maxBuffer: 50 * 1024 * 1024, // 50MB
      });
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Git command failed: git ${args.join(" ")}\n${error.message}`);
      }
      throw error;
    }
  }

  private parseCommitLog(commitStr: string): GitCommit | null {
    const lines = commitStr.trim().split("\n");
    if (lines.length < 7) return null;

    const [
      fullSha,
      authorName,
      authorEmail,
      committerName,
      committerEmail,
      message,
      timestamp,
      ...signatureLines
    ] = lines;

    if (!fullSha || !isValidGitSha(fullSha)) {
      return null;
    }

    const signature = signatureLines.join("\n").trim() || undefined;
    const sessionMetadata = this.parseSessionMetadata(message ?? "");

    return {
      sha: brand<string, "CommitSha">(fullSha),
      author: { name: authorName ?? "", email: authorEmail ?? "" },
      committer: { name: committerName ?? "", email: committerEmail ?? "" },
      message: message ?? "",
      timestamp: timestamp ?? "",
      ...(signature ? { signature } : {}),
      ...(sessionMetadata ? { sessionMetadata } : {}),
    };
  }

  private parseSessionMetadata(message: string): GitCommit["sessionMetadata"] {
    return parseSessionMetadata(message);
  }
}

/**
 * Read assistant-session markers from a commit message (its trailers
 * included): `Assistant: <name>`; a `Co-Authored-By:` / `Generated-By:`
 * trailer tagged `[<name>: assistant]`; Claude Code's own
 * `Co-Authored-By: <name> <noreply@anthropic.com>` trailer; or its
 * `Generated with [Claude Code]` line.
 */
export function parseSessionMetadata(message: string): GitCommit["sessionMetadata"] {
  const assistantPatterns = [
    /^assistant:\s*(\S+)/im,
    /^co-authored-by:.*\[(\S+):\s*assistant\]/im,
    /^generated-by:.*\[(\S+):\s*assistant\]/im,
    /^co-authored-by:\s*([^<\n]*?)\s*<noreply@anthropic\.com>/im,
    /generated with \[(claude code)\]/i,
  ];

  for (const pattern of assistantPatterns) {
    const match = message.match(pattern);
    if (match) {
      return {
        isAssistant: true,
        assistantName: match[1] || "Claude",
      };
    }
  }

  return undefined;
}

// Helper to unbrand for internal use
function unbrand<T, B>(branded: ReturnType<typeof brand<T, B>>): T {
  return branded;
}

// Signature verification lives in signature.ts (verifyCommitSigner): it checks
// a signature only against the Approval Policy's keys. There is deliberately
// no "does git consider this signature valid" helper here — that question
// accepts any key the verifying host trusts (criterion 7.3).
