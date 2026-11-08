/**
 * Figentra Flow file contract:
 * Purpose: the Studio's write surface over MCP (master plan Phase 5: OS's Product Studio calls Flow's tools, Flow
 *   exposes them): `spec_create` writes a Draft spec from the template for an issue key, `run_start` hands a tasked,
 *   approved spec to the build sandbox, `run_status` reads a run back, `run_list` pages through a spec's runs and
 *   `run_cancel` stops one that has not finished, and `repo_create` makes the product's private repository from a
 *   template through the repository host (the Figentra GitHub App), and `repo_link` links that repository to its
 *   tracker project. `fflow mcp --studio` adds them to the
 *   server's tools; without the flag the server is what it was.
 * Boundary: `spec_create` writes one new `spec.md` and nothing else (no branch, no worktree, no tracker); `run_start`
 *   writes nothing in the repository and runs only in the sandbox's EU or US region. Every call names the person it
 *   acts for (`onBehalfOf`, a user or principal public id, never a service): Flow holds no service key, the spec
 *   records the person, and the run carries them to the sandbox, which checks their grants (Stackra ADR 0209 A8,
 *   STA-2558). A refusal throws; the server turns it into the tool's error result.
 * Runtime: node
 * Governing contract: master plan 2026-11-07 Phase 5; Stackra ADR 0209 A8 (STA-2558); STA-1945.
 * Secrets: none.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { FINISHED, RUN_STATUSES, SANDBOX_REGIONS } from "../adapters/sandbox/index.mjs";
import { schemeFor } from "../adapters/tracker/index.mjs";
import { resolveTemplate, specsDirs } from "./flow-dir.mjs";
import { CONFIG_FILE, NAME } from "./product.mjs";
import { checkApproval, statusOf } from "./spec-status.mjs";

const PREFIX = NAME.replaceAll("-", "_");
const str = { type: "string" };
const object = (
  /** @type {Record<string, unknown>} */ properties,
  /** @type {string[]} */ required = [],
) => ({ type: "object", properties, required, additionalProperties: false });

/** A person's public id: a user or a principal, never a service (`svc_`), whose key Flow never holds. */
export const ON_BEHALF_OF = /^(?:usr|prn)_[0-9A-Za-z]{8,40}$/;

const onBehalfOf = {
  type: "string",
  description: "The person the call acts for: their user or principal public id (usr_…, prn_…).",
};

/** The most runs one page of `run_list` holds, and how many it holds when the caller names none. */
export const RUN_PAGE = Object.freeze({ max: 100, default: 20 });

/** A GitHub organisation or user name. */
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

/** A new repository's name: kebab-case, at most 100 characters. */
const REPO_NAME = /^(?=.{1,100}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The Studio's tools: five writers and two reads (master plan Phase 5). */
export const STUDIO_TOOLS = [
  {
    name: `${PREFIX}_spec_create`,
    description:
      "Writes a Draft spec for an issue key from the spec template: the title, the owner's description as its " +
      "Input and the person it was created for. Refused when the key already has a spec. Writes nothing else.",
    inputSchema: object({ repo: str, key: str, slug: str, title: str, intent: str, onBehalfOf }, [
      "repo",
      "key",
      "slug",
      "title",
      "intent",
      "onBehalfOf",
    ]),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: `${PREFIX}_run_start`,
    description:
      "Starts a build run of a tasked, approved spec in the build sandbox (eu or us, no real data), on behalf of " +
      "the person; answers the run's id and state.",
    inputSchema: object(
      { repo: str, key: str, region: { type: "string", enum: [...SANDBOX_REGIONS] }, onBehalfOf },
      ["repo", "key", "region", "onBehalfOf"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  {
    name: `${PREFIX}_run_status`,
    description:
      "One build run's state by its id: queued, running, passed, failed or cancelled, with its spec and region.",
    inputSchema: object({ runId: str }, ["runId"]),
    annotations: { readOnlyHint: true },
  },
  {
    name: `${PREFIX}_run_list`,
    description:
      "A spec's build runs, newest first, on behalf of the person: optionally only one status, at most `limit` " +
      `(default ${RUN_PAGE.default}, at most ${RUN_PAGE.max}) per page; pass the answer's nextCursor for the next page.`,
    inputSchema: object(
      {
        repo: str,
        key: str,
        status: { type: "string", enum: [...RUN_STATUSES] },
        limit: { type: "integer", minimum: 1, maximum: RUN_PAGE.max },
        cursor: str,
        onBehalfOf,
      },
      ["repo", "key", "onBehalfOf"],
    ),
    annotations: { readOnlyHint: true },
  },
  {
    name: `${PREFIX}_run_cancel`,
    description:
      "Cancels a queued or running build run on behalf of the person; refused for a run that has finished.",
    inputSchema: object({ runId: str, onBehalfOf }, ["runId", "onBehalfOf"]),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  },
  {
    name: `${PREFIX}_repo_create`,
    description:
      "Creates a new product's private repository `owner/name` from a template repository (`owner/repo`) through " +
      "the Figentra GitHub App, on behalf of the person. Refused when the name is taken or the template is not one.",
    inputSchema: object({ owner: str, name: str, template: str, description: str, onBehalfOf }, [
      "owner",
      "name",
      "template",
      "onBehalfOf",
    ]),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  {
    name: `${PREFIX}_repo_link`,
    description:
      "Links a repository (`owner/name`) to its tracker project (the Linear project id), on behalf of the person. " +
      "Linking the same repository again answers the existing link. Refused for an unknown project or repository.",
    inputSchema: object({ repo: str, project: str, onBehalfOf }, ["repo", "project", "onBehalfOf"]),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
];

/**
 * The repository's spec folder for `key` and its scheme, or a refusal; `undefined` folder when it has none.
 * @param {string} repo
 * @param {string} key
 */
function specOf(repo, key) {
  if (!existsSync(join(repo, CONFIG_FILE)))
    throw new Error(`${repo} is not a ${NAME} repository (no ${CONFIG_FILE})`);
  const scheme = schemeFor(repo);
  const wanted = scheme.parse(key);
  if (!wanted) throw new Error(`${key} is not an issue key`);
  const { dir } = specsDirs(repo);
  const base = join(repo, dir);
  const folder = (existsSync(base) ? readdirSync(base) : []).find(
    (f) => scheme.folderKey(f) === wanted,
  );
  return { scheme, wanted, dir, folder };
}

/** The one-line form of free text, for a Markdown line. */
const oneLine = (/** @type {string} */ text) => text.replace(/\s+/g, " ").trim();

/**
 * The Studio tools' handlers, keyed as the server looks them up (the tool name without the prefix).
 * @param {{ sandbox: import("../adapters/sandbox/index.mjs").BuildSandbox,
 *   repos: import("../adapters/repo-host/index.mjs").RepoHost,
 *   projects: import("../adapters/project-link/index.mjs").ProjectLinker, today?: () => string }} deps
 */
export function studioReaders({
  sandbox,
  repos,
  projects,
  today = () => new Date().toISOString().slice(0, 10),
}) {
  const person = (/** @type {string} */ id) => {
    if (!ON_BEHALF_OF.test(id))
      throw new Error(
        `onBehalfOf ${id} is not a person's public id (usr_… or prn_…); a service never calls alone`,
      );
    return id;
  };
  return {
    /** @param {{ repo: string, key: string, slug: string, title: string, intent: string, onBehalfOf: string }} args */
    spec_create: ({ repo, key, slug, title, intent, onBehalfOf: who }) => {
      person(who);
      const { scheme, wanted, dir, folder } = specOf(repo, key);
      const shown = scheme.display(wanted);
      if (folder) throw new Error(`${shown} already has a spec: ${dir}/${folder}`);
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
        throw new Error(`slug ${slug} is not kebab-case`);
      const template = resolveTemplate(repo, "spec-template");
      if (!template) throw new Error(`no spec-template in ${repo}'s overrides, preset or ${NAME}`);
      const name = scheme.folder(wanted, slug);
      const text = readFileSync(template, "utf8")
        .replace(/^# Feature Specification: .*$/m, `# Feature Specification: ${oneLine(title)}`)
        .replace(/^(\*\*(?:Linear|Issue)\*\*:[ \t]*)\S+/m, `$1${shown}`)
        .replace(/^(\*\*Feature Branch\*\*:[ \t]*)\S+/m, `$1\`${scheme.branch(wanted, slug)}\``)
        .replace(/^(\*\*Created\*\*:[ \t]*)\S+/m, `$1${today()}`)
        .replace(
          /^\*\*Input\*\*:.*$/m,
          `**Input**: User description: "${oneLine(intent).replaceAll('"', "'")}"\n\n**Requested by**: ${who} (Studio)`,
        );
      mkdirSync(join(repo, dir, name), { recursive: true });
      writeFileSync(join(repo, dir, name, "spec.md"), text);
      return {
        key: shown,
        folder: name,
        path: `${dir}/${name}/spec.md`,
        status: statusOf(text),
        requestedBy: who,
      };
    },
    /** @param {{ repo: string, key: string, region: string, onBehalfOf: string }} args */
    run_start: ({ repo, key, region, onBehalfOf: who }) => {
      person(who);
      if (!SANDBOX_REGIONS.includes(region))
        throw new Error(
          `the build sandbox runs in ${SANDBOX_REGIONS.join(" or ")} only, with no real data`,
        );
      const { scheme, wanted, dir, folder } = specOf(repo, key);
      const shown = scheme.display(wanted);
      if (!folder) throw new Error(`${shown} has no spec in ${dir}`);
      const text = readFileSync(join(repo, dir, folder, "spec.md"), "utf8");
      const status = statusOf(text);
      // Abandoned, superseded and done sort after tasked, and none of them is built.
      if (status !== "tasked" && status !== "implementing")
        throw new Error(`${shown} is ${status || "without a status"}; a run builds a tasked spec`);
      const problems = checkApproval(text);
      if (problems.length > 0) throw new Error(`${shown} is not approved: ${problems.join("; ")}`);
      return sandbox.start({ repo, key: shown, folder, region, onBehalfOf: who });
    },
    /** @param {{ runId: string }} args */
    run_status: async ({ runId }) => {
      const run = await sandbox.status(runId);
      if (!run) throw new Error(`no run ${runId}`);
      return run;
    },
    /** @param {{ repo: string, key: string, status?: string, limit?: number, cursor?: string, onBehalfOf: string }} args */
    run_list: async ({ repo, key, status, limit = RUN_PAGE.default, cursor, onBehalfOf: who }) => {
      person(who);
      const { scheme, wanted } = specOf(repo, key);
      if (status !== undefined && !RUN_STATUSES.includes(status))
        throw new Error(`status ${status} is not one of ${RUN_STATUSES.join(", ")}`);
      if (!Number.isInteger(limit) || limit < 1 || limit > RUN_PAGE.max)
        throw new Error(`limit ${limit} is not a whole number from 1 to ${RUN_PAGE.max}`);
      const page = await sandbox.list({
        key: scheme.display(wanted),
        ...(status === undefined
          ? {}
          : { status: /** @type {import("../adapters/sandbox/index.mjs").RunStatus} */ (status) }),
        limit,
        ...(cursor === undefined ? {} : { after: cursor }),
      });
      return { items: page.items, nextCursor: page.next };
    },
    /** @param {{ runId: string, onBehalfOf: string }} args */
    run_cancel: async ({ runId, onBehalfOf: who }) => {
      person(who);
      const run = await sandbox.status(runId);
      if (!run) throw new Error(`no run ${runId}`);
      if (FINISHED.includes(run.status))
        throw new Error(`${runId} is ${run.status}; only a queued or running run is cancelled`);
      const cancelled = await sandbox.cancel(runId, who);
      if (!cancelled) throw new Error(`no run ${runId}`);
      return cancelled;
    },
    /** @param {{ owner: string, name: string, template: string, description?: string, onBehalfOf: string }} args */
    repo_create: async ({ owner, name, template, description = "", onBehalfOf: who }) => {
      person(who);
      if (!OWNER.test(owner)) throw new Error(`owner ${owner} is not a GitHub organisation name`);
      if (!REPO_NAME.test(name))
        throw new Error(`name ${name} is not kebab-case (at most 100 characters)`);
      const [templateOwner, templateName, extra] = template.split("/");
      if (extra !== undefined || !templateOwner || !templateName || !OWNER.test(templateOwner))
        throw new Error(`template ${template} is not owner/repo`);
      if (!(await repos.isTemplate(template)))
        throw new Error(`${template} is not a template repository`);
      const fullName = `${owner}/${name}`;
      if (await repos.exists(fullName)) throw new Error(`${fullName} already exists`);
      return repos.createFromTemplate({
        owner,
        name,
        template,
        description: oneLine(description),
        onBehalfOf: who,
      });
    },
    /** @param {{ repo: string, project: string, onBehalfOf: string }} args */
    repo_link: async ({ repo, project, onBehalfOf: who }) => {
      person(who);
      const [owner, name, extra] = repo.split("/");
      if (extra !== undefined || !owner || !name || !OWNER.test(owner) || !REPO_NAME.test(name))
        throw new Error(`repo ${repo} is not owner/name`);
      if (!(await repos.exists(repo))) throw new Error(`${repo} does not exist`);
      const found = await projects.project(project);
      if (!found) throw new Error(`no project ${project}`);
      const url = `https://github.com/${repo}`;
      const existing = (await projects.links(found.id)).find((link) => link.url === url);
      if (existing) return existing;
      return projects.link({ project: found.id, url, label: `GitHub: ${repo}`, onBehalfOf: who });
    },
  };
}
