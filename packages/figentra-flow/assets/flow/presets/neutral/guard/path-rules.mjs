/**
 * The neutral preset's path rules for the guard engine: generic secret files are never read, searched or written by
 * an agent (`.env*` except `*.example`, `.dev.vars`, `*.pem`, `*.key`, SSH keys, `*.secrets*`). A preset with its own
 * `guard/path-rules.mjs` keeps them by spreading this table into its own.
 */

/** Files that hold secret values. */
const SECRET_FILE = [
  /(^|\/)\.env(\.[^/]*)?$/i,
  /(^|\/)\.dev\.vars$/i,
  /(^|\/)[^/]*\.secrets[^/]*$/i,
  /\.(?:pem|key)$/i,
  /(^|\/)id_(?:rsa|dsa|ecdsa|ed25519)(?:_[^/.]*)?$/,
];
/** Examples of a secret file hold names only. */
const SECRET_OK = /(^|\/)\.env(\.[^/]*)?\.example$/;

/**
 * True when `p` names a file that holds secret values.
 * @param {string} p
 */
export function isSecretPath(p) {
  const s = p.trim().replaceAll(/^['"]+|['"]+$/g, "");
  return !SECRET_OK.test(s) && SECRET_FILE.some((r) => r.test(s));
}

/** @type {import("../../../../../src/guard/paths.mjs").PathRule[]} */
export const PATH_RULES = [
  {
    id: "secret-file",
    match: isSecretPath,
    reason:
      "Secrets guard: this file holds secret values and is never read, searched or written by an agent. Names only; a human sets the values.",
  },
];
