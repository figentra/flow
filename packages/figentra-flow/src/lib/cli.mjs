/**
 * Figentra Flow file contract:
 * Purpose: the CLI kit every command prints its verdict through: the Flow glyph's five ASCII states (waiting,
 *   checking, approved, blocked, shipped) as a 14-column prefix, in the glyph's magenta (ANSI 256 colour 162), with
 *   only the blocked state's `x x` and `|` in the terminal's error red. Plain under NO_COLOR, under TERM=dumb or when
 *   the stream is not a TTY; FORCE_COLOR turns colour on anyway.
 * Boundary: formatting only; the caller picks the stream. The states are the brand's (figentra/brand
 *   `brands/flow/logo/glyph/ascii.json`, brand-flow 1.0.0); change them there first.
 * Runtime: node
 * Governing contract: STA-1729 (the leader's CLI kit, after phase 4).
 * Secrets: none.
 */

/** The glyph's states: `*` a finished stage, `.` a pending one, the parentheses the capsule. Never mirrored in RTL. */
export const GLYPHS = {
  waiting: ". . (- -)",
  checking: "* . (o o)",
  approved: "* * (^ ^)",
  blocked: "* . (x x)|",
  shipped: "* * * (^ ^)=>",
};

/** The prefix's width, glyph included. */
export const GLYPH_PAD = 14;

const MAGENTA = "\u001B[38;5;162m";
const RED = "\u001B[31m";
const RESET = "\u001B[0m";

/**
 * Whether to colour what goes to `stream`.
 * @param {{ isTTY?: boolean }} stream
 * @param {Record<string, string | undefined>} [env]
 */
export function colorFor(stream, env = process.env) {
  if (env.NO_COLOR) return false;
  if (env.FORCE_COLOR && env.FORCE_COLOR !== "0") return true;
  return Boolean(stream.isTTY) && env.TERM !== "dumb";
}

/**
 * One state as a padded prefix.
 * @param {keyof typeof GLYPHS} state
 * @param {boolean} [color]
 */
export function glyph(state, color = false) {
  const plain = GLYPHS[state];
  const pad = " ".repeat(GLYPH_PAD - plain.length);
  if (!color) return plain + pad;
  const body =
    state === "blocked" ? `${MAGENTA}* . (${RED}x x${MAGENTA})${RED}|` : `${MAGENTA}${plain}`;
  return `${body}${RESET}${pad}`;
}

/**
 * Writes `text` behind a state's glyph to `stream` (stderr by default: a verdict is for people, stdout for scripts).
 * @param {keyof typeof GLYPHS} state
 * @param {string} text
 * @param {{ write: (s: string) => unknown, isTTY?: boolean }} [stream]
 * @param {Record<string, string | undefined>} [env]
 */
export function say(state, text, stream = process.stderr, env = process.env) {
  stream.write(`${glyph(state, colorFor(stream, env))}${text}\n`);
}

/**
 * The glyph state of a `fflow/gate` commit status, or of none.
 * @param {string | undefined} state
 * @returns {keyof typeof GLYPHS}
 */
export function gateGlyph(state) {
  if (state === "success") return "approved";
  if (state === "pending") return "checking";
  if (state === "failure" || state === "error") return "blocked";
  return "waiting";
}
