/**
 * Figentra Flow file contract:
 * Purpose: hold the configuration to AC-035, AC-036 and AC-042: the shipped schema file equals `SCHEMA`; Figentra's
 *   configuration and a minimal outside one are valid; an unknown key, a wrong kind, a wrong type and a missing field
 *   are refused by their path; a missing port is refused naming its key; the older `package.json` keys still work with
 *   a warning; the gate App's `aliases` (a rename, ADR 0523) add logins and the bare login keeps its string form;
 *   the product's name-bearing literals live only in `product.mjs`; and `profile` is a name (STA-1945).
 * Boundary: temporary folders and the package's own source files; nothing runs.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1729 phase A (A1); STA-1945 (FR-6).
 */
// @covers sta-1729:FR-11 sta-1729:AC-035 sta-1729:AC-036 sta-1729:AC-042 sta-1729:P-011
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { ConfigError, gateLogins, loadConfig, need, SCHEMA, validate } from "../lib/config.mjs";
import { CONFIG_FILE, ENV_PREFIX, GATE_DIR, GATE_MARKER, STATUS_CONTEXT } from "../lib/product.mjs";

const PACKAGE_DIR = fileURLToPath(new URL("../..", import.meta.url));

/** Figentra's configuration, as our repositories carry it (the phase A plan). */
const FIGENTRA = {
  version: 1,
  preset: "stackra",
  tracker: {
    kind: "linear",
    team: "STA",
    branchPrefix: "figentra",
    token: ["LINEAR_AGENT_TOKEN", "LINEAR_API_KEY"],
  },
  credentials: { kind: "wrapper", gh: ["pnpm", "bot:gh", "--"], git: ["pnpm", "bot:git", "--"] },
  runner: { kind: "command", run: ["stackra", "testbed", "run", "{label}", "{dir}", "{command}"] },
  secrets: { kind: "infisical", paths: { gate: "/ci/gate" } },
  apps: {
    gate: { slug: "figentra-gate", login: "figentra-gate[bot]" },
    review: { slug: "figentra-review" },
    owner: "figentra-usr",
  },
  gate: { check: "pnpm verify" },
  clean: { keep: ["g-*", "*-gate", "land-*", "tpl-core", "c6-lock*", "template-wt-lean"] },
  artifacts: { paths: [".cache/", "node_modules/"], maxBytes: 5_000_000 },
};

/** A folder holding `files`. */
function folder(/** @type {Record<string, string>} */ files) {
  const dir = mkdtempSync(join(tmpdir(), "flow-config-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

test("schema: the shipped file is SCHEMA", () => {
  assert.deepEqual(
    JSON.parse(
      readFileSync(
        join(PACKAGE_DIR, "schema", CONFIG_FILE.replace(".json", ".schema.json")),
        "utf8",
      ),
    ),
    SCHEMA,
  );
});

test("schema: Figentra's configuration and a minimal outside one are valid", () => {
  assert.deepEqual(validate(SCHEMA, FIGENTRA), []);
  assert.deepEqual(
    validate(SCHEMA, {
      version: 1,
      tracker: { kind: "github-issues", branchPrefix: "work" },
      credentials: { kind: "env" },
      runner: { kind: "github-actions" },
    }),
    [],
  );
});

test("schema: unknown keys, wrong kinds, wrong types and missing fields are refused by path", () => {
  const problems = (/** @type {object} */ over) =>
    validate(SCHEMA, { ...FIGENTRA, ...over }).join("\n");
  assert.match(problems({ colour: "red" }), /^colour: is not a known key$/m);
  assert.match(
    problems({ runner: { kind: "jenkins" } }),
    /^runner\.kind: must be one of github-actions, ssh, local, command$/m,
  );
  assert.match(problems({ runner: { kind: "ssh" } }), /^runner\.host: is required$/m);
  assert.match(
    problems({ credentials: { kind: "wrapper", gh: [] } }),
    /^credentials\.gh: must have at least 1 item/m,
  );
  assert.match(
    problems({ tracker: { ...FIGENTRA.tracker, team: 7 } }),
    /^tracker\.team: must be a string$/m,
  );
  assert.match(
    problems({ artifacts: { maxBytes: 0 } }),
    /^artifacts\.maxBytes: must be at least 1$/m,
  );
  assert.match(problems({ version: 2 }), /^version: must be 1$/m);
});

// @covers sta-1945:FR-6 sta-1945:AC-6 sta-1945:P-009
test("schema: the config names its profile by a non-empty string", () => {
  assert.deepEqual(validate(SCHEMA, { ...FIGENTRA, profile: "framework" }), []);
  assert.deepEqual(validate(SCHEMA, { ...FIGENTRA, profile: "" }), ["profile: must not be empty"]);
  assert.deepEqual(validate(SCHEMA, { ...FIGENTRA, profile: ["framework"] }), [
    "profile: must be a string",
  ]);
});

test("config: a renamed gate App's aliases add logins; without them the login stays a string", () => {
  const renamed = {
    ...FIGENTRA,
    apps: { ...FIGENTRA.apps, gate: { ...FIGENTRA.apps.gate, aliases: ["figentra-flow[bot]"] } },
  };
  assert.deepEqual(validate(SCHEMA, renamed), []);
  assert.deepEqual(gateLogins(renamed.apps), ["figentra-gate[bot]", "figentra-flow[bot]"]);
  assert.equal(gateLogins(FIGENTRA.apps), "figentra-gate[bot]");
  assert.equal(gateLogins(undefined), undefined);
  // Unvalidated config: a bare string or an empty alias widens nothing.
  const raw = (/** @type {any} */ aliases) => gateLogins({ gate: { login: "a[bot]", aliases } });
  assert.equal(raw("figentra-flow[bot]"), "a[bot]");
  assert.deepEqual(raw(["", "b[bot]"]), ["a[bot]", "b[bot]"]);
  const bad = (/** @type {unknown} */ aliases) =>
    validate(SCHEMA, { version: 1, apps: { gate: { login: "a[bot]", aliases } } }).join("\n");
  assert.match(bad([]), /^apps\.gate\.aliases: must have at least 1 item/m);
  assert.match(bad([""]), /^apps\.gate\.aliases\[0\]: must not be empty$/m);
  assert.match(bad("b[bot]"), /^apps\.gate\.aliases: must be a array$/m);
});

test("config: a file is loaded and validated; a missing port is refused naming its key", (t) => {
  const good = folder({
    [CONFIG_FILE]: JSON.stringify({ version: 1, credentials: { kind: "gh-user" } }),
  });
  const bad = folder({
    [CONFIG_FILE]: JSON.stringify({ version: 1, runner: { kind: "jenkins" } }),
  });
  const broken = folder({ [CONFIG_FILE]: "{ not json" });
  t.after(() => [good, bad, broken].forEach((d) => rmSync(d, { recursive: true })));
  const loaded = loadConfig(good);
  assert.deepEqual(loaded.errors, []);
  assert.deepEqual(need(loaded, "credentials", "a GitHub call"), { kind: "gh-user" });
  assert.throws(
    () => need(loaded, "runner", "gate run"),
    (e) => e instanceof ConfigError && /gate run needs "runner"/.test(e.message),
  );
  assert.throws(() => need(loadConfig(bad), "credentials", "x"), /runner\.kind: must be one of/);
  assert.match(loadConfig(broken).errors.join(), /not valid JSON/);
});

test("config: only the configuration file is read; package.json's old key is ignored", (t) => {
  const dir = folder({
    "package.json": JSON.stringify({ vellum: { credentials: "gh-user", gate: "pnpm test" } }),
  });
  t.after(() => rmSync(dir, { recursive: true }));
  assert.deepEqual(loadConfig(dir), { config: {}, source: undefined, warnings: [], errors: [] });
});

test("product: the name-bearing literals appear only in product.mjs among the sources (AC-042)", () => {
  const literals = [CONFIG_FILE, STATUS_CONTEXT, GATE_MARKER, GATE_DIR, ENV_PREFIX];
  const walk = (/** @type {string} */ dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? e.name === "__tests__"
          ? []
          : walk(join(dir, e.name))
        : [join(dir, e.name)],
    );
  for (const file of walk(join(PACKAGE_DIR, "src"))) {
    if (file.endsWith("product.mjs")) continue;
    // Comments explain the product; code must take its names from product.mjs.
    const code = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const literal of literals)
      assert.equal(code.includes(literal), false, `${file} spells ${literal}`);
  }
});
