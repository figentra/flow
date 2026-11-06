/**
 * Figentra Flow file contract:
 * Purpose: third-party skills (STA-1945 FR-8, D1). A preset's `third-party.yml` lists each skill by source, version,
 *   licence and digest; `installSkills` fetches each into a temporary folder, refuses a licence the preset has not
 *   allowed and a tree whose digest is not the pinned one, and only then moves the skills into the git-ignored
 *   `.agents/skills/.vendor/`. A `machineOnly` skill (HeroUI Pro's, Remotion's, the owner's own) is never installed
 *   or pinned; `machineOnlyProblems` finds one committed to a repository, except a listed skill whose licence lets a
 *   repository carry it (`carriable`: a free licence or the owner's own) at `.agents/skills/<id>`. `sync` installs
 *   before it writes anything else, and the lock's pins are `pinsOf` the list, so `diff` needs no fetch.
 * Boundary: `installSkills` writes only `.agents/skills/.vendor/` and the OS temp folder; `gitFetchTree` runs network
 *   git against public sources. Everything else reads.
 * Runtime: node
 * Governing contract: STA-1945 (FR-8, FR-11, AC-10, P-013).
 * Secrets: none: the sources are public.
 */
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ConfigError } from "./config.mjs";
import { git } from "./git.mjs";
import { treeDigest } from "./lock.mjs";
import { parseYaml, YamlError } from "./yaml.mjs";

/**
 * @typedef {{ id: string, source: string, version: string, licence: string, digest: string, machineOnly?: boolean,
 *   ownerEntry?: string }} ThirdPartySkill
 */
/** Fetches `source` at `version` into the existing, empty folder `dest`; throws when it cannot. */
/** @typedef {(source: string, version: string, dest: string) => void} FetchTree */

/** The preset file that lists the third-party skills. */
export const THIRD_PARTY = "third-party.yml";
/** Where `sync` installs them; the folder ignores itself. */
export const VENDOR = ".agents/skills/.vendor";
/** The licences a skill installs under without the owner's entry. */
export const ALLOWED_LICENCES = ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"];

/** The licence of the owner's own skills ("the owner's own", maybe with a note): the owner's to commit. */
const OWNER_OWN = /^the owner's own\b/;

/** A skill id is a folder name: no path, no dot first. */
const SKILL_ID = /^[a-z0-9][a-z0-9-]*$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
/** What an air-gapped machine needs, for a failed fetch. */
const MIRROR =
  "; without network, mirror the source and point git at it (`git config --global url.<mirror>.insteadOf https://github.com/`)";

/**
 * Raised when a skill must not or cannot be installed; `sync` refuses with its message and writes nothing. A
 * `ConfigError`, so `sync`, `update` and `--workspace` refuse with the message rather than a stack trace.
 */
export class SkillError extends ConfigError {}

/**
 * Why a `third-party.yml` entry is not one, or undefined.
 * @param {any} e
 * @param {Set<string>} seen the ids before it
 */
function entryProblem(e, seen) {
  if (e === null || typeof e !== "object" || Array.isArray(e)) return "is not a map";
  if (typeof e.id !== "string" || !SKILL_ID.test(e.id))
    return "needs an `id` of lower-case letters, digits and dashes";
  if (seen.has(e.id)) return `repeats the id ${e.id}`;
  if (e.machineOnly !== undefined && typeof e.machineOnly !== "boolean")
    return `(${e.id}) has a \`machineOnly\` that is not true or false`;
  const keys = e.machineOnly ? ["source", "licence"] : ["source", "version", "licence", "digest"];
  const missing = keys.find((k) => typeof e[k] !== "string" || !e[k]);
  if (missing) return `(${e.id}) needs \`${missing}\``;
  if (!e.machineOnly && !DIGEST.test(e.digest))
    return `(${e.id}) has a digest that is not sha256:<64 hex digits>`;
  if (e.ownerEntry !== undefined && typeof e.ownerEntry !== "string")
    return `(${e.id}) has an \`ownerEntry\` that is not text`;
  return undefined;
}

/**
 * The third-party skills a preset lists: none without `third-party.yml`.
 * @param {string} presetDir
 * @returns {ThirdPartySkill[]}
 * @throws {ConfigError} when the file is not a valid list
 */
export function loadThirdParty(presetDir) {
  const file = join(presetDir, THIRD_PARTY);
  if (!existsSync(file)) return [];
  let data;
  try {
    data = parseYaml(readFileSync(file, "utf8"));
  } catch (error) {
    if (!(error instanceof YamlError)) throw error;
    throw new ConfigError(`${file}: ${error.message}`);
  }
  if (!Array.isArray(data?.skills)) throw new ConfigError(`${file}: \`skills\` is not a list`);
  /** @type {Set<string>} */
  const seen = new Set();
  return data.skills.map((/** @type {any} */ entry, /** @type {number} */ i) => {
    const problem = entryProblem(entry, seen);
    if (problem) throw new ConfigError(`${file}: skills[${i}] ${problem}`);
    seen.add(entry.id);
    return { version: "", digest: "", ...entry };
  });
}

/**
 * Why `skill` may not install, or undefined: a licence outside the allowed ones needs the owner's `ownerEntry`.
 * @param {ThirdPartySkill} skill
 * @returns {string | undefined}
 */
export function licenceProblem(skill) {
  if (skill.machineOnly || skill.ownerEntry || ALLOWED_LICENCES.includes(skill.licence))
    return undefined;
  return `${skill.id}: its licence ${skill.licence} is not allowed (${ALLOWED_LICENCES.join(", ")}); only the owner's \`ownerEntry\` in the preset's ${THIRD_PARTY} allows it`;
}

/**
 * Whether a repository may carry `skill` at `.agents/skills/<id>` (the leader's decision a, STA-2131): its licence
 * allows redistribution (one `licenceProblem` passes: allowed, or with the owner's `ownerEntry`) or it is the owner's
 * own. HeroUI Pro's licence (internal use only) and Remotion's (none declared) do not, so those stay problems.
 * @param {ThirdPartySkill} skill
 */
function carriable(skill) {
  return !licenceProblem({ ...skill, machineOnly: false }) || OWNER_OWN.test(skill.licence);
}

/**
 * The lock's pins for the skills `sync` installs (every one but the machine-only).
 * @param {ThirdPartySkill[]} skills
 * @returns {Record<string, import("./lock.mjs").SkillPin>}
 */
export function pinsOf(skills) {
  return Object.fromEntries(
    skills
      .filter((s) => !s.machineOnly)
      .map((s) => [
        s.id,
        { source: s.source, version: s.version, licence: s.licence, digest: s.digest },
      ]),
  );
}

/**
 * Fetches `github:<owner>/<repo>/<path>` at the commit `version` into `dest`: a shallow clone without blobs, then only
 * the skill's folder. `version` is a full commit id, never a tag or branch, so a preset pins what it digested.
 * @type {FetchTree}
 */
export function gitFetchTree(source, version, dest) {
  const m = /^github:([\w.-]+\/[\w.-]+)\/(.+)$/.exec(source);
  if (!m || m[2].split("/").some((p) => p === "" || p === ".." || p === "."))
    throw new Error(`${source} is not github:<owner>/<repo>/<path>`);
  // A full commit id: never a branch that moves, and never read as an option.
  if (!/^[0-9a-f]{40}$/.test(version)) throw new Error(`${version} is not a full commit id`);
  const [, repo, path] = m;
  const work = mkdtempSync(join(tmpdir(), "fflow-skill-"));
  try {
    for (const args of [
      [
        "clone",
        "-q",
        "--depth",
        "1",
        "--filter=blob:none",
        "--no-checkout",
        `https://github.com/${repo}.git`,
        work,
      ],
      ["-C", work, "fetch", "-q", "--depth", "1", "origin", version],
      ["-C", work, "checkout", "-q", version, "--", path],
    ]) {
      const r = git(tmpdir(), args);
      if (!r.ok) throw new Error(r.err || `git ${args.join(" ")} failed`);
    }
    cpSync(join(work, path), dest, { recursive: true });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * Installs the listed skills into `.agents/skills/.vendor/<id>/`, all or none: each is fetched into a temporary folder
 * and checked against its pinned digest before any moves into place. One already installed at its digest is not
 * fetched again; a folder there that the list no longer names (a machine-only skill among them) is removed.
 * @param {string} root
 * @param {ThirdPartySkill[]} skills
 * @param {{ fetchTree?: FetchTree }} [deps]
 * @throws {SkillError} on a vendor folder that is a symbolic link, a licence not allowed, a failed fetch or a digest
 *   mismatch, with nothing installed
 */
export function installSkills(root, skills, { fetchTree = gitFetchTree } = {}) {
  const wanted = skills.filter((s) => !s.machineOnly);
  const vendor = join(root, VENDOR);
  // The prune below would empty the link's target (say, the machine's own skill library).
  if (lstatSync(vendor, { throwIfNoEntry: false })?.isSymbolicLink())
    throw new SkillError(`${VENDOR} is a symbolic link: remove it and run \`sync\` again`);
  if (!wanted.length) {
    rmSync(vendor, { recursive: true, force: true });
    return;
  }
  for (const skill of wanted) {
    const problem = licenceProblem(skill);
    if (problem) throw new SkillError(problem);
  }
  mkdirSync(vendor, { recursive: true });
  writeFileSync(join(vendor, ".gitignore"), "*\n");
  /** @type {[string, string][]} temporary folder, then its place */
  const fetched = [];
  try {
    for (const s of wanted) {
      const at = join(vendor, s.id);
      if (existsSync(at) && treeDigest(at) === s.digest) continue;
      const tmp = mkdtempSync(join(vendor, `.tmp-${s.id}-`));
      fetched.push([tmp, at]);
      try {
        fetchTree(s.source, s.version, tmp);
      } catch (error) {
        throw new SkillError(
          `${s.id}: could not fetch ${s.source} at ${s.version}: ${/** @type {Error} */ (error).message}${MIRROR}`,
        );
      }
      const digest = treeDigest(tmp);
      if (digest !== s.digest)
        throw new SkillError(
          `${s.id}: ${s.source} at ${s.version} has the digest ${digest}, not the ${s.digest} the preset pins`,
        );
    }
  } catch (error) {
    for (const [tmp] of fetched) rmSync(tmp, { recursive: true, force: true });
    throw error;
  }
  for (const [tmp, at] of fetched) {
    rmSync(at, { recursive: true, force: true });
    renameSync(tmp, at);
  }
  const keep = new Set([".gitignore", ...wanted.map((s) => s.id)]);
  for (const name of readdirSync(vendor))
    if (!keep.has(name)) rmSync(join(vendor, name), { recursive: true, force: true });
}

/**
 * The `name` in a `SKILL.md`'s front matter, or undefined.
 * @param {string} file
 */
function skillName(file) {
  if (!existsSync(file)) return undefined;
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(file, "utf8"))?.[1] ?? "";
  return /^name:[ \t]*["']?([^"'\r\n]*?)["']?[ \t]*$/m.exec(front)?.[1];
}

/**
 * The machine-only skills committed to the repository at `root`: each tracked folder holding a `SKILL.md` (any case)
 * whose front-matter `name` (else its folder name) is a machine-only id, in path order. Tolerated: a `carriable` skill
 * at `.agents/skills/<id>` whose front-matter `name`, if any, is `<id>`; so a folder named like a free skill that
 * holds a HeroUI Pro or Remotion skill is still reported.
 * shortcut: only the repository is checked; FR-8's registry case waits for registry `skill` items (FR-12, after
 * 0.3.0), whose publish step must refuse them the same way.
 * @param {string} root
 * @param {ThirdPartySkill[]} skills
 * @returns {{ dir: string, id: string }[]} each folder, relative to `root`, and the id it carries
 * @throws {ConfigError} when git cannot list the tracked files, so `check` fails closed
 */
export function machineOnlyProblems(root, skills) {
  const ids = new Set(skills.filter((s) => s.machineOnly).map((s) => s.id));
  const carried = new Set(skills.filter((s) => s.machineOnly && carriable(s)).map((s) => s.id));
  if (!ids.size) return [];
  const tracked = git(root, ["ls-files", "-z", "--", ":(icase)*skill.md"]);
  if (!tracked.ok)
    throw new ConfigError(
      `could not list the tracked SKILL.md files: ${tracked.err || "git failed"}`,
    );
  /** @type {Map<string, string>} */
  const found = new Map();
  for (const file of tracked.out.split("\0")) {
    const m = /^((?:.*\/)?([^/]+))\/skill\.md$/i.exec(file);
    if (!m) continue;
    const name = skillName(join(root, file));
    const id = name && ids.has(name) ? name : ids.has(m[2]) ? m[2] : undefined;
    const tolerated =
      carried.has(id ?? "") && m[1] === `.agents/skills/${id}` && (!name || name === id);
    if (id && !tolerated) found.set(m[1], id);
  }
  return [...found.keys()].toSorted().map((dir) => ({ dir, id: found.get(dir) ?? "" }));
}
