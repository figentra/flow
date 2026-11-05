/**
 * Figentra Flow file contract:
 * Purpose: `fflow` on the one CLI engine, `@stackra/console` (STA-1966, FR-31): the Flow theme and every command,
 *   grouped, so `fflow` alone prints the banner, the version and the grouped commands, `<command> --help` prints its
 *   usage and runs nothing, an unknown command names the closest match and exits 2, and a failure is one error block.
 *   `doctor`, `preset add` (STA-2097), `status`, `next`, `resume`, `task start|done|wave`, `todo`, `ledger`,
 *   `session stop`, the governance commands (`update`, `check`, `diff`, `validate`, STA-1945 FR-1), the stage
 *   commands (`plan`, `review`, FR-15), `readme`, `team check`, `land`, the `train` steps, `gate`, `parse`, `guard`
 *   and `hooks run` (SC-2) declare their arguments and options; every other command is passthrough (migration only,
 *   ADR 0500 decision 7): it still parses its own flags from `io.rest`, and `PASSTHROUGH` in the tests pins that list.
 * Boundary: the registry and the repository check, in the CLI layer only: the governance core (gate, approve, land,
 *   record, lock, baseline) imports nothing from `@stackra/*`. A command's module is imported when it runs, never for
 *   the list or the help, and bin/fflow.mjs never loads this file for `fflow guard`, the agent hook. Plain
 *   JavaScript: the engine's legacy field decorators are applied by hand after each class, exactly as TypeScript's
 *   emit applies them.
 * Runtime: node
 * Governing contract: STA-1945 FR-1, FR-15, FR-31 (AC-35, AC-36, AC-37), FR-13, FR-19, FR-21, FR-23, FR-24; STA-1966
 *   (FR-024, FR-031); STA-2097.
 * Secrets: none.
 */
import { Argument, Command, CommandError, Option, UsageError } from "@stackra/console";
import { Int, List, Str } from "@stackra/validation";

import { ConfigError } from "./config.mjs";
import { git } from "./git.mjs";
import {
  CONFIG_FILE,
  DISPLAY_NAME,
  ENV_PREFIX,
  HOMEPAGE,
  NAME,
  STATUS_CONTEXT,
  VERSION,
} from "./product.mjs";

/** @typedef {import("@stackra/console").CommandIo} CommandIo */
/** @typedef {import("@stackra/console").CommandClass} CommandClass */

/**
 * The part of the engine's `CommandIo` that the declared (not passthrough) commands use.
 * @typedef {{ cwd: string, json: boolean, verbose: boolean, output: { line(text: string): void,
 *   title(text: string): void, note(text: string): void, info(text: string): void, success(text: string): void,
 *   warn(text: string): void, error(text: string): void, list(items: string[]): void, json(data: unknown): void,
 *   table(spec: any): void, checklist(spec: any): unknown } }} Io
 */

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
 *   `repository`: refuse before anything else when the working directory is not inside a git repository (unless
 *   `--workspace` is given).
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
      // `--workspace <dir>` (sync, STA-1945) runs in the repositories under it, not in this folder's.
      if (repository && !io.rest.includes("--workspace"))
        requireRepository(io.cwd, io.rest.includes("--verbose"));
      const { run } = await import(`../commands/${name}.mjs`);
      return refusing(() => run([...io.rest]));
    }
  };
}

/**
 * A governance command (STA-1945 FR-1): `update`, `check`, `diff` or `validate`, with its options declared, so its
 * help lists them. It hands them to the command's `run` as flags, which runs it here or, with `--workspace`, in each
 * repository of the workspace (src/lib/workspace-run.mjs); only the run here needs a repository.
 * @param {{ name: string, description: string, examples: string[], direct?: boolean, preset?: boolean }} definition
 *   `direct`, `preset`: the command takes `--direct`, `--preset <version>`.
 * @returns {CommandClass}
 */
function governance({ name, description, examples, direct = false, preset = false }) {
  const Governance = class extends Command({
    name,
    description,
    group: GROUPS.setup,
    examples,
    docs: DOCS,
  }) {
    /** @type {string | undefined} */
    workspace = undefined;
    direct = false;
    /** @type {string | undefined} */
    preset = undefined;

    /** @param {CommandIo} io */
    async handle(io) {
      if (this.workspace === undefined) requireRepository(io.cwd);
      const { run } = await import(`../commands/${name}.mjs`);
      const args = [
        ...(this.workspace === undefined ? [] : ["--workspace", this.workspace]),
        ...(this.direct ? ["--direct"] : []),
        ...(this.preset === undefined ? [] : ["--preset", this.preset]),
      ];
      return refusing(() => run(args));
    }
  };
  Option({ description: `Run in every repository under this folder that has ${CONFIG_FILE}` })(
    Governance.prototype,
    "workspace",
  );
  Str()(Governance.prototype, "workspace");
  if (direct)
    Option({ description: "Render Claude Code and OpenCode files, as `sync --direct` does" })(
      Governance.prototype,
      "direct",
    );
  if (preset) {
    Option({ description: "The preset version to adopt; only the installed one is accepted" })(
      Governance.prototype,
      "preset",
    );
    Str()(Governance.prototype, "preset");
  }
  return Governance;
}

/**
 * A stage command around its Claude workflow (STA-1945 FR-15): `plan <key>` or `review <pr>`, with `--input` or
 * `--record <file>` declared, so its help lists them. It hands them to the command's `run` as flags; `run` refuses
 * neither or both (exit 2).
 * @param {{ name: string, description: string, group: string, examples: string[], subject: string, output: string }}
 *   definition `subject`: what the argument names; `output`: the file `--record` takes.
 * @returns {CommandClass}
 */
function stage({ name, description, group, examples, subject, output }) {
  const Stage = class extends Command({ name, description, group, examples, docs: DOCS }) {
    /** @type {string} */
    subject;
    input = false;
    /** @type {string | undefined} */
    record = undefined;

    /** @param {CommandIo} io */
    async handle(io) {
      requireRepository(io.cwd);
      const { run } = await import(`../commands/${name}.mjs`);
      const args = [
        this.subject,
        ...(this.input ? ["--input"] : []),
        ...(this.record === undefined ? [] : ["--record", this.record]),
      ];
      return refusing(() => run(args));
    }
  };
  Argument({ description: subject })(Stage.prototype, "subject");
  Option({ description: "Print the workflow's input as JSON" })(Stage.prototype, "input");
  Option({ description: `Validate and record the workflow's ${output}` })(
    Stage.prototype,
    "record",
  );
  Str()(Stage.prototype, "record");
  return Stage;
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

class PresetAddCommand extends Command({
  name: "preset:add",
  description: `Install a preset package and name it as the preset in ${CONFIG_FILE}`,
  group: GROUPS.setup,
  docs: DOCS,
  examples: [
    `${NAME} preset add @acme/flow-preset`,
    `${NAME} preset add @acme/flow-preset --dry-run`,
  ],
}) {
  /** @type {string} */
  pkg;
  dryRun = false;

  /** @param {CommandIo} io */
  async handle(io) {
    const root = requireRepository(io.cwd);
    const { add } = await import("../commands/preset.mjs");
    return refusing(() => add(io, root, this));
  }
}
Argument({ description: "The preset's npm package, as @scope/name" })(
  PresetAddCommand.prototype,
  "pkg",
);
Option({ description: "Print the install command and the config change; run nothing" })(
  PresetAddCommand.prototype,
  "dryRun",
);

class ContextCommand extends Command({
  name: "context",
  description: "Find repository guidance, packages and skills without setup or network access",
  group: GROUPS.agents,
  docs: DOCS,
  examples: [
    `${NAME} context --path packages/widget --json`,
    `${NAME} context --all --query payments`,
  ],
}) {
  /** @type {string | undefined} */
  repo = undefined;
  all = false;
  query = "";
  path = "";
  limit = 20;

  /** @param {CommandIo} io */
  async handle(io) {
    const { handle } = await import("../commands/context.mjs");
    return refusing(() => handle(io, this));
  }
}
Option({ description: "One local repository (defaults to the current checkout)" })(
  ContextCommand.prototype,
  "repo",
);
Str()(ContextCommand.prototype, "repo");
Option({ description: "Case-insensitive phrase in paths, package names or descriptions" })(
  ContextCommand.prototype,
  "query",
);
Str()(ContextCommand.prototype, "query");
Option({
  description: "Repository-relative file or folder; also returns its ancestor instructions",
})(ContextCommand.prototype, "path");
Str()(ContextCommand.prototype, "path");
Option({ description: "Read the existing workspace registry (at most 25 repositories)" })(
  ContextCommand.prototype,
  "all",
);
Option({ description: "Maximum matches per repository (1–100, default 20)" })(
  ContextCommand.prototype,
  "limit",
);
Int({ min: 1, max: 100 })(ContextCommand.prototype, "limit");

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
    `${NAME} status --divergence --json`,
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
  divergence = false;

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
Option({
  description:
    "Each repository's lock (Flow and preset versions), preset lag, overrides and drift from the lock",
})(StatusCommand.prototype, "divergence");

/**
 * Runs a `task` command, turning its refusal (a `TaskError`) into a usage error (exit 2) and a record that fails its
 * schema into an error block (exit 1).
 * @param {() => number} work
 */
async function tasking(work) {
  const [{ TaskError }, { RecordError }] = await Promise.all([
    import("../commands/task.mjs"),
    import("./record.mjs"),
  ]);
  try {
    return await refusing(work);
  } catch (error) {
    if (error instanceof TaskError) throw new UsageError(error.message);
    if (error instanceof RecordError) throw new CommandError(error.message);
    throw error;
  }
}

class NextCommand extends Command({
  name: "next",
  description: "The task's current stage and the command that moves it on, from Flow's record",
  group: GROUPS.work,
  docs: DOCS,
  examples: [`${NAME} next`, `${NAME} next STA-12 --json`],
}) {
  /** @type {string | undefined} */
  key = undefined;

  /** @param {CommandIo} io */
  async handle(io) {
    const { next, show } = await import("../commands/next.mjs");
    const result = await refusing(() => next({ cwd: io.cwd, key: this.key }));
    if (result.ok === false) throw new CommandError(result.problem);
    show(io, result);
  }
}
Argument({ description: "The issue key; the branch's when left out", optional: true })(
  NextCommand.prototype,
  "key",
);

class ResumeCommand extends Command({
  name: "resume",
  description: "Re-enter the stage a stopped session left half done, in the task's worktree",
  group: GROUPS.work,
  docs: DOCS,
  examples: [`${NAME} resume STA-12`],
}) {
  /** @type {string} */
  key;

  /** @param {CommandIo} io */
  async handle(io) {
    const { resume, show } = await import("../commands/resume.mjs");
    const result = await refusing(() => resume({ cwd: io.cwd, key: this.key }));
    if (result.ok === false) throw new CommandError(result.problem);
    return show(io, this.key, result);
  }
}
Argument({ description: "The issue key" })(ResumeCommand.prototype, "key");

class TaskStartCommand extends Command({
  name: "task:start",
  description: "Start a task of a Tasked spec: set its marker to [-] and record the start",
  group: GROUPS.work,
  docs: DOCS,
  examples: [`${NAME} task start STA-12 T003`, `${NAME} task start STA-12 T003 --session mine`],
}) {
  /** @type {string} */
  key;
  /** @type {string} */
  id;
  /** @type {string | undefined} */
  session = undefined;

  /** @param {CommandIo} io */
  async handle(io) {
    const { start } = await import("../commands/task.mjs");
    return tasking(() => start(io, this));
  }
}
Argument({ description: "The issue key" })(TaskStartCommand.prototype, "key");
Argument({ description: "The task, as T003" })(TaskStartCommand.prototype, "id");
Str({ pattern: /^T\d{3}$/ })(TaskStartCommand.prototype, "id");
Option({ description: `The session's name; ${ENV_PREFIX}SESSION when left out` })(
  TaskStartCommand.prototype,
  "session",
);
Str()(TaskStartCommand.prototype, "session");

class TaskDoneCommand extends Command({
  name: "task:done",
  description: "Run a task's check command and mark it [x] on exit 0 at a clean HEAD",
  group: GROUPS.work,
  docs: DOCS,
  examples: [`${NAME} task done STA-12 T003 --command "pnpm test"`],
}) {
  /** @type {string} */
  key;
  /** @type {string} */
  id;
  /** @type {string | undefined} */
  command = undefined;
  echo = false;

  /** @param {CommandIo} io */
  async handle(io) {
    const { key, id, command, echo } = this;
    // An option is never required by the engine; the check command is.
    if (!command)
      throw new UsageError(
        "--command is missing: the check that proves the task",
        `${NAME} task done ${key} ${id} --command "pnpm test"`,
      );
    const { done } = await import("../commands/task.mjs");
    return tasking(() => done(io, { key, id, command, echo }));
  }
}
Argument({ description: "The issue key" })(TaskDoneCommand.prototype, "key");
Argument({ description: "The task, as T003" })(TaskDoneCommand.prototype, "id");
Str({ pattern: /^T\d{3}$/ })(TaskDoneCommand.prototype, "id");
Option({ description: "The check command; its exit code and a digest of its output are recorded" })(
  TaskDoneCommand.prototype,
  "command",
);
Str()(TaskDoneCommand.prototype, "command");
Option({ description: "Print the command's output after it runs" })(
  TaskDoneCommand.prototype,
  "echo",
);

class TaskWaveCommand extends Command({
  name: "task:wave",
  description: "Queue the build's next wave: set its [ ] tasks to [~] and print them",
  group: GROUPS.work,
  docs: DOCS,
  examples: [`${NAME} task wave STA-12`, `${NAME} task wave STA-12 --json`],
}) {
  /** @type {string} */
  key;

  /** @param {CommandIo} io */
  async handle(io) {
    const { wave } = await import("../commands/task.mjs");
    return tasking(() => wave(io, this));
  }
}
Argument({ description: "The issue key" })(TaskWaveCommand.prototype, "key");

class SessionStopCommand extends Command({
  name: "session:stop",
  description: "The SessionEnd hook: commit and push the session's tracked work and Flow's record",
  group: GROUPS.agents,
  docs: DOCS,
  examples: [`${NAME} session stop`, `${NAME} session stop --save-only`],
}) {
  saveOnly = false;
  /** @type {string | undefined} */
  session = undefined;
  /** @type {string | undefined} */
  kind = undefined;

  /** @param {CommandIo} io */
  async handle(io) {
    const { handle: stop } = await import("../commands/session.mjs");
    return stop(io, this);
  }
}
Option({ description: "The Stop hook: write the record only; no commit, no push" })(
  SessionStopCommand.prototype,
  "saveOnly",
);
Option({ description: `The session's name; ${ENV_PREFIX}SESSION, else the transcript's title` })(
  SessionStopCommand.prototype,
  "session",
);
Str()(SessionStopCommand.prototype, "session");
Option({ description: "The session's kind, as the record keeps it" })(
  SessionStopCommand.prototype,
  "kind",
);
Str()(SessionStopCommand.prototype, "kind");

class TodoCommand extends Command({
  name: "todo",
  description:
    "Everything waiting on the owner across the workspace, each with the command that clears it",
  group: GROUPS.work,
  docs: DOCS,
  examples: [`${NAME} todo`, `${NAME} todo --repo ../app --json`],
}) {
  /** @type {string | undefined} */
  repo = undefined;

  /** @param {CommandIo} io */
  async handle(io) {
    const { handle } = await import("../commands/todo.mjs");
    return refusing(() => handle(io, this));
  }
}
Option({ description: "One repository's path instead of the workspace list" })(
  TodoCommand.prototype,
  "repo",
);
Str()(TodoCommand.prototype, "repo");

class LedgerCommand extends Command({
  name: "ledger",
  description: "What landed, released and shipped across the workspace, by day and track",
  group: GROUPS.land,
  docs: DOCS,
  examples: [`${NAME} ledger`, `${NAME} ledger --since 2026-11-01 --json`],
}) {
  /** @type {string | undefined} */
  since = undefined;
  /** @type {string | undefined} */
  repo = undefined;

  /** @param {CommandIo} io */
  async handle(io) {
    const { handle, refusal } = await import("../commands/ledger.mjs");
    const refused = refusal(this);
    if (refused) throw new UsageError(refused.message, refused.hint);
    return refusing(() => handle(io, this));
  }
}
Option({ description: "The first day listed, as YYYY-MM-DD (UTC)" })(
  LedgerCommand.prototype,
  "since",
);
Str()(LedgerCommand.prototype, "since");
Option({ description: "One repository's path instead of the workspace list" })(
  LedgerCommand.prototype,
  "repo",
);
Str()(LedgerCommand.prototype, "repo");

class GateCommand extends Command({
  name: "gate",
  description: "The stage gates, the CI gate, the spec folder and the gate run on the runner",
  group: GROUPS.specs,
  docs: DOCS,
  examples: [
    `${NAME} gate dir --key STA-12`,
    `${NAME} gate plan .agents/specs/sta-12-x/spec.md`,
    `${NAME} gate ci --base=origin/main`,
    `${NAME} gate run`,
    `${NAME} gate run --shards 4 -- --no-wait`,
    `${NAME} gate baseline check --base <sha> --json`,
  ],
}) {
  /** @type {string} */
  mode;
  /** @type {string[] | undefined} */
  operands = undefined;
  /** @type {string | undefined} */
  ref = undefined;
  /** @type {string | undefined} */
  box = undefined;
  /** @type {number | undefined} */
  shards = undefined;
  /** @type {string | undefined} */
  base = undefined;
  /** @type {string | undefined} */
  key = undefined;
  /** @type {string | undefined} */
  slug = undefined;
  /** @type {string | undefined} */
  summary = undefined;
  /** @type {string | undefined} */
  reader = undefined;

  /** @param {CommandIo} io */
  async handle(io) {
    const { run } = await import("../commands/gate.mjs");
    /** @type {(flag: string, value: string | number | undefined) => string[]} */
    const pair = (flag, value) => (value === undefined ? [] : [`--${flag}`, String(value)]);
    const operands = this.operands ?? [];
    // Each mode's own parser reads these, so they go back as it reads them: `gate run` hands the runner every
    // token after `--`; `gate baseline` reads `--base <sha>`, `gate lane` and `gate ci` read `--base=<ref>`.
    const args =
      this.mode === "run"
        ? [
            ...pair("ref", this.ref),
            ...pair("box", this.box),
            ...pair("shards", this.shards),
            ...(operands.length > 0 ? ["--", ...operands] : []),
          ]
        : [
            ...operands,
            ...(this.base === undefined
              ? []
              : this.mode === "baseline"
                ? ["--base", this.base]
                : [`--base=${this.base}`]),
            ...pair("key", this.key),
            ...pair("slug", this.slug),
            ...pair("summary", this.summary),
            ...pair("reader", this.reader),
            ...(io.json ? ["--json"] : []),
          ];
    return refusing(() => run([this.mode, ...args]));
  }
}
Argument({
  description: "run, command, baseline, plan, check, tasks, lane, branch, ci, dir or stage",
  choices: [
    "run",
    "command",
    "baseline",
    "plan",
    "check",
    "tasks",
    "lane",
    "branch",
    "ci",
    "dir",
    "stage",
  ],
})(GateCommand.prototype, "mode");
Argument({
  description:
    "The mode's operands (a spec file, a folder, save|check, a stage); for run, the runner's flags after --",
})(GateCommand.prototype, "operands");
List(GateCommand.prototype, "operands");
Option({ description: "run: the branch to gate (default HEAD)" })(GateCommand.prototype, "ref");
Str()(GateCommand.prototype, "ref");
Option({ description: "run: the ssh host to run the checks on instead of the runner" })(
  GateCommand.prototype,
  "box",
);
Str()(GateCommand.prototype, "box");
Option({ description: "run: fan the checks out over this many package shards" })(
  GateCommand.prototype,
  "shards",
);
Int()(GateCommand.prototype, "shards");
Option({
  description:
    "lane, ci: the base ref (default origin/main); baseline check: the base commit's 40-hex SHA",
})(GateCommand.prototype, "base");
Str()(GateCommand.prototype, "base");
Option({ description: "dir: the issue key, instead of the branch's" })(
  GateCommand.prototype,
  "key",
);
Str()(GateCommand.prototype, "key");
Option({ description: "dir: the spec folder's kebab-case short name" })(
  GateCommand.prototype,
  "slug",
);
Str()(GateCommand.prototype, "slug");
Option({ description: "baseline save: the run summary (default the newest .turbo/runs/*.json)" })(
  GateCommand.prototype,
  "summary",
);
Str()(GateCommand.prototype, "summary");
Option({ description: "baseline save: the summary's reader (default turbo)" })(
  GateCommand.prototype,
  "reader",
);
Str()(GateCommand.prototype, "reader");

class ParseCommand extends Command({
  name: "parse",
  description: "What the parsers read from a spec artifact, as JSON",
  group: GROUPS.specs,
  docs: DOCS,
  examples: [`${NAME} parse .agents/specs/sta-12-x/tasks.md`],
}) {
  /** @type {string} */
  file;

  async handle() {
    const { run } = await import("../commands/parse.mjs");
    return refusing(() => run([this.file]));
  }
}
Argument({ description: "A spec.md, plan.md, tasks.md or routing.yaml" })(
  ParseCommand.prototype,
  "file",
);

class HooksRunCommand extends Command({
  name: "hooks:run",
  description:
    "Run a stage's lefthook jobs here, else on the runner's box, and stamp the Hooks-Run trailer",
  group: GROUPS.work,
  docs: DOCS,
  examples: [`${NAME} hooks run pre-commit`, `${NAME} hooks run commit-msg .git/COMMIT_EDITMSG`],
}) {
  /** @type {string} */
  stage;
  /** @type {string[] | undefined} */
  hookArgs = undefined;

  async handle() {
    const { run } = await import("../commands/hooks.mjs");
    return refusing(() => run(["run", this.stage, ...(this.hookArgs ?? [])]));
  }
}
Argument({ description: "The git hook: pre-commit, commit-msg or pre-push" })(
  HooksRunCommand.prototype,
  "stage",
);
Argument({ description: "The git hook's own arguments, as git passes them" })(
  HooksRunCommand.prototype,
  "hookArgs",
);
List(HooksRunCommand.prototype, "hookArgs");

class GuardCommand extends Command({
  name: "guard",
  description:
    "The guard engine on the hook event: the preset's rules, the side doors and the secret files",
  group: GROUPS.agents,
  docs: DOCS,
  examples: [`${NAME} guard --print-settings`],
}) {
  printSettings = false;

  async handle() {
    const { run } = await import("../commands/guard.mjs");
    return refusing(() => run(this.printSettings ? ["--print-settings"] : []));
  }
}
Option({ description: "Print the .claude/settings.json hooks sync renders; run no guard" })(
  GuardCommand.prototype,
  "printSettings",
);

class ReadmeCommand extends Command({
  name: "readme",
  description: "Render README.md from .flow/readme.yml; --check exits 1 when it differs",
  group: GROUPS.setup,
  docs: DOCS,
  examples: [`${NAME} readme`, `${NAME} readme --check`],
}) {
  check = false;

  /** @param {CommandIo} io */
  async handle(io) {
    requireRepository(io.cwd);
    const { run } = await import("../commands/readme.mjs");
    return refusing(() => run(this.check ? ["--check"] : []));
  }
}
Option({ description: "Write nothing; exit 1 when README.md differs from the render" })(
  ReadmeCommand.prototype,
  "check",
);

class TeamCheckCommand extends Command({
  name: "team:check",
  description: "Check the roster and its role files",
  group: GROUPS.setup,
  docs: DOCS,
  examples: [`${NAME} team check`, `${NAME} team check --tracker`],
}) {
  tracker = false;

  /** @param {CommandIo} io */
  async handle(io) {
    requireRepository(io.cwd);
    const { run } = await import("../commands/team.mjs");
    return refusing(() => run(["check", ...(this.tracker ? ["--tracker"] : [])]));
  }
}
Option({ description: "Also list the roles' labels the tracker does not have" })(
  TeamCheckCommand.prototype,
  "tracker",
);

class LandCommand extends Command({
  name: "land",
  description: "Squash-merge a PR that is green on the gate and approved",
  group: GROUPS.land,
  docs: DOCS,
  examples: [`${NAME} land 42 --dry-run`, `${NAME} land --stack`],
}) {
  /** @type {string | undefined} */
  pr = undefined;
  stack = false;
  dryRun = false;
  manualOk = false;
  /** @type {string | undefined} */
  wait = undefined;
  noWait = false;

  async handle() {
    const { run } = await import("../commands/land.mjs");
    // parseArgs (allowNegative) stores `--no-wait` as `wait: false`, which reaches here as the string "false".
    const noWait = this.noWait || this.wait === "false";
    const args = [
      ...(this.pr === undefined ? [] : [this.pr]),
      ...(this.stack ? ["--stack"] : []),
      ...(this.dryRun ? ["--dry-run"] : []),
      ...(this.manualOk ? ["--manual-ok"] : []),
      ...(noWait ? ["--no-wait"] : this.wait === undefined ? [] : ["--wait", this.wait]),
    ];
    return refusing(() => run(args));
  }
}
Argument({
  description: "The pull request number (#42 too); the branch's open PR when left out",
  optional: true,
})(LandCommand.prototype, "pr");
Option({ description: "Land the stack bottom-up, picking up where a stopped run left it" })(
  LandCommand.prototype,
  "stack",
);
Option({ description: "Check every rule; merge nothing" })(LandCommand.prototype, "dryRun");
Option({ description: `Land although the ruleset does not require ${STATUS_CONTEXT} yet` })(
  LandCommand.prototype,
  "manualOk",
);
Option({ description: "Minutes to wait for main's land lane (default 10)" })(
  LandCommand.prototype,
  "wait",
);
Str()(LandCommand.prototype, "wait");
Option({ description: "Return at once instead of waiting for the land lane" })(
  LandCommand.prototype,
  "noWait",
);

/**
 * A release-train step (STA-1746): `train <sub>`, with its argument (`open`'s version, `add`'s and `eject`'s PR) and
 * `--dry-run` declared. It hands them to train's `run`, which checks the PR is a number.
 * @param {{ sub: string, description: string, subject?: "version" | "pr" }} definition
 * @returns {CommandClass}
 */
function trainStep({ sub, description, subject }) {
  const Step = class extends Command({
    name: `train:${sub}`,
    description,
    group: GROUPS.land,
    examples: [`${NAME} train ${sub}${subject === "pr" ? " 42" : ""}`],
    docs: DOCS,
  }) {
    /** @type {string | undefined} */
    version = undefined;
    /** @type {string | undefined} */
    pr = undefined;
    dryRun = false;

    async handle() {
      const { run } = await import("../commands/train.mjs");
      const given = this.version ?? this.pr;
      const args = [
        sub,
        ...(given === undefined ? [] : [given]),
        ...(this.dryRun ? ["--dry-run"] : []),
      ];
      return refusing(() => run(args));
    }
  };
  if (subject === "version")
    Argument({
      description: "The version, as x.y.z; the next from changesets when left out",
      optional: true,
    })(Step.prototype, "version");
  if (subject === "pr")
    Argument({ description: "The pull request number (#42 too)" })(Step.prototype, "pr");
  Option({ description: "Print what it would do; change nothing" })(Step.prototype, "dryRun");
  return Step;
}

/** Every command, in the order the list shows them within their group. */
export const COMMANDS = [
  ContextCommand,
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
    description:
      "Render the flow-* skills from the locked preset and write .flow/lock.json; --workspace for each repository",
    group: GROUPS.setup,
    examples: [`${NAME} sync`, `${NAME} sync --direct`, `${NAME} sync --workspace ~/code`],
    repository: true,
  }),
  governance({
    name: "update",
    description: "Print the diff, adopt the installed preset into the lock, then sync",
    examples: [
      `${NAME} update`,
      `${NAME} update --preset 1.2.0`,
      `${NAME} update --workspace ~/code`,
    ],
    direct: true,
    preset: true,
  }),
  governance({
    name: "check",
    description:
      "The CI check: owned files, preset, config and overrides against the lock, and review dates; writes nothing",
    examples: [`${NAME} check`, `${NAME} check --workspace ~/code`],
  }),
  governance({
    name: "diff",
    description:
      "Every file sync or update would add, change or delete, with its lines; writes nothing",
    examples: [`${NAME} diff`, `${NAME} diff --direct`, `${NAME} diff --workspace ~/code`],
    direct: true,
  }),
  governance({
    name: "validate",
    description: `Check ${CONFIG_FILE} and .flow/overrides/ against their schemas and the mandatory policies, naming each break`,
    examples: [`${NAME} validate`, `${NAME} validate --workspace ~/code`],
  }),
  DoctorCommand,
  PresetAddCommand,
  passthrough({
    name: "migrate",
    description: "Move a spec-kit repository onto .flow/",
    group: GROUPS.setup,
    examples: [`${NAME} migrate --dry-run`],
    repository: true,
  }),
  ReadmeCommand,
  TeamCheckCommand,
  passthrough({
    name: "spec",
    description:
      "The spec folder, its documents and the resolved templates, for the flow-* commands; async questions",
    group: GROUPS.specs,
    examples: [
      `${NAME} spec paths --json`,
      `${NAME} spec setup-plan --json`,
      `${NAME} spec setup-tasks --json`,
      `${NAME} spec template plan-template`,
      `${NAME} spec ask STA-12 --async`,
      `${NAME} spec resume STA-12`,
    ],
    repository: true,
  }),
  GateCommand,
  stage({
    name: "plan",
    description: "The plan stage: its workflow's input, then its tasks.md checked and recorded",
    group: GROUPS.specs,
    examples: [`${NAME} plan STA-12 --input`, `${NAME} plan STA-12 --record tasks.md`],
    subject: "The issue key",
    output: "tasks.md",
  }),
  passthrough({
    name: "trace",
    description: "The requirement to task to test matrix, spec drift and the Done rules",
    group: GROUPS.specs,
    examples: [`${NAME} trace trace .agents/specs/sta-12-x`, `${NAME} trace ci`],
  }),
  ParseCommand,
  passthrough({
    name: "linear",
    description: "Link a spec and its tasks to Linear",
    group: GROUPS.specs,
    examples: [`${NAME} linear tasks .agents/specs/sta-12-x/tasks.md --dry-run`],
  }),
  passthrough({
    name: "adr",
    description:
      "Reserve the next ADR number under the queue lock; prints it once it is on the default branch",
    group: GROUPS.specs,
    examples: [`${NAME} adr reserve cancel-order --issue STA-12`],
  }),
  passthrough({
    name: "start",
    description: "Make the issue's worktree and branch from the default branch",
    group: GROUPS.work,
    examples: [`${NAME} start STA-12 --slug cancel-order`, `${NAME} start STA-12 --dry-run`],
  }),
  StatusCommand,
  NextCommand,
  ResumeCommand,
  TaskStartCommand,
  TaskDoneCommand,
  TaskWaveCommand,
  TodoCommand,
  passthrough({
    name: "clean",
    description: "Remove finished worktrees and report what was kept",
    group: GROUPS.work,
    examples: [`${NAME} clean --dry-run`, `${NAME} clean --budget`, `${NAME} clean --all`],
  }),
  stage({
    name: "review",
    description: "The review stage: its workflow's input, then its findings recorded for land",
    group: GROUPS.land,
    examples: [`${NAME} review 42 --input`, `${NAME} review 42 --record findings.json`],
    subject: "The pull request number",
    output: "findings (JSON)",
  }),
  HooksRunCommand,
  LandCommand,
  trainStep({ sub: "open", description: "Open the next release train", subject: "version" }),
  trainStep({ sub: "add", description: "Board a green PR on the open train", subject: "pr" }),
  trainStep({ sub: "close", description: "Cut off the open train" }),
  trainStep({
    sub: "build",
    description: "Build train/<version> from the members by merge commits, then gate it",
  }),
  trainStep({ sub: "eject", description: "Eject a member from the train by hand", subject: "pr" }),
  trainStep({
    sub: "depart",
    description: "Fast-forward the default branch to the green tip and open the next train",
  }),
  trainStep({
    sub: "status",
    description: "The open train: members and their gates, ejections, waiting PRs",
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
    examples: [
      `${NAME} release`,
      `${NAME} release --offline --json`,
      `${NAME} release --preflight`,
    ],
  }),
  LedgerCommand,
  GuardCommand,
  passthrough({
    name: "mcp",
    description: "A read-only MCP server over stdio",
    group: GROUPS.agents,
    examples: [`${NAME} mcp`],
  }),
  SessionStopCommand,
  passthrough({
    name: "app",
    description: "Create the repository's gate or review GitHub App (a human only)",
    group: GROUPS.agents,
    examples: [`${NAME} app create gate --org acme`],
  }),
];

/** `fflow`'s console configuration: the theme, the version and every command. */
export const CONSOLE = { name: NAME, version: VERSION, theme: FLOW_THEME, commands: COMMANDS };
