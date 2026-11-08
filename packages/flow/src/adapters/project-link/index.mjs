/**
 * Figentra Flow file contract:
 * Purpose: the project-link port (the Studio's write surface, master plan Phase 5: the new product's repository "links
 *   Linear"): finds a tracker project, lists its links and adds one, on behalf of one person.
 * Boundary: the port's shape only; `./fake.mjs` is the one driver until the Linear driver is wired with the App's
 *   credentials. A driver carries the person it acts for (`onBehalfOf`, Stackra ADR 0209 A8) and never a personal
 *   token.
 * Runtime: node
 * Governing contract: master plan 2026-11-07 Phase 5; Stackra ADR 0209 A8 (STA-2558).
 * Secrets: none here; the real driver reads its credential from the caller's environment by name.
 */

/**
 * @typedef {{ id: string, name: string, url: string }} Project
 * @typedef {{ project: string, url: string, label: string, linkedBy: string, linkedAt: string }} ProjectLink
 * @typedef {{ kind: string, project: (id: string) => Promise<Project | undefined>,
 *             links: (project: string) => Promise<ProjectLink[]>,
 *             link: (link: { project: string, url: string, label: string, onBehalfOf: string }) => Promise<ProjectLink> }}
 *           ProjectLinker
 */
export {};
