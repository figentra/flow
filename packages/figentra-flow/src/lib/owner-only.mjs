/**
 * Figentra Flow file contract:
 * Purpose: the paths only the owner lands (owner decision 2026-11-01, STA-1856): every workflow and action (production
 *   deploy, promote and release, and what defines a required check), secrets and the secret guards, the catalog, the
 *   Flow configuration (it names the trusted Apps), repo settings and branch protection, and billing or legal files.
 *   `land` refuses them; the approval workflow re-checks them with `ownerOnlyPattern()`.
 * Boundary: pure: paths in, paths out.
 * Runtime: node
 * Governing contract: STA-1856 FR-1.
 * Secrets: none.
 */
import { CONFIG_FILE } from "./product.mjs";
import { globRe } from "./roles.mjs";

/** The owner-only globs, in `globRe`'s syntax. */
export const OWNER_ONLY = [
  // Workflows and actions run with the repository's secrets, and one of them defines the required check.
  ".github/workflows/**",
  ".github/actions/**",
  // Repo settings and branch protection.
  ".github/rulesets/**",
  ".github/branch-protection.json",
  ".github/settings.yml",
  "**/CODEOWNERS",
  // The catalog, the registry and Flow's own trust anchors.
  "pnpm-workspace.yaml",
  ".npmrc",
  CONFIG_FILE,
  // Secrets and the guards that keep them.
  ".infisical.yaml",
  ".infisical.json",
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
  "LICENSE*",
  "LICENCE*",
  "NOTICE*",
  "COPYRIGHT*",
  ".github/NOTICE*",
];

const PATTERNS = OWNER_ONLY.map(globRe);

/**
 * The owner-only paths among `files`, each once, in their order.
 * @param {string[]} files
 */
export const ownerOnlyPaths = (files) =>
  [...new Set(files)].filter((f) => PATTERNS.some((p) => p.test(f)));

/** One regular expression for every owner-only glob, in syntax both JavaScript and `grep -P` read. */
export const ownerOnlyPattern = () => PATTERNS.map((p) => p.source).join("|");
