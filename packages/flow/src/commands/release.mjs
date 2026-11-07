/**
 * Figentra Flow file contract:
 * Purpose: `fflow release [--json] [--offline] [--preflight]`: what the next release would publish and what stands in
 *   its way: the pending changesets with each package's next version, the open version pull request, the Release
 *   workflow's last run on the default branch with its notices (a skipped publish says why there), and each package's
 *   published versions on its registry. `--preflight` answers instead whether the owner may merge the version PR now
 *   (STA-1945): one row per item, each failed one with its fix, exit 1 when any fails; offline, the network rows are
 *   skipped, never passed.
 * Boundary: reads only. It never runs `changeset version`, publishes, tags, dispatches a workflow or merges: the
 *   repository's Release workflow does all of that in CI, where the registry's trusted-publisher exchange takes the
 *   job's GitHub ID token (no registry token exists), and an agent never dispatches it. GitHub is reached only through
 *   the configured credentials; the registry only by anonymous GET.
 * Runtime: node
 * Governing contract: Stackra ADR 0453, ADR 0503 decision 4; STA-1729 (FR-8, AC-013, AC-054); STA-1845; STA-1945.
 * Secrets: none here; the token stays inside `gh` or the wrapper.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { connect } from "./land.mjs";
import { say } from "../lib/cli.mjs";
import { gateLogins, loadConfig } from "../lib/config.mjs";
import { defaultBranch, git, isClean } from "../lib/git.mjs";
import { CONFIG_FILE, NAME, REGISTRY, STATUS_CONTEXT } from "../lib/product.mjs";
import { requiredCheckState, requiredContexts } from "../lib/required-checks.mjs";
import { parseYaml } from "../lib/yaml.mjs";

/** The Release workflow, under `.github/workflows/`. */
export const RELEASE_WORKFLOW = "release.yml";

const BUMPS = ["patch", "minor", "major"];

/**
 * The pending changesets: each `.changeset/*.md` but the README, with the bumps its frontmatter names.
 * @param {string} root
 * @returns {{ file: string, bumps: Record<string, string> }[]}
 */
export function changesetsOf(root) {
  const dir = join(root, ".changeset");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md")
    .sort()
    .map((f) => {
      const text = readFileSync(join(dir, f), "utf8");
      const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
      /** @type {Record<string, string>} */
      const bumps = {};
      for (const m of front.matchAll(/^\s*["']?([^"'\s]+?)["']?\s*:\s*["']?(\w+)["']?\s*$/gm))
        bumps[m[1]] = m[2];
      return { file: `.changeset/${f}`, bumps };
    });
}

/**
 * The registry the repository publishes to when a package names none: the `registry:` input of its Release workflow
 * (Stackra core passes it to the Runway npm provider), else undefined.
 * @param {string} root
 */
export function workflowRegistry(root) {
  const file = join(root, ".github/workflows", RELEASE_WORKFLOW);
  if (!existsSync(file)) return undefined;
  return /^\s*registry:\s*["']?(https?:\/\/[^\s"']+)/m.exec(readFileSync(file, "utf8"))?.[1];
}

/**
 * The `@scope:registry=` lines of the repository's `.npmrc`.
 * @param {string} root
 * @returns {Record<string, string>}
 */
export function scopeRegistries(root) {
  const file = join(root, ".npmrc");
  if (!existsSync(file)) return {};
  return Object.fromEntries(
    [...readFileSync(file, "utf8").matchAll(/^\s*(@[^:\s]+):registry\s*=\s*(\S+)/gm)].map((m) => [
      m[1],
      m[2],
    ]),
  );
}

/**
 * Every `package.json` git tracks, by package name, with the registry it publishes to: its `publishConfig.registry`,
 * else its scope's `.npmrc` registry, else the Release workflow's `registry:` input.
 * @param {string} root
 * `declared` is its own `publishConfig.registry`.
 * @returns {Map<string, { path: string, version: string, private: boolean, registry?: string, declared?: string }>}
 */
export function packagesOf(root) {
  const files = git(root, ["ls-files", "--", "package.json", "**/package.json"])
    .out.split("\n")
    .filter(Boolean);
  const packages = new Map();
  const scopes = scopeRegistries(root);
  const fallback = workflowRegistry(root);
  for (const path of files) {
    try {
      const m = JSON.parse(readFileSync(join(root, path), "utf8"));
      if (typeof m.name === "string")
        packages.set(m.name, {
          path,
          version: m.version ?? "0.0.0",
          private: m.private === true,
          registry: m.publishConfig?.registry ?? scopes[m.name.split("/")[0]] ?? fallback,
          declared: m.publishConfig?.registry,
        });
    } catch {
      // a broken package.json is the build's finding, not the release report's
    }
  }
  return packages;
}

/**
 * `version` bumped by `bump`, as changesets bumps it (a major from 0.x is 1.0.0).
 * @param {string} version
 * @param {string} bump
 */
export function bumped(version, bump) {
  const [major = 0, minor = 0, patch = 0] = version.split("-")[0].split(".").map(Number);
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/**
 * Each package's highest pending bump and the version it leads to.
 * @param {{ bumps: Record<string, string> }[]} changesets
 * @param {Map<string, { version: string }>} packages
 * @returns {Map<string, { bump: string, from: string, to?: string }>} `to` is absent for an unknown package
 */
export function nextVersions(changesets, packages) {
  /** @type {Map<string, { bump: string, from: string, to?: string }>} */
  const next = new Map();
  for (const { bumps } of changesets)
    for (const [name, bump] of Object.entries(bumps)) {
      if (!BUMPS.includes(bump)) continue; // "none"
      const prev = next.get(name);
      if (prev && BUMPS.indexOf(prev.bump) >= BUMPS.indexOf(bump)) continue;
      const from = packages.get(name)?.version ?? "";
      next.set(name, { bump, from, to: from ? bumped(from, bump) : undefined });
    }
  return next;
}

/**
 * Why the next release would not publish cleanly (AC-054); empty means nothing stands in its way.
 * @param {{ changesets: { file: string, bumps: Record<string, string> }[],
 *           packages: Map<string, { private: boolean, registry?: string }>,
 *           next: Map<string, { to?: string }>,
 *           published?: Map<string, string[]> }} input
 * @returns {string[]}
 */
export function releaseProblems({ changesets, packages, next, published = new Map() }) {
  const problems = [];
  for (const { file, bumps } of changesets)
    for (const name of Object.keys(bumps))
      if (!packages.has(name))
        problems.push(`${file} names ${name}, which this repository does not have`);
  for (const [name, { to }] of next) {
    const pkg = packages.get(name);
    if (!pkg || pkg.private) continue;
    if (!pkg.registry)
      problems.push(
        `${name} names no registry (publishConfig.registry, its scope in .npmrc or the Release workflow's \`registry:\`), so it would go to the default one`,
      );
    else if (to && published.get(name)?.includes(to))
      problems.push(`${name}@${to} is already on ${pkg.registry}`);
  }
  return problems;
}

/**
 * The open version pull request from `changeset-release/<branch>`, and the next versions its body does not name yet.
 * @param {import("../lib/github.mjs").Api} api
 * @param {string} repo
 * @param {string} branch
 * @param {Map<string, { to?: string }>} next
 * @returns {{ number?: number, url?: string, stale?: string[], err?: string }}
 */
export function versionPr(api, repo, branch, next) {
  const owner = repo.split("/")[0];
  const r = api("GET", `/repos/${repo}/pulls?state=open&head=${owner}:changeset-release/${branch}`);
  if (!r.ok) return { err: r.err };
  const pr = Array.isArray(r.json) ? r.json[0] : undefined;
  if (!pr) return {};
  const body = String(pr.body ?? "");
  const stale = [...next]
    .flatMap(([name, { to }]) => (to ? [`${name}@${to}`] : []))
    .filter((v) => !body.includes(v));
  return { number: pr.number, url: pr.html_url, stale };
}

/**
 * The Release workflow's last run on `branch`, with its jobs' notice and warning annotations (GitHub's own runner
 * notices left out).
 * @param {import("../lib/github.mjs").Api} api
 * @param {string} repo
 * @param {string} branch
 * @returns {{ url?: string, sha?: string, conclusion?: string, notices: string[], err?: string }}
 */
export function lastRelease(api, repo, branch) {
  const runs = api(
    "GET",
    `/repos/${repo}/actions/workflows/${RELEASE_WORKFLOW}/runs?branch=${branch}&per_page=1`,
  );
  if (!runs.ok) return { notices: [], err: runs.err };
  const last = runs.json?.workflow_runs?.[0];
  if (!last) return { notices: [] };
  const notices = [];
  const jobs = api("GET", `/repos/${repo}/actions/runs/${last.id}/jobs`);
  for (const job of jobs.ok ? (jobs.json?.jobs ?? []) : []) {
    const a = api("GET", `/repos/${repo}/check-runs/${job.id}/annotations`);
    for (const n of a.ok && Array.isArray(a.json) ? a.json : [])
      if (!/runner-images|ubuntu-latest label/i.test(n.message ?? ""))
        notices.push(`${job.name}: ${n.message}`);
  }
  return {
    url: last.html_url,
    sha: last.head_sha,
    conclusion: last.conclusion ?? last.status,
    notices,
  };
}

/**
 * The versions `registry` holds for `name`: an empty list when it was never published.
 * @param {string} registry
 * @param {string} name
 * @param {(url: string, init: object) => Promise<{ ok: boolean, status: number, json: () => Promise<any> }>} [get]
 * @returns {Promise<{ versions: string[], latest?: string, err?: string }>}
 */
export async function published(registry, name, get = fetch) {
  const url = `${registry.replace(/\/$/, "")}/${name.replace("/", "%2f")}`;
  try {
    const r = await get(url, { headers: { accept: "application/json" } });
    if (r.status === 404) return { versions: [] };
    if (!r.ok) return { versions: [], err: `${url} answered ${r.status}` };
    const doc = await r.json();
    return { versions: Object.keys(doc.versions ?? {}), latest: doc["dist-tags"]?.latest };
  } catch (error) {
    return { versions: [], err: `${url} unreachable: ${/** @type {Error} */ (error).message}` };
  }
}

/** The Quality Gate check runs the preflight requires on main and on the version PR, besides the ruleset's own. */
export const RELEASE_CHECKS = ["verify", "test"];

/** The login GitHub Actions posts check runs as. */
const ACTIONS = "github-actions[bot]";

/** @typedef {{ id: string, status: "pass" | "fail" | "skip", detail: string, fix?: string }} Row */

/** @returns {Row} */
const row = (
  /** @type {string} */ id,
  /** @type {Row["status"]} */ status,
  /** @type {string} */ detail,
  /** @type {string | undefined} */ fix = undefined,
) => ({ id, status, detail, ...(fix && status === "fail" ? { fix } : {}) });

const short = (/** @type {string | undefined} */ sha) => (sha ?? "?").slice(0, 12);

const parsed = (/** @type {string | undefined} */ text) => {
  try {
    return JSON.parse(text ?? "");
  } catch {
    return undefined;
  }
};

const slash = (/** @type {string | undefined} */ url) => url?.replace(/\/?$/, "/");

/**
 * Reads a file as of commit `sha`: from the local object store when it has the commit, else through GitHub's contents
 * API. Undefined when neither has it.
 * @param {string} root
 * @param {import("../lib/github.mjs").Api | undefined} api
 * @param {string | undefined} repo
 * @param {string} sha
 * @returns {(path: string) => string | undefined}
 */
export const reader = (root, api, repo, sha) => (path) => {
  const local = git(root, ["show", `${sha}:${path}`]);
  if (local.ok) return local.out;
  const r = api && repo ? api("GET", `/repos/${repo}/contents/${path}?ref=${sha}`) : undefined;
  const content = r?.ok ? r.json?.content : undefined;
  return typeof content === "string" && content
    ? Buffer.from(content, "base64").toString("utf8")
    : undefined;
};

/**
 * Where `pnpm-lock.yaml`'s importers disagree with the `package.json` files they stand for (a stale importer fails the
 * Release job's frozen install), and each released package's folder that has no importer. Read without installing.
 * @param {string} lock
 * @param {(path: string) => string | undefined} read
 * @param {string[]} released  the released packages' folders ("." for the root)
 * @returns {string[]}
 */
export function lockfileProblems(lock, read, released) {
  const section = /^importers:[ \t]*\n((?:[ \t].*\n|[ \t]*\n)*)/m.exec(`${lock}\n`)?.[1];
  if (section === undefined) return ["pnpm-lock.yaml has no importers"];
  /** @type {Record<string, any>} */
  let importers;
  try {
    importers = parseYaml(`importers:\n${section}`)?.importers ?? {};
  } catch (error) {
    return [`pnpm-lock.yaml's importers not read: ${/** @type {Error} */ (error).message}`];
  }
  const problems = released
    .filter((dir) => !(dir in importers))
    .map((dir) => `pnpm-lock.yaml has no importer for ${dir}`);
  for (const [dir, importer] of Object.entries(importers)) {
    const file = dir === "." ? "package.json" : `${dir}/package.json`;
    const manifest = parsed(read(file));
    if (!manifest) {
      problems.push(`pnpm-lock.yaml's importer ${dir} has no readable ${file}`);
      continue;
    }
    for (const kind of ["dependencies", "devDependencies", "optionalDependencies"]) {
      const locked = importer?.[kind] ?? {};
      const wanted = manifest[kind] ?? {};
      for (const name of new Set([...Object.keys(locked), ...Object.keys(wanted)]))
        if (locked[name]?.specifier !== wanted[name])
          problems.push(
            `${dir} ${kind} ${name}: package.json has ${wanted[name] ?? "nothing"}, pnpm-lock.yaml ${locked[name]?.specifier ?? "nothing"}`,
          );
    }
  }
  return problems;
}

/**
 * Whether the required checks are green on `sha`, each from its trusted source.
 * @param {string} id
 * @param {{ api: import("../lib/github.mjs").Api, repo: string, sha: string,
 *           required: { context: string, integration_id?: number }[], trusted: Record<string, string | string[]>,
 *           fix: string }} input
 * @returns {Row}
 */
function checksRow(id, { api, repo, sha, required, trusted, fix }) {
  const statuses = api("GET", `/repos/${repo}/commits/${sha}/statuses?per_page=100`).json;
  const state = requiredCheckState({
    required,
    trusted,
    statuses: Array.isArray(statuses) ? statuses : [],
    checkRuns:
      api("GET", `/repos/${repo}/commits/${sha}/check-runs?per_page=100`).json?.check_runs ?? [],
  });
  const bad = [
    ...state.failed.map((c) => `${c} failed`),
    ...state.pending.map((c) => `${c} is pending`),
    ...state.untrusted,
  ];
  return bad.length
    ? row(id, "fail", `at ${short(sha)}: ${bad.join("; ")}`, fix)
    : row(id, "pass", `${state.passed.join(", ")} green at ${short(sha)}`);
}

/**
 * The release preflight (STA-1945): whether the owner may merge the version PR now. Reads only: git, GitHub through
 * `api` and the registry by anonymous GET; it never merges, dispatches or publishes.
 * @param {{ root: string, branch: string, offline: boolean, api?: import("../lib/github.mjs").Api, repo?: string,
 *           problem?: string, config?: any, get?: Parameters<typeof published>[2] }} input
 *   `problem`: why GitHub cannot be read, when `api` is absent online.
 * @returns {Promise<Row[]>}
 */
export async function preflight({ root, branch, offline, api, repo, problem, config = {}, get }) {
  const changesets = changesetsOf(root);
  const packages = packagesOf(root);
  const next = nextVersions(changesets, packages);
  const gh = !offline && api && repo ? { api, repo } : undefined;
  /** A row GitHub must answer: skipped offline, failed when GitHub cannot be read. */
  const remote = (/** @type {string} */ id, /** @type {(g: NonNullable<typeof gh>) => Row} */ f) =>
    offline
      ? row(id, "skip", "not checked offline")
      : gh
        ? f(gh)
        : row(
            id,
            "fail",
            `GitHub not read: ${problem}`,
            `check the "credentials" block in ${CONFIG_FILE}`,
          );
  /** @type {Row[]} */
  const rows = [];

  const at = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).out;
  rows.push(
    at === branch
      ? row("branch", "pass", `on ${branch}`)
      : row("branch", "fail", `on ${at || "no branch"}, not ${branch}`, `git switch ${branch}`),
    isClean(root)
      ? row("clean", "pass", "no local changes")
      : row(
          "clean",
          "fail",
          "the checkout has uncommitted or untracked changes",
          "commit, stash or remove them",
        ),
  );
  const main = gh?.api("GET", `/repos/${gh.repo}/branches/${branch}`);
  /** @type {string | undefined} */
  const mainSha = main?.ok ? main.json?.commit?.sha : undefined;
  const noMain = `${branch}'s head not read: ${main?.err}`;
  rows.push(
    remote("up-to-date", () => {
      const head = git(root, ["rev-parse", "HEAD"]).out;
      if (!mainSha) return row("up-to-date", "fail", noMain);
      return head === mainSha
        ? row("up-to-date", "pass", `at origin/${branch} (${short(mainSha)})`)
        : row(
            "up-to-date",
            "fail",
            `HEAD ${short(head)} is not origin/${branch} ${short(mainSha)}`,
            `git pull --ff-only origin ${branch}`,
          );
    }),
  );

  const rules = gh?.api("GET", `/repos/${gh.repo}/rules/branches/${branch}`);
  const contexts = requiredContexts(rules?.ok && Array.isArray(rules.json) ? rules.json : []);
  const required = [
    ...contexts,
    ...RELEASE_CHECKS.filter((c) => !contexts.some((r) => r.context === c)).map((context) => ({
      context,
    })),
  ];
  const gate = gateLogins(config.apps);
  const trusted = {
    ...Object.fromEntries(RELEASE_CHECKS.map((c) => [c, ACTIONS])),
    ...(gate ? { [STATUS_CONTEXT]: gate } : {}),
    ...config.approve?.checks,
  };
  /** Checks on `sha` when the ruleset was read; a ruleset that cannot be read fails closed. */
  const checks = (
    /** @type {string} */ id,
    /** @type {NonNullable<typeof gh>} */ g,
    /** @type {string} */ sha,
    /** @type {string} */ fix,
  ) =>
    rules?.ok
      ? checksRow(id, { ...g, sha, required, trusted, fix })
      : row(id, "fail", `${branch}'s ruleset not read: ${rules?.err}`);
  rows.push(
    remote("main-checks", (g) =>
      mainSha
        ? checks(
            "main-checks",
            g,
            mainSha,
            `wait for the Quality Gate on ${branch} (a failed one is fixed by a PR, then re-run)`,
          )
        : row("main-checks", "fail", noMain),
    ),
  );

  const unknown = changesets.flatMap(({ file, bumps }) =>
    Object.keys(bumps)
      .filter((n) => !packages.has(n))
      .map((n) => `${file} names ${n}, which this repository does not have`),
  );
  const plan = [...next].map(([n, { from, to }]) => `${n} ${from || "?"} -> ${to ?? "?"}`);
  rows.push(
    unknown.length
      ? row("changesets", "fail", unknown.join("; "), "correct or remove those changesets")
      : next.size
        ? row("changesets", "pass", `${changesets.length} pending: ${plan.join(", ")}`)
        : row(
            "changesets",
            "fail",
            "no pending changesets: nothing to release",
            "land a change with a changeset first",
          ),
  );

  /** @type {any} */
  let pr;
  rows.push(
    remote("version-pr", (g) => {
      const owner = g.repo.split("/")[0];
      const r = g.api(
        "GET",
        `/repos/${g.repo}/pulls?state=open&head=${owner}:changeset-release/${branch}`,
      );
      if (!r.ok) return row("version-pr", "fail", `not read: ${r.err}`);
      pr = Array.isArray(r.json) ? r.json[0] : undefined;
      if (!pr)
        return row(
          "version-pr",
          "fail",
          `no open version PR from changeset-release/${branch}`,
          `the next Release run on ${branch} opens it`,
        );
      const problems = [];
      if (pr.base?.ref !== branch) problems.push(`it targets ${pr.base?.ref}, not ${branch}`);
      const cmp = mainSha
        ? g.api("GET", `/repos/${g.repo}/compare/${mainSha}...${pr.head?.sha}`)
        : undefined;
      if (!cmp?.ok) problems.push(`its base not read: ${cmp ? cmp.err : noMain}`);
      else if (cmp.json?.behind_by !== 0)
        problems.push(
          `it is ${cmp.json?.behind_by} commits behind ${branch} (merge base ${short(cmp.json?.merge_base_commit?.sha)})`,
        );
      const atHead = reader(root, g.api, g.repo, pr.head?.sha);
      for (const [name, { to }] of next) {
        const pkg = packages.get(name);
        if (!pkg || !to) continue;
        const has = parsed(atHead(pkg.path))?.version;
        if (has !== to) problems.push(`it has ${name}@${has ?? "?"}, the changesets imply ${to}`);
      }
      return problems.length
        ? row(
            "version-pr",
            "fail",
            `#${pr.number}: ${problems.join("; ")}`,
            `wait for the Release run on ${branch}'s head to update it (if that run failed, the owner re-runs it)`,
          )
        : row(
            "version-pr",
            "pass",
            `#${pr.number} is on ${branch} ${short(mainSha)} and bumps ${plan.join(", ")}`,
          );
    }),
    remote("version-pr-checks", (g) =>
      pr?.head?.sha
        ? checks("version-pr-checks", g, pr.head.sha, `wait for the Quality Gate on #${pr.number}`)
        : row("version-pr-checks", "fail", "no version PR to check"),
    ),
  );

  const expected = workflowRegistry(root) ?? REGISTRY;
  const publishing = [...next].flatMap(([name, { to }]) => {
    const pkg = packages.get(name);
    return pkg && !pkg.private ? [{ name, to, pkg }] : [];
  });
  const wrong = publishing.filter(({ pkg }) => slash(pkg.declared) !== slash(expected));
  rows.push(
    wrong.length
      ? row(
          "publish-config",
          "fail",
          wrong
            .map(
              ({ name, pkg }) =>
                `${name} publishes to ${pkg.declared ?? "no publishConfig.registry"}, not ${expected}`,
            )
            .join("; "),
          `set publishConfig.registry to ${expected} in ${wrong.map(({ pkg }) => pkg.path).join(", ")}`,
        )
      : row("publish-config", "pass", `${publishing.length} packages publish to ${expected}`),
  );
  if (offline) rows.push(row("registry", "skip", "not checked offline"));
  else {
    const problems = [];
    for (const { name, to, pkg } of publishing) {
      if (!to || !pkg.registry) continue;
      const got = await published(pkg.registry, name, get);
      if (got.err) problems.push(got.err);
      else if (got.versions.includes(to))
        problems.push(`${name}@${to} is already on ${pkg.registry}`);
    }
    rows.push(
      problems.length
        ? row(
            "registry",
            "fail",
            problems.join("; "),
            "a version on the registry cannot be published again: add a changeset that bumps past it",
          )
        : row("registry", "pass", `${plan.join(", ") || "nothing"} not yet published`),
    );
  }

  // At the version PR's head when there is one: that is what the Release job installs.
  const where = pr?.head?.sha ? `the version PR's head ${short(pr.head.sha)}` : "HEAD";
  const read = reader(root, gh?.api, gh?.repo, pr?.head?.sha ?? "HEAD");
  const lock = read("pnpm-lock.yaml");
  if (lock === undefined) rows.push(row("lockfile", "skip", `no pnpm-lock.yaml at ${where}`));
  else {
    const problems = lockfileProblems(
      lock,
      read,
      publishing.map(({ pkg }) => dirname(pkg.path)),
    );
    rows.push(
      problems.length
        ? row(
            "lockfile",
            "fail",
            `at ${where}: ${problems.join("; ")}`,
            "regenerate pnpm-lock.yaml (`pnpm install --lockfile-only`) where the version PR is made",
          )
        : row("lockfile", "pass", `pnpm-lock.yaml's importers match package.json at ${where}`),
    );
  }
  return rows;
}

/** @param {string[]} args */
export async function run(args = []) {
  const json = args.includes("--json");
  const offline = args.includes("--offline");
  const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).out;
  if (!root) {
    console.error(`${NAME} release: not inside a git repository`);
    return 2;
  }
  if (args.includes("--preflight")) return reportPreflight(root, { json, offline });

  const changesets = changesetsOf(root);
  const packages = packagesOf(root);
  const next = nextVersions(changesets, packages);
  const branch = defaultBranch(root);
  /** @type {string[]} */
  const notes = [];
  if (!existsSync(join(root, ".github/workflows", RELEASE_WORKFLOW)))
    notes.push(`there is no .github/workflows/${RELEASE_WORKFLOW}: nothing publishes`);

  /** @type {Map<string, string[]>} */
  const versions = new Map();
  /** @type {Record<string, { versions: string[], latest?: string, err?: string }>} */
  const registry = {};
  /** @type {ReturnType<typeof versionPr> | undefined} */
  let pr;
  /** @type {ReturnType<typeof lastRelease> | undefined} */
  let last;
  if (!offline) {
    for (const [name] of next) {
      const pkg = packages.get(name);
      if (!pkg?.registry || pkg.private) continue;
      const got = await published(pkg.registry, name);
      registry[name] = got;
      versions.set(name, got.versions);
      if (got.err) notes.push(got.err);
    }
    const { repo, api, problem } = connect(root);
    if (problem || !api || !repo) notes.push(`GitHub not read: ${problem}`);
    else {
      pr = versionPr(api, repo, branch, next);
      last = lastRelease(api, repo, branch);
      if (pr.err) notes.push(`version PR not read: ${pr.err}`);
      if (last.err) notes.push(`Release runs not read: ${last.err}`);
    }
  }
  const problems = releaseProblems({ changesets, packages, next, published: versions });

  if (json) {
    console.log(
      JSON.stringify(
        {
          schema: `${NAME}.release/1`,
          changesets,
          next: Object.fromEntries(next),
          registry,
          versionPr: pr,
          lastRun: last,
          notes,
          problems,
        },
        null,
        2,
      ),
    );
    return problems.length ? 1 : 0;
  }

  if (!next.size) say("waiting", `${NAME} release: no pending changesets, nothing to release`);
  for (const [name, { bump, from, to }] of next) {
    const reg = registry[name];
    const on = reg ? (reg.latest ? `, ${reg.latest} published` : ", never published") : "";
    say("checking", `${name}: ${from || "?"} -> ${to ?? "?"} (${bump}${on})`);
  }
  if (changesets.length) console.error(`  from ${changesets.length} changesets in .changeset/`);
  if (pr?.number)
    say(
      pr.stale?.length ? "waiting" : "approved",
      pr.stale?.length
        ? `version PR #${pr.number} is stale until the next Release run (it lacks ${pr.stale.join(", ")}): ${pr.url}`
        : `version PR #${pr.number} is current: ${pr.url}`,
    );
  else if (pr && !pr.err && next.size)
    say("waiting", "no version PR yet: the next Release run on the default branch opens it");
  if (last?.url)
    say(
      // a green run whose publish job was skipped says why in a notice: not yet a release
      ["queued", "in_progress", "pending", "waiting", "requested"].includes(last.conclusion ?? "")
        ? "checking"
        : last.conclusion !== "success"
          ? "blocked"
          : last.notices.length
            ? "waiting"
            : "approved",
      `last Release run on ${branch} (${last.sha?.slice(0, 12)}): ${last.conclusion}, ${last.url}`,
    );
  for (const n of last?.notices ?? []) console.error(`  notice: ${n}`);
  for (const n of notes) console.error(`  note: ${n}`);
  for (const p of problems) say("blocked", p);
  if (!problems.length && next.size)
    console.error("  the Release workflow publishes once the owner merges the version PR");
  return problems.length ? 1 : 0;
}

/**
 * `fflow release --preflight`: the rows, each failed one with its fix; exit 1 when any fails. A skipped row does not
 * fail the run, but the run says the answer is incomplete.
 * @param {string} root
 * @param {{ json: boolean, offline: boolean }} options
 */
async function reportPreflight(root, { json, offline }) {
  const gh = offline ? undefined : connect(root);
  const rows = await preflight({
    root,
    branch: defaultBranch(root),
    offline,
    api: gh?.api,
    repo: gh?.repo,
    problem: gh?.problem,
    config: loadConfig(root).config,
  });
  const failed = rows.filter((r) => r.status === "fail");
  const skipped = rows.filter((r) => r.status === "skip");
  if (json) {
    const ok = !failed.length && !skipped.length;
    console.log(JSON.stringify({ schema: `${NAME}.release-preflight/1`, ok, rows }, null, 2));
    return failed.length ? 1 : 0;
  }
  for (const r of rows) {
    say(
      r.status === "pass" ? "approved" : r.status === "skip" ? "waiting" : "blocked",
      `${r.id}: ${r.detail}`,
    );
    if (r.fix) console.error(`  fix: ${r.fix}`);
  }
  if (failed.length)
    say("blocked", `${NAME} release --preflight: not yet: ${failed.map((r) => r.id).join(", ")}`);
  else if (skipped.length)
    say(
      "waiting",
      `${NAME} release --preflight: ${skipped.map((r) => r.id).join(", ")} not checked; run it online before merging`,
    );
  else say("approved", `${NAME} release --preflight: the owner may merge the version PR`);
  return failed.length ? 1 : 0;
}
