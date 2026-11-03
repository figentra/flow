/**
 * Figentra Flow file contract:
 * Purpose: `fflow` without the console engine: `@stackra/console` is an optional peer (NFR-1, FR-31), so when it is
 *   missing or fails to import, and always for `fflow guard` (the agent hook runs it on every tool call), the binary
 *   dispatches here. Each command runs by name as before the engine; `doctor` and `status` write the same checklist
 *   and tables as plain text, and `--json` as the same `{ "ok", "data" }` document.
 * Boundary: no dependency; writes to the streams it is given, human text to stderr under `--json`.
 * Runtime: node
 * Governing contract: STA-1945 FR-31, NFR-1; plan C9 (the plain renderer).
 * Secrets: none.
 */
import { ConfigError } from "./config.mjs";
import { NAME } from "./product.mjs";

/** Every command, as src/lib/console.mjs registers them (help.test.mjs pins the two lists together). */
export const COMMAND_NAMES = [
  "init",
  "sync",
  "gate",
  "trace",
  "parse",
  "linear",
  "start",
  "clean",
  "guard",
  "land",
  "train",
  "app",
  "status",
  "mcp",
  "team",
  "spec",
  "migrate",
  "ship",
  "release",
  "doctor",
  "readme",
];

/**
 * The part of the engine's `CommandIo` that `doctor` and `status` use.
 * @typedef {{ cwd: string, json: boolean, verbose: boolean, output: { line(text: string): void,
 *   title(text: string): void, note(text: string): void, warn(text: string): void, list(items: string[]): void,
 *   json(data: unknown): void, table(spec: any): void, checklist(spec: any): unknown } }} Io
 */

/** @typedef {{ write(text: string): unknown }} Stream */

/**
 * The plain output: the engine's methods as text, with `--json` held back for `finish`.
 * @param {{ cwd: string, json: boolean, verbose: boolean, stdout: Stream, stderr: Stream }} options
 * @returns {Io & { finish(code: number | void): number }}
 */
export function plainIo({ cwd, json, verbose, stdout, stderr }) {
  const out = (/** @type {string} */ s) => void (json ? stderr : stdout).write(`${s}\n`);
  const err = (/** @type {string} */ s) => void stderr.write(`${s}\n`);
  /** @type {unknown} */
  let data = null;
  let failed = false;
  return {
    cwd,
    json,
    verbose,
    output: {
      line: out,
      title: (s) => out(`\n${s}`),
      note: err,
      warn: (s) => err(`warning: ${s}`),
      list: (items) => items.forEach((i) => out(`    - ${i}`)),
      json: (value) => void (data = value),
      table({ title, columns, rows }) {
        /** @type {string[][]} */
        const cells = [
          columns.map((/** @type {any} */ c) => c.header),
          ...rows.map((/** @type {any} */ r) =>
            columns.map((/** @type {any} */ c) => String(r[c.key] ?? "")),
          ),
        ];
        const widths = cells[0].map((_, i) => Math.max(...cells.map((row) => row[i].length)));
        out(`  ${title}`);
        for (const row of cells)
          out(
            `    ${row
              .map((cell, i) => cell.padEnd(widths[i]))
              .join("  ")
              .trimEnd()}`,
          );
      },
      checklist({ rows, groups }) {
        data = rows;
        for (const group of groups) {
          const mine = rows.filter((/** @type {any} */ r) => r.group === group);
          if (mine.length) out(`${group}`);
          for (const r of mine) {
            out(`  ${r.status.padEnd(4)}  ${r.name}: ${r.detail}`);
            if (r.fix && r.status !== "ok") out(`        fix: ${r.fix}`);
          }
        }
        const count = (/** @type {string} */ s) =>
          rows.filter((/** @type {any} */ r) => r.status === s).length;
        failed = count("fail") > 0;
        out(`${count("ok")} passed, ${count("warn")} warning(s), ${count("fail")} failed`);
      },
    },
    finish(code) {
      const exit = typeof code === "number" ? code : failed ? 1 : 0;
      if (json) stdout.write(`${JSON.stringify({ ok: exit === 0, data }, null, 2)}\n`);
      return exit;
    },
  };
}

/**
 * Runs `fflow <command> …` without the engine and resolves with the exit code; a configuration refusal exits 2.
 * @param {string[]} argv
 * @param {{ cwd?: string, stdout?: Stream, stderr?: Stream }} [streams]
 * @returns {Promise<number>}
 */
export async function runPlain(argv, streams = {}) {
  const { cwd = process.cwd(), stdout = process.stdout, stderr = process.stderr } = streams;
  const [command, ...args] = argv;
  if (!COMMAND_NAMES.includes(command)) {
    stderr.write(`usage: ${NAME} <${COMMAND_NAMES.join("|")}> …\n`);
    return command === undefined || command === "--help" ? 0 : 2;
  }
  const flag = (/** @type {string} */ name) => args.includes(`--${name}`);
  const opt = (/** @type {string} */ name) =>
    flag(name) ? args[args.indexOf(`--${name}`) + 1] : undefined;
  const io = plainIo({ cwd, json: flag("json"), verbose: flag("verbose"), stdout, stderr });
  try {
    if (command === "doctor") {
      const { doctor } = await import("../commands/doctor.mjs");
      return io.finish(doctor(io, { offline: flag("offline") }));
    }
    if (command === "status") {
      const { refusal, status } = await import("../commands/status.mjs");
      const options = {
        repo: opt("repo"),
        offline: flag("offline"),
        metrics: flag("metrics"),
        since: opt("since") ?? "30d",
        by: opt("by"),
        role: opt("role"),
        web: flag("web"),
        port: Number(opt("port") ?? 4747),
      };
      const refused = refusal(options);
      if (refused) {
        stderr.write(`${NAME} status: ${refused.message} (${refused.hint})\n`);
        return 2;
      }
      return io.finish(await status(io, options));
    }
    const { run } = await import(`../commands/${command}.mjs`);
    return await run(args);
  } catch (error) {
    // An invalid or missing configuration is a refusal (2) naming the key, not a crash.
    if (!(error instanceof ConfigError)) throw error;
    stderr.write(`${NAME} ${command}: ${error.message}\n`);
    return 2;
  }
}
