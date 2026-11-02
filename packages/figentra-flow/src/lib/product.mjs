/**
 * Figentra Flow file contract:
 * Purpose: the one place the product's name lives (AC-042): the CLI name, the config file, the gate's status context
 *   and comment marker, the gate job folder, the environment prefix and the user folder. The product is being renamed;
 *   a rename changes this module, `package.json` and the docs.
 * Boundary: constants only.
 * Runtime: node
 * Governing contract: STA-1729 phase A (the leader's plan stop of 2026-10-31).
 * Secrets: none.
 */

import { readFileSync } from "node:fs";

const MANIFEST = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
/**
 * The npm name, from `package.json`: `@figentra-oss/flow` on the Figentra registry (owner, 2026-10-31). The CLI is
 * `NAME`, whatever the package is called.
 */
export const PACKAGE = MANIFEST.name;

/** This package's version: the one a written gate workflow pins its poster to. */
export const VERSION = MANIFEST.version;

/** The Node range Flow needs, from `package.json`'s `engines`. */
export const NODE_RANGE = MANIFEST.engines?.node ?? ">=0";

/** The registry the package is published to (`publishConfig.registry`), or undefined for npm's default. */
export const REGISTRY = MANIFEST.publishConfig?.registry;

/** The product's name, as people read it. */
export const DISPLAY_NAME = "Figentra Flow";

/** The CLI's name, as users type it (the binary; the npm name is `PACKAGE`). Owner, 2026-11-02: `fflow`. */
export const NAME = "fflow";

/** The name before 2026-11-02: a deprecated binary alias for one release, and the names `sync` migrates from. */
export const LEGACY_NAME = "figentra-flow";

/** The repository's configuration file. */
export const CONFIG_FILE = "flow.config.json";

/** The configuration file's name before 0.2.2; `sync` renames it once. */
export const LEGACY_CONFIG_FILE = `${LEGACY_NAME}.config.json`;

/** The commit status context the gate posts and the ruleset requires. */
export const STATUS_CONTEXT = `${NAME}/gate`;

/** The marker that finds the gate's own PR comment again. */
export const GATE_MARKER = `<!-- ${STATUS_CONTEXT} -->`;

/** The folder a gate job carries its poster, job file, log and exit code in. */
export const GATE_DIR = `.${NAME}-gate`;

/** The environment variables' prefix (`<PREFIX>GATE_APP_ID`, `<PREFIX>WORKSPACE`, …). */
export const ENV_PREFIX = `${NAME.toUpperCase().replaceAll("-", "_")}_`;

/** The prefix before 0.2.2, still read for one release where a user sets a variable (`<PREFIX>WORKSPACE`, `TRACKER`). */
export const LEGACY_ENV_PREFIX = `${LEGACY_NAME.toUpperCase().replaceAll("-", "_")}_`;

/** The user's folder under the home directory (`~/.config/<name>`). */
export const USER_DIR = [".config", NAME];

/** The branch config key `land` records its squash commit under (`branch.<b>.<key>`, AC-029). */
export const LANDED_KEY = `${NAME.replace(/-(\w)/g, (_, c) => c.toUpperCase())}Landed`;

/** The key before 0.2.2; `clean` still reads it, so a branch landed by 0.2.1 is still known as landed. */
export const LEGACY_LANDED_KEY = `${LEGACY_NAME.replace(/-(\w)/g, (_, c) => c.toUpperCase())}Landed`;

/** The approval workflow `sync` renders (STA-1856); `land` dispatches it when a review is required. */
export const APPROVE_WORKFLOW = `${NAME}-approve.yml`;

/** The GitHub environment holding the approving App's id and key; it allows the default branch only. */
export const APPROVE_ENVIRONMENT = `${NAME}-approve`;

/** The baseline workflow `sync` renders when the config has `baseline` (STA-1942); its job is the check. */
export const BASELINE_WORKFLOW = `${NAME}-baseline.yml`;

/** The baseline workflow's job name, and so the check a red-main repository requires instead of its full gate. */
export const BASELINE_CHECK = "Baseline";
