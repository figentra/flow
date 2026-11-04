/**
 * Figentra Flow file contract:
 * Purpose: hold the question tools of `fflow mcp` to STA-2098 H4: `questions_list` names each live marker and each
 *   unanswered Clarifications question with its line, and never one inside a comment; `docs_lookup` searches only
 *   the specs, `docs/` and `.flow/`, bounded, and never follows a symbolic link out of the repository;
 *   `clarification_record` writes one Q/A bullet under today's session (making the section and the session when
 *   missing), replaces the matching marker, records the same answer once, refuses bad input, a missing marker and a
 *   spec that resolves outside `.agents/specs/<key>-*`, and takes its answer from MCP elicitation only when the
 *   client declared it in `initialize`, else from the arguments.
 * Boundary: temporary folders and the handler driven by request objects; no process, no network.
 * Runtime: node
 * Governing contract: STA-2098 (PLAN section 10, H4).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { connection, defaultReaders, handle } from "../commands/mcp.mjs";
import { docsLookup, openQuestions, recordAnswer } from "../lib/questions.mjs";

const DATE = "2026-11-04";
const SPEC = [
  "# Feature Specification: Thing",
  "",
  "**Status**: Draft <!-- [NEEDS CLARIFICATION: template guidance, not a question] -->",
  "",
  "## Requirements",
  "",
  "- **FR-001**: Exports go out as [NEEDS CLARIFICATION: which format do exports use?].",
  "- **FR-002**: Keep data [NEEDS CLARIFICATION: how long is data kept?].",
  "",
  "## Status history",
  "",
].join("\n");

/**
 * A repository with one spec, `sta-7-thing`, removed after the test.
 * @param {{ after: (fn: () => void) => void }} t
 * @param {string} [spec]
 */
function repoWith(t, spec = SPEC) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "flow-questions-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".agents/specs/sta-7-thing"), { recursive: true });
  writeFileSync(join(root, ".agents/specs/sta-7-thing/spec.md"), spec);
  return root;
}
const specOf = (/** @type {string} */ root) =>
  readFileSync(join(root, ".agents/specs/sta-7-thing/spec.md"), "utf8");

/**
 * A tool call through the handler with the real readers; `session` stands for the connection.
 * @param {string} name
 * @param {Record<string, unknown>} args
 * @param {import("../commands/mcp.mjs").Session} [session]
 * @returns {Promise<any>}
 */
const call = (name, args, session = {}) =>
  handle(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: `fflow_${name}`, arguments: args },
    },
    defaultReaders({ today: () => DATE }),
    session,
  );
const json = (/** @type {any} */ reply) => JSON.parse(reply.result.content[0].text);

test("questions: the open markers and unanswered questions, with lines; none inside a comment", () => {
  const spec = `${SPEC}\n## Clarifications\n\n### Session 2026-11-01\n\n- Q: who signs? → A: the owner\n- Q: which region?\n- Q: what cap? → A:\n`;
  assert.deepEqual(openQuestions(spec), {
    markers: [
      { line: 7, question: "which format do exports use?" },
      { line: 8, question: "how long is data kept?" },
    ],
    unanswered: [
      { line: 17, question: "which region?" },
      { line: 18, question: "what cap?" },
    ],
  });
});

test("questions: an answer makes the section and the session, replaces its marker, and is recorded once", () => {
  const first = recordAnswer(SPEC, {
    question: "which format do exports use?",
    answer: "CSV",
    date: DATE,
  });
  assert.equal(first.replaced, true);
  assert.equal(
    first.text,
    SPEC.replace(
      "## Requirements",
      `## Clarifications\n\n### Session ${DATE}\n\n- Q: which format do exports use? → A: CSV\n\n## Requirements`,
    ).replace("[NEEDS CLARIFICATION: which format do exports use?]", "CSV"),
  );
  const second = recordAnswer(first.text, {
    question: "How long do we keep data?",
    answer: "90 days",
    date: DATE,
    marker: "how long is data kept?",
  });
  assert.match(
    second.text,
    /→ A: CSV\n- Q: How long do we keep data\? → A: 90 days\n\n## Requirements/,
  );
  assert.match(second.text, /Keep data 90 days\./);
  assert.deepEqual(openQuestions(second.text).markers, []);
  // The same answer again changes nothing; a later day opens its own session.
  assert.equal(
    recordAnswer(second.text, {
      question: "How long do we keep data?",
      answer: "90 days",
      date: DATE,
    }).text,
    second.text,
  );
  const later = recordAnswer(second.text, { question: "Who?", answer: "Ops", date: "2026-11-05" });
  assert.match(
    later.text,
    /→ A: 90 days\n\n### Session 2026-11-05\n\n- Q: Who\? → A: Ops\n\n## Requirements/,
  );
  // A spec with no level-2 heading gets the section at its end.
  assert.equal(
    recordAnswer("# T\n\nbody\n", { question: "Q?", answer: "A", date: DATE }).text,
    `# T\n\nbody\n\n## Clarifications\n\n### Session ${DATE}\n\n- Q: Q? → A: A\n`,
  );
  assert.throws(
    () =>
      recordAnswer(SPEC, {
        question: "q",
        answer: "a",
        date: DATE,
        marker: "template guidance, not a question",
      }),
    /no open \[NEEDS CLARIFICATION: template guidance/,
  );
});

test("mcp questions_list: the spec's open questions by its key; an unknown key is a JSON-RPC error", async (t) => {
  const root = repoWith(t);
  const listed = json(await call("questions_list", { repo: root, key: "STA-7" }));
  assert.equal(listed.spec, ".agents/specs/sta-7-thing/spec.md");
  assert.deepEqual(
    listed.markers.map((/** @type {any} */ m) => m.line),
    [7, 8],
  );
  assert.equal((await call("questions_list", { repo: root, key: "STA-8" })).error.code, -32602);
});

test("mcp docs_lookup: specs, docs/ and .flow/ only, bounded, never through a symbolic link", async (t) => {
  const root = repoWith(t);
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "flow-outside-")));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, "secret.md"), "exports are secret\n");
  const write = (/** @type {string} */ path, /** @type {string} */ text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  write("docs/guide.md", "# Guide\nExports are CSV.\n");
  write(".flow/constitution.md", "No EXPORTS without a spec.\n");
  write("src/code.md", "exports here are not searched\n");
  write("docs/image.png", "exports\n");
  symlinkSync(join(outside, "secret.md"), join(root, "docs/linked.md"));
  symlinkSync(outside, join(root, "docs/linked-dir"));
  const found = json(await call("docs_lookup", { repo: root, query: "exports" }));
  assert.deepEqual(
    found.matches.map((/** @type {any} */ m) => `${m.path}:${m.line}`),
    [".agents/specs/sta-7-thing/spec.md:7", "docs/guide.md:2", ".flow/constitution.md:1"],
  );
  assert.equal(found.truncated, false);
  assert.equal(docsLookup(root, "exports", { limit: 1 }).truncated, true);
  assert.equal(docsLookup(root, "exports", { limit: 1 }).matches.length, 1);
  // A root that is itself a link is not searched.
  rmSync(join(root, "docs"), { recursive: true });
  symlinkSync(outside, join(root, "docs"));
  assert.equal(docsLookup(root, "secret").matches.length, 0);
  assert.equal((await call("docs_lookup", { repo: root, query: "" })).error.code, -32602);
  assert.equal(
    (await call("docs_lookup", { repo: root, query: "x".repeat(201) })).error.code,
    -32602,
  );
});

test("mcp clarification_record: writes the spec from the arguments when the client has no elicitation", async (t) => {
  const root = repoWith(t);
  const reply = await call("clarification_record", {
    repo: root,
    key: "STA-7",
    question: "which format do exports use?",
    answer: "CSV",
  });
  assert.deepEqual(json(reply), {
    spec: ".agents/specs/sta-7-thing/spec.md",
    session: DATE,
    recorded: true,
    replaced: true,
  });
  assert.match(
    specOf(root),
    new RegExp(`### Session ${DATE}\\n\\n- Q: which format do exports use\\? → A: CSV\\n`),
  );
  // No answer and no elicitation: a JSON-RPC error, nothing written.
  const before = specOf(root);
  const missing = await call("clarification_record", {
    repo: root,
    key: "STA-7",
    question: "how long is data kept?",
  });
  assert.equal(missing.error.code, -32602);
  assert.match(missing.error.message, /answer/);
  assert.equal(specOf(root), before);
});

test("mcp clarification_record: refuses bad input, a missing marker and a spec outside its folder", async (t) => {
  const root = repoWith(t);
  const base = { repo: root, key: "STA-7", question: "q?", answer: "a" };
  for (const bad of [
    { question: "two\nlines" },
    { answer: "" },
    { answer: "x".repeat(501) },
    { question: "q? → A: sneaky" },
    { marker: "" },
  ])
    assert.equal(
      (await call("clarification_record", { ...base, ...bad })).error.code,
      -32602,
      JSON.stringify(bad),
    );
  const nested = await call("clarification_record", {
    ...base,
    answer: "[NEEDS CLARIFICATION: again]",
  });
  assert.equal(nested.result.isError, true);
  const unknown = await call("clarification_record", { ...base, marker: "no such question" });
  assert.equal(unknown.result.isError, true);
  assert.equal(specOf(root), SPEC, "nothing written");
  // A spec that is a link to a file elsewhere is never written through.
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "flow-outside-")));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, "spec.md"), SPEC);
  rmSync(join(root, ".agents/specs/sta-7-thing/spec.md"));
  symlinkSync(join(outside, "spec.md"), join(root, ".agents/specs/sta-7-thing/spec.md"));
  const linked = await call("clarification_record", base);
  assert.equal(linked.result.isError, true);
  assert.match(linked.result.content[0].text, /refusing to write/);
  assert.equal(readFileSync(join(outside, "spec.md"), "utf8"), SPEC);
  // So is a spec folder that is a link.
  rmSync(join(root, ".agents/specs/sta-7-thing"), { recursive: true });
  symlinkSync(outside, join(root, ".agents/specs/sta-7-thing"));
  assert.equal((await call("clarification_record", base)).result.isError, true);
  assert.equal(readFileSync(join(outside, "spec.md"), "utf8"), SPEC);
});

test("mcp clarification_record: asks through elicitation/create only when the client declared it", async (t) => {
  const root = repoWith(t);
  /** @type {any[]} */
  const sent = [];
  const session = connection((m) => sent.push(m));
  const readers = defaultReaders({ today: () => DATE });
  const send = (/** @type {any} */ message) => handle(message, readers, session);
  // A client without the capability is never asked.
  await send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { capabilities: {} } });
  assert.equal(session.elicitation, false);
  await send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { capabilities: { elicitation: {} } },
  });
  assert.equal(session.elicitation, true);
  const args = { repo: root, key: "STA-7", question: "how long is data kept?" };
  const pending = send({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "fflow_clarification_record", arguments: args },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].method, "elicitation/create");
  assert.equal(sent[0].params.message, "how long is data kept?");
  assert.deepEqual(sent[0].params.requestedSchema.required, ["answer"]);
  assert.equal(
    session.reply({
      jsonrpc: "2.0",
      id: sent[0].id,
      result: { action: "accept", content: { answer: "90 days" } },
    }),
    true,
  );
  assert.equal(json(await pending).replaced, true);
  assert.match(specOf(root), /Keep data 90 days\./);
  // Declined: nothing is recorded.
  const before = specOf(root);
  const declined = send({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "fflow_clarification_record", arguments: { ...args, question: "Who?" } },
  });
  await new Promise((resolve) => setImmediate(resolve));
  session.reply({ jsonrpc: "2.0", id: sent[1].id, result: { action: "decline" } });
  assert.deepEqual(json(await declined), { recorded: false, action: "decline" });
  assert.equal(specOf(root), before);
  // An answer in the arguments is taken as given, with no form.
  await send({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "fflow_clarification_record",
      arguments: { ...args, question: "Who?", answer: "Ops" },
    },
  });
  assert.equal(sent.length, 2);
  // A reply nobody waits for is dropped, never answered; closing settles what still waits.
  assert.equal(session.reply({ jsonrpc: "2.0", id: "other", result: {} }), true);
  assert.equal(session.reply({ jsonrpc: "2.0", id: 9, method: "ping" }), false);
  const orphan = send({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "fflow_clarification_record", arguments: { ...args, question: "Where?" } },
  });
  await new Promise((resolve) => setImmediate(resolve));
  session.close();
  assert.equal((await orphan).result.isError, true);
});
