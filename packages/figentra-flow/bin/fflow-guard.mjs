#!/usr/bin/env node
/**
 * Figentra Flow file contract:
 * Purpose: the guard's hook entry, `node node_modules/@figentra-oss/flow/bin/fflow-guard.mjs <event>`: runs the guard
 *   engine for one hook event (PreToolUse, PostToolUse, UserPromptSubmit, SessionStart) without the dispatcher or
 *   `pnpm exec`, so a hook starts fast (NFR-2).
 * Runtime: node
 * Secrets: none.
 */
import { main } from "../src/guard/engine.mjs";

process.exit(await main(process.argv[2] ?? ""));
