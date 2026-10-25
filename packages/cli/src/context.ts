/**
 * CLI Context — Shared context for all command handlers
 */

import type { ExitStatus } from "@vellum/protocol";

/** Minimal writable stream the CLI writes to. */
export interface OutputStream {
  write(chunk: string): unknown;
}

/**
 * Context passed to every CLI command handler.
 */
export interface CliContext {
  /** Whether JSON output was requested */
  json: boolean;
  /** Working directory the command runs in */
  cwd: string;
  /** Whether running in a CI environment (CI=true|1) */
  ci: boolean;
  /** Whether stdin and stdout are both a terminal */
  interactive: boolean;
  /** The assistant session detected from the environment, if any */
  assistantSession: string | null;
  /**
   * The merge request's target branch, when the environment names one:
   * approvals are then judged by its Approval Policy (criterion 7.10)
   */
  targetBranch?: string;
  /** Stdout stream */
  stdout: OutputStream;
  /** Stderr stream */
  stderr: OutputStream;
}

/**
 * Environment variables an assistant runtime sets in the shells it runs.
 * Detection is a courtesy that stops an obvious mistake early; it is not the
 * guarantee. The guarantee is that an Approval Record counts only when the
 * commit adding it is signed by a key the Approval Policy lists for the
 * approver (see `vellum approve --help`).
 */
const ASSISTANT_MARKERS: ReadonlyArray<readonly [string, (value: string) => boolean]> = [
  ["ASSISTANT_SESSION", (v) => v === "true" || v === "1"],
  ["CLAUDECODE", (v) => v !== "" && v !== "0"],
  ["CLAUDE_CODE_ENTRYPOINT", (v) => v !== ""],
  ["OPENCODE", (v) => v !== "" && v !== "0"],
  ["KIRO_AGENT", (v) => v !== "" && v !== "0"],
];

/** The first assistant-session marker set in `env`, or null. */
export function detectAssistantSession(env: NodeJS.ProcessEnv): string | null {
  for (const [name, isSet] of ASSISTANT_MARKERS) {
    const value = env[name];
    if (value !== undefined && isSet(value)) return name;
  }
  return null;
}

/**
 * Environment variables naming a merge request's target branch, in order:
 * Vellum's own, then GitHub Actions' and GitLab CI's.
 */
const TARGET_BRANCH_VARIABLES = [
  "VELLUM_TARGET_BRANCH",
  "GITHUB_BASE_REF",
  "CI_MERGE_REQUEST_TARGET_BRANCH_NAME",
] as const;

/** The first non-empty target-branch variable in `env`, or undefined. */
export function detectTargetBranch(env: NodeJS.ProcessEnv): string | undefined {
  for (const name of TARGET_BRANCH_VARIABLES) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

/**
 * Create a CLI context from command arguments and environment.
 */
export function createCliContext(
  args: {
    json?: boolean;
  },
  env: NodeJS.ProcessEnv = process.env,
): CliContext {
  const ci = env.CI === "true" || env.CI === "1";
  const targetBranch = detectTargetBranch(env);
  return {
    json: args.json ?? false,
    cwd: process.cwd(),
    ci,
    interactive: Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY) && !ci,
    assistantSession: detectAssistantSession(env),
    ...(targetBranch === undefined ? {} : { targetBranch }),
    stdout: process.stdout,
    stderr: process.stderr,
  };
}

/**
 * Exit the process with the appropriate exit status.
 */
export function exitWithStatus(status: ExitStatus): never {
  process.exit(status);
}
