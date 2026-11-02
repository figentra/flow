#!/usr/bin/env node
/**
 * Figentra Flow file contract:
 * Purpose: the deprecated `figentra-flow` binary (owner, 2026-11-02: the command is `fflow`). Prints one notice, then
 *   runs `fflow` with the same arguments. It goes in the release after 0.2.2.
 * Runtime: node
 * Secrets: none.
 */
console.error("figentra-flow is now `fflow`; this alias goes in the next release.");
await import("./fflow.mjs");
