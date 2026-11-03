/**
 * Figentra Flow file contract:
 * Purpose: the independent AI review of Stackra ADR 0230, as `fflow land` reads it: the counted verdict on a PR's
 *   head from a listed reviewer App (one slug or a list; matched by App identity, never a login string), unedited,
 *   first line `AI-REVIEW: PASS <40-hex head> base=<base>`, never from the PR's author or the head commit's author or
 *   committer; or the owner's APPROVED review on the head with the `owner-approval` token. A FAIL for the head beats
 *   any PASS.
 * Boundary: pure; ported from Stackra core's `tools/scripts/pr-merge.mjs` (`aiReview`, `byReviewerApp`, `actor`,
 *   `ownerApproves`), without its patch-id survival: `land` merges the exact head, so a verdict must name that head.
 * Runtime: node
 * Governing contract: Stackra ADR 0230 (reviewer identity), ADR 0285; STA-1729 phase 3 (AC-031).
 * Secrets: none.
 */

// Optional `role=<id> session=<name>` (a quoted name may hold spaces) name the reviewer for a roster (AC-051).
const VERDICT_LINE =
  /^AI-REVIEW:\s*(PASS|FAIL)\s+([0-9a-f]{40})(?:\s+base=(\S+))?(?:\s+patch=([0-9a-f]{40}))?(?:\s+role=([\w.-]+))?(?:\s+session=("[^"]*"|\S+))?\s*$/i;
const OWNER_TOKEN = /(?:^|\s)owner-approval\s*$/;
// A FAIL is read loosely so a sloppy FAIL still blocks; only a 7+ hex token that is not a prefix of the head marks it
// as a FAIL for an older commit, which a new commit clears.
const LOOSE_FAIL = /^\W*AI-REVIEW\W*FAIL(?:ED)?\b\W*(\w*)/i;
const HEX_TOKEN = /^[0-9a-f]{7,40}$/i;
const failForHead = (/** @type {string} */ token, /** @type {string} */ sha) => {
  const t = token.toLowerCase();
  return !HEX_TOKEN.test(t) || sha.startsWith(t);
};

/** One login form for users and apps: `app/stackra-bot`, `stackra-bot[bot]` and `stackra-bot` are the same actor. */
export const actor = (login = "") =>
  login
    .replace(/^app\//, "")
    .replace(/\[bot\]$/, "")
    .toLowerCase();

/** A REST issue comment written by a listed reviewer App itself, not by an account that only shares its name. */
export const byReviewerApp = (/** @type {any} */ c, /** @type {string | string[]} */ reviewer) =>
  c.user?.type === "Bot" && [reviewer].flat().includes(c.performed_via_github_app?.slug);

/** A REST pull request review approving `sha` by the owner user with the `owner-approval` token. */
export const ownerApproves = (
  /** @type {any} */ r,
  /** @type {string} */ sha,
  /** @type {string} */ owner,
) =>
  r.user?.type === "User" &&
  r.user.login === owner &&
  r.state === "APPROVED" &&
  r.commit_id === sha &&
  OWNER_TOKEN.test((r.body ?? "").trim());

/**
 * The counted verdict on `sha` from the REST issue `comments` and pull `reviews`, and why other verdicts were
 * ignored. `authors` holds the PR author and the head commit's author and committer: none may review their change.
 * @param {{ sha: string, base: string }} pr
 * @param {any[]} comments
 * @param {any[]} reviews
 * @param {(string | undefined)[]} authors
 * @param {{ reviewer: string | (string | undefined)[] | undefined, owner?: string }} identities the reviewer App
 *   slugs (today only `apps.review.slug`; the Flow App's slug joins only once its key is reachable solely from main's
 *   OIDC workflow, ADR 0523) and `apps.owner`; with no reviewer nothing counts, with no owner no owner review counts
 * @returns {{ verdict: "PASS" | "FAIL" | null, ignored: string[],
 *            passes: { role: string | null, session: string | null }[] }} `passes`: who signed each counted reviewer PASS
 */
export function aiReview(pr, comments, reviews, authors, { reviewer: listed, owner }) {
  // An unset or empty slug drops out, so an empty list means no reviewer is configured.
  const reviewer = /** @type {string[]} */ ([listed ?? []].flat().filter(Boolean));
  const names = reviewer.join(" or ");
  if (!reviewer.length)
    return {
      verdict: null,
      ignored: ["no review App is configured (apps.review.slug)"],
      passes: [],
    };
  const { sha, base: target } = pr;
  const self = new Set(authors.filter(Boolean).map((a) => actor(a)));
  /** @type {string[]} */
  const ignored = [];
  // An edit to any reviewer comment voids every reviewer verdict posted before it. No body exempts an edit: the
  // body is what the editor controls, so an edited FAIL could otherwise pose as an exempt comment.
  const voidBefore =
    comments
      .filter((c) => byReviewerApp(c, reviewer) && c.updated_at !== c.created_at)
      .map((c) => String(c.updated_at))
      .toSorted()
      .at(-1) ?? "";
  const verdicts = new Set();
  /** @type {{ role: string | null, session: string | null }[]} */
  const passes = [];
  for (const c of comments) {
    const line = String(c.body ?? "")
      .trim()
      .split("\n")[0]
      .trim();
    const match = VERDICT_LINE.exec(line);
    const loose = match ? null : LOOSE_FAIL.exec(line);
    if (match ? match[2].toLowerCase() !== sha : !loose || !failForHead(loose[1], sha)) continue;
    const who = c.user?.login ?? "unknown";
    const [, kind, , base] = match ?? [line, "FAIL"];
    if (!byReviewerApp(c, reviewer)) ignored.push(`${who} is not the ${names} app`);
    else if (self.has(actor(who))) ignored.push(`${who} authored this change and cannot review it`);
    else if (c.updated_at !== c.created_at) ignored.push(`a verdict by ${who} was edited`);
    else if (String(c.created_at) < voidBefore)
      ignored.push(`a ${names} comment was edited after this verdict; post a new one`);
    else if (kind.toUpperCase() === "PASS" && base !== target)
      ignored.push(`a PASS names base ${base ?? "none"}, the PR targets ${target}`);
    else {
      verdicts.add(kind.toUpperCase());
      if (kind.toUpperCase() === "PASS" && match)
        passes.push({ role: match[5] ?? null, session: match[6]?.replace(/^"|"$/g, "") ?? null });
    }
  }
  const ownerOk =
    owner !== undefined &&
    !self.has(actor(owner)) &&
    reviews.some((r) => ownerApproves(r, sha, owner));
  const verdict = verdicts.has("FAIL") ? "FAIL" : verdicts.has("PASS") || ownerOk ? "PASS" : null;
  return { verdict, ignored, passes };
}
