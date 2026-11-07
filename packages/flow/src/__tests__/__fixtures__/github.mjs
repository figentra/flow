/**
 * Figentra Flow file contract:
 * Purpose: an in-memory GitHub for the queue tests: refs and commits, `main` at a root commit, commits dated by an
 *   injected clock, a ref create that fails while the ref exists and a ref update that only fast-forwards.
 * Boundary: test helper; no network, no files.
 * Runtime: node
 * Governing contract: STA-1945 (FR-17; plan C12).
 */

/**
 * An in-memory GitHub with `main` at a root commit; commits are dated by `clock.t`. PATCH fast-forwards only.
 * @param {{ t: number }} clock
 */
export function fakeGitHub(clock) {
  /** @type {Map<string, string>} */
  const refs = new Map([["heads/main", "m0"]]);
  /** @type {Map<string, any>} */
  const commits = new Map([
    ["m0", { tree: { sha: "t0" }, parents: [], committer: { date: new Date(0).toISOString() } }],
  ]);
  let n = 0;
  const ok = (/** @type {any} */ json) => ({ ok: true, json, err: "" });
  const fail = (/** @type {string} */ err) => ({ ok: false, json: { message: err }, err });
  /** @type {import("../../lib/github.mjs").Api} */
  const api = (method, path, body) => {
    const b = /** @type {any} */ (body);
    const ref = path.match(/\/git\/refs?\/(heads\/.+)$/)?.[1];
    const commit = path.match(/\/git\/commits\/(\w+)$/)?.[1];
    if (method === "GET" && ref)
      return refs.has(ref) ? ok({ object: { sha: refs.get(ref) } }) : fail("HTTP 404");
    if (method === "GET" && commit)
      return commits.has(commit) ? ok({ sha: commit, ...commits.get(commit) }) : fail("HTTP 404");
    if (method === "POST" && path.endsWith("/git/commits")) {
      const sha = `c${++n}`;
      commits.set(sha, {
        tree: { sha: b.tree },
        parents: b.parents,
        committer: { date: new Date(clock.t).toISOString() },
      });
      return ok({ sha });
    }
    if (method === "POST" && path.endsWith("/git/refs")) {
      const name = b.ref.replace(/^refs\//, "");
      if (refs.has(name)) return fail("HTTP 422: Reference already exists");
      refs.set(name, b.sha);
      return ok({ ref: b.ref });
    }
    if (method === "PATCH" && ref) {
      if (!refs.has(ref) || commits.get(b.sha)?.parents?.[0] !== refs.get(ref))
        return fail("HTTP 422: Update is not a fast forward");
      refs.set(ref, b.sha);
      return ok({});
    }
    if (method === "DELETE" && ref) return refs.delete(ref) ? ok(undefined) : fail("HTTP 422");
    return fail(`unexpected ${method} ${path}`);
  };
  return { api, refs, commits };
}
