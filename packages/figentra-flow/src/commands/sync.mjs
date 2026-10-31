/**
 * Figentra Flow file contract:
 * Purpose: `figentra-flow sync` (core's `speckit-sync`, moved unchanged) — install the Stackra spec-kit preset into
 *   `.specify/presets/`, keep the bundled `speckit` workflow disabled, and re-render both integrations (spec-kit
 *   registers preset commands for the active integration only, so OpenCode first, then Claude). The preset is the
 *   configuration's `preset`: a bundled one (`neutral`, `stackra`) or a path to the repository's own preset folder.
 *   A configuration without one gets `neutral`; a repository with no config file keeps what it used before (its
 *   `.agents/speckit/presets/` when it has one, else the bundled `stackra`) until the config files land.
 *   Without `specify` on PATH it copies the bundled, already rendered `speckit-*` skills and commands of the
 *   `stackra` preset instead; the other presets need `specify`.
 *   The installed copies are generated and committed; `figentra-flow gate ci` (tripwire) fails when they drift from the source.
 * Boundary: writes only `.specify/` (through the pinned `specify`), or `.claude/skills/speckit-*` and
 *   `.opencode/commands/speckit.*` when it falls back.
 * Runtime: node
 * Governing contract: ADR 0120 (SDLC specs); ADR 0027 (CLI tools pinned in mise).
 * Needs: the pinned `specify` on PATH (mise.toml) for the full sync. Local only; CI never runs it.
 * Secrets: none.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "../lib/config.mjs";

const ROOT = process.cwd();
export const PRESETS = ".agents/speckit/presets";
/** The package's own copies: the preset source, `.specify/`, and the rendered skills and commands. */
export const ASSETS = fileURLToPath(new URL("../../assets", import.meta.url));

/** The `specify` calls, in order, that bring `.specify/` in line with the sources in `dir`. */
export function steps(presets, installed, dir = PRESETS) {
  return [
    ...presets.map((id) => [
      "preset",
      installed.includes(id) ? "update" : "add",
      ...(installed.includes(id) ? [id] : []),
      "--dev",
      `${dir}/${id}`,
    ]),
    ["workflow", "disable", "speckit"],
    ["integration", "use", "opencode"],
    ["integration", "use", "claude"],
  ];
}

/** Copy the bundled rendered `speckit-*` skills and commands into `root`. */
export function installSkills(root) {
  cpSync(join(ASSETS, "claude/skills"), join(root, ".claude/skills"), { recursive: true });
  cpSync(join(ASSETS, "opencode/commands"), join(root, ".opencode/commands"), { recursive: true });
}

/** The bundled presets. */
export const BUNDLED = ["neutral", "stackra"];

/**
 * The folder holding the presets to install, and their ids.
 * @param {string} root
 * @returns {{ dir: string, presets: string[] }}
 */
export function presetSource(root) {
  const preset = loadConfig(root).config.preset;
  if (preset && BUNDLED.includes(preset))
    return { dir: join(ASSETS, "presets"), presets: [preset] };
  if (preset)
    return { dir: dirname(resolve(root, preset)), presets: [basename(resolve(root, preset))] };
  return { dir: join(ASSETS, "presets"), presets: ["neutral"] };
}

export function run() {
  const list = (p) => (existsSync(join(ROOT, p)) ? readdirSync(join(ROOT, p)) : []);
  const { dir, presets } = presetSource(ROOT);
  const installed = list(".specify/presets").filter((n) => !n.startsWith("."));
  for (const args of steps(presets, installed, dir)) {
    console.log(`$ specify ${args.join(" ")}`);
    const r = spawnSync("specify", args, { cwd: ROOT, stdio: "inherit" });
    if (/** @type {NodeJS.ErrnoException | undefined} */ (r.error)?.code === "ENOENT") {
      if (presets.join() !== "stackra") {
        console.error(
          `specify is not on PATH: the ${presets.join(", ")} preset renders through it (install spec-kit's specify)`,
        );
        return 1;
      }
      console.log("specify is not on PATH: installing the bundled speckit skills and commands");
      installSkills(ROOT);
      return 0;
    }
    // `workflow disable` fails when it is already disabled; nothing else may.
    if (r.status !== 0 && args[0] !== "workflow") return r.status ?? 1;
  }
  rmSync(join(ROOT, ".specify/.workflow-install.lock"), { force: true });
  const bash = join(ROOT, ".specify/scripts/bash");
  for (const f of list(".specify/scripts/bash"))
    if (f.endsWith(".sh")) chmodSync(join(bash, f), 0o755);
  return 0;
}
