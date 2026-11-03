/**
 * Figentra Flow file contract:
 * Purpose: the README banner pulled from a released brand kit (STA-1879, figentra/brand ADR 0001: the brand is pulled,
 *   never copied). `banner: { kit: "<id>@<version>", image }` names the kit and one of its README-safe images;
 *   `bannerPaths` gives the committed files the README points at (`.github/assets/brand/banner-{light,dark}.<ext>` and
 *   `banner.json`, the kit's product name for the alt text), and `pullBanner` fetches the kit with the brand CLI
 *   (`figentra-brand pull`: the registry, with its integrity check) and returns the bytes `fflow readme` writes or checks.
 *   A private repository's README cannot show an image from the private brand repository, so the image is committed.
 * Boundary: the brand CLI runs through `pnpm dlx` at the exact version `BRAND_CLI` (so a render is reproducible) only
 *   when a banner names a kit; Flow never depends on the private CLI as a package. Reads the kit from a temp
 *   directory it deletes.
 * Runtime: node
 * Governing contract: STA-1879; figentra/brand ADR 0001 and docs/releases.md (pull).
 * Secrets: STACKRA_REGISTRY_TOKEN is read from the environment and passed to the CLI's process only, never printed.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The brand CLI that pulls a kit, at an exact version; the README's header comment names it. */
export const BRAND_CLI = "@figentra/brand-cli@1.0.0";

/** Where a repository keeps the pulled banner. */
export const BANNER_DIR = ".github/assets/brand";

/** A released kit: `<id>@<x.y.z>`, as `figentra-brand pull` takes it. */
export const BANNER_KIT = /^([a-z][a-z0-9-]*)@(\d+\.\d+\.\d+)$/;

/** The kit images a README banner may use: the file in a pulled kit for a theme, and its extension. */
export const BANNER_IMAGES = {
  /** The 3D Open Graph still, 1.91:1, English crop. */
  "og-still": {
    ext: "png",
    file: (/** @type {string} */ id, /** @type {string} */ theme) =>
      `3d-stills/${id}-3d-og-${theme}-en.png`,
  },
  /** The horizontal logo, English. */
  "logo-horizontal": {
    ext: "svg",
    file: (/** @type {string} */ id, /** @type {string} */ theme) =>
      `logos/${id}-horizontal.${theme}.en.svg`,
  },
};

/** A missing registry token: `fflow readme` prints it as a boxed problem. */
export class RegistryTokenMissing extends Error {}

/**
 * The committed files of a kit banner.
 * @param {{ image: keyof typeof BANNER_IMAGES }} banner
 */
export function bannerPaths(banner) {
  const { ext } = BANNER_IMAGES[banner.image];
  return {
    light: `${BANNER_DIR}/banner-light.${ext}`,
    dark: `${BANNER_DIR}/banner-dark.${ext}`,
    manifest: `${BANNER_DIR}/banner.json`,
  };
}

/**
 * How the brand CLI runs: its exit status and error text are all the pull reads (tests replace it).
 * @typedef {(root: string, args: string[], env: NodeJS.ProcessEnv) => { status: number | null, stderr?: string }} BrandCliRunner
 */

/**
 * Runs the brand CLI in `root` (whose `.npmrc` maps the `@figentra` scope to the registry).
 * @param {string} root
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} env
 */
const runBrandCli = (root, args, env) =>
  spawnSync("pnpm", ["dlx", BRAND_CLI, ...args], {
    cwd: root,
    env,
    encoding: "utf8",
  });

/**
 * Pulls `banner.kit` and returns the light and dark image and the kit's product name.
 * @param {string} root
 * @param {{ kit: string, image: keyof typeof BANNER_IMAGES }} banner
 * @param {{ env?: NodeJS.ProcessEnv, run?: BrandCliRunner }} [options]
 * @returns {{ light: Buffer, dark: Buffer, name: string }}
 * @throws {RegistryTokenMissing} without STACKRA_REGISTRY_TOKEN; Error when the pull fails or the kit lacks the image.
 */
export function pullBanner(root, banner, { env = process.env, run = runBrandCli } = {}) {
  if (!env.STACKRA_REGISTRY_TOKEN)
    throw new RegistryTokenMissing(
      `the banner comes from the brand kit ${banner.kit} on the Stackra registry, and STACKRA_REGISTRY_TOKEN is not set`,
    );
  const id = /** @type {RegExpExecArray} */ (BANNER_KIT.exec(banner.kit))[1];
  const out = mkdtempSync(join(tmpdir(), "flow-brand-"));
  try {
    const pulled = run(root, ["pull", banner.kit, "--out", out], env);
    if (pulled.status !== 0)
      throw new Error(`figentra-brand pull ${banner.kit} failed: ${(pulled.stderr ?? "").trim()}`);
    const { file } = BANNER_IMAGES[banner.image];
    const read = (/** @type {string} */ theme) => {
      const path = join(out, file(id, theme));
      if (!existsSync(path)) throw new Error(`the kit ${banner.kit} has no ${file(id, theme)}`);
      return readFileSync(path);
    };
    // The kit's README opens with "# <product name> brand kit (<Arabic name>)".
    const readme = join(out, "README.md");
    const heading = existsSync(readme)
      ? /^# (.+?) brand kit\b/m.exec(readFileSync(readme, "utf8"))
      : null;
    return { light: read("light"), dark: read("dark"), name: heading?.[1] ?? id };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}
