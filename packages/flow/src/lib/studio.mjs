/**
 * Figentra Flow file contract:
 * Purpose: the Studio's write surface over MCP (master plan Phase 5: OS's Product Studio calls Flow's tools, Flow
 *   exposes them): `spec_create` writes a Draft spec from the template for an issue key, `run_start` hands a tasked,
 *   approved spec to the build sandbox, and `run_status` reads a run back. `fflow mcp --studio` adds them to the
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

import { SANDBOX_REGIONS } from "../adapters/sandbox/index.mjs";
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

/** The Studio's three tools: two writers and one read (master plan Phase 5). */
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
      "One build run's state by its id: queued, running, passed or failed, with its spec and region.",
    inputSchema: object({ runId: str }, ["runId"]),
    annotations: { readOnlyHint: true },
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
 * @param {{ sandbox: import("../adapters/sandbox/index.mjs").BuildSandbox, today?: () => string }} deps
 */
export function studioReaders({ sandbox, today = () => new Date().toISOString().slice(0, 10) }) {
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
  };
}
