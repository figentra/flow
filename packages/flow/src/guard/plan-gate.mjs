/**
 * Figentra Flow file contract:
 * Purpose: the guard engine's plan gate, ported from core's `decidePlanGate` (Stackra ADR 0362): a write to a source
 *   path (the preset's `PLAN_GATED`, repo-relative) is allowed only when the branch's key has one spec folder whose
 *   spec.md passes `checkSpec` (every question answered) and which holds a non-empty plan.md, or holds the owner's
 *   approved `hotfix.md`. Markdown is never gated, and neither is a file outside any git checkout.
 * Boundary: reads the file's git checkout (top, prefix, branch, a rebase's `head-name`) and its spec folder; writes
 *   nothing. The gate's checks load only for a gated path, so other hook calls stay fast.
 * Runtime: node
 * Governing contract: Stackra ADR 0362; STA-1945 (FR-7, FR-11, AC-9, P-012).
 * Secrets: none.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import { specsDirs } from "../lib/flow-dir.mjs";
import { NAME } from "../lib/product.mjs";

/** The fields an owner-approved `hotfix.md` fills; with all of them set, a hotfix may go before its questionnaire. */
export const HOTFIX_FIELDS = ["Approved by", "Approved on", "Reason"];

/**
 * True when a `hotfix.md` text fills every `HOTFIX_FIELDS` line (`**Approved by**: …`) and dates its approval.
 * @param {string} text
 */
export const hotfixApproved = (text) =>
  HOTFIX_FIELDS.every((f) => new RegExp(`^\\*\\*${f}\\*\\*:[ \\t]*\\S`, "m").test(text)) &&
  /^\*\*Approved on\*\*:[ \t]*\d{4}-\d{2}-\d{2}/m.test(text);

/** git in `dir`, uncached: one gate decision must see the branch as it is now. "" on failure. */
const gitIn = (/** @type {string} */ dir, /** @type {string[]} */ ...args) => {
  const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", timeout: 5000 });
  return r.status === 0 ? r.stdout.trim() : "";
};

/** The checked-out branch; during a rebase HEAD is detached, so the branch comes from the rebase's `head-name`. */
function currentBranch(/** @type {string} */ top) {
  const now = gitIn(top, "branch", "--show-current");
  if (now) return now;
  for (const d of ["rebase-merge", "rebase-apply"]) {
    const p = gitIn(top, "rev-parse", "--git-path", `${d}/head-name`);
    const f = p && resolve(top, p);
    if (f && existsSync(f))
      return readFileSync(f, "utf8")
        .trim()
        .replace(/^refs\/heads\//, "");
  }
  return "";
}

/** The plan gate's deny decision with `why`. */
const denial = (/** @type {string} */ why, /** @type {string} */ specs) =>
  /** @type {import("./bash.mjs").Decision} */ ({
    decision: "deny",
    reason: `Plan gate: ${why} No code without an answered questionnaire and a plan: write ${specs}/<key>-<slug>/spec.md (every question answered; \`${NAME} gate plan <spec.md>\` passes) and plan.md first. A production hotfix needs the owner's hotfix.md in that folder.`,
  });

/**
 * The plan gate for a write to `path`. `root` and `branch` default to the file's git checkout.
 * @param {string} path
 * @param {RegExp} gated the repo-relative source paths
 * @param {{ cwd?: string, root?: string, branch?: string }} [options]
 * @returns {Promise<import("./bash.mjs").Decision>}
 */
export async function decidePlanGate(path, gated, { cwd, root, branch } = {}) {
  /** @type {import("./bash.mjs").Decision} */
  const ok = { decision: "allow" };
  const abs = resolve(cwd ?? ".", path);
  let rel;
  if (root === undefined) {
    let dir = dirname(abs);
    while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir);
    const [top, prefix = ""] = gitIn(dir, "rev-parse", "--show-toplevel", "--show-prefix").split(
      "\n",
    );
    if (!top) return ok;
    root = top;
    branch ??= currentBranch(top);
    // The prefix, not `top`, so a symlinked path still lands in the repository.
    rel = join(prefix, relative(dir, abs));
  } else rel = relative(root, abs);
  const posix = rel.split(sep).join("/");
  // Documentation is never blocked, even inside a source folder (packages/*/README.md, services/*/docs/*.md).
  if (/\.mdx?$/i.test(posix) || !gated.test(posix)) return ok;
  const [{ checkSpec, specDir, RULES, presetId, presetOf }, { schemeFor }] = await Promise.all([
    import("../lib/spec-check.mjs"),
    import("../adapters/tracker/index.mjs"),
  ]);
  const specs = specsDirs(root).dir;
  const keys = schemeFor(root);
  const found = specDir({ root, branch: String(branch ?? ""), keys });
  if (found.error) return denial(`${found.error.replace(/; pass --slug.*/, "")}.`, specs);
  const dir = join(root, found.dir);
  const read = (/** @type {string} */ f) =>
    existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8") : "";
  if (hotfixApproved(read("hotfix.md"))) return ok;
  const spec = read("spec.md");
  if (!spec) return denial(`${basename(found.dir)} has no spec.md.`, specs);
  const open = checkSpec(
    spec,
    keys,
    RULES[presetId(presetOf(root), root) ?? "neutral"] ?? RULES.neutral,
  );
  if (open.length)
    return denial(
      `${basename(found.dir)}/spec.md has unanswered questions: ${open.join("; ")}.`,
      specs,
    );
  if (!read("plan.md").trim()) return denial(`${basename(found.dir)} has no plan.md.`, specs);
  return ok;
}
