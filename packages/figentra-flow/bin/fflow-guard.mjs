#!/usr/bin/env node
/**
 * Figentra Flow file contract:
 * Purpose: the installed package's guard entry, `node node_modules/@figentra-oss/flow/bin/fflow-guard.mjs <event>`:
 *   runs the guard engine for one hook event (PreToolUse, PostToolUse, UserPromptSubmit, SessionStart) on the
 *   preset's folder, without the dispatcher. The rendered hooks run the repository's own guard bundle instead
 *   (`.agents/hooks/fflow-guard.mjs`, `render-guard.mjs`), which needs no install (NFR-2, A-8).
 * Runtime: node
 * Secrets: none.
 */
import { main } from "../src/guard/engine.mjs";

process.exit(await main(process.argv[2] ?? ""));
