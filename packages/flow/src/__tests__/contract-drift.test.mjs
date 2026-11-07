/**
 * Figentra Flow file contract:
 * Purpose: hold contract drift (STA-1945 FR-30, AC-33) to its contract: a function a plan's component declares is
 *   looked up in the files of its folder trees; a missing one, one with other parameters or another return, and an
 *   interface block with no readable declaration are reported; a small spec's `## Design` is read the same way.
 * Boundary: pure; files come from an in-memory map; node:test and node:assert.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945 FR-30, AC-33.
 */
// FR-30's contract part only, so FR-30 and P-034 are not claimed until edited approvals (T048) land.
// @covers sta-1945:AC-33
import { test } from "node:test";
import assert from "node:assert/strict";

import { contractDrift, declarations } from "../lib/contract-drift.mjs";

const fence = "```";
const plan = (/** @type {string} */ iface, lang = "js") => `# Plan

## Components

### C1 Export streaming

**Responsibility**: write a table as CSV.

${fence}text
src/export/
├── stream.mjs                 (new)
├── {a,b}.mjs                  (new)
└── __tests__/stream.test.mjs  (new)
${fence}

${fence}${lang}
${iface}
${fence}

## Files and folders
`;

const reader = (/** @type {Record<string, string>} */ files) => (/** @type {string} */ p) =>
  files[p];

test("declarations: name, parameters and return, whitespace and comments aside", () => {
  const found = declarations(`/** @param {string} a */
export async function one(a, b = 1) {
  return a;
}
export function two({
  folder,
  spec,
}) {}
// export function commented(x) {}
function three<T>(t: T): Promise<{ rows: number }>;
def four(self, x) -> int:
func (r *Repo) Five(id string) (int, error) {
`);
  assert.deepEqual(Object.fromEntries(found), {
    one: "one(a,b=1)",
    two: "two({folder,spec})",
    three: "three(t:T):Promise<{rows:number}>",
    four: "four(self,x)->int",
    Five: "Five(idstring)(int,error)",
  });
});

test("contract drift: a declared function its tree's file has with the same signature passes", () => {
  const read = reader({
    "src/export/stream.mjs": "export async function streamTable(\n  table,\n  out,\n) {\n}\n",
  });
  assert.deepEqual(contractDrift(plan("export function streamTable(table, out) {}"), read), []);
});

test("contract drift: a missing function, or one with another signature, is reported", () => {
  const read = reader({ "src/export/stream.mjs": "export function streamTable(table) {}\n" });
  assert.deepEqual(
    contractDrift(
      plan("export function streamTable(table, out) {}\nexport function gone() {}"),
      read,
    ),
    [
      "component `C1 Export streaming` declares `streamTable(table,out)`, but `src/export/stream.mjs` has `streamTable(table)` (FR-30)",
      "component `C1 Export streaming` declares `gone`, which no file of its folder tree has (FR-30)",
    ],
  );
  // a file outside the component's tree does not count
  assert.match(
    contractDrift(
      plan("export function streamTable(table) {}"),
      reader({ "src/other.mjs": "export function streamTable(table) {}" }),
    ).join(),
    /declares `streamTable`, which no file/,
  );
});

test("contract drift: a changed return type is reported", () => {
  const read = reader({
    "src/export/stream.mjs": "export function streamTable(table: string): number {\n}\n",
  });
  assert.equal(
    contractDrift(plan("export function streamTable(table: string): string;", "ts"), read).length,
    1,
  );
  assert.deepEqual(
    contractDrift(plan("export function streamTable(table: string): number;", "ts"), read),
    [],
  );
});

test("contract drift: an interface block with no readable declaration is a problem, never a pass", () => {
  assert.deepEqual(contractDrift(plan("export const streamTable = 1;"), reader({})), [
    "component `C1 Export streaming`: interface block 2 (```js) declares no function that can be read (FR-30)",
  ]);
  // a comment-only block says there is no code interface
  assert.deepEqual(
    contractDrift(plan("// no code interface: the templates are data"), reader({})),
    [],
  );
});

test("contract drift: a small spec's `## Design` is read as one component", () => {
  const spec = `# Spec\n\n## Design\n\n${fence}text\nsrc/a.mjs (new)\n${fence}\n\n${fence}js\nexport function a(x) {}\n${fence}\n\n## Tasks\n`;
  assert.deepEqual(contractDrift(spec, reader({ "src/a.mjs": "export function a(x) {}" })), []);
  assert.deepEqual(contractDrift(spec, reader({})), [
    "component `Design` declares `a`, which no file of its folder tree has (FR-30)",
  ]);
});
