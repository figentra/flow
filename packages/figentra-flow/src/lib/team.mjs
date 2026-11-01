/**
 * Figentra Flow file contract:
 * Purpose: the agent roster a repository may name in `team` (FR-12, AC-046, AC-047): the index (`owner.keeps`,
 *   `rules`, `roles[] { id, label, file }`) and one file per role beside it, validated against `ROSTER_SCHEMA` and
 *   `ROLE_SCHEMA` (shipped as `schema/team.roster.schema.json` and `schema/team.role.schema.json`) and against each
 *   other: ids unique, `label` is `role:<id>`, each file's `id` matches, every `reviewed_by` and `tests_run_by` a known
 *   role, no role reviewing itself, and no `approves` entry naming a category the owner keeps.
 * Boundary: reads the roster files; writes nothing. Flow ships no role: a repository without `team` has none, and every
 *   role-aware check is off.
 * Runtime: node
 * Governing contract: STA-1729 phase 7 (the agent-team plan stop of 2026-11-01, decisions B and D).
 * Secrets: none.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { loadConfig, validate } from "./config.mjs";
import { parseYaml, YamlError } from "./yaml.mjs";

const str = { type: "string", minLength: 1 };
const strs = { type: "array", items: str };

/** The roster index's JSON Schema, the single source of `schema/team.roster.schema.json`. */
export const ROSTER_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "team.roster.schema.json",
  title: "Figentra Flow agent roster",
  type: "object",
  additionalProperties: false,
  required: ["version", "owner", "roles"],
  properties: {
    version: { const: 1 },
    owner: {
      type: "object",
      additionalProperties: false,
      required: ["keeps"],
      properties: { keeps: strs },
    },
    linear: {
      type: "object",
      additionalProperties: false,
      properties: {
        team: str,
        agent: str,
        label_group: str,
        issue_rule: {
          type: "object",
          additionalProperties: false,
          properties: { labels: str, assignee: str, delegate: str },
        },
      },
    },
    rules: {
      type: "object",
      additionalProperties: false,
      properties: {
        reviewer_not_builder: { type: "boolean" },
        tests_run_by: str,
        self_merge: { type: "boolean" },
      },
    },
    roles: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label", "file"],
        properties: { id: str, label: str, file: str },
      },
    },
  },
};

/** One role file's JSON Schema, the single source of `schema/team.role.schema.json`. */
export const ROLE_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "team.role.schema.json",
  title: "Figentra Flow agent role",
  type: "object",
  additionalProperties: false,
  required: ["id", "label", "purpose", "changes", "approves", "reviewed_by"],
  properties: {
    id: str,
    title: str,
    label: str,
    purpose: str,
    changes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["repo", "paths"],
        properties: { repo: str, paths: strs },
      },
    },
    skills: strs,
    tools: strs,
    approves: strs,
    reviewed_by: strs,
    sessions: strs,
  },
};

/**
 * @typedef {{ id: string, label: string, title?: string, purpose: string,
 *             changes: { repo: string, paths: string[] }[], approves: string[], reviewed_by: string[],
 *             sessions?: string[], skills?: string[], tools?: string[] }} Role
 * @typedef {{ version: 1, owner: { keeps: string[] }, rules?: { reviewer_not_builder?: boolean,
 *             tests_run_by?: string, self_merge?: boolean }, linear?: any,
 *             roles: { id: string, label: string, file: string }[] }} Roster
 * @typedef {{ source: string, roster: Roster, roles: Map<string, Role>, problems: string[] }} Team
 */

/**
 * Reads a YAML file, turning a parse error into a problem.
 * @param {string} file
 * @param {string} name for messages
 * @param {string[]} problems
 */
function readYaml(file, name, problems) {
  if (!existsSync(file)) {
    problems.push(`${name}: not found`);
    return undefined;
  }
  try {
    return parseYaml(readFileSync(file, "utf8"));
  } catch (error) {
    if (!(error instanceof YamlError)) throw error;
    problems.push(`${name}: ${error.message}`);
    return undefined;
  }
}

/** Whole words of a kept category in `text`, case-insensitive. */
const names = (/** @type {string} */ text, /** @type {string} */ word) =>
  new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);

/**
 * The repository's roster, or undefined when its configuration names none.
 * @param {string} root
 * @returns {Team | undefined}
 */
export function loadTeam(root) {
  const path = loadConfig(root).config.team;
  if (!path) return undefined;
  const source = resolve(root, path);
  /** @type {string[]} */
  const problems = [];
  const roster = /** @type {Roster} */ (readYaml(source, path, problems));
  /** @type {Map<string, Role>} */
  const roles = new Map();
  if (!roster) return { source, roster: /** @type {any} */ ({}), roles, problems };
  problems.push(...validate(ROSTER_SCHEMA, roster).map((p) => `${path}: ${p}`));
  const entries = Array.isArray(roster.roles) ? roster.roles : [];
  const keeps = roster.owner?.keeps ?? [];
  for (const entry of entries) {
    if (typeof entry?.id !== "string") continue;
    if (roles.has(entry.id)) problems.push(`${path}: role \`${entry.id}\` is listed twice`);
    if (entry.label !== `role:${entry.id}`)
      problems.push(
        `${path}: role \`${entry.id}\` has label \`${entry.label}\`, not \`role:${entry.id}\``,
      );
    if (typeof entry.file !== "string") continue;
    const name = join(dirname(path), entry.file);
    const role = /** @type {Role} */ (readYaml(join(dirname(source), entry.file), name, problems));
    if (!role) continue;
    problems.push(...validate(ROLE_SCHEMA, role).map((p) => `${name}: ${p}`));
    if (role.id !== entry.id)
      problems.push(`${name}: id \`${role.id}\` does not match the roster's \`${entry.id}\``);
    if (role.label !== undefined && role.label !== entry.label)
      problems.push(
        `${name}: label \`${role.label}\` does not match the roster's \`${entry.label}\``,
      );
    for (const line of Array.isArray(role.approves) ? role.approves : [])
      for (const kept of keeps)
        if (typeof line === "string" && names(line, kept))
          problems.push(
            `${name}: approves "${line}", which names \`${kept}\`, a category the owner keeps (owner.keeps)`,
          );
    roles.set(entry.id, role);
  }
  for (const [id, role] of roles)
    for (const by of Array.isArray(role.reviewed_by) ? role.reviewed_by : []) {
      if (by === id) problems.push(`role \`${id}\` reviews itself (reviewed_by)`);
      else if (!roles.has(by))
        problems.push(`role \`${id}\`: reviewed_by names an unknown role \`${by}\``);
    }
  const tests = roster.rules?.tests_run_by;
  if (tests && !roles.has(tests))
    problems.push(`${path}: rules.tests_run_by names an unknown role \`${tests}\``);
  return { source, roster, roles, problems };
}
