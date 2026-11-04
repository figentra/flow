/**
 * Figentra Flow file contract:
 * Purpose: hold asynchronous questions to STA-2098 (PLAN section 10 H5): the open questions are the spec's
 *   `[NEEDS CLARIFICATION: …]` markers; `spec ask --async` posts them as one numbered comment through the tracker and
 *   puts the waiting line in the spec without touching its status; `spec resume` records each `Q<n>: <answer>` given
 *   after it (the marker becomes the answer, `## Clarifications` gets the bullet), keeps the waiting line while an
 *   asked question is open and clears it after; the GitHub Issues and Linear adapters post a comment with its link
 *   and list comments oldest first.
 * Boundary: temporary repositories; the tracker, GitHub and Linear's fetch are fakes; no network.
 * Runtime: node
 * Governing contract: ADR 0510; STA-2098.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { githubIssuesTracker } from "../adapters/tracker/github-issues.mjs";
import { schemeFor } from "../adapters/tracker/index.mjs";
import { linearTracker } from "../adapters/tracker/linear.mjs";
import { ask, resume } from "../commands/spec.mjs";
import {
  answersIn,
  askedIn,
  clearWaiting,
  markWaiting,
  openQuestions,
  questionComment,
  recordAnswers,
  waitingOn,
} from "../lib/async-questions.mjs";
import { statusOf } from "../lib/spec-status.mjs";
import { repo, sh } from "./__fixtures__/repo.mjs";

const SPEC = `# Spec

**Status**: Draft

**Issue**: STA-5

**Clarifications status**: pending

## Requirements

- **FR-001**: Users sign in with [NEEDS CLARIFICATION: which sign-in method?].
- **FR-002**: Exports keep [NEEDS CLARIFICATION: how many days of history?] of history.
`;

test("async questions: markers are the questions; the comment numbers them and answers read back", () => {
  assert.deepEqual(openQuestions(`${SPEC}<!-- [NEEDS CLARIFICATION: a template example] -->`), [
    "which sign-in method?",
    "how many days of history?",
  ]);
  const body = questionComment("STA-5", openQuestions(SPEC));
  assert.deepEqual(
    [...askedIn(body)],
    [
      [1, "which sign-in method?"],
      [2, "how many days of history?"],
    ],
  );
  assert.deepEqual(
    [...answersIn("Thanks!\nQ1: SSO only\n  q2 :  90 days \nQ3:")],
    [
      [1, "SSO only"],
      [2, "90 days"],
    ],
  );
  const waiting = markWaiting(SPEC, "https://x/c/1");
  assert.equal(waitingOn(waiting), "https://x/c/1");
  assert.match(
    waiting,
    /^\*\*Clarifications status\*\*: pending\n\n> Waiting on clarification: https:\/\/x\/c\/1\n/m,
  );
  assert.equal(statusOf(waiting), "draft", "the status the gate reads is untouched");
  assert.equal(clearWaiting(waiting), SPEC);
  assert.equal(markWaiting(waiting, "https://x/c/2").match(/Waiting on/g)?.length, 1);
});

test("async questions: recording an answer replaces its marker and adds the Clarifications bullet", () => {
  const once = recordAnswers(
    SPEC,
    [{ question: "which sign-in method?", answer: "SSO" }],
    "2026-11-04",
  );
  assert.match(once, /- \*\*FR-001\*\*: Users sign in with SSO\./);
  assert.match(
    once,
    /## Clarifications\n\n### Session 2026-11-04\n\n- Q: which sign-in method\? → A: SSO\n\n## Requirements/,
  );
  const twice = recordAnswers(
    once,
    [{ question: "how many days of history?", answer: "90 days" }],
    "2026-11-04",
  );
  assert.match(
    twice,
    /### Session 2026-11-04\n\n- Q: which sign-in method\? → A: SSO\n- Q: how many days of history\? → A: 90 days\n\n## Requirements/,
  );
  assert.deepEqual(openQuestions(twice), []);
  assert.doesNotMatch(twice, /\[NEEDS CLARIFICATION/);
});

/**
 * A repository with SPEC at `.agents/specs/sta-5-widget/` and an in-memory tracker.
 * @param {import("node:test").TestContext} t
 */
function world(t) {
  const r = repo();
  t.after(r.dispose);
  const dir = join(r.root, ".agents/specs/sta-5-widget");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "spec.md"), SPEC);
  /** @type {import("../adapters/tracker/index.mjs").TrackerComment[]} */
  const comments = [];
  const tracker = {
    title: async () => "",
    state: async () => "",
    inProgress: async () => {},
    done: async () => {},
    comment: async (/** @type {string} */ key, /** @type {string} */ body) => {
      assert.equal(key, "sta-5");
      const url = `https://tracker/STA-5#c${comments.length + 1}`;
      comments.push({ body, url, createdAt: `2026-11-04T00:00:0${comments.length}Z` });
      return url;
    },
    comments: async () => comments,
  };
  const ports = { scheme: schemeFor(r.root), tracker };
  const read = () => readFileSync(join(dir, "spec.md"), "utf8");
  /** @param {string} body */
  const reply = (body) => comments.push({ body, url: "", createdAt: "2026-11-04T01:00:00Z" });
  return { root: r.root, ports, comments, read, reply };
}

test("spec ask --async posts one comment and marks the spec; without --async it only lists", async (t) => {
  const w = world(t);
  assert.deepEqual(await ask(w.root, "STA-5", { ports: w.ports }), {
    KEY: "STA-5",
    QUESTIONS: ["which sign-in method?", "how many days of history?"],
  });
  assert.equal(w.comments.length, 0);
  assert.equal(w.read(), SPEC);
  const out = await ask(w.root, "sta-5", { post: true, ports: w.ports });
  assert.equal(out.WAITING, "https://tracker/STA-5#c1");
  assert.equal(w.comments.length, 1);
  assert.match(w.comments[0].body, /- \*\*Q1\*\*: which sign-in method\?\n- \*\*Q2\*\*: how many/);
  assert.equal(waitingOn(w.read()), "https://tracker/STA-5#c1");
});

test("spec resume records answers after the asking comment, keeps waiting while one is open, then clears", async (t) => {
  const w = world(t);
  // An answer before the question is not one.
  w.reply("Q1: password");
  await ask(w.root, "STA-5", { post: true, ports: w.ports });
  w.reply("Q1: email");
  w.reply("Looks good. Q1: SSO only");
  w.reply("Q1: SSO");
  const first = await resume(w.root, "STA-5", { ports: w.ports, today: "2026-11-04" });
  assert.deepEqual(first, {
    KEY: "STA-5",
    RECORDED: ["which sign-in method?"],
    REMAINING: ["how many days of history?"],
    WAITING: "https://tracker/STA-5#c2",
  });
  assert.match(w.read(), /Users sign in with SSO\./, "the later answer wins");
  assert.match(w.read(), /- Q: which sign-in method\? → A: SSO\n/);
  w.reply("Q2: 90 days");
  const second = await resume(w.root, "STA-5", { ports: w.ports, today: "2026-11-04" });
  assert.deepEqual(second.RECORDED, ["how many days of history?"]);
  assert.deepEqual(second.REMAINING, []);
  assert.equal(second.WAITING, "");
  assert.equal(waitingOn(w.read()), undefined);
  assert.equal(w.read().match(/- Q: /g)?.length, 2, "Q1 is recorded once");
});

test("spec resume with no asking comment refuses, naming the command", async (t) => {
  const w = world(t);
  await assert.rejects(
    resume(w.root, "STA-5", { ports: w.ports }),
    /no `fflow spec ask --async` comment on STA-5/,
  );
});

test("github-issues: comment returns its link; comments are listed with body, link and time", async (t) => {
  const r = repo();
  t.after(r.dispose);
  sh(r.root, "remote", "set-url", "origin", "git@github.com:acme/app.git");
  /** @type {string[]} */
  const calls = [];
  /** @type {import("../lib/github.mjs").Api} */
  const api = (method, path) => {
    calls.push(`${method} ${path}`);
    if (method === "POST") return { ok: true, json: { html_url: "https://gh/c/9" }, err: "" };
    return {
      ok: true,
      json: [{ body: "Q1: yes", html_url: "https://gh/c/10", created_at: "2026-11-04T00:00:00Z" }],
      err: "",
    };
  };
  const tracker = githubIssuesTracker({ kind: "github-issues" }, { root: r.root, api });
  assert.equal(await tracker.comment("gh-3", "hello"), "https://gh/c/9");
  assert.deepEqual(await tracker.comments?.("gh-3"), [
    { body: "Q1: yes", url: "https://gh/c/10", createdAt: "2026-11-04T00:00:00Z" },
  ]);
  assert.deepEqual(calls, [
    "POST /repos/acme/app/issues/3/comments",
    "GET /repos/acme/app/issues/3/comments?per_page=100",
  ]);
});

test("linear: comment returns its link; comments are listed oldest first", async () => {
  /** @type {string[]} */
  const queries = [];
  /** A Linear GraphQL endpoint: the issue, a comment create, the comments (newest first, as Linear gives them). */
  const fetch = async (/** @type {string} */ _url, /** @type {any} */ init) => {
    const { query } = JSON.parse(init.body);
    const kind = ["commentCreate(", "comments(", "issue("].find((k) => query.includes(k)) ?? query;
    queries.push(kind);
    const data =
      kind === "commentCreate("
        ? { commentCreate: { success: true, comment: { url: "https://linear/c/1" } } }
        : kind === "comments("
          ? {
              issue: {
                comments: {
                  nodes: [
                    { body: "Q1: b", url: "u2", createdAt: "2026-11-04T02:00:00Z" },
                    { body: "Q1: a", url: "u1", createdAt: "2026-11-04T01:00:00Z" },
                  ],
                },
              },
            }
          : { issue: { id: "i1", identifier: "OPS-7", title: "T", labels: { nodes: [] } } };
    return { ok: true, status: 200, json: async () => ({ data }) };
  };
  const tracker = linearTracker(
    { kind: "linear", team: "OPS" },
    { env: { LINEAR_API_KEY: "fake-key" }, fetch: /** @type {any} */ (fetch) },
  );
  assert.equal(await tracker.comment("ops-7", "hello"), "https://linear/c/1");
  assert.deepEqual(
    (await tracker.comments?.("ops-7"))?.map((c) => c.url),
    ["u1", "u2"],
  );
  assert.deepEqual(queries, ["issue(", "commentCreate(", "issue(", "comments("]);
});

test("spec ask --async: a tracker failure is a refusal and leaves the spec as it was", async (t) => {
  const w = world(t);
  const down = {
    ...w.ports,
    tracker: { ...w.ports.tracker, comment: async () => Promise.reject(new Error("HTTP 503")) },
  };
  await assert.rejects(
    ask(w.root, "STA-5", { post: true, ports: down }),
    /STA-5: the tracker failed \(HTTP 503\)/,
  );
  assert.equal(w.read(), SPEC);
});
