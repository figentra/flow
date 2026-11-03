/**
 * Figentra Flow file contract:
 * Purpose: the YAML subset an agent roster uses, read without a dependency: block maps and lists (a list item may
 *   open a map), flow lists of scalars (`[a, b]`), `{}`, folded and literal block scalars (`>-`, `>`, `|-`, `|`),
 *   single- and double-quoted strings, booleans, integers and `#` comments. Anything else (anchors, tags, nested flow
 *   collections, multi-document files) is refused with its line number, never guessed. `stringifyYaml` writes plain
 *   data back in the same subset (block maps and lists, literal block scalars), which the rendered surfaces use.
 * Boundary: text in, plain data out, and back; reads no file.
 * Runtime: node
 * Governing contract: STA-1729 phase 7 (the agent-team plan stop of 2026-11-01: no new dependency).
 * Secrets: none.
 */

/** `key: value` or `key:`, the key plain or quoted. */
const KEY = /^("[^"]*"|'[^']*'|[^\s"'[{#-][^:]*?|-[^\s:][^:]*?)\s*:(?:\s+(.*))?$/;

/** A YAML text this reader refuses, with the line. */
export class YamlError extends Error {}

/**
 * The text before a `#` comment, outside quotes.
 * @param {string} s
 */
function uncomment(s) {
  let quote = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "#" && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).trimEnd();
  }
  return s.trimEnd();
}

/**
 * One scalar or flow value.
 * @param {string} s
 * @param {number} n the line, for errors
 * @returns {unknown}
 */
function scalar(s, n) {
  if (s === "" || s === "~" || s === "null") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^-?\d+$/.test(s)) return Number(s);
  if (s.startsWith('"')) {
    try {
      return JSON.parse(s);
    } catch {
      throw new YamlError(`line ${n}: a double-quoted string that does not close`);
    }
  }
  if (s.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/.test(s))
      throw new YamlError(`line ${n}: a single-quoted string that does not close`);
    return s.slice(1, -1).replaceAll("''", "'");
  }
  if (s === "{}") return {};
  if (s.startsWith("[")) {
    if (!s.endsWith("]")) throw new YamlError(`line ${n}: a flow list that does not close`);
    const body = s.slice(1, -1).trim();
    if (/[[\]{}]/.test(body)) throw new YamlError(`line ${n}: nested flow collections`);
    if (!body) return [];
    // shortcut: splits on every comma, so a quoted item may not hold one; the roster's items never do.
    return body.split(",").map((item) => scalar(item.trim(), n));
  }
  if (/^[&*!{|>%@`]/.test(s)) throw new YamlError(`line ${n}: \`${s[0]}\` is not supported`);
  return s;
}

/**
 * Parses `text` as the supported YAML subset.
 * @param {string} text
 * @returns {any}
 */
export function parseYaml(text) {
  const raw = text.replace(/\r\n?/g, "\n").split("\n");
  /** @type {{ indent: number, text: string, n: number }[]} */
  const lines = [];
  raw.forEach((line, i) => {
    if (/^\s*(#|$)/.test(line)) return;
    if (line.startsWith("---") || line.startsWith("...")) {
      if (lines.length) throw new YamlError(`line ${i + 1}: more than one document`);
      return;
    }
    if (/^\s*\t/.test(line)) throw new YamlError(`line ${i + 1}: a tab in the indentation`);
    lines.push({ indent: line.search(/\S/), text: uncomment(line.trim()), n: i + 1 });
  });
  let at = 0;

  /**
   * A block scalar's body after the line at `n`: the raw lines indented deeper than `indent`.
   * @param {string} style
   * @param {number} indent
   * @param {number} n
   */
  function block(style, indent, n) {
    /** @type {string[]} */
    const body = [];
    let i = n; // raw index of the line after the header
    for (; i < raw.length; i++) {
      const line = raw[i];
      if (line.trim() && line.search(/\S/) <= indent) break;
      body.push(line);
    }
    while (at < lines.length && lines[at].n <= i) at++;
    while (body.length && !body.at(-1)?.trim()) body.pop();
    const cut = Math.min(...body.filter((l) => l.trim()).map((l) => l.search(/\S/)));
    const kept = body.map((l) => l.slice(cut));
    const joined = style.startsWith(">")
      ? kept.reduce(
          (out, l, k) => (k === 0 ? l : !l || !kept[k - 1] ? `${out}\n${l}` : `${out} ${l}`),
          "",
        )
      : kept.join("\n");
    return style.endsWith("-") ? joined : `${joined}\n`;
  }

  /**
   * The value of a `key:` with nothing after it: a deeper node, a list at the same indent, or null.
   * @param {number} indent
   */
  function child(indent) {
    const next = lines[at];
    if (!next) return null;
    if (next.indent > indent) return node(next.indent);
    if (next.indent === indent && /^-(\s|$)/.test(next.text)) return list(indent);
    return null;
  }

  /** @param {number} indent */
  function node(indent) {
    const { text, n } = lines[at];
    if (/^-(\s|$)/.test(text)) return list(indent);
    if (/^[[{"']/.test(text) && !KEY.test(text)) {
      // a flow or quoted value on its own line under its key
      at++;
      return scalar(text, n);
    }
    return map(indent);
  }

  /** @param {number} indent */
  function map(indent) {
    /** @type {Record<string, unknown>} */
    const out = {};
    while (at < lines.length && lines[at].indent === indent && !/^-(\s|$)/.test(lines[at].text)) {
      const { text, n } = lines[at];
      const m = text.match(KEY);
      if (!m) throw new YamlError(`line ${n}: expected \`key: value\``);
      const key = String(scalar(m[1], n));
      if (key in out) throw new YamlError(`line ${n}: \`${key}\` appears twice`);
      at++;
      const value = m[2] ?? "";
      out[key] = /^[>|]-?$/.test(value)
        ? block(value, indent, n)
        : value === ""
          ? child(indent)
          : scalar(value, n);
    }
    if (at < lines.length && lines[at].indent > indent)
      throw new YamlError(`line ${lines[at].n}: unexpected indentation`);
    return out;
  }

  /** @param {number} indent */
  function list(indent) {
    /** @type {unknown[]} */
    const out = [];
    while (at < lines.length && lines[at].indent === indent && /^-(\s|$)/.test(lines[at].text)) {
      const line = lines[at];
      const rest = line.text.slice(1).trimStart();
      if (!rest) {
        at++;
        out.push(child(indent));
      } else if (KEY.test(rest)) {
        // `- key: value` opens a map whose keys sit where `key` starts.
        lines[at] = { ...line, indent: indent + line.text.indexOf(rest), text: rest };
        out.push(map(lines[at].indent));
      } else {
        at++;
        out.push(scalar(rest, line.n));
      }
    }
    return out;
  }

  if (!lines.length) return null;
  const value = node(lines[0].indent);
  if (at < lines.length) throw new YamlError(`line ${lines[at].n}: unexpected indentation`);
  return value;
}

/** A string any YAML reader reads back as itself without quotes. */
const PLAIN = /^(?:[A-Za-z_/$]|-[A-Za-z-])[\w./@$<>=?+,() -]*$/;
/** Plain words some YAML reader takes for a boolean or null. */
const RESERVED = /^(?:true|false|yes|no|on|off|null|y|n)$/i;

/**
 * One scalar on its line: plain when safe, else double-quoted (a JSON string is a YAML one).
 * @param {unknown} value
 */
function scalarText(value) {
  if (typeof value !== "string") return JSON.stringify(value ?? null);
  return PLAIN.test(value) && !value.endsWith(" ") && !RESERVED.test(value)
    ? value
    : JSON.stringify(value);
}

/** @param {unknown} value */
const isNode = (value) =>
  value !== null && typeof value === "object" && Object.keys(value).length > 0;

/**
 * `head` and a scalar: a multi-line string as a literal block scalar when it reads back unchanged, else one line.
 * @param {string} head
 * @param {unknown} value
 * @param {string} pad the indent of `head`'s key
 * @returns {string[]}
 */
function field(head, value, pad) {
  if (
    typeof value === "string" &&
    value.includes("\n") &&
    /^\S/.test(value) &&
    !/\n\n$|\r|\t|\n +(?:\n|$)/.test(value)
  ) {
    const keep = value.endsWith("\n");
    const body = (keep ? value.slice(0, -1) : value).split("\n");
    return [`${head} ${keep ? "|" : "|-"}`, ...body.map((l) => (l ? `${pad}  ${l}` : ""))];
  }
  return [`${head} ${scalarText(value)}`];
}

/**
 * The lines of a non-empty map or list at `pad`.
 * @param {any} value
 * @param {string} pad
 * @returns {string[]}
 */
function blockLines(value, pad) {
  if (Array.isArray(value))
    return value.flatMap((item) => {
      if (!isNode(item)) return [`${pad}- ${scalarText(item)}`];
      const [first, ...rest] = blockLines(item, `${pad}  `);
      return [`${pad}- ${first.trimStart()}`, ...rest];
    });
  return Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .flatMap(([k, v]) => {
      const key = /^[A-Za-z0-9_][\w.-]*$/.test(k) ? k : JSON.stringify(k);
      return isNode(v) ? [`${pad}${key}:`, ...blockLines(v, `${pad}  `)] : field(`${pad}${key}:`, v, pad);
    });
}

/**
 * `value` (a map or list of plain data) as YAML that `parseYaml` and any YAML reader read back as `value`.
 * @param {Record<string, unknown> | unknown[]} value
 * @returns {string}
 */
export function stringifyYaml(value) {
  return isNode(value) ? `${blockLines(value, "").join("\n")}\n` : `${scalarText(value)}\n`;
}
