/**
 * Figentra Flow file contract:
 * Purpose: the Linear client `figentra-flow linear` uses, vendored from Stackra core's `tools/scripts/linear.mjs` (ADR 0065,
 *   0121): `client` (token from the environment), `linear` (issue reads and writes), `isAgent`, `TEAM`, `BRANCH_RE`.
 *   Core's `pnpm linear` CLI stays in core; only the library half is here.
 * Boundary: talks to Linear's GraphQL API through net.mjs; writes no repo file.
 * Runtime: node
 * Token: LINEAR_AGENT_TOKEN (re-minted from LINEAR_AGENT_CLIENT_ID and LINEAR_AGENT_CLIENT_SECRET), else
 *   LINEAR_API_KEY. They reach the process only through the caller's `infisical run` wrapper or CI secrets.
 * Secrets: read from the environment only; never written, logged or echoed.
 */
import { randomUUID } from "node:crypto";
import { isGraphqlRead, netFetch, retryUnlessLanded } from "./net.mjs";

export const TEAM = "STA";
const API = "https://api.linear.app/graphql";
export const KEY_RE = /\bSTA-(\d+)\b/i;
export const BRANCH_RE = /^(?:figentra|delegate)\/sta-\d+-[a-z0-9]+(?:-[a-z0-9]+)*$/;

const TOKEN_URL = "https://api.linear.app/oauth/token";
export const SCOPE = "read,write,issues:create,comments:create,app:assignable,app:mentionable";

/** The starting credential: the app token, else app client credentials (minted on first use), else the personal key. */
export function auth(env = process.env) {
  const mintable = Boolean(env.LINEAR_AGENT_CLIENT_ID && env.LINEAR_AGENT_CLIENT_SECRET);
  if (env.LINEAR_AGENT_TOKEN)
    return { header: `Bearer ${env.LINEAR_AGENT_TOKEN}`, app: true, mintable };
  if (mintable) return { header: null, app: true, mintable };
  if (env.LINEAR_API_KEY) return { header: env.LINEAR_API_KEY, app: false, mintable };
  return null;
}

/** A client_credentials token for the "Stackra Agent" app. The error never carries the response body. */
export async function mint(env, fetch) {
  const res = await fetch(
    TOKEN_URL,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: env.LINEAR_AGENT_CLIENT_ID,
        client_secret: env.LINEAR_AGENT_CLIENT_SECRET,
        scope: SCOPE,
      }),
    },
    { idempotent: true },
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token)
    throw new Error(`Linear app token mint failed (HTTP ${res.status})`);
  // A minted token is not a registered secret, so Actions would not redact it on its own.
  if (env.GITHUB_ACTIONS) console.log(`::add-mask::${json.access_token}`);
  return json.access_token;
}

const isAuthError = (res, json) =>
  res.status === 401 ||
  (json.errors ?? []).some((e) =>
    /AUTHENTICATION|authenticat/i.test(`${e.extensions?.code} ${e.message}`),
  );

/** A read or an issueUpdate (it sets values) is safe to repeat; netFetch retries it. */
const isIdempotentQuery = (query) => isGraphqlRead(query) || /\bissueUpdate\(/.test(query);

/**
 * A GraphQL client. A missing or expired app token is (re-)minted from the client credentials, once per call;
 * if that fails and a personal key exists, the client falls back to it. Errors carry Linear's messages, never a token.
 */
export function client({ env = process.env, fetch = netFetch } = {}) {
  const a = auth(env);
  const state = { ...a };
  const fallback = () => {
    if (!env.LINEAR_API_KEY) return false;
    Object.assign(state, { header: env.LINEAR_API_KEY, app: false, mintable: false });
    return true;
  };
  const refresh = async () => {
    try {
      state.header = `Bearer ${await mint(env, fetch)}`;
    } catch (error) {
      if (!fallback()) throw error;
    }
  };
  const post = async (query, variables) => {
    const res = await fetch(
      API,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: state.header },
        body: JSON.stringify({ query, variables }),
      },
      { idempotent: isIdempotentQuery(query) },
    );
    return { res, json: await res.json().catch(() => ({})) };
  };
  const gql = async (query, variables = {}) => {
    if (!a) throw new Error("no Linear token (run under `infisical run --env=dev --path=/agents`)");
    if (!state.header) await refresh();
    let { res, json } = await post(query, variables);
    if (isAuthError(res, json) && state.app && (state.mintable || env.LINEAR_API_KEY)) {
      if (state.mintable) await refresh();
      else fallback();
      ({ res, json } = await post(query, variables));
    }
    if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
    if (!res.ok) throw new Error(`Linear HTTP ${res.status}`);
    return json.data;
  };
  return {
    gql,
    get app() {
      return Boolean(state.app);
    },
    hasToken: Boolean(a),
  };
}

export const normKey = (k) => {
  const m = String(k ?? "").match(/^STA-(\d+)$/i);
  if (!m) throw new Error(`expected an issue key like STA-42 (got "${k ?? ""}")`);
  return `STA-${m[1]}`;
};

/** True when an AI agent (Claude Code, OpenCode, CI reconcile) is running this. */
export const isAgent = (env = process.env) =>
  Boolean(env.CLAUDECODE || env.OPENCODE || env.AI_AGENT || env.STACKRA_AGENT);

/** CI key check: the PR title or branch carries an STA key, unless the lane is exempt. */
export function prCarriesKey({ title = "", branch = "", labels = [] }) {
  if (labels.includes("chore-lane")) return { ok: true, why: "labelled chore-lane" };
  if (/^(renovate|changeset-release)\//.test(branch))
    return { ok: true, why: `bot branch ${branch}` };
  // ADR 0065 decision 5: a Linear-named branch, `figentra/sta-<n>-<slug>` (Linear's gitBranchName) or
  // `delegate/sta-<n>-…` (pnpm delegate).
  if (!BRANCH_RE.test(branch))
    return {
      ok: false,
      why: `branch "${branch}" is not figentra/sta-<n>-<slug> or delegate/sta-<n>-<slug> (use Linear's branch name, or label the PR chore-lane)`,
    };
  if (KEY_RE.test(title) || KEY_RE.test(branch)) return { ok: true, why: "carries an STA key" };
  return {
    ok: false,
    why: `neither the PR title nor branch "${branch}" names an STA-n issue (add one, or label the PR chore-lane)`,
  };
}

const ISSUE = `id identifier title url state{id name type} team{id} labels{nodes{id name}}`;

/** Linear operations over a gql function. Every write is skipped (and described) when dry. */
export function linear(c, { dry = false, log = console.log } = {}) {
  const { gql } = c;
  let viewerId;
  const cache = new Map();
  const write = async (desc, fn) => (dry ? log(`[dry-run] would ${desc}`) : fn());

  const api = {
    async issue(key) {
      return (await gql(`query($k:String!){issue(id:$k){${ISSUE}}}`, { k: key })).issue;
    },
    async teamId() {
      if (!cache.has("team")) {
        const d = await gql(`query($k:String!){teams(filter:{key:{eq:$k}}){nodes{id}}}`, {
          k: TEAM,
        });
        const id = d.teams.nodes[0]?.id;
        if (!id) throw new Error(`Linear team ${TEAM} not found`);
        cache.set("team", id);
      }
      return cache.get("team");
    },
    async stateId(name) {
      const k = `state:${name}`;
      if (!cache.has(k)) {
        const d = await gql(
          `query($t:ID!,$n:String!){workflowStates(filter:{team:{id:{eq:$t}},name:{eq:$n}}){nodes{id}}}`,
          { t: await api.teamId(), n: name },
        );
        const id = d.workflowStates.nodes[0]?.id;
        if (!id) throw new Error(`no "${name}" state in team ${TEAM}`);
        cache.set(k, id);
      }
      return cache.get(k);
    },
    /** Label id by name; created on the team when missing (not in dry-run). */
    async labelId(name) {
      const k = `label:${name}`;
      if (!cache.has(k)) {
        const d = await gql(
          `query($n:String!,$t:ID!){issueLabels(filter:{name:{eqIgnoreCase:$n},or:[{team:{null:true}},{team:{id:{eq:$t}}}]}){nodes{id}}}`,
          { n: name, t: await api.teamId() },
        );
        let id = d.issueLabels.nodes[0]?.id;
        if (!id && !dry)
          id = (
            await gql(
              `mutation($i:IssueLabelCreateInput!){issueLabelCreate(input:$i){issueLabel{id}}}`,
              {
                i: { name, teamId: await api.teamId() },
              },
            )
          ).issueLabelCreate.issueLabel.id;
        cache.set(k, id);
      }
      return cache.get(k);
    },
    async viewerId() {
      viewerId ??= (await gql(`query{viewer{id}}`)).viewer.id;
      return viewerId;
    },
    async update(issue, input, desc) {
      return write(`${desc} on ${issue.identifier}`, () =>
        gql(`mutation($id:String!,$i:IssueUpdateInput!){issueUpdate(id:$id,input:$i){success}}`, {
          id: issue.id,
          i: input,
        }),
      );
    },
    async setState(issue, name) {
      if (issue.state?.name === name) return;
      await api.update(issue, { stateId: await api.stateId(name) }, `move to ${name}`);
    },
    async addLabel(issue, name) {
      const ids = issue.labels.nodes.map((l) => l.id);
      if (issue.labels.nodes.some((l) => l.name.toLowerCase() === name)) return;
      await api.update(issue, { labelIds: [...ids, await api.labelId(name)] }, `add label ${name}`);
    },
    async removeLabel(issue, name) {
      const keep = issue.labels.nodes.filter((l) => l.name.toLowerCase() !== name).map((l) => l.id);
      if (keep.length === issue.labels.nodes.length) return;
      await api.update(issue, { labelIds: keep }, `remove label ${name}`);
    },
    /** With the agent-app token, the app becomes the issue's delegate; the human assignee is untouched. */
    async delegateToAgent(issue) {
      if (!c.app) return;
      await api.update(issue, { delegateId: await api.viewerId() }, "delegate to Stackra Agent");
    },
    /** The comment's own id lets a retry ask whether the failed attempt landed, so it never posts twice. */
    async comment(issue, body) {
      const id = randomUUID();
      await write(`comment on ${issue.identifier}: ${body.split("\n")[0]}`, () =>
        retryUnlessLanded(
          () =>
            gql(`mutation($i:CommentCreateInput!){commentCreate(input:$i){success}}`, {
              i: { id, issueId: issue.id, body },
            }),
          // Re-send only on Linear's explicit not-found; any other read error leaves the outcome unknown.
          () =>
            gql(`query($id:String!){comment(id:$id){id}}`, { id }).then(Boolean, (error) => {
              if (/\bEntity not found: Comment\b/.test(error.message)) return false;
              throw error;
            }),
        ),
      );
    },
    async link(issue, url, title) {
      await write(`attach ${url} to ${issue.identifier}`, () =>
        gql(
          `mutation($i:String!,$u:String!,$t:String){attachmentLinkURL(issueId:$i,url:$u,title:$t){success}}`,
          {
            i: issue.id,
            u: url,
            t: title,
          },
        ),
      );
    },
    async create({ title, project, labels = [], description, parentId }) {
      const teamId = await api.teamId();
      let projectId;
      if (project) {
        const p = await gql(`query($n:String!){projects(filter:{name:{eq:$n}}){nodes{id}}}`, {
          n: project,
        });
        projectId = p.projects.nodes[0]?.id;
        if (!projectId) throw new Error(`Linear project "${project}" not found`);
      }
      const labelIds = await Promise.all(labels.map((l) => api.labelId(l)));
      if (dry) return (log(`[dry-run] would create "${title}" [${labels.join(", ")}]`), null);
      const d = await gql(
        `mutation($i:IssueCreateInput!){issueCreate(input:$i){issue{identifier url}}}`,
        {
          i: { teamId, projectId, title, description, labelIds, parentId },
        },
      );
      return d.issueCreate.issue;
    },
    /** filter is a Linear IssueFilter merged with team STA. */
    async list(filter) {
      const d = await gql(
        `query($f:IssueFilter!){issues(filter:$f,first:50,orderBy:updatedAt){nodes{identifier title state{name}}}}`,
        { f: { team: { key: { eq: TEAM } }, ...filter } },
      );
      return d.issues.nodes;
    },
  };
  return api;
}
