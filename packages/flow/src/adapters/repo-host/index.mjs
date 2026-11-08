/**
 * Figentra Flow file contract:
 * Purpose: the repository-host port (the Studio's write surface, master plan Phase 5: "the Figentra GitHub App creates
 *   the repository from the template"): makes one private repository from a template repository on behalf of one
 *   person, says whether a repository already exists, and whether one is a template (GitHub's `is_template`).
 * Boundary: the port's shape only; `./fake.mjs` is the one driver until the GitHub App and its keys exist (the owner
 *   creates them). A driver acts with the App's installation token for the owner's organisation and carries the
 *   person it acts for (`onBehalfOf`, Stackra ADR 0209 A8); it never holds a personal token.
 * Runtime: node
 * Governing contract: master plan 2026-11-07 Phase 5; Stackra ADR 0209 A8 (STA-2558).
 * Secrets: none here; the real driver reads the App's key from the caller's environment by name.
 */

/**
 * @typedef {{ owner: string, name: string, template: string, description: string, onBehalfOf: string }} RepoRequest
 * @typedef {{ fullName: string, url: string, defaultBranch: string, template: string, private: true,
 *             createdBy: string, createdAt: string }} RepoState
 * @typedef {{ kind: string, exists: (fullName: string) => Promise<boolean>,
 *             isTemplate: (fullName: string) => Promise<boolean>,
 *             createFromTemplate: (request: RepoRequest) => Promise<RepoState> }} RepoHost
 */
export {};
