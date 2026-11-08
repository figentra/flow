/**
 * Figentra Flow file contract:
 * Purpose: the fake repository host: knows the template repositories it is given (every name is a template when it
 *   is given none) and records each repository it "creates" from one, private, on `main`. Nothing is created on
 *   GitHub.
 * Boundary: process memory only; no network. The Studio's MCP surface binds it until the GitHub App driver exists.
 * Runtime: node
 * Governing contract: master plan 2026-11-07 Phase 5.
 * Secrets: none.
 */

/**
 * The fake repository host.
 * @param {{ templates?: readonly string[], existing?: readonly string[], now?: () => string }} [options] the template
 *   repositories it knows (any when absent), the repositories that already exist, and the clock
 * @returns {import("./index.mjs").RepoHost}
 */
export function fakeRepoHost({
  templates,
  existing = [],
  now = () => new Date().toISOString(),
} = {}) {
  const known = templates && new Set(templates.map((name) => name.toLowerCase()));
  const repos = new Set([...(templates ?? []), ...existing].map((name) => name.toLowerCase()));
  return {
    kind: "fake",
    exists: async (fullName) => repos.has(fullName.toLowerCase()),
    isTemplate: async (fullName) => known === undefined || known.has(fullName.toLowerCase()),
    createFromTemplate: async ({ owner, name, template, onBehalfOf }) => {
      const fullName = `${owner}/${name}`;
      repos.add(fullName.toLowerCase());
      return {
        fullName,
        url: `https://github.com/${fullName}`,
        defaultBranch: "main",
        template,
        private: true,
        createdBy: onBehalfOf,
        createdAt: now(),
      };
    },
  };
}
