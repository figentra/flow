/**
 * Figentra Flow file contract:
 * Purpose: `fflow review <pr> --input | --record <findings.json>` (FR-15, C14), the review stage around its Claude
 *   workflow (D6 Q5). `--input` prints, as JSON, what the four reviewers (correctness, simplicity, security and
 *   tenancy, contracts) read: the PR, its head and base, the changed files, the spec's FRs and ACs and its documents.
 *   `--record` takes the workflow's findings (each verified by its own verifier), refuses output that is not a list
 *   of findings and names each problem, else records the review on the head in Flow's record: its verdict, the
 *   finding count and the confirmed blocking findings, which `land` refuses on (AC-40, P-021).
 * Boundary: reads git and the spec folder of the branch's key; `--record` writes Flow's record only, and nothing when
 *   it refuses. Posts nothing to GitHub.
 * Runtime: node
 * Governing contract: STA-1945 (FR-15, AC-40, P-021).
 * Secrets: none.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { schemeFor } from "../adapters/tracker/index.mjs";
import { specDir } from "./gate.mjs";
import { say } from "../lib/cli.mjs";
import { defaultBranch, git } from "../lib/git.mjs";
import { NAME } from "../lib/product.mjs";
import { RecordError, updateRecord } from "../lib/record.mjs";
import { definedIds } from "../lib/spec-parse.mjs";

/** The review workflow's parallel reviewers (FR-15). */
export const REVIEWERS = ["correctness", "simplicity", "security-tenancy", "contracts"];

/**
 * @typedef {{ id: string, reviewer: "correctness" | "simplicity" | "security-tenancy" | "contracts",
 *             blocking: boolean, confirmed: boolean, file: string, text: string }} Finding
 */

/** A refusal: no issue key on the branch, or no PR number. */
export class ReviewError extends Error {}

/**
 * The branch's issue key and its spec text ("" when the work has no spec).
 * @param {string} root
 */
function taskOf(root) {
  const keys = schemeFor(root);
  const branch = git(root, ["branch", "--show-current"]).out;
  const k = keys.keys(branch)[0];
  if (!k)
    throw new ReviewError(
      `no issue key in the branch \`${branch}\`: review runs on the task's branch`,
    );
  const found = specDir({ root, key: k, keys });
  const file = found.dir ? join(root, found.dir, "spec.md") : "";
  return { k, dir: found.dir, spec: file && existsSync(file) ? readFileSync(file, "utf8") : "" };
}

/**
 * The review workflow's input.
 * @param {string} root the task's worktree
 * @param {number} pr
 */
export function reviewInput(root, pr) {
  const { k, dir, spec } = taskOf(root);
  const base = defaultBranch(root);
  return {
    pr,
    key: k,
    sha: git(root, ["rev-parse", "HEAD"]).out,
    base,
    changed: git(root, ["diff", "--name-only", `origin/${base}...HEAD`])
      .out.split("\n")
      .filter(Boolean),
    frs: [...definedIds(spec, "FR").live],
    acs: [...definedIds(spec, "AC").live],
    files: spec
      ? ["spec.md", "plan.md", "tasks.md"]
          .filter((f) => existsSync(join(root, dir, f)))
          .map((f) => `${dir}/${f}`)
      : [],
    reviewers: REVIEWERS,
  };
}

/**
 * Why `findings` is not the workflow's output: a list of findings, each with its id, reviewer, flags, file and text.
 * @param {unknown} findings
 * @returns {string[]}
 */
export function findingProblems(findings) {
  if (!Array.isArray(findings)) return ["the findings are not a JSON list"];
  return findings.flatMap((/** @type {any} */ f, i) => {
    const at = `finding ${i + 1}${typeof f?.id === "string" && f.id ? ` (${f.id})` : ""}`;
    if (!f || typeof f !== "object") return [`${at} is not an object`];
    return [
      ...["id", "file", "text"]
        .filter((k) => typeof f[k] !== "string" || !f[k].trim())
        .map((k) => `${at} has no \`${k}\``),
      ...(REVIEWERS.includes(f.reviewer)
        ? []
        : [`${at}: reviewer is not one of ${REVIEWERS.join(", ")}`]),
      ...["blocking", "confirmed"]
        .filter((k) => typeof f[k] !== "boolean")
        .map((k) => `${at}: \`${k}\` is not true or false`),
    ];
  });
}

/**
 * Records the review of `pr` on the head: PASS unless a blocking finding is confirmed. Nothing is written when the
 * findings are not valid output.
 * @param {string} root the task's worktree
 * @param {number} pr
 * @param {Finding[]} findings
 * @returns {{ blocking: Finding[], problems: string[] }}
 */
export function recordReview(root, pr, findings) {
  const problems = findingProblems(findings);
  if (problems.length) return { blocking: [], problems };
  const { k } = taskOf(root);
  const blocking = findings.filter((f) => f.blocking && f.confirmed);
  updateRecord(root, k, (r) => ({
    ...r,
    stage: "review",
    state: blocking.length ? "failed" : "done",
    prs: r.prs.includes(pr) ? r.prs : [...r.prs, pr],
    review: [
      ...r.review,
      {
        sha: git(root, ["rev-parse", "HEAD"]).out,
        verdict: blocking.length ? "FAIL" : "PASS",
        findings: findings.length,
        pr,
        blocking: blocking.map(({ id, file, text }) => ({ id, file, text })),
      },
    ],
  }));
  return { blocking, problems: [] };
}

/** @param {string[]} args */
export function run(args = []) {
  const pr = Number(args[0]);
  const at = args.indexOf("--record");
  const file = at === -1 ? undefined : args[at + 1];
  if (
    !Number.isInteger(pr) ||
    pr < 1 ||
    args.includes("--input") === (at !== -1) ||
    (at !== -1 && !file)
  ) {
    console.error(`usage: ${NAME} review <pr> --input | --record <findings.json>`);
    return 2;
  }
  const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).out || process.cwd();
  try {
    if (!file) {
      console.log(JSON.stringify(reviewInput(root, pr), null, 2));
      return 0;
    }
    if (!existsSync(file)) throw new ReviewError(`${file} does not exist`);
    let findings;
    try {
      findings = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      throw new ReviewError(`${file} is not JSON (${/** @type {Error} */ (error).message})`);
    }
    const { blocking, problems } = recordReview(root, pr, findings);
    for (const p of problems) say("blocked", `${NAME} review: ${p}`);
    if (problems.length) return 2;
    for (const f of blocking)
      say("blocked", `${NAME} review: blocking ${f.id} in ${f.file}: ${f.text}`);
    if (!blocking.length) say("approved", `${NAME} review: #${pr} passes`);
    return blocking.length ? 1 : 0;
  } catch (error) {
    if (!(error instanceof ReviewError || error instanceof RecordError)) throw error;
    say("blocked", `${NAME} review: ${error.message}`);
    return 2;
  }
}
