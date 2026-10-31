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
 * The npm name, from `package.json`: `@figentra-oss/flow` on the Figentra registry for now, `figentra-flow` on npmjs
 * later (owner, 2026-10-31). Only the package name changes; the CLI stays `NAME`.
 */
export const PACKAGE = MANIFEST.name;

/** This package's version: the one a written gate workflow pins its poster to. */
export const VERSION = MANIFEST.version;

/** The registry the package is published to (`publishConfig.registry`), or undefined for npm's default. */
export const REGISTRY = MANIFEST.publishConfig?.registry;

/** The product's name, as people read it. */
export const DISPLAY_NAME = "Figentra Flow";

/** The CLI's name, as users type it (the binary; the npm name is `PACKAGE`). */
export const NAME = "figentra-flow";

/** The binary's short alias. */
export const ALIAS = "fflow";

/** The repository's configuration file. */
export const CONFIG_FILE = `${NAME}.config.json`;

/** The commit status context the gate posts and the ruleset requires. */
export const STATUS_CONTEXT = `${NAME}/gate`;

/** The marker that finds the gate's own PR comment again. */
export const GATE_MARKER = `<!-- ${STATUS_CONTEXT} -->`;

/** The folder a gate job carries its poster, job file, log and exit code in. */
export const GATE_DIR = `.${NAME}-gate`;

/** The environment variables' prefix (`<PREFIX>GATE_APP_ID`, `<PREFIX>WORKSPACE`, …). */
export const ENV_PREFIX = `${NAME.toUpperCase().replaceAll("-", "_")}_`;

/** The user's folder under the home directory (`~/.config/<name>`). */
export const USER_DIR = [".config", NAME];

/** The branch config key `land` records its squash commit under (`branch.<b>.<key>`, AC-029). */
export const LANDED_KEY = `${NAME.replace(/-(\w)/g, (_, c) => c.toUpperCase())}Landed`;
