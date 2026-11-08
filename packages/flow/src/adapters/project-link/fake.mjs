/**
 * Figentra Flow file contract:
 * Purpose: the fake project linker: knows the projects it is given (any id is a project when it is given none) and
 *   records each link in memory. Nothing reaches Linear.
 * Boundary: process memory only; no network. The Studio's MCP surface binds it until the Linear driver is wired.
 * Runtime: node
 * Governing contract: master plan 2026-11-07 Phase 5.
 * Secrets: none.
 */

/**
 * The fake project linker.
 * @param {{ projects?: readonly { id: string, name: string }[], now?: () => string }} [options] the projects it knows
 *   (any when absent) and the clock
 * @returns {import("./index.mjs").ProjectLinker}
 */
export function fakeProjectLinker({ projects, now = () => new Date().toISOString() } = {}) {
  const known = projects && new Map(projects.map((project) => [project.id, project]));
  /** @type {import("./index.mjs").ProjectLink[]} */
  const links = [];
  return {
    kind: "fake",
    project: async (id) => {
      const project = known === undefined ? { id, name: id } : known.get(id);
      return project && { ...project, url: `https://linear.app/project/${project.id}` };
    },
    links: async (project) =>
      links.filter((link) => link.project === project).map((link) => ({ ...link })),
    link: async ({ project, url, label, onBehalfOf }) => {
      const made = { project, url, label, linkedBy: onBehalfOf, linkedAt: now() };
      links.push(made);
      return { ...made };
    },
  };
}
