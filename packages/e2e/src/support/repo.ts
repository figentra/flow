/**
 * A throwaway git repository under os.tmpdir() with everything a scenario
 * needs isolated inside one root directory:
 *
 *   <root>/home        HOME
 *   <root>/gnupg       GNUPGHOME (0700)
 *   <root>/gitconfig   GIT_CONFIG_GLOBAL; GIT_CONFIG_NOSYSTEM=1
 *   <root>/keys        SSH signing keys generated for this repository
 *   <root>/repo        the git work tree
 *
 * Commands run with an environment built from scratch — PATH, TMPDIR and the
 * paths above — so no CI flag, assistant-session marker, ssh-agent, signing
 * configuration or npm credential of the machine running the suite leaks in.
 * The `vellum` it runs is the bin installed from the packed tarball.
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { inject } from "vitest";
import { PROJECT_FILES, SLUG } from "./spec.js";

export interface Run {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type Kind = "requirements" | "design" | "tasks";
export const KINDS: readonly Kind[] = ["requirements", "design", "tasks"];

/** The identity the Approval Policy authorises, and the key it lists for it. */
export const HUMAN = { name: "Hana Human", email: "human@example.test", key: "human" } as const;
/** A key no policy lists. */
export const INTRUDER_KEY = "intruder";

/** "^D" and two backspaces: BSD script's echo of the EOF it reads from /dev/null. */
const BSD_EOF_ECHO = new RegExp(`^\\^D${String.fromCharCode(8).repeat(2)}`);

/** Does `util-linux` script (Linux) or BSD script (macOS) run here? */
function scriptFlavour(): "util-linux" | "bsd" {
  const probe = spawnSync("script", ["-V"], { encoding: "utf8" });
  return probe.status === 0 && /util-linux/.test(`${probe.stdout}${probe.stderr}`)
    ? "util-linux"
    : "bsd";
}

function shellQuote(word: string): string {
  return `'${word.replace(/'/g, `'\\''`)}'`;
}

export class TestRepo {
  readonly root: string;
  readonly repo: string;
  readonly env: NodeJS.ProcessEnv;
  private readonly binDir: string;

  /** A new repository with a policy, the greeter project, keys and one initial commit. */
  static create(): TestRepo {
    const root = mkdtempSync(join(tmpdir(), "vellum-e2e-"));
    const repo = new TestRepo(root);
    mkdirSync(join(root, "keys"));
    for (const name of [HUMAN.key, INTRUDER_KEY]) {
      execFileSync(
        "ssh-keygen",
        ["-q", "-t", "ed25519", "-N", "", "-C", name, "-f", repo.key(name)],
        {
          env: repo.env,
        },
      );
    }
    mkdirSync(repo.repo);
    repo.git(["init", "-q", "-b", "main"]);
    for (const [path, content] of Object.entries(PROJECT_FILES)) repo.write(path, content);
    repo.writePolicy();
    repo.commitAll("chore: greeter project and approval policy");
    return repo;
  }

  private constructor(root: string) {
    this.root = root;
    this.repo = join(root, "repo");
    this.binDir = inject("vellumBinDir");
    const home = join(root, "home");
    const gnupg = join(root, "gnupg");
    mkdirSync(home, { recursive: true });
    mkdirSync(gnupg, { recursive: true });
    chmodSync(gnupg, 0o700);
    const gitconfig = join(root, "gitconfig");
    writeFileSync(
      gitconfig,
      [
        "[user]",
        `\tname = ${HUMAN.name}`,
        `\temail = ${HUMAN.email}`,
        `\tsigningkey = ${this.key(HUMAN.key)}`,
        "[gpg]",
        "\tformat = ssh",
        "[commit]",
        "\tgpgsign = false",
        "[init]",
        "\tdefaultBranch = main",
        "",
      ].join("\n"),
    );
    this.env = {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      TMPDIR: process.env.TMPDIR ?? tmpdir(),
      LANG: "C.UTF-8",
      HOME: home,
      GNUPGHOME: gnupg,
      GIT_CONFIG_GLOBAL: gitconfig,
      GIT_CONFIG_NOSYSTEM: "1",
    };
  }

  /** An independent copy of this repository (work tree, keys, config). */
  clone(): TestRepo {
    const root = mkdtempSync(join(tmpdir(), "vellum-e2e-"));
    rmSync(root, { recursive: true, force: true });
    cpSync(this.root, root, { recursive: true });
    return new TestRepo(root);
  }

  dispose(): void {
    rmSync(this.root, { recursive: true, force: true });
  }

  key(name: string): string {
    return join(this.root, "keys", name);
  }

  get specDir(): string {
    return `.agents/specs/${SLUG}`;
  }

  get ledgerPath(): string {
    return `${this.specDir}/.sdlc/ledger.jsonl`;
  }

  // ------------------------------------------------------------------ files

  write(path: string, content: string): void {
    const full = join(this.repo, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }

  read(path: string): string {
    return readFileSync(join(this.repo, path), "utf8");
  }

  /** The ledger's raw lines (empty when there is no ledger yet). */
  ledgerLines(): string[] {
    try {
      return this.read(this.ledgerPath)
        .split("\n")
        .filter((l) => l !== "");
    } catch {
      return [];
    }
  }

  ledger(): Array<Record<string, unknown>> {
    return this.ledgerLines().map((l) => JSON.parse(l) as Record<string, unknown>);
  }

  /** The marker character of task `id` in tasks.md. */
  marker(id: string): string | undefined {
    const escaped = id.replace(/\./g, "\\.");
    return new RegExp(`^\\s*- \\[(.)\\]\\*? ${escaped}[.*]?\\s`, "m").exec(
      this.read(`${this.specDir}/tasks.md`),
    )?.[1];
  }

  /**
   * A SHA-256 over what "nothing was written" means — to prove a command wrote
   * nothing: the commit HEAD names, `git status --porcelain=v1 -uall` (the
   * index against HEAD and the work tree, untracked files included), and the
   * path and bytes of every file outside `.git` (the ledger among them).
   *
   * `.git` is not hashed byte for byte: `git status` refreshes the stat cache
   * in `.git/index` when it runs, so a snapshot of `.git` can change between
   * two runs that wrote nothing. What the index records is covered by the
   * porcelain status instead.
   */
  fingerprint(): string {
    const hash = createHash("sha256");
    hash.update(this.git(["rev-parse", "HEAD"])).update("\0");
    hash.update(this.git(["status", "--porcelain=v1", "-uall"])).update("\0");
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir).sort()) {
        if (dir === this.repo && name === ".git") continue;
        const path = join(dir, name);
        const stat = statSync(path);
        if (stat.isDirectory()) walk(path);
        else
          hash
            .update(relative(this.repo, path))
            .update("\0")
            .update(readFileSync(path))
            .update("\0");
      }
    };
    walk(this.repo);
    return hash.digest("hex");
  }

  /** The fingerprint the Approval Policy lists for the human's key, as ssh-keygen prints it. */
  policyFingerprint(): string {
    return sshFingerprint(this.env, `${this.key(HUMAN.key)}.pub`);
  }

  writePolicy(keys: readonly string[] = [HUMAN.key]): void {
    const approverKeys = keys.map((name) => {
      const publicKey = readFileSync(`${this.key(name)}.pub`, "utf8").trim();
      return {
        type: "ssh",
        fingerprint: sshFingerprint(this.env, `${this.key(name)}.pub`),
        public_key: publicKey,
      };
    });
    this.write(
      ".sdlc/policy.json",
      `${JSON.stringify(
        {
          schema_version: "1.0",
          repository: "greeter",
          approval: {
            schema_version: "1.0",
            approvers: [{ email: HUMAN.email, authorised_for: ["standard"], keys: approverKeys }],
            requirements: { standard: { count: 1 } },
          },
        },
        null,
        2,
      )}\n`,
    );
  }

  /**
   * Write the spec's artifacts as the method's skills do — bare Markdown, one
   * document at a time — and bring each under management with the installed
   * CLI: `vellum adopt` after requirements.md (Lifecycle Frontmatter and the
   * adoption entry), `vellum stamp` after each later document. Nothing here
   * writes frontmatter or re-implements the protocol's checksum.
   */
  writeSpec(bodies: Readonly<Partial<Record<Kind, string>>>): void {
    for (const kind of KINDS) {
      const body = bodies[kind];
      if (body === undefined) continue;
      this.write(`${this.specDir}/${kind}.md`, body);
      this.expectVellum([kind === "requirements" ? "adopt" : "stamp", SLUG]);
    }
  }

  /**
   * Replace one artifact's body as an editing skill does — the frontmatter
   * block left as it was — then `vellum stamp`, which records the next
   * version and the new checksum.
   */
  rewriteBody(kind: Kind, body: string): void {
    const path = `${this.specDir}/${kind}.md`;
    const block = /^---\n[\s\S]*?\n---\n/.exec(this.read(path))?.[0];
    if (block === undefined) throw new Error(`${kind}.md has no frontmatter block`);
    this.write(path, `${block}${body}`);
    this.expectVellum(["stamp", SLUG]);
  }

  /** Set the Recorded Lifecycle State in the frontmatter of every artifact that exists. */
  setRecordedState(state: string): void {
    for (const kind of KINDS) {
      const path = `${this.specDir}/${kind}.md`;
      if (!existsSync(join(this.repo, path))) continue;
      this.write(path, this.read(path).replace(/^state: .*$/m, `state: ${state}`));
    }
  }

  frontmatter(kind: Kind): Record<string, string> {
    const text = this.read(`${this.specDir}/${kind}.md`);
    const block = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? "";
    return Object.fromEntries(
      block
        .split("\n")
        .map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()]),
    );
  }

  /** Run the installed `vellum`, throwing with its output unless it exits 0. */
  private expectVellum(args: readonly string[]): Run {
    const result = this.vellum(args);
    if (result.status !== 0) {
      throw new Error(
        `vellum ${args.join(" ")} exited ${result.status}: ${result.stdout}${result.stderr}`,
      );
    }
    return result;
  }

  // ------------------------------------------------------------------- git

  git(args: readonly string[]): string {
    return execFileSync("git", [...args], {
      cwd: this.repo,
      env: this.env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  /** Commit everything, unsigned. */
  commitAll(message: string): string {
    this.git(["add", "-A"]);
    this.git(["commit", "-q", "--allow-empty", "-m", message]);
    return this.git(["rev-parse", "HEAD"]).trim();
  }

  /**
   * Commit only the spec's ledger files as the human would after
   * `vellum approve`: signed with `key` (SSH), or unsigned when `key` is null.
   */
  commitLedger(message: string, key: string | null): string {
    const paths = [this.ledgerPath, `${this.specDir}/.sdlc/ledger.head.json`];
    this.git(["add", "--", ...paths]);
    const sign = key === null ? [] : ["-c", `user.signingkey=${this.key(key)}`];
    this.git([
      ...sign,
      "commit",
      "-q",
      ...(key === null ? [] : ["-S"]),
      "-m",
      message,
      "--",
      ...paths,
    ]);
    return this.git(["rev-parse", "HEAD"]).trim();
  }

  // ---------------------------------------------------------------- vellum

  /** Run the installed `vellum` with pipes (not a terminal). */
  vellum(args: readonly string[], extraEnv: NodeJS.ProcessEnv = {}): Run {
    const result = spawnSync(join(this.binDir, "vellum"), [...args], {
      cwd: this.repo,
      env: { ...this.env, ...extraEnv },
      encoding: "utf8",
    });
    if (result.error) throw result.error;
    return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
  }

  /**
   * Run the installed `vellum` inside a pseudo-terminal, as a person at a
   * terminal runs it: `script` gives it a tty on stdin and stdout, which is
   * what the CLI's human-session check reads. No flag or variable bypasses
   * that check; a terminal is what it asks for. stdout and stderr arrive
   * merged, as on a terminal.
   */
  vellumInTerminal(
    args: readonly string[],
    extraEnv: NodeJS.ProcessEnv = {},
  ): { status: number; output: string } {
    const command = [join(this.binDir, "vellum"), ...args];
    const argv =
      scriptFlavour() === "util-linux"
        ? ["-q", "-e", "-c", command.map(shellQuote).join(" "), "/dev/null"]
        : ["-q", "/dev/null", ...command];
    const result = spawnSync("script", argv, {
      cwd: this.repo,
      env: { ...this.env, TERM: "dumb", ...extraEnv },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error) throw result.error;
    // BSD script echoes the EOF it read from /dev/null as "^D" + two backspaces.
    const output = `${result.stdout}${result.stderr}`
      .replace(/\r\n/g, "\n")
      .replace(BSD_EOF_ECHO, "");
    return { status: result.status ?? -1, output };
  }
}

/** `SHA256:<base64>` as `ssh-keygen -l` prints it, for a public key file. */
function sshFingerprint(env: NodeJS.ProcessEnv, publicKeyPath: string): string {
  const line = execFileSync("ssh-keygen", ["-l", "-E", "sha256", "-f", publicKeyPath], {
    env,
    encoding: "utf8",
  });
  const fingerprint = line.split(" ")[1];
  if (fingerprint === undefined || !fingerprint.startsWith("SHA256:")) {
    throw new Error(`unexpected ssh-keygen -l output: ${line}`);
  }
  return fingerprint;
}
