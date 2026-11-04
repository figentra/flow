/**
 * Figentra Flow file contract:
 * Purpose: hold the third-party skills to STA-1945 FR-8 and D1: `third-party.yml` is checked entry by entry; only an
 *   allowed licence or the owner's entry installs; each skill is fetched into a temporary folder and moves into the
 *   git-ignored `.agents/skills/.vendor/` only when every one matches its pinned digest; a machine-only skill is never
 *   fetched, installed or locked, and `machineOnlyProblems` finds a committed one by folder or front-matter name; a
 *   vendor folder that is a symbolic link refuses; `gitFetchTree` fetches only the skill's folder at its commit;
 *   `sync` locks the pins and refuses without writing (a legacy config not renamed), and installs and pins only the
 *   skills the profile selects (FR-6); the stackra preset lists D1's machine-only skills.
 * Boundary: temporary folders and scratch git repositories; `fetchTree` copies a local folder, and `gitFetchTree`
 *   reaches `https://github.com/` only through a `url.<local>.insteadOf` mirror, so no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945.
 */
// @covers sta-1945:FR-8 sta-1945:FR-11 sta-1945:AC-10 sta-1945:P-013
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { diff } from "../commands/diff.mjs";
import { sync } from "../commands/sync.mjs";
import { ConfigError } from "../lib/config.mjs";
import { FLOW_ASSETS, LOCK } from "../lib/flow-dir.mjs";
import { readLock, treeDigest } from "../lib/lock.mjs";
import { CONFIG_FILE, LEGACY_CONFIG_FILE } from "../lib/product.mjs";
import {
  ALLOWED_LICENCES,
  gitFetchTree,
  installSkills,
  licenceProblem,
  loadThirdParty,
  machineOnlyProblems,
  pinsOf,
  SkillError,
  THIRD_PARTY,
  VENDOR,
} from "../lib/skills.mjs";
import { governed, OWN_PRESET, snapshot } from "./__fixtures__/governed.mjs";
import { sh } from "./__fixtures__/repo.mjs";

const COMMIT = "a".repeat(40);
const ZERO = `sha256:${"0".repeat(64)}`;

/**
 * A temporary folder, removed after the test.
 * @param {{ after: (fn: () => void) => void }} t
 */
function scratch(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "flow-skills-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * An upstream skill folder `dir/upstream/<id>` and the entry that pins it.
 * @param {string} dir
 * @param {string} id
 * @param {string} [licence]
 * @returns {import("../lib/skills.mjs").ThirdPartySkill}
 */
function upstream(dir, id, licence = "MIT") {
  const at = join(dir, "upstream", id);
  mkdirSync(join(at, "references"), { recursive: true });
  writeFileSync(join(at, "SKILL.md"), `---\nname: ${id}\n---\n`);
  writeFileSync(join(at, "references", "a.md"), "a\r\n");
  return {
    id,
    source: `github:o/r/skills/${id}`,
    version: COMMIT,
    licence,
    digest: treeDigest(at),
  };
}

/**
 * A machine-only entry.
 * @param {string} id
 * @returns {import("../lib/skills.mjs").ThirdPartySkill}
 */
const machineOnly = (id) => ({
  id,
  source: "the owner's library",
  version: "",
  licence: "own",
  digest: "",
  machineOnly: true,
});

/**
 * A `fetchTree` that copies `github:o/r/skills/<id>` from `dir/upstream/<id>`, recording each source.
 * @param {string} dir
 */
function localFetch(dir) {
  /** @type {string[]} */
  const calls = [];
  /** @type {import("../lib/skills.mjs").FetchTree} */
  const fetchTree = (source, _version, dest) => {
    calls.push(source);
    cpSync(join(dir, "upstream", source.split("/").at(-1) ?? ""), dest, { recursive: true });
  };
  return { calls, fetchTree };
}

/**
 * The lock pin of `skill`.
 * @param {import("../lib/skills.mjs").ThirdPartySkill} skill
 */
const pinOf = ({ source, version, licence, digest }) => ({ source, version, licence, digest });

/**
 * `skills` as `third-party.yml`.
 * @param {Record<string, unknown>[]} skills
 */
const yamlOf = (skills) =>
  `skills:\n${skills
    .map((s) =>
      Object.entries(s)
        .map(([k, v], i) => `${i ? "    " : "  - "}${k}: ${JSON.stringify(v)}`)
        .join("\n"),
    )
    .join("\n")}\n`;

test("loadThirdParty: none without the file; each entry checked; a machine-only one needs no pin", (t) => {
  const dir = scratch(t);
  assert.deepEqual(loadThirdParty(dir), []);
  const a = { id: "a", source: "github:o/r/a", version: COMMIT, licence: "MIT", digest: ZERO };
  const m = { id: "m", source: "the owner's library", licence: "own", machineOnly: true };
  writeFileSync(join(dir, THIRD_PARTY), yamlOf([a, m]));
  assert.deepEqual(loadThirdParty(dir), [a, { ...m, version: "", digest: "" }]);
  for (const [text, problem] of [
    ["skills: {}\n", /third-party\.yml: `skills` is not a list/],
    ["skills: [\n", /third-party\.yml: line 1:/],
    [yamlOf([{ id: "A" }]), /skills\[0\] needs an `id` of lower-case letters/],
    [yamlOf([m, { id: "m" }]), /skills\[1\] repeats the id m/],
    [yamlOf([{ ...m, machineOnly: "yes" }]), /\(m\) has a `machineOnly` that is not true or false/],
    [yamlOf([{ ...a, version: "" }]), /skills\[0\] \(a\) needs `version`/],
    [yamlOf([{ id: "m", licence: "own", machineOnly: true }]), /skills\[0\] \(m\) needs `source`/],
    [yamlOf([{ ...a, digest: "abc" }]), /\(a\) has a digest that is not sha256:<64 hex digits>/],
    [yamlOf([{ ...a, ownerEntry: 1 }]), /\(a\) has an `ownerEntry` that is not text/],
  ]) {
    writeFileSync(join(dir, THIRD_PARTY), /** @type {string} */ (text));
    assert.throws(
      () => loadThirdParty(dir),
      (e) => e instanceof ConfigError && /** @type {RegExp} */ (problem).test(e.message),
      String(text),
    );
  }
});

test("licenceProblem: the allowed licences install; any other needs the owner's entry", () => {
  const skill = { id: "x", source: "s", version: COMMIT, licence: "MIT", digest: ZERO };
  for (const licence of ALLOWED_LICENCES)
    assert.equal(licenceProblem({ ...skill, licence }), undefined, licence);
  assert.match(
    licenceProblem({ ...skill, licence: "GPL-3.0" }) ?? "",
    /^x: its licence GPL-3\.0 is not allowed \(MIT, .*\); only the owner's `ownerEntry`/,
  );
  assert.equal(
    licenceProblem({ ...skill, licence: "GPL-3.0", ownerEntry: "allowed by the owner" }),
    undefined,
  );
});

test("installSkills: each skill lands in the git-ignored vendor folder at its pinned digest; machine-only never", (t) => {
  const dir = scratch(t);
  const root = join(dir, "repo");
  mkdirSync(root);
  spawnSync("git", ["init", "-q"], { cwd: root });
  const a = upstream(dir, "a");
  const b = upstream(dir, "b", "Apache-2.0");
  const m = machineOnly("m");
  const { calls, fetchTree } = localFetch(dir);
  installSkills(root, [a, b, m], { fetchTree });
  const vendor = join(root, VENDOR);
  assert.deepEqual(readdirSync(vendor).toSorted(), [".gitignore", "a", "b"]);
  assert.equal(readFileSync(join(vendor, ".gitignore"), "utf8"), "*\n");
  assert.equal(treeDigest(join(vendor, "a")), a.digest);
  assert.deepEqual(calls, [a.source, b.source], "the machine-only skill is never fetched");
  const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(status.stdout, "", "the vendor folder ignores itself");
  // Installed at its digest: not fetched again; a dropped skill and a machine-only folder go.
  mkdirSync(join(vendor, "m"));
  installSkills(root, [a, m], { fetchTree });
  assert.deepEqual(calls, [a.source, b.source]);
  assert.deepEqual(readdirSync(vendor).toSorted(), [".gitignore", "a"]);
  // A hand edit no longer matches the digest: fetched again.
  writeFileSync(join(vendor, "a", "SKILL.md"), "edited\n");
  installSkills(root, [a], { fetchTree });
  assert.equal(treeDigest(join(vendor, "a")), a.digest);
  assert.equal(calls.length, 3);
  installSkills(root, [m], { fetchTree });
  assert.equal(existsSync(vendor), false);
});

test("installSkills: a vendor folder that is a symbolic link refuses, and its target keeps every file", (t) => {
  const dir = scratch(t);
  const root = join(dir, "repo");
  const library = join(dir, "library");
  mkdirSync(join(library, "animate"), { recursive: true });
  writeFileSync(join(library, "animate", "SKILL.md"), "---\nname: animate\n---\n");
  mkdirSync(join(root, ".agents", "skills"), { recursive: true });
  symlinkSync(library, join(root, VENDOR));
  const before = snapshot(library);
  const { fetchTree } = localFetch(dir);
  for (const skills of [[upstream(dir, "a")], [machineOnly("m")]])
    assert.throws(
      () => installSkills(root, skills, { fetchTree }),
      (e) => e instanceof SkillError && e.message.includes("is a symbolic link"),
    );
  assert.deepEqual(snapshot(library), before);
});

test("installSkills: a licence not allowed, a failed fetch or a digest mismatch refuses and installs nothing", (t) => {
  const dir = scratch(t);
  const root = join(dir, "repo");
  mkdirSync(root);
  const a = upstream(dir, "a");
  const { calls, fetchTree } = localFetch(dir);
  const vendor = join(root, VENDOR);
  assert.throws(
    () => installSkills(root, [a, upstream(dir, "g", "GPL-3.0")], { fetchTree }),
    (e) => e instanceof SkillError && e.message.startsWith("g: its licence GPL-3.0 is not allowed"),
  );
  assert.deepEqual(calls, [], "refused before any fetch");
  assert.equal(existsSync(vendor), false);
  const unreachable = () => {
    throw new Error("could not resolve host");
  };
  assert.throws(
    () => installSkills(root, [a], { fetchTree: unreachable }),
    (e) =>
      e instanceof SkillError &&
      /^a: could not fetch github:o\/r\/skills\/a at a{40}: could not resolve host; without network, mirror the source/.test(
        e.message,
      ),
  );
  const b = { ...upstream(dir, "b"), digest: ZERO };
  assert.throws(
    () => installSkills(root, [a, b], { fetchTree }),
    (e) =>
      e instanceof SkillError &&
      /^b: github:o\/r\/skills\/b at a{40} has the digest sha256:[0-9a-f]{64}, not the sha256:0{64} the preset pins$/.test(
        e.message,
      ),
  );
  assert.deepEqual(
    readdirSync(vendor),
    [".gitignore"],
    "a, fetched first, did not move into place",
  );
});

test("gitFetchTree: only github:<owner>/<repo>/<path> at a full commit id, refused before git runs", () => {
  for (const [source, version, problem] of [
    ["https://example.com/x", COMMIT, /is not github:<owner>\/<repo>\/<path>/],
    ["github:o/r", COMMIT, /is not github:/],
    ["github:o/r/../x", COMMIT, /is not github:/],
    ["github:o/r/x", "main", /^main is not a full commit id$/],
    ["github:o/r/x", "--upload-pack=x", /^--upload-pack=x is not a full commit id$/],
  ])
    assert.throws(
      () => gitFetchTree(String(source), String(version), tmpdir()),
      (e) => e instanceof Error && /** @type {RegExp} */ (problem).test(e.message),
      String(version),
    );
});

/**
 * Points `https://github.com/` at the local folder `dir` for the test's git runs, the mirror route the fetch hint
 * names.
 * @param {{ after: (fn: () => void) => void }} t
 * @param {string} dir
 */
function mirrorGithub(t, dir) {
  const keys = ["GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0"];
  const saved = keys.map((k) => process.env[k]);
  Object.assign(process.env, {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `url.file://${dir}/.insteadOf`,
    GIT_CONFIG_VALUE_0: "https://github.com/",
  });
  t.after(() =>
    keys.forEach((k, i) => {
      if (saved[i] === undefined) delete process.env[k];
      else process.env[k] = saved[i];
    }),
  );
}

test("gitFetchTree: fetches only the skill's folder at the pinned commit, not the tip; a missing source fails with the hint", (t) => {
  const dir = scratch(t);
  const upstreamRepo = join(dir, "o", "r.git");
  mkdirSync(join(upstreamRepo, "skills", "x"), { recursive: true });
  sh(upstreamRepo, "init", "-q");
  // Served over file://: the filter and a want by commit id, as GitHub allows.
  sh(upstreamRepo, "config", "uploadpack.allowFilter", "true");
  sh(upstreamRepo, "config", "uploadpack.allowAnySHA1InWant", "true");
  writeFileSync(join(upstreamRepo, "skills", "x", "SKILL.md"), "---\nname: x\n---\n");
  writeFileSync(join(upstreamRepo, "README.md"), "not the skill\n");
  sh(upstreamRepo, "add", "-A");
  sh(upstreamRepo, "commit", "-q", "-m", "pinned");
  const pinned = sh(upstreamRepo, "rev-parse", "HEAD");
  writeFileSync(join(upstreamRepo, "skills", "x", "SKILL.md"), "---\nname: x\n---\nlater\n");
  sh(upstreamRepo, "commit", "-q", "-am", "tip");
  mirrorGithub(t, dir);

  const dest = join(dir, "dest");
  mkdirSync(dest);
  gitFetchTree("github:o/r/skills/x", pinned, dest);
  assert.deepEqual(readdirSync(dest), ["SKILL.md"]);
  assert.equal(readFileSync(join(dest, "SKILL.md"), "utf8"), "---\nname: x\n---\n");

  const root = join(dir, "repo");
  mkdirSync(root);
  const missing = {
    id: "y",
    source: "github:o/missing/skills/y",
    version: pinned,
    licence: "MIT",
    digest: ZERO,
  };
  assert.throws(
    () => installSkills(root, [missing]),
    (e) =>
      e instanceof SkillError &&
      e.message.startsWith(`y: could not fetch github:o/missing/skills/y at ${pinned}: `) &&
      e.message.includes("url.<mirror>.insteadOf https://github.com/"),
  );
  assert.deepEqual(readdirSync(join(root, VENDOR)), [".gitignore"]);
});

test("machineOnlyProblems: a committed machine-only skill wherever it sits; not an untracked or a listed one", (t) => {
  const root = scratch(t);
  spawnSync("git", ["init", "-q"], { cwd: root });
  /** @type {[string, string, string][]} folder, file name, front-matter name */
  const files = [
    [".claude/skills/animate", "SKILL.md", "x"],
    ["docs/skills/remotion-docs", "skill.md", "x"],
    [".claude/skills/remotion", "SKILL.md", '"remotion-render"'],
    [".agents/skills/tdd", "SKILL.md", "tdd"],
    [".claude/skills/better-ui", "SKILL.md", "better-ui"],
  ];
  for (const [d, file, name] of files) {
    mkdirSync(join(root, d), { recursive: true });
    writeFileSync(join(root, d, file), `---\nname: ${name}\n---\n`);
  }
  spawnSync("git", ["add", ...files.slice(0, 4).map(([d]) => d)], { cwd: root });
  const skills = ["animate", "remotion-docs", "remotion-render", "better-ui"].map(machineOnly);
  // By folder name, a lower-case skill.md among them, or by the name its front matter gives.
  assert.deepEqual(machineOnlyProblems(root, skills), [
    { dir: ".claude/skills/animate", id: "animate" },
    { dir: ".claude/skills/remotion", id: "remotion-render" },
    { dir: "docs/skills/remotion-docs", id: "remotion-docs" },
  ]);
  // A committed skill the list installs is not machine-only.
  assert.deepEqual(machineOnlyProblems(root, [{ ...machineOnly("tdd"), machineOnly: false }]), []);
});

test("sync installs the preset's skills and locks their pins; a refusal writes nothing", (t) => {
  const dir = scratch(t);
  const root = governed(t, { own: true });
  const a = upstream(dir, "a");
  const file = join(root, OWN_PRESET, THIRD_PARTY);
  writeFileSync(file, yamlOf([a, machineOnly("m")]));
  const { fetchTree } = localFetch(dir);
  const quiet = { log: () => {}, fetchTree };
  sync(root, quiet);
  assert.deepEqual(readLock(root)?.skills, { a: pinOf(a) });
  assert.equal(treeDigest(join(root, VENDOR, "a")), a.digest);
  assert.equal(existsSync(join(root, VENDOR, "m")), false);
  assert.deepEqual(
    diff(root).filter((c) => c.path === LOCK),
    [],
    "diff reads the pins without a fetch",
  );
  writeFileSync(file, yamlOf([{ ...a, licence: "GPL-3.0" }]));
  const before = snapshot(root);
  assert.throws(
    () => sync(root, { ...quiet, adopt: true }),
    (e) =>
      e instanceof ConfigError && e.message.startsWith("a: its licence GPL-3.0 is not allowed"),
  );
  assert.deepEqual(snapshot(root), before, "nothing written");
  // Under the legacy config name, the refusal comes before the rename.
  renameSync(join(root, CONFIG_FILE), join(root, LEGACY_CONFIG_FILE));
  const legacy = snapshot(root);
  assert.throws(
    () => sync(root, { ...quiet, adopt: true }),
    (e) => e instanceof SkillError && e.message.startsWith("a: its licence GPL-3.0"),
  );
  assert.deepEqual(snapshot(root), legacy, "not renamed");
  // Both config files: refused before the install prunes the vendor folder.
  writeFileSync(file, yamlOf([a]));
  writeFileSync(join(root, CONFIG_FILE), readFileSync(join(root, LEGACY_CONFIG_FILE), "utf8"));
  const both = snapshot(root);
  assert.throws(
    () => sync(root, { ...quiet, adopt: true }),
    (e) => e instanceof ConfigError && /both exist/.test(e.message),
  );
  assert.deepEqual(snapshot(root), both, "the vendor folder kept");
});

// @covers sta-1945:FR-6 sta-1945:FR-8
test("sync installs and pins only the third-party skills the profile selects", (t) => {
  const dir = scratch(t);
  const root = governed(t, { own: true, config: { profile: "lean" } });
  writeFileSync(
    join(root, OWN_PRESET, "preset.yml"),
    'preset:\n  id: "ours"\nprofiles:\n  lean:\n    agents: []\n    skills: [flow-plan, a]\n    hooks: []\n',
  );
  const a = upstream(dir, "a");
  const b = upstream(dir, "b");
  writeFileSync(join(root, OWN_PRESET, THIRD_PARTY), yamlOf([a, b]));
  const { calls, fetchTree } = localFetch(dir);
  sync(root, { log: () => {}, fetchTree });
  assert.deepEqual(calls, [a.source], "b is never fetched");
  assert.deepEqual(readLock(root)?.skills, { a: pinOf(a) });
  assert.equal(readLock(root)?.profile, "lean");
  assert.deepEqual(readdirSync(join(root, VENDOR)).toSorted(), [".gitignore", "a"]);
});

// @covers sta-1945:FR-8 sta-1945:AC-10 sta-1945:P-013
test("stackra's third-party.yml: D1's and O9's machine-only skills, none pinned or refused", () => {
  const skills = loadThirdParty(join(FLOW_ASSETS, "presets", "stackra"));
  const only = skills.filter((s) => s.machineOnly).map((s) => s.id);
  assert.deepEqual(
    only.filter((id) => id.startsWith("heroui")),
    ["heroui-react-pro", "heroui-pro-design-taste", "heroui-react", "heroui-native"],
  );
  assert.equal(only.filter((id) => id.startsWith("remotion-")).length, 6);
  // D1's 21, then the 20 upstream skills core used to vendor (O9), until G7 pins them.
  assert.equal(only.length, 2 + 6 + 13 + 20);
  const pins = pinsOf(skills);
  for (const s of skills) {
    assert.equal(licenceProblem(s), undefined, s.id);
    if (s.machineOnly) assert.ok(!(s.id in pins), `${s.id} is never locked`);
  }
});
