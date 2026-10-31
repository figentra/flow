/**
 * Figentra Flow file contract:
 * Purpose: the network layer `figentra-flow linear` calls Linear through, vendored unchanged from Stackra core's
 *   `tools/scripts/bot-token.mjs` (STA-302): fetch over an undici Agent with a connect timeout when undici is
 *   installed, retries with backoff for idempotent calls, and `retryUnlessLanded` for writes. The token mint is not
 *   vendored.
 * Boundary: wraps fetch; holds no state between runs.
 * Runtime: node
 * Secrets: none; it never reads, logs or echoes a token.
 */
// linear-sync runs node without `pnpm install`: there the global fetch (10 s connect timeout) keeps only the retries.
const undici = await import("undici").catch((error) => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return null;
  throw error;
});

/**
 * Connect timeout of every GitHub and Linear fetch; undici's 10 s default failed 1 slow connect in 5 (STA-302). It
 * reads 10 s where undici is not installed, so the OP7 gate (`enqueueReady`) stays shut there.
 */
export const CONNECT_TIMEOUT_MS = undici ? 30_000 : 10_000;
/** Tries of an idempotent call, the first included. */
export const RETRY_ATTEMPTS = 4;
/** Ceiling of the first backoff; retry n waits a random 0 to BACKOFF_MS * 2^(n-1) ms. */
const BACKOFF_MS = 500;
const RETRY_STATUS = new Set([502, 503, 504]);
/** Error text that a retry may fix: a fetch rejection, connect timeouts and resets, HTTP 502/503/504 (gh, Linear). */
const TRANSIENT =
  /fetch failed|UND_ERR_(?:CONNECT_TIMEOUT|SOCKET)|ECONNRESET|ETIMEDOUT|EAI_AGAIN|connection reset|i\/o timeout|TLS handshake timeout|timed out|Timeout exceeded|unexpected EOF|HTTP 50[234]\b|Bad Gateway|Service Unavailable|Gateway Time-?out/i;

const dispatcher =
  undici && new undici.Agent({ connectTimeout: CONNECT_TIMEOUT_MS, autoSelectFamily: true });

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** The wait before retry `n` (1, 2, …): exponential backoff with full jitter. */
export const backoff = (n, random = Math.random) =>
  Math.floor(random() * BACKOFF_MS * 2 ** (n - 1));

/** Calls `attempt` until `again(result)` (may be async) is false or RETRY_ATTEMPTS ran, backing off in between. */
async function retry(attempt, again, wait = sleep) {
  let result = await attempt();
  for (let n = 1; n < RETRY_ATTEMPTS && (await again(result)); n++) {
    await wait(backoff(n));
    result = await attempt();
  }
  return result;
}

/**
 * fetch over the Agent. An idempotent call (GET and HEAD by default; pass `idempotent: true` for a POST that is, like a
 * token mint) is retried on a network failure or a 502/503/504; any other call is sent once.
 */
export async function netFetch(url, init = {}, options = {}) {
  const { idempotent = /^(GET|HEAD)$/i.test(init.method ?? "GET"), wait } = options;
  const once = () =>
    (undici ? undici.fetch(url, { ...init, dispatcher }) : fetch(url, init)).then(
      (res) => ({ res }),
      (error) => ({ error }),
    );
  const again = (r) => idempotent && (r.error !== undefined || RETRY_STATUS.has(r.res.status));
  const { res, error } = await retry(once, again, wait);
  if (error) throw error;
  return res;
}

/**
 * A call that is not idempotent (merge, enqueue, comment): after each TRANSIENT failure, the last one included,
 * `landed()` (a fresh read) says whether it landed anyway; only when it did not is the call run again. Resolves to
 * run()'s value, or undefined if it landed. A failing read keeps the call's own error and says the outcome is unknown.
 */
export async function retryUnlessLanded(run, landed, wait = sleep) {
  for (let n = 1; ; n++) {
    let error;
    try {
      return await run();
    } catch (failureError) {
      error = failureError;
    }
    if (!TRANSIENT.test(error.message)) throw error;
    let done;
    try {
      done = await landed();
    } catch (readError) {
      throw new Error(
        `${error.message}; outcome unknown, check it by hand (re-read failed: ${readError.message})`,
        { cause: readError },
      );
    }
    if (done) return undefined;
    if (n >= RETRY_ATTEMPTS) throw error;
    await wait(backoff(n));
  }
}

/**
 * True for a GraphQL document that only reads: after leading whitespace and `#` comments it opens with `query` or `{`.
 * Anything else (a mutation, a subscription, a leading fragment) counts as a write and is never retried.
 * Only the first operation is read: a document holding several operations is not supported here.
 */
export const isGraphqlRead = (document) => /^(?:\s|#[^\n]*\n)*(?:query\b|\{)/.test(document);
