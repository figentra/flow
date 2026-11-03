/**
 * Figentra Flow file contract:
 * Purpose: the mandatory policies (STA-1945 FR-5): the guard's secret and tenancy tables, the owner-only paths and the
 *   guard's wiring. No override may disable, replace or configure one; an `extend` may only tighten it, by adding
 *   `items` to the policy's rule list (target: the policy's id). An item `!<rule>` asks to drop a rule, which loosens
 *   the policy, so it is refused. `policyProblems` names each override that breaks this and the policy it touches.
 * Boundary: pure: overrides and rule lists in, problems out.
 * Runtime: node
 * Governing contract: STA-1945 (FR-5, AC-5, P-008).
 * Secrets: none.
 */
import { OWNER_ONLY } from "./owner-only.mjs";
import { APPROVE_WORKFLOW } from "./product.mjs";

/** The mandatory policies (FR-5). */
export const MANDATORY = ["guard.secrets", "guard.tenancy", "owner-only", "guard.wiring"];

/** The policies held as a rule list, which an `extend` of the policy's id with `items` adds to. */
export const RULE_LISTS = ["guard.secrets", "guard.tenancy", "owner-only"];

/**
 * Each rule-list policy's rules before any override. The guard's secret and tenancy tables join as preset data with
 * STA-1945 PR 4; until then an `extend` of them is checked but changes nothing.
 * @type {Record<string, string[]>}
 */
export const PRESET_RULES = { "guard.secrets": [], "guard.tenancy": [], "owner-only": OWNER_ONLY };

/**
 * The rendered outputs each policy lives in: an override on one of them is an override on the policy. The guard's
 * tables and its wiring are rendered from STA-1945 PR 4 and PR 5; their outputs are listed now so no override can be
 * written ahead of them.
 * @type {Record<string, string[]>}
 */
const OUTPUTS = {
  "guard.secrets": [],
  "guard.tenancy": [],
  "owner-only": [".github/CODEOWNERS", `.github/workflows/${APPROVE_WORKFLOW}`],
  "guard.wiring": [".claude/settings.json", "opencode.jsonc", ".opencode/plugins/fflow-guard.mjs"],
};

/**
 * The mandatory policy `target` belongs to (its id or one of its outputs), or undefined.
 * @param {string} target
 */
export function policyOf(target) {
  return MANDATORY.find((p) => p === target || OUTPUTS[p].includes(target));
}

/**
 * The rule list after an `extend`'s `items`: each item joins it once, and `!<rule>` drops that rule.
 * @param {string[]} before
 * @param {string[]} items
 */
export function extended(before, items) {
  const drop = new Set(items.filter((i) => i.startsWith("!")).map((i) => i.slice(1)));
  return [
    ...new Set([...before.filter((r) => !drop.has(r)), ...items.filter((i) => !i.startsWith("!"))]),
  ];
}

/**
 * Whether `after` holds every rule of `before`.
 * @param {string[]} before
 * @param {string[]} after
 */
export function tightensOnly(before, after) {
  const kept = new Set(after);
  return before.every((r) => kept.has(r));
}

/**
 * Each override that disables, replaces, configures or loosens a mandatory policy, naming the policy (AC-5).
 * @param {import("./overrides.mjs").Override[]} overrides
 * @param {Record<string, string[]>} [presetRules] each rule-list policy's rules before any override
 * @returns {string[]}
 */
export function policyProblems(overrides, presetRules = PRESET_RULES) {
  /** @type {string[]} */
  const problems = [];
  for (const o of overrides) {
    const policy = policyOf(o.target);
    if (!policy) continue;
    const refused = `${o.path}: ${o.kind} ${o.target} is refused: the mandatory policy ${policy}`;
    const fix = RULE_LISTS.includes(policy)
      ? `only an \`extend\` of \`${policy}\` that adds \`items\` may change it`
      : "no override may change it";
    if (o.kind === "disable" || o.kind === "replace" || o.kind === "configure")
      problems.push(`${refused} cannot be ${o.kind}d (${fix})`);
    else if (o.target !== policy || !RULE_LISTS.includes(policy) || o.text || !o.items)
      problems.push(`${refused} cannot be extended as text (${fix})`);
    else {
      const before = presetRules[policy] ?? [];
      const after = extended(before, o.items);
      if (!tightensOnly(before, after))
        problems.push(
          `${refused} would lose ${before.filter((r) => !after.includes(r)).join(", ")}; an extend may only tighten it`,
        );
    }
  }
  return problems;
}
