/**
 * Figentra Flow file contract:
 * Purpose: the one place the product's name lives (AC-042): the CLI name, the config file, the gate's status context
 *   and comment marker, the gate job folder, the environment prefix, the user folder, the automation freeze
 *   variable and the land request's label, hold label, status context and comment marker. The product is being
 *   renamed; a rename changes this module, `package.json` and the docs.
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

/** The docs link every command's help and error block give, from `package.json`'s `homepage`. */
export const HOMEPAGE = MANIFEST.homepage;

/** The registry the package is published to (`publishConfig.registry`), or undefined for npm's default. */
export const REGISTRY = MANIFEST.publishConfig?.registry;

/** The product's name, as people read it. */
export const DISPLAY_NAME = "Figentra Flow";

/** The CLI's name, as users type it (the binary; the npm name is `PACKAGE`). Owner, 2026-11-02: `fflow`. */
export const NAME = "fflow";

/** The mise every rendered mise-action step installs; unpinned, the action takes the latest, which can be down. */
export const MISE_VERSION = "2026.11.4";

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

/** The variable the `ci.render` job hands `render` its entry in, as JSON. */
export const RENDER_ENV = `${ENV_PREFIX}RENDER`;

/** The prefix before 0.2.2, still read for one release where a user sets a variable (`<PREFIX>WORKSPACE`, `TRACKER`). */
export const LEGACY_ENV_PREFIX = `${LEGACY_NAME.toUpperCase().replaceAll("-", "_")}_`;

/** The user's folder under the home directory (`~/.config/<name>`). */
export const USER_DIR = [".config", NAME];

/** The branch config key `land` records its squash commit under (`branch.<b>.<key>`, AC-029). */
export const LANDED_KEY = `${NAME.replace(/-(\w)/g, (_, c) => c.toUpperCase())}Landed`;

/** The branch config key `land --stack` records a child's squashed parent head under, for a re-run after a stop. */
export const STACK_PARENT_KEY = `${NAME.replace(/-(\w)/g, (_, c) => c.toUpperCase())}StackParent`;

/** The key before 0.2.2; `clean` still reads it, so a branch landed by 0.2.1 is still known as landed. */
export const LEGACY_LANDED_KEY = `${LEGACY_NAME.replace(/-(\w)/g, (_, c) => c.toUpperCase())}Landed`;

/**
 * The approval workflow `sync` renders (STA-1856). With `secrets.oidc`, events run it (the L2 design): the `LAND_LABEL`
 * label or a `/fflow land` comment asks for a land; before that, `land` dispatched it.
 */
export const APPROVE_WORKFLOW = `${NAME}-approve.yml`;

/** The GitHub environment holding the approving App's id and key; it allows the default branch only. */
export const APPROVE_ENVIRONMENT = `${NAME}-approve`;

/** The baseline workflow `sync` renders when the config has `baseline` (STA-1942); its job is the check. */
export const BASELINE_WORKFLOW = `${NAME}-baseline.yml`;

/** The baseline workflow's job name, and so the check a red-main repository requires instead of its full gate. */
export const BASELINE_CHECK = "Baseline";

/** The standard CI workflow `sync` renders when the config has `ci`; its `Quality Gate` job is the required check. */
export const CI_WORKFLOW = `${NAME}-ci.yml`;

/** The CI workflow's aggregate job name, and so the one check a repository's ruleset requires. */
export const CI_CHECK = "Quality Gate";

/**
 * The checks a red main never excuses, whatever `approve.tolerate` lists (STA-1945 FR-22): Baseline is the comparison
 * itself, and the gate runs the whole check command, more than Baseline's tasks.
 */
export const NEVER_TOLERATED = [BASELINE_CHECK, STATUS_CONTEXT];

/**
 * The organisation's Actions variable that freezes automation (ADR 0523; the owner, 2026-11-04): `on`, `merge-only`
 * or `frozen`. Missing or unreadable is frozen; the approval workflow's event jobs run only on `AUTOMATION_RUNS`.
 */
export const AUTOMATION_VARIABLE = "FIGENTRA_AUTOMATION";

/** The `AUTOMATION_VARIABLE` values the verdict runs on; any other value, or none, is the freeze. */
export const AUTOMATION_RUNS = Object.freeze(["on", "merge-only"]);

/** The label that asks main's approval workflow to approve and merge a PR (the L2 design); a push removes it. */
export const LAND_LABEL = `${NAME}:land`;

/** The label that pauses one PR's land request (ADR 0523). */
export const HOLD_LABEL = "HOLD";

/** The commit status main's approval workflow posts on a requested head: why it waits, refuses or approved. */
export const LAND_CONTEXT = `${NAME}/land`;

/** The first line of the one PR comment main's approval workflow keeps up to date. */
export const LAND_MARKER = `<!-- ${LAND_CONTEXT} -->`;

/** The comment that re-asks for a land when the label is already there (re-adding a label fires no event). */
export const LAND_COMMAND = `/${NAME} land`;
