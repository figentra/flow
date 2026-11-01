/**
 * Figentra Flow file contract:
 * Purpose: what only the owner lands (owner decision 2026-11-01, STA-1856): every workflow and action, what a deploy,
 *   promote or release runs, secrets and the secret guards, the catalog, the Flow configuration (it names the trusted
 *   Apps), repo settings and branch protection, and billing or legal files, matched case-insensitively; plus a
 *   repository's own `approve.ownerOnly` globs. `packageFindings` adds what a path cannot show: the root package.json's
 *   scripts changing, and a dependency moved off its `catalog:` entry. `land`, the approval check and the generated
 *   CODEOWNERS all read this one list.
 * Boundary: pure: paths and texts in, findings out.
 * Runtime: node
 * Governing contract: STA-1856 FR-1 (the security review of 2026-11-01).
 * Secrets: none.
 */
import { CONFIG_FILE, NAME } from "./product.mjs";
import { globRe } from "./roles.mjs";

/** The owner-only globs, in `globRe`'s syntax; a leading double star matches at any depth. */
export const OWNER_ONLY = [
  // Workflows and actions run with the repository's secrets, and one of them defines the required check.
  ".github/workflows/**",
  ".github/actions/**",
  "**/action.yml",
  "**/action.yaml",
  // What a deploy, promote or release runs.
  "**/wrangler.toml",
  "**/wrangler.json",
  "**/wrangler.jsonc",
  "**/eas.json",
  "**/runway.yaml",
  ".changeset/config.json",
  // Repo settings and branch protection.
  ".github/rulesets/**",
  ".github/branch-protection.json",
  ".github/settings.yml",
  "**/CODEOWNERS",
  // The catalog, the registry and Flow's own trust anchors.
  "pnpm-workspace.yaml",
  "**/.npmrc",
  CONFIG_FILE,
  // Secrets and the guards that keep them.
  "**/.infisical.*",
  ".gitleaks.toml",
  "**/.env*",
  "**/.dev.vars",
  "**/*.pem",
  "**/*.key",
  "**/*.p8",
  "**/*.p12",
  ".agents/hooks/**",
  ".agents/rules/secrets.md",
  ".claude/settings.json",
  ".claude/settings.local.json",
  "opencode.jsonc",
  ".opencode/plugins/guard/**",
  // Billing and legal.
  "**/billing/**",
  "**/legal/**",
  "**/LICENSE*",
  "**/LICENCE*",
  "**/NOTICE*",
  "**/COPYRIGHT*",
];

/**
 * The owner-only paths among `files`, each once, in their order.
 * @param {string[]} files
 * @param {string[]} [extra] the repository's `approve.ownerOnly` globs
 */
export function ownerOnlyPaths(files, extra = []) {
  const patterns = [...OWNER_ONLY, ...extra].map((g) => globRe(g, "is"));
  return [...new Set(files)].filter((f) => patterns.some((p) => p.test(f)));
}

const SECTIONS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

/** Parsed JSON: `undefined` for no text, `null` for text that is not JSON. */
function parse(/** @type {string | undefined} */ text) {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Owner-only findings in one changed package.json: the root one's `scripts` changing (deploys and releases run them),
 * and a dependency whose `catalog:` specifier became anything else.
 * @param {string} path repository-relative
 * @param {string | undefined} before the text at the merge base; undefined when added
 * @param {string | undefined} after the text at the head; undefined when removed
 * @returns {string[]}
 */
export function packageFindings(path, before, after) {
  const [old, now] = [parse(before), parse(after)];
  if (now === undefined) return [];
  if (now === null) return [`${path} is not valid JSON`];
  /** @type {string[]} */
  const findings = [];
  if (
    path === "package.json" &&
    JSON.stringify(old?.scripts ?? {}) !== JSON.stringify(now.scripts ?? {})
  )
    findings.push("package.json: the root scripts changed");
  for (const section of SECTIONS)
    for (const [name, spec] of Object.entries(old?.[section] ?? {})) {
      const next = now[section]?.[name];
      if (
        String(spec).startsWith("catalog:") &&
        next !== undefined &&
        !String(next).startsWith("catalog:")
      )
        findings.push(`${path}: ${name} moved off its catalog to "${next}"`);
    }
  return findings;
}

/**
 * The CODEOWNERS text that makes GitHub itself ask `owner` for every owner-only path (with the ruleset's
 * `require_code_owner_review`). There is no catch-all line, so everything else stays with the approving App. GitHub
 * matches these case-sensitively; `land` and the approval check also match case-insensitively.
 * @param {string} owner a GitHub login
 * @param {string[]} [extra] the repository's `approve.ownerOnly` globs
 */
export function codeowners(owner, extra = []) {
  const handle = `@${owner.replace(/^@/, "")}`;
  const lines = [...OWNER_ONLY, ...extra].map(
    (g) => `${g.startsWith("**/") ? g : `/${g}`} ${handle}`,
  );
  return `# Written by \`${NAME} sync\` from the owner-only list (STA-1856); change that list, not this file.\n${lines.join("\n")}\n`;
}
