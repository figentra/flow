/**
 * Figentra Flow file contract:
 * Purpose: the outsider's install path (STA-1945 T121): `pnpm pack` the package, install the tarball with npm into
 *   a scratch repository that knows only the public registry scopes (`@figentra-oss` and `@stackra` on the
 *   Figentra registry, the rest on npm's default), and run the installed `fflow`: `--version`, `init` on the
 *   `neutral` preset, `sync`, `check`, `doctor --offline --json` and `mcp` (`initialize` and `tools/list` over
 *   stdio), asserting exit codes and key outputs. No workspace links: every dependency resolves from a registry.
 * Boundary: temporary folders; needs the network (the registries), so it is not in `node --test`'s `*.test.mjs`
 *   glob: CI's `e2e` job runs it (`pnpm --filter @figentra-oss/flow test:e2e`). The npm and pnpm settings of the
 *   workspace and the machine are kept out of the install (a userconfig of its own, no `npm_config_*`).
 * Runtime: node
 * Governing contract: ADR 0510; STA-1945 (T121; FR-11, P-016).
 */
// @covers sta-1945:FR-11 sta-1945:P-016
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PKG = new URL("../..", import.meta.url).pathname;
const VERSION = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8")).version;
const REGISTRY = "https://npm.stackra.figentra.com/";

/** The outsider's environment: no npm or pnpm setting inherited from the workspace, the runner or the machine. */
const OUTSIDE = {
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(npm|pnpm)_/i.test(k))),
  NO_COLOR: "1",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
};

/**
 * Runs `cmd` in `cwd`; returns its status and output.
 * @param {string} cwd
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ env?: NodeJS.ProcessEnv, input?: string }} [options]
 */
const run = (cwd, cmd, args, { env = OUTSIDE, input } = {}) => {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", env, input, timeout: 300_000 });
  return { status: r.status, out: r.stdout ?? "", err: `${r.stderr ?? ""}${r.error ?? ""}` };
};

test(
  "e2e: the packed tarball installs from the public registries and fflow runs init, sync, check, doctor and mcp",
  {
    timeout: 900_000,
  },
  (t) => {
    // The real path: git and the CLI report /private/var on macOS where tmpdir() says /var.
    const top = realpathSync(mkdtempSync(join(tmpdir(), "flow-packed-")));
    t.after(() => rmSync(top, { recursive: true, force: true }));

    // pnpm packs what is published: the `files` list, and `catalog:` replaced by the pinned versions.
    const packed = run(PKG, "pnpm", ["pack", "--pack-destination", top], { env: process.env });
    assert.equal(packed.status, 0, packed.err);
    const tarball = join(top, readdirSync(top).find((f) => f.endsWith(".tgz")) ?? "");

    const repo = join(top, "repo");
    mkdirSync(repo);
    const scopes = `@figentra-oss:registry=${REGISTRY}\n@stackra:registry=${REGISTRY}\n`;
    writeFileSync(join(repo, ".npmrc"), scopes);
    writeFileSync(join(top, "user.npmrc"), "");
    writeFileSync(
      join(repo, "package.json"),
      `${JSON.stringify({ name: "outsider", private: true }, null, 2)}\n`,
    );
    writeFileSync(join(repo, ".gitignore"), "node_modules/\n");
    run(repo, "git", ["init", "-q", "-b", "main"]);

    const env = { ...OUTSIDE, npm_config_userconfig: join(top, "user.npmrc") };
    const installed = run(repo, "npm", ["install", "--no-audit", "--no-fund", tarball], { env });
    assert.equal(installed.status, 0, installed.err);
    const modules = join(repo, "node_modules");
    assert.equal(lstatSync(join(modules, "@figentra-oss/flow")).isSymbolicLink(), false);
    const lock = JSON.parse(readFileSync(join(repo, "package-lock.json"), "utf8")).packages;
    assert.match(
      lock["node_modules/@stackra/console"]?.resolved ?? "",
      /^https:\/\/npm\.stackra\.figentra\.com\//,
      "@stackra/console resolves from the Stackra registry",
    );
    for (const f of ["src/__tests__", "assets/specify"])
      assert.equal(
        existsSync(join(modules, "@figentra-oss/flow", f)),
        false,
        `${f} is not published`,
      );

    const bin = join(modules, ".bin/fflow");
    const flow = (/** @type {string[]} */ args, input = "") => run(repo, bin, args, { input });

    const version = flow(["--version"]);
    assert.equal(version.status, 0, version.err);
    assert.match(version.out, new RegExp(VERSION.replaceAll(".", "\\.")));

    writeFileSync(
      join(repo, "flow.config.json"),
      `${JSON.stringify({ version: 1, preset: "neutral" }, null, 2)}\n`,
    );
    const init = flow(["init"]);
    assert.equal(init.status, 0, `${init.out}${init.err}`);
    assert.ok(existsSync(join(repo, ".flow/README.md")), ".flow/ is installed");
    assert.ok(
      existsSync(join(repo, ".claude/skills/flow-plan/SKILL.md")),
      "the flow-* skills are rendered",
    );
    const flowLock = JSON.parse(readFileSync(join(repo, ".flow/lock.json"), "utf8"));
    assert.equal(flowLock.preset.name, "neutral");

    const sync = flow(["sync"]);
    assert.equal(sync.status, 0, `${sync.out}${sync.err}`);
    run(repo, "git", ["add", "-A"]);
    run(repo, "git", ["commit", "-q", "-m", "flow"]);
    const check = flow(["check"]);
    assert.equal(check.status, 0, `${check.out}${check.err}`);

    const doctor = flow(["doctor", "--offline", "--json"]);
    assert.equal(doctor.status, 0, `${doctor.out}${doctor.err}`);
    const report = /** @type {{ ok: boolean, data: { id: string, status: string }[] }} */ (
      JSON.parse(doctor.out)
    );
    assert.equal(report.ok, true);
    const status = Object.fromEntries(report.data.map((row) => [row.id, row.status]));
    for (const id of ["node", "git", "config", "preset", "install", "worktrees"])
      assert.equal(status[id], "ok", `doctor's ${id} check`);

    const messages = [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "e2e", version: "0" },
        },
      },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ];
    // Closing stdin after the messages ends the server once it has answered them.
    const mcp = flow(["mcp"], messages.map((m) => `${JSON.stringify(m)}\n`).join(""));
    assert.equal(mcp.status, 0, mcp.err);
    const replies = new Map(
      mcp.out
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .map((reply) => [reply.id, reply]),
    );
    assert.equal(replies.size, 2, "only the two requests are answered");
    assert.equal(replies.get(1).result.serverInfo.name, "fflow");
    assert.equal(replies.get(1).result.serverInfo.version, VERSION);
    const tools = replies
      .get(2)
      .result.tools.map((/** @type {{ name: string }} */ tool) => tool.name);
    assert.equal(tools.length, 8);
    assert.ok(tools.includes("fflow_status") && tools.includes("fflow_clarification_record"));
  },
);
