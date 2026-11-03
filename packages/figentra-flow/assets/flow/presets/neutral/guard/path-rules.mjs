/**
 * The neutral preset's path rules for the guard engine: generic secret files are never read, searched or written by
 * an agent (`.env*` except `*.example`, `.dev.vars`, `*.pem`, `*.key`, SSH keys, `*.secrets*`), and `flow.config.json`
 * (or its legacy name) is never written by one. The engine checks them for every preset after the preset's own table
 * (`decidePaths`, FR-5), so a preset's `guard/path-rules.mjs` cannot drop them.
 */
import { CONFIG_FILE, LEGACY_CONFIG_FILE } from "../../../../../src/lib/product.mjs";

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
  {
    id: "flow-config",
    writes: true,
    // The legacy name is still read (and both at once is an error), so it picks the preset too.
    match: (p) => {
      const name = p.split("/").at(-1)?.toLowerCase();
      return name === CONFIG_FILE || name === LEGACY_CONFIG_FILE;
    },
    reason: `${CONFIG_FILE} picks the preset, and so the guard's own tables: only the owner changes it.`,
  },
];
