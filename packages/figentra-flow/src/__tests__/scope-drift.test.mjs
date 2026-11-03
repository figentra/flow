/**
 * Figentra Flow file contract:
 * Purpose: hold scope drift (STA-1945 FR-30) to its contract: a changed file no live task names, by its path or a
 *   folder ending in `/`, is drift; tests, changesets and lockfiles never are; a struck task names nothing. A folder
 *   tree block's lines are paths under the folders they nest in, and a task's path outside every tree is reported.
 * Boundary: pure; no file, git or network access; node:test and node:assert.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945 FR-30.
 */
// FR-30's scope part only, so FR-30 and P-034 are not claimed until contract drift (T047) and edited approvals (T048) land.
// @covers sta-1945:AC-32
import { test } from "node:test";
import assert from "node:assert/strict";

import { outsideTrees, scopeDrift, treePaths } from "../lib/scope-drift.mjs";

const task = (/** @type {string[]} */ paths, struck = false) => ({ paths, struck });

test("scope drift: files no live task names, by path or folder", () => {
  const tasks = [task(["src/a.mjs", "docs/"]), task(["src/gone.mjs"], true)];
  assert.deepEqual(
    scopeDrift(["src/a.mjs", "docs/guide/x.md", "src/b.mjs", "src/gone.mjs", "docsx/y.md"], tasks),
    ["src/b.mjs", "src/gone.mjs", "docsx/y.md"],
  );
  assert.deepEqual(scopeDrift([], tasks), []);
});

test("scope drift: tests, changesets and lockfiles are always in scope", () => {
  assert.deepEqual(
    scopeDrift(
      [
        "src/__tests__/a.test.mjs",
        "lib/b.spec.ts",
        ".changeset/brave-fox.md",
        "pnpm-lock.yaml",
        "packages/x/package-lock.json",
        "go.sum",
        ".changeset/config.json",
      ],
      [],
    ),
    [".changeset/config.json"],
  );
});

test("tree paths: each line under the folders it nests in, the tree marks and notes dropped", () => {
  assert.deepEqual(
    treePaths([
      "packages/x/",
      "├── bin/x.mjs                 (changed: a note)",
      "├── src/",
      "│   ├── lib/",
      "│   │   └── a.mjs",
      "│   └── b.mjs",
      "└── README.md",
      "",
      "lib/",
      "|-- c.mjs",
      "`-- d/",
      "    `-- e.mjs",
      "src/",
      "  f.mjs",
      "  ...",
      "packages/x/flat/g.mjs (new)",
    ]),
    [
      "packages/x",
      "packages/x/bin/x.mjs",
      "packages/x/src",
      "packages/x/src/lib",
      "packages/x/src/lib/a.mjs",
      "packages/x/src/b.mjs",
      "packages/x/README.md",
      "lib",
      "lib/c.mjs",
      "lib/d",
      "lib/d/e.mjs",
      "src",
      "src/f.mjs",
      "packages/x/flat/g.mjs",
    ],
  );
});

test("outside trees: a live task's path no entry holds, by path, folder or glob; tests and non-paths aside", () => {
  const entries = [
    "src/a.mjs",
    "docs/",
    "lib/{b,c}.mjs",
    "assets/*/x.yml",
    "deep/**/y.md",
    "pkg/z.mjs",
  ];
  const tasks = [
    task([
      "src/a.mjs",
      "docs/guide/x.md",
      "lib/c.mjs",
      "assets/neutral/x.yml",
      "deep/a/b/y.md",
      "pkg/",
      "src/__tests__/a.test.mjs",
      ".changeset/a.md",
      "gate ci",
      "checkScope",
      "/flow-tasks",
      "@stackra/console",
      "~/.local/bin",
      ".flow/overrides/**",
      "src/<name>.mjs",
    ]),
    task(["src/b.mjs", "lib/d.mjs", "assets/a/b/x.yml", "README.md", "src/b.mjs"]),
    task(["src/gone.mjs"], true),
  ];
  assert.deepEqual(outsideTrees(tasks, entries), [
    "pkg/",
    "src/b.mjs",
    "lib/d.mjs",
    "assets/a/b/x.yml",
    "README.md",
  ]);
  assert.deepEqual(outsideTrees([], entries), []);
  // a folder line with lines beneath it holds only those; a leaf folder line holds everything under it
  const rooted = treePaths(["packages/x/", "├── src/", "│   └── a.mjs", "└── docs/"]);
  assert.deepEqual(
    outsideTrees(
      [
        task([
          "packages/x/src/a.mjs",
          "packages/x/src/",
          "packages/x/docs/y.md",
          "packages/x/src/b.mjs",
        ]),
      ],
      rooted,
    ),
    ["packages/x/src/", "packages/x/src/b.mjs"],
  );
});
