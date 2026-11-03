/**
 * Figentra Flow file contract:
 * Purpose: hold spec-trace's trace matrix and drift rules to their contract, on the sta-901 fixture.
 * Boundary: pure functions; no git, no network; node:test and node:assert.
 * Runtime: node
 * Governing contract: ADR 0022 (tests live in tests folders); ADR 0182 (testing strategy).
 */
// @covers sta-163:FR-006 sta-163:FR-007 sta-163:P-004
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drift, trace, traceProblems } from "../commands/trace.mjs";
import { keyScheme } from "../adapters/tracker/index.mjs";
import { coversTags, parseTasks } from "../lib/spec-parse.mjs";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__/sdd/sta-901-widget");
const read = (n) => readFileSync(join(FIX, n), "utf8");
const base = {
  folder: "sta-901-widget",
  spec: read("spec.md"),
  plan: read("plan.md"),
  tasks: read("tasks.md"),
};

test("coversTags reads only the spec's own key", () => {
  assert.deepEqual(
    coversTags("/** @covers sta-901:FR-001 sta-7:FR-002, sta-901:P-001 */", "sta-901"),
    ["FR-001", "P-001"],
  );
});

test("another scheme: trace keys the folder and the tags by it; tasks keep any tracker's key", () => {
  const gh = keyScheme({ kind: "github-issues", branchPrefix: "work" });
  const t = trace({ ...base, folder: "gh-901-widget", tests: "@covers gh-901:P-001", keys: gh });
  assert.equal(t.key, "gh-901");
  assert.equal(t.ps[0].tested, true);
  assert.match(
    traceProblems(trace({ ...base, folder: "gh-901-widget", keys: gh })).join(),
    /`@covers gh-901:/,
  );
  assert.deepEqual(coversTags("@covers GH-901:FR-001 sta-901:FR-002", "gh-901"), ["FR-001"]);
  const [task] = parseTasks("- [ ] T001 Do it — covers: FR-001 [GH-12]\n");
  assert.deepEqual([task.key, task.covers], ["GH-12", ["FR-001"]]);
});

test("trace: an FR is covered directly or through a tested P; struck IDs drop out", () => {
  const t = trace({ ...base, tests: "@covers sta-901:P-001" });
  assert.deepEqual(
    t.frs.map((f) => [f.id, f.tasks, f.via]),
    [
      ["FR-001", ["T001"], ["P-001"]],
      ["FR-002", ["T002"], ["P-001"]],
    ],
  );
  assert.deepEqual(traceProblems(t), []);
});

// @covers sta-1945:FR-23 sta-1945:P-028
test("trace: with a record, a ticked task counts only with passing evidence", () => {
  const ok = { command: "true", exit: 0, ms: 1, head: "h", clean: true, digest: "d", at: "t" };
  const record = { tasks: { T001: [{ ...ok, exit: 1 }, ok], T002: [{ ...ok, clean: false }] } };
  const t = trace({ ...base, tests: "@covers sta-901:P-001", record });
  assert.deepEqual(
    t.tasks.map((x) => [x.id, x.done]),
    [
      ["T001", true],
      ["T002", false],
    ],
  );
  assert.deepEqual(traceProblems(t), [
    "T002 is ticked without passing evidence in the record (`fflow task done`; FR-23)",
  ]);
  // no record: a spec before FR-23 counts its markers
  assert.ok(trace({ ...base }).tasks.every((x) => x.done));
});

test("trace: Done needs every FR and P tested and every SC's method", () => {
  const untested = traceProblems(trace({ ...base, tests: "@covers sta-901:FR-001" }));
  assert.match(untested.join("\n"), /FR-002 has no test carrying `@covers sta-901:FR-002`/);
  assert.match(untested.join("\n"), /P-001 has no test/);
  const spec = base.spec.replace(" — verified by: manual", "");
  const noMethod = traceProblems(trace({ ...base, spec, tests: "@covers sta-901:P-001" }));
  assert.deepEqual(noMethod, [
    'SC-002 names no verification method ("— verified by: unit|e2e|k6|manual")',
  ]);
});

test("drift: unnamed members, missing ticked paths, untouched docs at Done", () => {
  const docs = "apps/docs/src/docs/guides/widget.mdx";
  const ok = drift({ ...base, changed: ["packages/foundation/widget/src/build.ts", docs] });
  assert.deepEqual(ok, []);
  assert.match(
    drift({ ...base, changed: ["packages/data/other/src/x.ts", docs] }).join(),
    /changes `packages\/data\/other`, which no spec in the diff names in its Impact/,
  );
  assert.deepEqual(
    drift({
      ...base,
      changed: ["packages/data/other/src/x.ts", docs],
      named: new Set(["packages/data/other"]),
    }),
    [],
  );
  assert.match(
    drift({ ...base, changed: [] }).join(),
    /Impact's doc `apps\/docs\/src\/docs\/guides\/widget\.mdx` is not touched/,
  );
  assert.match(
    drift({ ...base, changed: [docs], exists: (p) => !p.endsWith("build.ts") }).join(),
    /T002 is ticked, but its path `packages\/foundation\/widget\/src\/build\.ts` does not exist/,
  );
});
