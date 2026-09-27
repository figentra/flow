/**
 * @vellum/storage — Ledger Operations
 *
 * Append-only, hash-chained ledger operations.
 * Each entry contains SHA-256 of previous entry.
 */

import { appendFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, basename } from "node:path";
import type { LedgerEntry, Checksum } from "@vellum/protocol";
import { brand } from "@vellum/protocol";
import { createFilesystem } from "./fs.js";

/** Initial hash for first entry (all zeros) */
const INITIAL_HASH = "0000000000000000000000000000000000000000000000000000000000000000";

/**
 * Read all entries from ledger file.
 */
export async function readLedger(ledgerPath: string): Promise<readonly LedgerEntry[]> {
  const dir = dirname(ledgerPath);
  const filename = basename(ledgerPath);
  const fs = createFilesystem(dir);

  if (!(await fs.exists(filename))) {
    return Object.freeze([]);
  }

  const content = await fs.readFile(filename);
  const lines = content.split("\n").filter((line: string) => line.trim());

  const entries: LedgerEntry[] = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as LedgerEntry;
      entries.push(entry);
    } catch {
      throw new Error(`Invalid ledger entry: ${line.slice(0, 100)}`);
    }
  }

  return Object.freeze(entries);
}

/**
 * Get the last entry from ledger.
 * Returns null if ledger is empty.
 */
export async function getLastEntry(ledgerPath: string): Promise<LedgerEntry | null> {
  const entries = await readLedger(ledgerPath);
  return entries.length > 0 ? entries[entries.length - 1]! : null;
}

/**
 * Append entry to ledger atomically.
 * Computes predecessor hash automatically.
 */
export async function appendLedgerEntry(
  ledgerPath: string,
  entry: Omit<LedgerEntry, "predecessor_digest" | "hash">,
): Promise<LedgerEntry> {
  // Get predecessor hash
  const lastEntry = await getLastEntry(ledgerPath);
  const predecessor_digest = lastEntry?.hash ?? brand<string, "Checksum">(INITIAL_HASH);

  // Compute new entry hash
  const newEntry = {
    ...entry,
    predecessor_digest,
  } as unknown as LedgerEntry;

  const hash = computeEntryHash(newEntry);
  const completeEntry = {
    ...newEntry,
    hash,
  } as unknown as LedgerEntry;

  // Atomic append: write to temp, then append
  const line = JSON.stringify(completeEntry) + "\n";

  await appendFile(ledgerPath, line, "utf-8");

  return completeEntry;
}

/**
 * Compute SHA-256 hash of a ledger entry.
 */
export function computeEntryHash(entry: LedgerEntry): Checksum {
  // Hash over: id, kind, timestamp, predecessor_digest, payload (sorted keys)
  const { hash: _, ...rest } = entry;
  const payloadJson = JSON.stringify(rest, Object.keys(rest).sort());
  const data = `${rest.id}:${rest.kind}:${rest.timestamp}:${rest.predecessor_digest}:${payloadJson}`;

  const hash = createHash("sha256").update(data, "utf8").digest("hex");
  return brand<string, "Checksum">(hash);
}

/**
 * Verify ledger integrity.
 * Returns { valid: true } or { valid: false, errors: [...] }.
 */
export async function verifyLedgerIntegrity(ledgerPath: string): Promise<{
  valid: boolean;
  errors: { seq: number; message: string }[];
}> {
  const entries = await readLedger(ledgerPath);
  const errors: Array<{ seq: number; message: string }> = [];

  let expectedPredecessor = INITIAL_HASH;
  const seenHashes = new Map<string, number>();

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;

    // Check sequence number
    if (entry.id !== i) {
      errors.push({
        seq: entry.id,
        message: `Expected id ${i}, got ${entry.id}`,
      });
    }

    // Check predecessor hash
    const predecessor = entry.predecessor_digest ?? INITIAL_HASH;
    if (predecessor !== expectedPredecessor) {
      errors.push({
        seq: entry.id,
        message: `Predecessor hash mismatch: expected ${expectedPredecessor.slice(0, 8)}..., got ${predecessor.slice(0, 8)}...`,
      });
    }

    // Check for forks (two entries with same predecessor)
    if (seenHashes.has(predecessor)) {
      const otherSeq = seenHashes.get(predecessor)!;
      errors.push({
        seq: entry.id,
        message: `Fork detected: entries ${otherSeq} and ${entry.id} have same predecessor`,
      });
    }

    // Verify entry hash
    const computedHash = computeEntryHash(entry);
    if (entry.hash && entry.hash !== computedHash) {
      errors.push({
        seq: entry.id,
        message: `Entry hash mismatch: expected ${computedHash.slice(0, 8)}..., got ${entry.hash!.slice(0, 8)}...`,
      });
    }

    // Update state
    seenHashes.set(predecessor, entry.id);
    expectedPredecessor = entry.hash ?? computedHash;
  }

  return {
    valid: errors.length === 0,
    errors: errors as { seq: number; message: string }[],
  };
}

/**
 * Detect if ledger has a fork (two entries with same predecessor).
 */
export function detectFork(ledgerPath: string): Promise<{
  hasFork: boolean;
  fork?: { entry1: number; entry2: number };
}> {
  return readLedger(ledgerPath).then((entries) => {
    const predecessors = new Map<string, number>();

    for (const entry of entries) {
      const predecessor = entry.predecessor_digest ?? INITIAL_HASH;
      const prev = predecessors.get(predecessor);
      if (prev !== undefined) {
        return {
          hasFork: true,
          fork: { entry1: prev, entry2: entry.id },
        };
      }
      predecessors.set(predecessor, entry.id);
    }

    return { hasFork: false };
  });
}
