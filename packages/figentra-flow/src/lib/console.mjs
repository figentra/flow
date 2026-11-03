/**
 * Figentra Flow file contract:
 * Purpose: `fflow` on the one CLI engine, `@stackra/console` (STA-1966, FR-31): the Flow theme and every command,
 *   grouped, so `fflow` alone prints the banner, the version and the grouped commands, `<command> --help` prints its
 *   usage and runs nothing, an unknown command names the closest match and exits 2, and a failure is one error block.
 *   `doctor` and `status` declare their options; every other command is passthrough (migration only, ADR 0500
 *   decision 7): it still parses its own flags from `io.rest`, and `PASSTHROUGH` in the tests pins that list.
 * Boundary: the registry and the repository check. A command's module is imported when it runs, never for the list or
 *   the help. `@stackra/console` is an optional peer (NFR-1): bin/fflow.mjs loads this file only when it imports, and
 *   never for `fflow guard`, the agent hook (src/lib/plain.mjs runs both cases). Plain JavaScript: the engine's legacy
 *   field decorators are applied by hand after each class, exactly as TypeScript's emit applies them.
 * Runtime: node
 * Governing contract: STA-1945 FR-31 (AC-35, AC-36, AC-37); STA-1966 (FR-024, FR-031).
 * Secrets: none.
 */
import { Command, CommandError, Option, UsageError } from "@stackra/console";
import { Int, Str } from "@stackra/validation";

import { ConfigError } from "./config.mjs";
import { git } from "./git.mjs";
import { DISPLAY_NAME, HOMEPAGE, NAME, VERSION } from "./product.mjs";

/** @typedef {import("@stackra/console").CommandIo} CommandIo */
/** @typedef {import("@stackra/console").CommandClass} CommandClass */

/** Where every command's help and error block point. */
export const DOCS = HOMEPAGE;

/** The headings of the command list, in order. */
export const GROUPS = {
  setup: "Set up",
  specs: "Specs",
  work: "Work",
  land: "Land and release",
  agents: "Agents",
};

/**
 * Flow's look (figentra/brand `brands/flow`): the glyph's magenta, never a wash, so both gradient stops are the same.
 * @type {import("@stackra/console").ConsoleConfig["theme"]}
 */
export const FLOW_THEME = {
  name: DISPLAY_NAME,
  logo: [
    "  __  __ _",
    " / _|/ _| | _____      __",
    "| |_| |_| |/ _ \\ \\ /\\ / /",
    "|  _|  _| | (_) \\ V  V /",
    "|_| |_| |_|\\___/ \\_/\\_/",
  ],
  gradient: ["#C2187A", "#C2187A"],
  accent: "#C2187A",
  dark: { gradient: ["#F48BC0", "#F48BC0"], accent: "#F48BC0" },
  glyph: "●",
  asciiGlyph: "*",
};

/**
 * Runs `work`, turning a configuration refusal into a usage error: still exit 2, now inside the error block.
 * @template T
 * @param {() => T | Promise<T>} work
 * @returns {Promise<T>}
 */
async function refusing(work) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ConfigError)
      throw new UsageError(error.message, `correct what it names, then run \`${NAME} doctor\``);
    throw error;
  }
}

/**
 * The repository check a command makes before anything else (FR-31, AC-35): outside a git work tree it throws one
 * error block naming the fix. git's own words join the reason only under `verbose`: a passthrough command's
 * `--verbose` reaches it in `io.rest`, never the engine's globals, which would show the block's `detail`.
 * @param {string} cwd
 * @param {boolean} [verbose]
 * @returns {string} the repository's top folder
 */
export function requireRepository(cwd, verbose = false) {
  const top = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (top.ok) return top.out;
  throw new CommandError("not a git repository", {
    why: `${cwd} is not inside a git work tree${verbose && top.err ? ` (${top.err})` : ""}`,
    fix: `cd into the repository (or run \`git init\`, then \`${NAME} init\`)`,
    detail: top.err,
  });
}

/**
 * A command that still parses its own flags (migration only, STA-1966 FR-031).
 * @param {{ name: string, description: string, group: string, examples: string[], repository?: boolean }} definition
 *   `repository`: refuse before anything else when the working directory is not inside a git repository.
 * @returns {CommandClass}
 */
function passthrough({ name, description, group, examples, repository = false }) {
  return class extends Command({
    name,
    description,
    group,
    examples,
    docs: DOCS,
    passthrough: true,
  }) {
    /** @param {CommandIo} io */
    async handle(io) {
      if (repository) requireRepository(io.cwd, io.rest.includes("--verbose"));
      const { run } = await import(`../commands/${name}.mjs`);
      return refusing(() => run([...io.rest]));
    }
  };
}

class DoctorCommand extends Command({
  name: "doctor",
  description: "Whether this machine and repository can run Flow, each check with its fix",
  group: GROUPS.setup,
  docs: DOCS,
  examples: [`${NAME} doctor`, `${NAME} doctor --offline --json`],
}) {
  offline = false;

  /** @param {CommandIo} io */
  async handle(io) {
    const { doctor } = await import("../commands/doctor.mjs");
    await refusing(() => doctor(io, this));
  }
}
Option({ description: "Make no GitHub call" })(DoctorCommand.prototype, "offline");

class StatusCommand extends Command({
  name: "status",
  description: "Specs, worktrees, open PRs and sessions for every repository of the workspace",
  group: GROUPS.work,
  docs: DOCS,
  examples: [
    `${NAME} status`,
    `${NAME} status --repo ../app --offline --json`,
    `${NAME} status --metrics --since 30d`,
    `${NAME} status --by role --role reviewer`,
    `${NAME} status --web --port 4747`,
  ],
}) {
  /** @type {string | undefined} */
  repo = undefined;
  offline = false;
  metrics = false;
  since = "30d";
  /** @type {string | undefined} */
  by = undefined;
  /** @type {string | undefined} */
  role = undefined;
  web = false;
  port = 4747;

  /** @param {CommandIo} io */
  async handle(io) {
    const { refusal, status } = await import("../commands/status.mjs");
    const refused = refusal(this);
    if (refused) throw new UsageError(refused.message, refused.hint);
    return refusing(() => status(io, this));
  }
}
Option({ description: "One repository's path instead of the workspace list" })(
  StatusCommand.prototype,
  "repo",
);
Str()(StatusCommand.prototype, "repo");
Option({ description: "Make no GitHub call" })(StatusCommand.prototype, "offline");
Option({ description: "Lead and cycle times, gate runs and reviews of the merged PRs" })(
  StatusCommand.prototype,
  "metrics",
);
Option({ description: "The metrics window in days, as 30d" })(StatusCommand.prototype, "since");
Str()(StatusCommand.prototype, "since");
Option({ description: "Group the specs by role", choices: ["role"] })(
  StatusCommand.prototype,
  "by",
);
Option({ description: "Keep one role (with --by role)" })(StatusCommand.prototype, "role");
Str()(StatusCommand.prototype, "role");
Option({ description: "Serve the status page on 127.0.0.1" })(StatusCommand.prototype, "web");
Option({ description: "The status page's port (with --web)" })(StatusCommand.prototype, "port");
Int({ min: 0, max: 65535 })(StatusCommand.prototype, "port");

/** Every command, in the order the list shows them within their group. */
export const COMMANDS = [
  passthrough({
    name: "init",
    description:
      "Install .flow/ and the flow-* skills, a starter config, the workspace list or a runner",
    group: GROUPS.setup,
    examples: [
      `${NAME} init`,
      `${NAME} init --force`,
      `${NAME} init --workspace ~/code`,
      `${NAME} init --runner github-actions`,
    ],
  }),
  passthrough({
    name: "sync",
    description: "Render the flow-* skills from the preset and write .flow/lock.json",
    group: GROUPS.setup,
    examples: [`${NAME} sync`, `${NAME} sync --direct`],
    repository: true,
  }),
  DoctorCommand,
  passthrough({
    name: "migrate",
    description: "Move a spec-kit repository onto .flow/",
    group: GROUPS.setup,
    examples: [`${NAME} migrate --dry-run`],
    repository: true,
  }),
  passthrough({
    name: "readme",
    description: "Render README.md from .flow/readme.yml; --check exits 1 when it differs",
    group: GROUPS.setup,
    examples: [`${NAME} readme`, `${NAME} readme --check`],
    repository: true,
  }),
  passthrough({
    name: "team",
    description: "Check the roster and its role files",
    group: GROUPS.setup,
    examples: [`${NAME} team check`, `${NAME} team check --tracker`],
    repository: true,
  }),
  passthrough({
    name: "spec",
    description:
      "The spec folder, its documents and the resolved templates, for the flow-* commands",
    group: GROUPS.specs,
    examples: [
      `${NAME} spec paths --json`,
      `${NAME} spec setup-plan --json`,
      `${NAME} spec setup-tasks --json`,
      `${NAME} spec template plan-template`,
    ],
    repository: true,
  }),
  passthrough({
    name: "gate",
    description: "The stage gates, the CI gate, the spec folder and the gate run on the runner",
    group: GROUPS.specs,
    examples: [
      `${NAME} gate dir --key STA-12`,
      `${NAME} gate plan .agents/specs/sta-12-x/spec.md`,
      `${NAME} gate ci --base=origin/main`,
      `${NAME} gate run`,
    ],
  }),
  passthrough({
    name: "trace",
    description: "The requirement to task to test matrix, spec drift and the Done rules",
    group: GROUPS.specs,
    examples: [`${NAME} trace trace .agents/specs/sta-12-x`, `${NAME} trace ci`],
  }),
  passthrough({
    name: "parse",
    description: "What the parsers read from a spec artifact, as JSON",
    group: GROUPS.specs,
    examples: [`${NAME} parse .agents/specs/sta-12-x/tasks.md`],
  }),
  passthrough({
    name: "linear",
    description: "Link a spec and its tasks to Linear",
    group: GROUPS.specs,
    examples: [`${NAME} linear tasks .agents/specs/sta-12-x/tasks.md --dry-run`],
  }),
  passthrough({
    name: "start",
    description: "Make the issue's worktree and branch from the default branch",
    group: GROUPS.work,
    examples: [`${NAME} start STA-12 --slug cancel-order`, `${NAME} start STA-12 --dry-run`],
  }),
  StatusCommand,
  passthrough({
    name: "clean",
    description: "Remove finished worktrees and report what was kept",
    group: GROUPS.work,
    examples: [`${NAME} clean --dry-run`, `${NAME} clean --budget`, `${NAME} clean --all`],
  }),
  passthrough({
    name: "land",
    description: "Squash-merge a PR that is green on the gate and approved",
    group: GROUPS.land,
    examples: [`${NAME} land 42 --dry-run`, `${NAME} land --stack`],
  }),
  passthrough({
    name: "train",
    description: "The release train: open, board, cut off, build and depart",
    group: GROUPS.land,
    examples: [`${NAME} train status`, `${NAME} train open`],
  }),
  passthrough({
    name: "ship",
    description: "Ship the default branch to dev or staging through the deploy workflow",
    group: GROUPS.land,
    examples: [`${NAME} ship staging --dry-run`],
  }),
  passthrough({
    name: "release",
    description: "What the next release would publish and what stands in its way",
    group: GROUPS.land,
    examples: [`${NAME} release`, `${NAME} release --offline --json`],
  }),
  passthrough({
    name: "guard",
    description: "The agent hook that keeps worktrees inside .claude/worktrees/",
    group: GROUPS.agents,
    examples: [`${NAME} guard --print-settings`],
  }),
  passthrough({
    name: "mcp",
    description: "A read-only MCP server over stdio",
    group: GROUPS.agents,
    examples: [`${NAME} mcp`],
  }),
  passthrough({
    name: "app",
    description: "Create the repository's gate or review GitHub App (a human only)",
    group: GROUPS.agents,
    examples: [`${NAME} app create gate --org acme`],
  }),
];

/** `fflow`'s console configuration: the theme, the version and every command. */
export const CONSOLE = { name: NAME, version: VERSION, theme: FLOW_THEME, commands: COMMANDS };
