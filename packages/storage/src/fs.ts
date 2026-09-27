/**
 * @vellum/storage — Filesystem Operations
 *
 * Atomic filesystem operations using temp file + rename pattern.
 * All writes are atomic to prevent corruption from crashes.
 */

import {
  readFile,
  writeFile,
  access,
  readdir,
  stat,
  unlink,
  rename,
  mkdir,
} from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { FileSystem } from "@vellum/protocol";

/**
 * Create a filesystem instance for a working directory.
 */
export function createFilesystem(workingDir: string): FileSystem {
  return new FilesystemImpl(workingDir);
}

class FilesystemImpl implements FileSystem {
  constructor(private readonly workingDir: string) {}

  async readFile(path: string): Promise<string> {
    const absolute = this.resolve(path);
    return await readFile(absolute, "utf-8");
  }

  async writeFile(path: string, content: string): Promise<void> {
    const absolute = this.resolve(path);
    const tempPath = await this.createTempFile(content);

    // Ensure directory exists
    await mkdir(dirname(absolute), { recursive: true });

    // Atomic write: write to temp, then rename
    await rename(tempPath, absolute);
  }

  async exists(path: string): Promise<boolean> {
    const absolute = this.resolve(path);
    try {
      await access(absolute);
      return true;
    } catch {
      return false;
    }
  }

  async readdir(path: string): Promise<readonly string[]> {
    const absolute = this.resolve(path);
    try {
      const entries = await readdir(absolute);
      return Object.freeze(entries);
    } catch {
      return Object.freeze([]);
    }
  }

  async delete(path: string): Promise<void> {
    const absolute = this.resolve(path);
    try {
      await unlink(absolute);
    } catch {
      // Ignore if file doesn't exist
    }
  }

  async stat(path: string): Promise<{ mtime: Date; size: number; isDirectory: boolean }> {
    const absolute = this.resolve(path);
    const stats = await stat(absolute);
    return {
      mtime: stats.mtime,
      size: stats.size,
      isDirectory: stats.isDirectory(),
    };
  }

  async mkdirp(path: string): Promise<void> {
    const absolute = this.resolve(path);
    await mkdir(absolute, { recursive: true });
  }

  async updateSection(
    path: string,
    options: {
      startMarker: string;
      endMarker: string;
      content: string;
    },
  ): Promise<void> {
    const absolute = this.resolve(path);

    // Read current content
    const current = await readFile(absolute, "utf-8");

    // Find section boundaries
    const startIdx = current.indexOf(options.startMarker);
    const endIdx = current.indexOf(options.endMarker);

    if (startIdx === -1 || endIdx === -1 || startIdx >= endIdx) {
      throw new Error(`Section markers not found or invalid in ${path}`);
    }

    // Replace section
    const before = current.slice(0, startIdx);
    const after = current.slice(endIdx + options.endMarker.length);
    const updated = before + options.startMarker + options.content + options.endMarker + after;

    // Atomic write
    await this.writeFile(path, updated);
  }

  private resolve(path: string): string {
    return join(this.workingDir, path);
  }

  private async createTempFile(content: string): Promise<string> {
    const tempDir = tmpdir();
    const tempPath = join(tempDir, `vellum-${randomUUID()}.tmp`);
    await writeFile(tempPath, content, "utf-8");
    return tempPath;
  }
}

/**
 * Parse YAML frontmatter from content.
 * Returns null if no frontmatter found.
 */
export function parseFrontmatter(
  content: string,
): { frontmatter: Record<string, unknown>; body: string } | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return null;
  }

  const [, frontmatterYaml, body] = match;

  // Simple YAML parsing for our limited schema
  // (We don't need full YAML parser - frontmatter is simple key: value)
  const frontmatter: Record<string, unknown> = {};
  const lines = (frontmatterYaml ?? "").split(/\r?\n/);

  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();

    // Parse common types
    if (/^\d+$/.test(value)) {
      frontmatter[key] = parseInt(value, 10);
    } else if (/^\d+\.\d+$/.test(value)) {
      frontmatter[key] = parseFloat(value);
    } else if (value === "true" || value === "false") {
      frontmatter[key] = value === "true";
    } else {
      // Remove quotes if present
      frontmatter[key] = value.replace(/^["']|["']$/g, "");
    }
  }

  return { frontmatter, body: body ?? "" };
}

/**
 * Serialize frontmatter and body back to string.
 */
export function serializeFrontmatter(frontmatter: Record<string, unknown>, body: string): string {
  const entries = Object.entries(frontmatter);
  const yaml = entries.map(([key, value]) => `${key}: ${formatYamlValue(value)}`).join("\n");
  return `---\n${yaml}\n---\n${body}`;
}

function formatYamlValue(value: unknown): string {
  if (typeof value === "string") {
    // Quote strings with special chars
    if (/[:#\n\r]/.test(value) || /^\s|\s$/.test(value)) {
      return `"${value.replace(/"/g, '\\"')}"`;
    }
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

/**
 * Compute SHA-256 checksum of content.
 */
export function computeChecksum(content: string): string {
  // Import crypto synchronously
  const { createHash } = require("node:crypto");
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Strip frontmatter from content.
 */
export function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
}
