/**
 * Figentra Flow file contract:
 * Purpose: the `linear` tracker adapter: an issue's title and state, moving it to In Progress or Done, and comments,
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
 * @param {{ env?: Record<string, string | undefined> }} [context]
 * @returns {import("./index.mjs").Tracker}
 */
export function linearTracker(block, { env = process.env } = {}) {
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
    api ??= linear(client({ env: scoped }));
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
      await a.comment(found, body);
    },
  };
}
