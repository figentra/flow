/**
 * signingKeyFingerprint: an Approval Record's `identity_key` is the signing
 * key's fingerprint, never the path git's `user.signingkey` names — the
 * ledger is committed, and a path into a home directory does not belong in
 * it. Keys are throwaway keys generated per run inside os.tmpdir().
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sshPublicKeyFingerprint } from "../signature.ts";
import { signingKeyFingerprint } from "../signing-key.ts";

function has(command: string, args: readonly string[]): boolean {
  try {
    execFileSync(command, [...args], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const HAS_SSH_KEYGEN = has("ssh-keygen", ["-?"]) || has("which", ["ssh-keygen"]);
if (!HAS_SSH_KEYGEN)
  console.warn("signing-key.test: SKIPPING SSH cases — ssh-keygen is not installed");

describe("signingKeyFingerprint", () => {
  let root: string;
  let repo: string;
  let home: string;
  let publicKey: string;
  let expected: string | null;
  const saved = {
    global: process.env.GIT_CONFIG_GLOBAL,
    nosystem: process.env.GIT_CONFIG_NOSYSTEM,
    home: process.env.HOME,
  };

  const config = (key: string, value: string | null): void => {
    if (value === null) {
      try {
        execFileSync("git", ["config", "--unset", key], { cwd: repo, stdio: "ignore" });
      } catch {
        // not set
      }
    } else execFileSync("git", ["config", key, value], { cwd: repo, stdio: "ignore" });
  };

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "vellum-signing-key-"));
    repo = join(root, "repo");
    home = join(root, "home");
    mkdirSync(repo);
    mkdirSync(join(home, ".ssh"), { recursive: true });
    writeFileSync(join(root, "gitconfig"), "");
    process.env.GIT_CONFIG_GLOBAL = join(root, "gitconfig");
    process.env.GIT_CONFIG_NOSYSTEM = "1";
    process.env.HOME = home;
    execFileSync("git", ["init", "-q"], { cwd: repo });
    if (HAS_SSH_KEYGEN) {
      execFileSync("ssh-keygen", [
        "-q",
        "-t",
        "ed25519",
        "-N",
        "",
        "-C",
        "alice",
        "-f",
        join(home, ".ssh", "id_ed25519"),
      ]);
      publicKey = readFileSync(join(home, ".ssh", "id_ed25519.pub"), "utf8").trim();
      expected = sshPublicKeyFingerprint(publicKey);
    }
  });

  afterAll(() => {
    for (const [name, value] of [
      ["GIT_CONFIG_GLOBAL", saved.global],
      ["GIT_CONFIG_NOSYSTEM", saved.nosystem],
      ["HOME", saved.home],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });

  describe.skipIf(!HAS_SSH_KEYGEN)("SSH", () => {
    beforeAll(() => config("gpg.format", "ssh"));

    it("records the fingerprint for a path to the public key, never the path", () => {
      const path = join(home, ".ssh", "id_ed25519.pub");
      config("user.signingkey", path);
      const fingerprint = signingKeyFingerprint(repo);
      expect(fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]+$/);
      expect(fingerprint).toBe(expected);
      expect(fingerprint).not.toContain(home);
    });

    it("reads the .pub beside a path to the private key, not the private key's armour", () => {
      config("user.signingkey", join(home, ".ssh", "id_ed25519"));
      expect(signingKeyFingerprint(repo)).toBe(expected);
    });

    it("expands ~/ to the home directory and takes a relative path from the repository root", () => {
      config("user.signingkey", "~/.ssh/id_ed25519.pub");
      expect(signingKeyFingerprint(repo)).toBe(expected);
      copyFileSync(join(home, ".ssh", "id_ed25519.pub"), join(repo, "signing.pub"));
      config("user.signingkey", "signing.pub");
      expect(signingKeyFingerprint(repo)).toBe(expected);
    });

    it("reads a literal public key, with or without key::", () => {
      config("user.signingkey", publicKey);
      expect(signingKeyFingerprint(repo)).toBe(expected);
      config("user.signingkey", `key::${publicKey}`);
      expect(signingKeyFingerprint(repo)).toBe(expected);
    });

    it("records nothing when no public key can be found", () => {
      const lone = join(root, "lone");
      copyFileSync(join(home, ".ssh", "id_ed25519"), lone);
      chmodSync(lone, 0o600);
      config("user.signingkey", lone);
      expect(signingKeyFingerprint(repo)).toBe("");
      config("user.signingkey", join(root, "missing.pub"));
      expect(signingKeyFingerprint(repo)).toBe("");
      config("user.signingkey", null);
      expect(signingKeyFingerprint(repo)).toBe("");
    });
  });

  describe("GPG", () => {
    const FPR = "0123456789ABCDEF0123456789ABCDEF01234567";
    const program = (name: string, body: string): string => {
      const path = join(root, name);
      writeFileSync(path, `#!/bin/sh\n${body}\n`);
      chmodSync(path, 0o755);
      return path;
    };

    beforeAll(() => {
      config("gpg.format", null);
      config("user.signingkey", "ALICEKEYID");
    });

    it("records the primary key's fingerprint as the configured gpg.program lists it", () => {
      config(
        "gpg.program",
        program(
          "gpg-ok",
          `echo "pub:u:255:22:ALICEKEYID:1:::u:::scESC::::::23::0:"\necho "fpr:::::::::${FPR}:"\necho "fpr:::::::::FEDCBA9876543210FEDCBA9876543210FEDCBA98:"`,
        ),
      );
      expect(signingKeyFingerprint(repo)).toBe(FPR);
    });

    it("records nothing when gpg fails or prints no fingerprint", () => {
      config("gpg.program", program("gpg-fail", "exit 2"));
      expect(signingKeyFingerprint(repo)).toBe("");
      config("gpg.program", program("gpg-path", `echo "fpr:::::::::${home}/.gnupg:"`));
      expect(signingKeyFingerprint(repo)).toBe("");
    });

    it("records nothing for x509", () => {
      config("gpg.format", "x509");
      expect(signingKeyFingerprint(repo)).toBe("");
    });
  });
});
