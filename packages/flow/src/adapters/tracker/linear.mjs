/**
 * Figentra Flow file contract:
 * Purpose: the `linear` tracker adapter: an issue's title and state, moving it to In Progress or Done, comments (posting
 *   one gives its link; `comments` lists them, STA-2098), and a
 *   roster role (its one `role:<id>` label and the agent app as delegate; a missing label is reported, never created),
 *   through the Linear client in `lib/linear.mjs` (the agent app's minted token, else an API key).
 * Boundary: GraphQL calls to Linear; a failure is thrown to the caller, which reports it as a warning.
 * Runtime: node
 * Governing contract: STA-1729 phase A (A2).
 * Secrets: the Linear token only from the environment the caller set (`LINEAR_AGENT_TOKEN` or `LINEAR_API_KEY`, or
 *   the names in the block's `token`); never printed.
 */
import { client, linear } from "../../lib/linear.mjs";

/**
 * @param {any} block the configuration's `tracker` (`kind: "linear"`)
 * @param {{ env?: Record<string, string | undefined>, fetch?: typeof import("../../lib/net.mjs").netFetch }} [context]
 *   `fetch` replaces the network (tests)
 * @returns {import("./index.mjs").Tracker}
 */
export function linearTracker(block, { env = process.env, fetch } = {}) {
  // The block may name other variables; the client reads the two it knows.
  const names = block.token ?? ["LINEAR_AGENT_TOKEN", "LINEAR_API_KEY"];
  const scoped = {
    ...env,
    LINEAR_AGENT_TOKEN: env[names[0]],
    LINEAR_API_KEY: env[names[1] ?? names[0]],
  };
  /** @type {ReturnType<typeof linear> | undefined} */
  let api;
  const issue = async (/** @type {string} */ key) => {
    api ??= linear(client({ env: scoped, ...(fetch ? { fetch } : {}) }));
    const found = await api.issue(key.toUpperCase());
    if (!found) throw new Error(`${key.toUpperCase()} not found`);
    return { api, found };
  };
  return {
    async title(key) {
      return (await issue(key)).found.title;
    },
    async state(key) {
      return (await issue(key)).found.state?.name;
    },
    async inProgress(key, branch) {
      const { api: a, found } = await issue(key);
      await a.setState(found, "In Progress");
      if (branch) await a.comment(found, `Started: branch \`${branch}\`.`);
    },
    async done(key, url) {
      const { api: a, found } = await issue(key);
      await a.setState(found, "Done");
      await a.comment(found, `Landed: ${url}.`);
    },
    async comment(key, body) {
      const { api: a, found } = await issue(key);
      return a.comment(found, body);
    },
    async comments(key) {
      const { api: a, found } = await issue(key);
      return (await a.comments(found)).sort((/** @type {any} */ x, /** @type {any} */ y) =>
        x.createdAt.localeCompare(y.createdAt),
      );
    },
    async role(key, label) {
      const { api: a, found } = await issue(key);
      const id = await a.findLabel(label);
      if (!id) throw new Error(`the label ${label} does not exist in Linear (the lead creates it)`);
      // The roster's issue rule: exactly one role label, and the agent app as the delegate; the human assignee stays.
      const others = found.labels.nodes.filter(
        (/** @type {any} */ l) => !l.name.toLowerCase().startsWith("role:"),
      );
      if (
        !found.labels.nodes.some((/** @type {any} */ l) => l.id === id) ||
        others.length + 1 !== found.labels.nodes.length
      )
        await a.update(
          found,
          { labelIds: [...others.map((/** @type {any} */ l) => l.id), id] },
          `set ${label}`,
        );
      await a.delegateToAgent(found);
    },
    async missingLabels(labels) {
      api ??= linear(client({ env: scoped, ...(fetch ? { fetch } : {}) }));
      /** @type {string[]} */
      const missing = [];
      for (const label of labels) if (!(await api.findLabel(label))) missing.push(label);
      return missing;
    },
  };
}
