/**
 * @vellum/storage — Artifact Cache
 *
 * Disposable, content-addressed cache for computed results.
 * Stored outside version control.
 */

import { join } from "node:path";
import { mkdir, rm, readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";

/** Default max cache size in bytes (50 MB) */
const DEFAULT_MAX_SIZE = 50 * 1024 * 1024;

/**
 * Create a cache instance for a repository.
 */
export function createCache(repoPath: string, options?: { maxSize?: number }) {
  return new CacheImpl(repoPath, options?.maxSize ?? DEFAULT_MAX_SIZE);
}

interface CacheEntry {
  key: string;
  version: string;
  content: string;
  timestamp: number;
}

class CacheImpl {
  private readonly cachePath: string;
  private readonly maxSize: number;

  constructor(repoPath: string, maxSize: number) {
    // Cache stored in ~/.cache/vellum/<repo-hash>/
    const repoHash = createHash("sha256").update(repoPath, "utf8").digest("hex").slice(0, 16);

    const cacheDir =
      process.platform === "win32"
        ? join(process.env.LOCALAPPDATA || homedir(), "vellum", "cache")
        : join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "vellum");

    this.cachePath = join(cacheDir, repoHash);
    this.maxSize = maxSize;
  }

  /**
   * Get a cached value.
   * Returns null if not found, stale, or corrupt.
   */
  async get(key: string, version: string): Promise<string | null> {
    await this.ensureDir();

    const entryPath = this.getEntryPath(key);

    try {
      const content = await readFile(entryPath, "utf-8");
      const entry: CacheEntry = JSON.parse(content);

      // Check version
      if (entry.version !== version) {
        await this.delete(key);
        return null;
      }

      // Check content hash
      const expectedHash = computeContentHash(entry.content);
      if (entry.key !== `${key}:${expectedHash}`) {
        // Corrupt entry
        await this.delete(key);
        return null;
      }

      return entry.content;
    } catch {
      return null;
    }
  }

  /**
   * Set a cached value.
   * Automatically evicts old entries if size limit exceeded.
   */
  async set(key: string, version: string, content: string): Promise<void> {
    await this.ensureDir();

    // Check size limit
    await this.evictIfNeeded(content.length);

    const contentHash = computeContentHash(content);
    const entry: CacheEntry = {
      key: `${key}:${contentHash}`,
      version,
      content,
      timestamp: Date.now(),
    };

    const entryPath = this.getEntryPath(key);
    await writeFile(entryPath, JSON.stringify(entry), "utf-8");
  }

  /**
   * Delete a cached value.
   */
  async delete(key: string): Promise<void> {
    const entryPath = this.getEntryPath(key);

    try {
      await rm(entryPath);
    } catch {
      // Ignore if file doesn't exist
    }
  }

  /**
   * Clear all cached values.
   */
  async clear(): Promise<void> {
    try {
      await rm(this.cachePath, { recursive: true, force: true });
    } catch {
      // Ignore if directory doesn't exist
    }
  }

  /**
   * Get cache statistics.
   */
  async stats(): Promise<{
    entryCount: number;
    totalSize: number;
    maxSize: number;
  }> {
    await this.ensureDir();

    const files = await this.listFiles();
    let totalSize = 0;

    for (const file of files) {
      try {
        const content = await readFile(join(this.cachePath, file), "utf-8");
        totalSize += content.length;
      } catch {
        // Skip unreadable files
      }
    }

    return {
      entryCount: files.length,
      totalSize,
      maxSize: this.maxSize,
    };
  }

  /**
   * Get entry path from key.
   */
  private getEntryPath(key: string): string {
    // Hash key to create safe filename
    const safeKey = createHash("sha256").update(key, "utf8").digest("hex").slice(0, 32);
    return join(this.cachePath, `entry-${safeKey}.json`);
  }

  /**
   * Ensure cache directory exists.
   */
  private async ensureDir(): Promise<void> {
    await mkdir(this.cachePath, { recursive: true });
  }

  /**
   * List all cache files.
   */
  private async listFiles(): Promise<string[]> {
    try {
      return await readdir(this.cachePath);
    } catch {
      return [];
    }
  }

  /**
   * Evict old entries if needed to make room.
   */
  private async evictIfNeeded(newSize: number): Promise<void> {
    const stats = await this.stats();

    if (stats.totalSize + newSize <= this.maxSize) {
      return;
    }

    // Need to evict - remove oldest entries first
    const files = await this.listFiles();
    const entries: Array<{ file: string; timestamp: number; size: number }> = [];

    for (const file of files) {
      try {
        const content = await readFile(join(this.cachePath, file), "utf-8");
        const entry: CacheEntry = JSON.parse(content);
        entries.push({
          file,
          timestamp: entry.timestamp,
          size: content.length,
        });
      } catch {
        // Skip unreadable files
      }
    }

    // Sort by timestamp (oldest first)
    entries.sort((a, b) => a.timestamp - b.timestamp);

    // Evict until we have enough space
    let freed = 0;
    const target = stats.totalSize + newSize - this.maxSize;

    for (const entry of entries) {
      if (freed >= target) break;

      try {
        await rm(join(this.cachePath, entry.file));
        freed += entry.size;
      } catch {
        // Ignore deletion errors
      }
    }
  }
}

/**
 * Compute content hash for cache key.
 */
function computeContentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 16);
}
