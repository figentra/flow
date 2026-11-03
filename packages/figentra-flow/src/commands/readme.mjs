/**
 * Figentra Flow file contract:
 * Purpose: `fflow readme [--check]` (STA-1879): renders `README.md` from `.flow/readme.yml` through the
 *   preset's `readme-template`; `--check` writes nothing and exits 1 when `README.md` differs from the render.
 *   When the banner names a brand kit, it also pulls the kit and writes its light and dark image and `banner.json`
 *   into `.github/assets/brand/`; `--check` compares them with the kit. Without a registry token it stops with a boxed
 *   problem that says where to run it. `sync` renders the README too, and records it in `.flow/lock.json`.
 * Boundary: writes only `README.md` and the banner files; the kit pull is `pullBanner`'s.
 * Runtime: node
 * Governing contract: STA-1879; figentra/brand ADR 0001.
 * Secrets: STACKRA_REGISTRY_TOKEN reaches the brand CLI's process only; it is never printed.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { bannerPaths, pullBanner, RegistryTokenMissing } from "../lib/brand-banner.mjs";
import { git } from "../lib/git.mjs";
import { NAME } from "../lib/product.mjs";
import { README_DATA, readmeData, renderReadme } from "../lib/readme.mjs";

/**
 * A problem framed so it stands out in a CI log.
 * @param {string[]} lines
 */
export function boxed(lines) {
  const width = Math.max(...lines.map((line) => line.length));
  return [
    `┌${"─".repeat(width + 2)}┐`,
    ...lines.map((line) => `│ ${line.padEnd(width)} │`),
    `└${"─".repeat(width + 2)}┘`,
  ].join("\n");
}

/**
 * The banner files of `root` as the kit has them, or the number to exit with after printing why not.
 * @param {string} root
 * @param {{ kit: string, image: any }} banner
 * @param {Parameters<typeof pullBanner>[2]} options
 * @returns {Map<string, Buffer> | number}
 */
function kitFiles(root, banner, options) {
  try {
    const pulled = pullBanner(root, banner, options);
    const paths = bannerPaths(banner);
    const manifest = { kit: banner.kit, image: banner.image, name: pulled.name };
    return new Map([
      [paths.light, pulled.light],
      [paths.dark, pulled.dark],
      [paths.manifest, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)],
    ]);
  } catch (error) {
    if (!(error instanceof RegistryTokenMissing)) throw error;
    console.error(
      boxed([
        `${NAME} readme: ${error.message}.`,
        "Run it where the token is: a ci-box (`ci-box run`), or CI after the registry login step.",
        "The README text itself needs no token: `fflow sync` still renders it.",
      ]),
    );
    return 2;
  }
}

/**
 * `fflow readme [--check]`.
 * @param {string[]} [args]
 * @param {Parameters<typeof pullBanner>[2]} [options] the pull's environment and runner (tests replace them)
 */
export function run(args = [], options = {}) {
  const top = git(process.cwd(), ["rev-parse", "--show-toplevel"]);
  const root = top.ok ? top.out : process.cwd();
  const data = readmeData(root);
  if (data === undefined) {
    console.error(`${NAME} readme: no ${README_DATA} in ${root}`);
    return 2;
  }
  const check = args.includes("--check");
  // The banner first: the README's alt text reads the kit's name from banner.json.
  if (data.banner?.kit) {
    const files = kitFiles(root, data.banner, options);
    if (typeof files === "number") return files;
    for (const [path, bytes] of files) {
      const file = join(root, path);
      if (check) {
        if (existsSync(file) && readFileSync(file).equals(bytes)) continue;
        console.error(
          `${NAME} readme: ${path} differs from the brand kit ${data.banner.kit} (run \`${NAME} readme\`)`,
        );
        return 1;
      }
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, bytes);
    }
  }
  const text = /** @type {string} */ (renderReadme(root));
  const file = join(root, "README.md");
  if (check) {
    if (existsSync(file) && readFileSync(file, "utf8") === text) return 0;
    console.error(
      `${NAME} readme: README.md differs from ${README_DATA} (edit the data file, then run \`${NAME} readme\`)`,
    );
    return 1;
  }
  writeFileSync(file, text);
  const from = data.banner?.kit ? ` and the banner from ${data.banner.kit}` : "";
  console.log(`${NAME} readme: wrote README.md from ${README_DATA}${from}`);
  return 0;
}
