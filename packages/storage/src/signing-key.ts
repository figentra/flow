/**
 * @vellum/storage — The fingerprint of the key git is configured to sign with
 *
 * An Approval Record names the key its approver signs with (`identity_key`).
 * It records the key's fingerprint — `SHA256:…` for SSH, the hex fingerprint
 * for GPG — and never where the key lives: `user.signingkey` is often a path
 * into the approver's home directory, and the ledger is committed. When no
 * fingerprint can be determined the field is "" (it is informational;
 * verification reads the signer from the signed commit, criterion 7.3).
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { sshPublicKeyFingerprint } from "./signature.js";
import { gitConfig } from "./workspace.js";

/** A public key line: a key type, then the base64 blob. */
const SSH_PUBLIC_KEY = /^(?:ssh-[a-z0-9-]+|ecdsa-sha2-[a-z0-9-]+|sk-[a-z0-9@.-]+)\s+\S/;
/** The only shapes the result may take — never a path. */
const FINGERPRINT = /^(?:SHA256:[A-Za-z0-9+/]+|[0-9A-F]{40}|[0-9A-F]{64})$/;

/**
 * The fingerprint of the key `git config` in `repoRoot` signs with
 * (`gpg.format`, `user.signingkey`), or "" when it cannot be determined.
 *
 * SSH: `user.signingkey` is a public key (`ssh-ed25519 AAAA…`, optionally
 * `key::`-prefixed) or a path — to the public key, or to the private key with
 * its `.pub` beside it; `~/` is the home directory, a relative path is taken
 * from the repository root. GPG (`openpgp`, the default format): the key
 * `user.signingkey` names, or else the one for `user.email`, as the
 * configured `gpg.program` (default `gpg`) lists it. x509: "".
 */
export function signingKeyFingerprint(repoRoot: string): string {
  const format = gitConfig(repoRoot, "gpg.format") ?? "openpgp";
  const key = gitConfig(repoRoot, "user.signingkey");
  const fingerprint =
    format === "ssh"
      ? key === null
        ? null
        : sshKeyFingerprint(repoRoot, key)
      : format === "openpgp"
        ? gpgKeyFingerprint(repoRoot, key ?? gitConfig(repoRoot, "user.email"))
        : null;
  return fingerprint !== null && FINGERPRINT.test(fingerprint) ? fingerprint : "";
}

function sshKeyFingerprint(repoRoot: string, configured: string): string | null {
  const key = configured.startsWith("key::") ? configured.slice("key::".length) : configured;
  if (SSH_PUBLIC_KEY.test(key.trim())) return sshPublicKeyFingerprint(key);

  const path = key.startsWith("~/") ? resolve(homedir(), key.slice(2)) : resolve(repoRoot, key);
  for (const candidate of [path, `${path}.pub`]) {
    let line: string;
    try {
      line = (readFileSync(candidate, "utf8").split(/\r?\n/)[0] ?? "").trim();
    } catch {
      continue;
    }
    if (SSH_PUBLIC_KEY.test(line)) return sshPublicKeyFingerprint(line);
  }
  return null;
}

function gpgKeyFingerprint(repoRoot: string, key: string | null): string | null {
  if (key === null) return null;
  try {
    const listing = execFileSync(
      gitConfig(repoRoot, "gpg.program") ?? "gpg",
      ["--batch", "--with-colons", "--fingerprint", "--", key],
      { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 },
    );
    // The first `fpr` record is the primary key's: field 10 holds the fingerprint.
    const fpr = listing.split("\n").find((line) => line.startsWith("fpr:"));
    return fpr?.split(":")[9]?.toUpperCase() ?? null;
  } catch {
    return null;
  }
}
