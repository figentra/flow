/**
 * Figentra Flow file contract:
 * Purpose: hold STA-1945's C6 to its contract: the stackra preset carries core's content (27 role agents beside the
 *   three stewards, 15 rules, 16 skills, 29 reference files, routing and models) and `sync` renders it, the skills
 *   beside the `flow-*` ones and the reference, routing and models always under `.agents/`, as in the preset with
 *   the provenance header; each stackra profile renders its split (agents and skills, counted) and the lock records
 *   it; the neutral preset renders none of it; a preset skill named `flow-*` or a file that is not UTF-8 is refused;
 *   `renderReference` reads only the preset folder it is given; the profiles name only what the preset carries, each
 *   selects the agents routing's trust tasks go to, and `validate` names each agent or skill a profile selects that
 *   its preset lacks; a `replace` of a preset skill's file, a reference file or `routing.yaml` is a preset source
 *   `sync` renders (FR-4); its own text runs one member's tests through turbo, never a bare filtered `pnpm test`,
 *   which skips `stackra gen` (STA-2129); its agents name no file only core has (a docs page is a link, a rule is named).
 * Boundary: temporary folders; no network.
 * Runtime: node
 * Governing contract: STA-1945 (C6, D2, FR-4).
 */
// @covers sta-1945:FR-4 sta-1945:FR-6 sta-1945:FR-7 sta-1945:FR-11 sta-1945:FR-12 sta-1945:AC-7 sta-1945:P-009 sta-1945:P-010 sta-1945:P-016
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { sync } from "../commands/sync.mjs";
import { validateRepo } from "../commands/validate.mjs";
import { FLOW_ASSETS } from "../lib/flow-dir.mjs";
import { readLock } from "../lib/lock.mjs";
import { VERSION } from "../lib/product.mjs";
import { withHeader } from "../lib/provenance.mjs";
import { installProblems, renderReference, vendored } from "../lib/render.mjs";
import { loadThirdParty } from "../lib/skills.mjs";
import { parseYaml } from "../lib/yaml.mjs";
import { governed, OWN_PRESET, snapshot } from "./__fixtures__/governed.mjs";

const STACKRA = join(FLOW_ASSETS, "presets", "stackra");
const quiet = { log: () => {} };

/**
 * A repository on `preset`, removed after the test.
 * @param {import("node:test").TestContext} t
 * @param {string} preset
 * @param {string} [profile]
 */
function repo(t, preset, profile) {
  const root = mkdtempSync(join(tmpdir(), `flow-content-${preset}-`));
  t.after(() => rmSync(root, { recursive: true }));
  writeFileSync(
    join(root, "flow.config.json"),
    JSON.stringify({ version: 1, preset, ...(profile ? { profile } : {}) }),
  );
  return root;
}

/** @param {string[]} files @param {string} prefix */
const under = (files, prefix) => files.filter((f) => f.startsWith(prefix));
/** @param {string[]} files @param {string} prefix the distinct first folder names under `prefix` */
const names = (files, prefix) => [
  ...new Set(under(files, prefix).map((f) => f.slice(prefix.length).split("/")[0])),
];

test("sync renders core's content from the stackra preset, file for file, and holds the install check", (t) => {
  const root = repo(t, "stackra");
  const { files } = sync(root, quiet);
  assert.equal(under(files, ".agents/agents/").length, 30, "27 role agents and the three stewards");
  assert.ok(files.includes(".agents/agents/security-tenancy-reviewer.md"));
  assert.equal(under(files, ".agents/rules/").length, 15);
  assert.ok(files.includes(".agents/rules/tenancy.md"));
  const skills = names(files, ".agents/skills/").filter((n) => !n.startsWith("flow-"));
  assert.equal(skills.length, 16);
  for (const skill of skills) assert.ok(files.includes(`.agents/skills/${skill}/SKILL.md`), skill);
  assert.equal(under(files, ".agents/reference/").length, 29);
  assert.ok(files.includes(".agents/reference/encore/encore-api/SKILL.md"));
  // As in the preset, with the provenance header where the file can carry one.
  for (const path of [
    "skills/docs-adr/SKILL.md",
    "reference/encore/encore-api/LICENSE",
    "routing.yaml",
    "models.yaml",
  ])
    assert.equal(
      readFileSync(join(root, ".agents", path), "utf8"),
      withHeader(`.agents/${path}`, readFileSync(join(STACKRA, path), "utf8"), {
        preset: "stackra",
        version: VERSION,
      }),
      path,
    );
  assert.equal(readLock(root)?.profile, "framework");
  assert.deepEqual(installProblems(root), []);
});

test("each stackra profile renders its split of agents and skills, and the lock records it", (t) => {
  /** [agents, skills]: everything for core; all but compiler-engineer where members are built; brand's design side. */
  const expected = {
    framework: [30, 26],
    platform: [29, 26],
    product: [29, 26],
    brand: [12, 10],
    starter: [29, 26],
  };
  for (const [profile, [agents, skills]] of Object.entries(expected)) {
    const root = repo(t, "stackra", profile);
    const { files } = sync(root, quiet);
    const rendered = names(files, ".agents/agents/");
    assert.equal(rendered.length, agents, `${profile}: agents`);
    assert.equal(names(files, ".agents/skills/").length, skills, `${profile}: skills`);
    assert.equal(rendered.includes("compiler-engineer.md"), profile === "framework", profile);
    assert.equal(readLock(root)?.profile, profile);
    assert.deepEqual(installProblems(root), [], profile);
    assert.deepEqual(validateRepo(root).problems, [], profile);
  }
  const brand = names(sync(repo(t, "stackra", "brand"), quiet).files, ".agents/skills/");
  assert.ok(brand.includes("docs-adr") && brand.includes("flow-plan"));
  assert.equal(brand.includes("test-infra"), false);
});

test("a preset skill named flow-*, or a skill file that is not UTF-8, is refused and nothing is written", (t) => {
  for (const [path, bytes] of /** @type {[string, Buffer][]} */ ([
    ["skills/flow-plan/SKILL.md", Buffer.from("---\nname: flow-plan\n---\n")],
    ["skills/logo/logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe])],
  ])) {
    const root = governed(t, { own: true });
    mkdirSync(join(root, OWN_PRESET, dirname(path)), { recursive: true });
    writeFileSync(join(root, OWN_PRESET, path), bytes);
    const before = snapshot(root);
    assert.throws(() => sync(root, quiet), /flow-\* is the commands' name|is not UTF-8 text/, path);
    assert.deepEqual(snapshot(root), before, "a refused sync writes nothing");
  }
});

test("validate names each agent or skill the profile selects that its preset lacks", (t) => {
  const root = governed(t, { own: true });
  const file = join(root, OWN_PRESET, "preset.yml");
  writeFileSync(
    file,
    readFileSync(file, "utf8").replace(
      /default: default[\s\S]*/,
      `default: lean
profiles:
  lean:
    agents: [git-steward, ghost]
    skills: [flow-plan, nowhere]
    hooks: ["*"]
`,
    ),
  );
  assert.deepEqual(validateRepo(root).problems, [
    'profile "lean" selects agents "ghost", which the preset lacks',
    'profile "lean" selects skills "nowhere", which the preset lacks',
  ]);
});

test("direct: the skills go to .claude/skills; reference, routing and models stay under .agents/", (t) => {
  const root = repo(t, "stackra");
  const { files } = sync(root, { direct: true, ...quiet });
  assert.ok(files.includes(".claude/skills/docs-adr/SKILL.md"));
  assert.deepEqual(under(files, ".agents/skills/"), []);
  assert.ok(files.includes(".agents/routing.yaml"));
  assert.ok(files.includes(".agents/models.yaml"));
  assert.equal(under(files, ".agents/reference/").length, 29);
});

test("direct after a projector linked .claude/skills into .agents: the render replaces the dangling links", (t) => {
  // Core before H6: a non-direct sync renders the skills under .agents/skills, and its own projector links each into
  // .claude/skills. The first direct sync removes the .agents copies, so those links dangle where it writes.
  const root = repo(t, "stackra");
  const { files } = sync(root, quiet);
  const linked = names(files, ".agents/skills/");
  mkdirSync(join(root, ".claude", "skills"), { recursive: true });
  for (const name of linked)
    symlinkSync(join("..", "..", ".agents", "skills", name), join(root, ".claude", "skills", name));
  const direct = sync(root, { direct: true, ...quiet });
  assert.ok(direct.files.includes(".claude/skills/docs-adr/SKILL.md"));
  for (const name of ["docs-adr", "flow-specify"]) {
    const at = join(root, ".claude", "skills", name);
    assert.equal(lstatSync(at).isSymbolicLink(), false, name);
    assert.ok(readFileSync(join(at, "SKILL.md"), "utf8").length > 0, name);
  }
});

test("vendored Markdown keeps its words but is fenced from a repository's formatter and spell checker", () => {
  const front = "---\nname: x\ndescription: a very long line\n---\n\n# Title\n\nBody.\n";
  assert.equal(
    vendored(front),
    "---\n# cspell:disable\n# prettier-ignore\nname: x\n# prettier-ignore\ndescription: a very long line\n---\n\n" +
      "<!-- prettier-ignore-start -->\n# Title\n\nBody.\n<!-- prettier-ignore-end -->\n",
  );
  assert.equal(
    vendored("# Plain\n"),
    "<!-- cspell:disable -->\n\n<!-- prettier-ignore-start -->\n# Plain\n<!-- prettier-ignore-end -->\n",
  );
});

test("the neutral preset renders none of core's content", (t) => {
  const { files } = sync(repo(t, "neutral"), quiet);
  assert.deepEqual(
    names(files, ".agents/skills/").filter((n) => !n.startsWith("flow-")),
    [],
  );
  assert.deepEqual(under(files, ".agents/reference/"), []);
  assert.equal(files.includes(".agents/routing.yaml"), false);
  assert.equal(files.includes(".agents/models.yaml"), false);
});

test("the stackra profiles name only what the preset carries, with the counts each selects", () => {
  const manifest = parseYaml(readFileSync(join(STACKRA, "preset.yml"), "utf8"));
  assert.equal(manifest.default, "framework");
  const routing = parseYaml(readFileSync(join(STACKRA, "routing.yaml"), "utf8"));
  const trust = [
    "auth",
    "tenancy",
    "iam",
    "money",
    "pii",
    "secrets",
    "ci-permissions",
    "secrets-import",
    "incident",
  ];
  const md = (/** @type {string} */ f) => f.replace(/\.md$/, "");
  /** @type {Record<"agents" | "skills", string[]>} */
  const all = {
    agents: readdirSync(join(STACKRA, "agents")).map(md),
    // A profile's skills also select the `flow-*` skills rendered from the commands.
    skills: [
      ...readdirSync(join(STACKRA, "skills")),
      ...readdirSync(join(STACKRA, "commands")).map(md),
    ],
  };
  /** The `third-party.yml` skills: a profile may select one, though sync renders none of them. */
  const listed = loadThirdParty(STACKRA).map((s) => s.id);
  /** @type {Record<string, number[]>} */
  const counts = {};
  for (const [name, profile] of Object.entries(manifest.profiles)) {
    for (const kind of /** @type {const} */ (["agents", "skills"]))
      for (const id of profile[kind])
        if (id !== "*")
          assert.ok(
            all[kind].includes(id) || (kind === "skills" && listed.includes(id)),
            `${name}: ${kind} ${id} is not in the preset`,
          );
    assert.deepEqual(profile.hooks, ["*"], `${name}: the preset ships no hooks yet`);
    const size = (/** @type {"agents" | "skills"} */ kind) =>
      profile[kind].includes("*") ? all[kind].length : profile[kind].length;
    counts[name] = [size("agents"), size("skills")];
    // Every profile gets routing.yaml and the secrets rule, so each has the agents their trust work goes to.
    for (const task of trust)
      assert.ok(
        profile.agents.includes("*") || profile.agents.includes(routing.tasks[task].agent),
        `${name}: ${task} routes to ${routing.tasks[task].agent}, which the profile does not render`,
      );
  }
  // [agents, skills]: everything for core; all but compiler-engineer where members are built; brand's design side.
  assert.deepEqual(counts, {
    framework: [30, 26],
    platform: [29, 26],
    product: [29, 26],
    brand: [12, 17],
    starter: [29, 26],
  });
});

test("renderReference reads only its preset folder; a missing file or folder renders nothing", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "flow-reference-"));
  t.after(() => rmSync(dir, { recursive: true }));
  assert.deepEqual([...renderReference({ presetDir: dir })], []);
  mkdirSync(join(dir, "reference/a"), { recursive: true });
  writeFileSync(join(dir, "reference/a/b.md"), "B\n");
  writeFileSync(join(dir, "reference/README.md"), "R\n");
  writeFileSync(join(dir, "models.yaml"), "tiers: []\n");
  assert.deepEqual(
    [...renderReference({ presetDir: dir })],
    [
      [".agents/reference/README.md", vendored("R\n")],
      [".agents/reference/a/b.md", vendored("B\n")],
      [".agents/models.yaml", "tiers: []\n"],
    ],
  );
});

test("a replace of a preset skill's file, a reference file or routing.yaml is a preset source: sync renders its text", (t) => {
  const root = repo(t, "stackra");
  const governedBy = "reason: ours\nowner: o\nreview: 2099-01-31\n";
  const overrides = {
    "skills.yml": `kind: replace\ntarget: skills/docs-adr/SKILL.md\nfile: content/skill.md\n${governedBy}`,
    "reference.yml": `kind: replace\ntarget: reference/README.md\nfile: content/reference.md\n${governedBy}`,
    "routing.yml": `kind: replace\ntarget: routing.yaml\nfile: content/routing.txt\n${governedBy}`,
    // A replacement's own name: a `.yml` beside the overrides would be read as one.
    "skill.md": "OUR SKILL\n",
    "reference.md": "OUR REFERENCE\n",
    "routing.txt": "routes: []\n",
  };
  for (const [path, text] of Object.entries(overrides)) {
    const at = join(root, ".flow/overrides/content", path);
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, text);
  }
  assert.deepEqual(validateRepo(root).problems, []);
  sync(root, quiet);
  const read = (/** @type {string} */ path) => readFileSync(join(root, path), "utf8");
  assert.match(read(".agents/skills/docs-adr/SKILL.md"), /OUR SKILL/);
  assert.match(read(".agents/reference/README.md"), /OUR REFERENCE/);
  assert.match(read(".agents/routing.yaml"), /routes: \[\]/);
  assert.match(read(".agents/routing.yaml"), /\.flow\/overrides\/content\/routing\.yml/);
});

test("the stackra preset runs one member's tests through turbo, never a bare filtered pnpm test", () => {
  /** @param {string} dir @returns {string[]} */
  const md = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? md(join(dir, e.name)) : e.name.endsWith(".md") ? [join(dir, e.name)] : [],
    );
  // reference/ is vendored third-party text, not Flow's guidance.
  const own = ["agents", "commands", "rules", "skills", "templates"].flatMap((d) =>
    md(join(STACKRA, d)),
  );
  // Each line is read with the next, so a command wrapped after `--filter <x>` is caught; a line that warns the
  // bare form skips gen names it on purpose.
  /** @param {string} text */
  const bareFiltered = (text) =>
    text.split("\n").some((line, i, lines) => {
      const joined = `${line.trimEnd()} ${lines[i + 1]?.trimStart() ?? ""}`;
      return (
        /pnpm (?:--filter|-F)[ =]\S+ (?:\S+ )*?(?:test|typecheck|build)\b/.test(joined) &&
        !joined.includes("skips `stackra gen`")
      );
    });
  assert.ok(bareFiltered("Run `pnpm --filter @stackra/logger\ntest` first."));
  assert.ok(bareFiltered("Run `pnpm -F @stackra/logger build`."));
  assert.ok(!bareFiltered("Run `pnpm turbo run build --filter=@stackra/logger`."));
  const bare = own.filter((f) => bareFiltered(readFileSync(f, "utf8")));
  assert.deepEqual(bare, []);
  assert.match(
    readFileSync(join(STACKRA, "rules", "task-vocabulary.md"), "utf8"),
    /`Needs testing: pnpm turbo run test --filter=<name>`/,
  );
});

test("the stackra preset's agents name no file only core has: docs pages are links, rules are named", () => {
  // A product's validate refuses an agent that backticks a repository path it lacks (core's checkAgentSources); a
  // direct sync renders the rules under .claude/rules, so a rule's path differs by mode too.
  const coreOnly =
    /`(?:apps\/docs\/src\/docs\/[^`<>*]+\.mdx|\.agents\/rules\/[^`<>*]+|tools\/[^`<>*]+)`/;
  const agents = join(STACKRA, "agents");
  const offenders = readdirSync(agents)
    .filter((f) => f.endsWith(".md"))
    .flatMap((f) =>
      readFileSync(join(agents, f), "utf8")
        .split("\n")
        .filter((line) => coreOnly.test(line))
        .map((line) => `${f}: ${line.trim()}`),
    );
  assert.deepEqual(offenders, []);
  assert.ok(coreOnly.test("read `.agents/rules/linear.md`"));
  assert.ok(!coreOnly.test("write `apps/docs/src/docs/adr/NNNN-<slug>.mdx`"));
});
