/**
 * Figentra Flow file contract:
 * Purpose: `fflow release [--json] [--offline]`: what the next release would publish and what stands in its
 *   way: the pending changesets with each package's next version, the open version pull request, the Release
 *   workflow's last run on the default branch with its notices (a skipped publish says why there), and each package's
 *   published versions on its registry.
 * Boundary: reads only. It never runs `changeset version`, publishes, tags, dispatches a workflow or merges: the
 *   repository's Release workflow does all of that in CI, where the registry's trusted-publisher exchange takes the
 *   job's GitHub ID token (no registry token exists), and an agent never dispatches it. GitHub is reached only through
 *   the configured credentials; the registry only by anonymous GET.
 * Runtime: node
 * Governing contract: Stackra ADR 0453, ADR 0503 decision 4; STA-1729 (FR-8, AC-013, AC-054); STA-1845.
 * Secrets: none here; the token stays inside `gh` or the wrapper.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { connect } from "./land.mjs";
import { say } from "../lib/cli.mjs";
import { defaultBranch, git } from "../lib/git.mjs";
import { NAME } from "../lib/product.mjs";

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
 * @returns {Map<string, { path: string, version: string, private: boolean, registry?: string }>}
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

/** @param {string[]} args */
export async function run(args = []) {
  const json = args.includes("--json");
  const offline = args.includes("--offline");
  const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).out;
  if (!root) {
    console.error(`${NAME} release: not inside a git repository`);
    return 2;
  }

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
