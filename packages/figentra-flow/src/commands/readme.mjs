/**
 * Figentra Flow file contract:
 * Purpose: `fflow readme [--check]` (STA-1879): renders `README.md` from `.flow/readme.yml` through the
 *   preset's `readme-template`; `--check` writes nothing and exits 1 when `README.md` differs from the render.
 *   `sync` renders it too, and records it in `.flow/lock.json`.
 * Boundary: writes only `README.md`.
 * Runtime: node
 * Governing contract: STA-1879.
 * Secrets: none.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { git } from "../lib/git.mjs";
import { NAME } from "../lib/product.mjs";
import { README_DATA, renderReadme } from "../lib/readme.mjs";

/** `fflow readme [--check]`. */
export function run(/** @type {string[]} */ args = []) {
  const top = git(process.cwd(), ["rev-parse", "--show-toplevel"]);
  const root = top.ok ? top.out : process.cwd();
  const text = renderReadme(root);
  if (text === undefined) {
    console.error(`${NAME} readme: no ${README_DATA} in ${root}`);
    return 2;
  }
  const file = join(root, "README.md");
  if (args.includes("--check")) {
    if (existsSync(file) && readFileSync(file, "utf8") === text) return 0;
    console.error(
      `${NAME} readme: README.md differs from ${README_DATA} (edit the data file, then run \`${NAME} readme\`)`,
    );
    return 1;
  }
  writeFileSync(file, text);
  console.log(`${NAME} readme: wrote README.md from ${README_DATA}`);
  return 0;
}
