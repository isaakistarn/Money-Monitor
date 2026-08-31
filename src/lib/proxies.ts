/**
 * CORS proxy front-ends used to reach Yahoo Finance from the browser.
 *
 * Yahoo sends no CORS headers, so every request goes through a proxy. Each
 * entry is a URL PREFIX that takes a percent-encoded target URL appended to it
 * (`…?url=<encoded>` / `…?quest=<encoded>`), so one call site works for all.
 *
 * The list is a FAILOVER CHAIN, not a preference: free proxies come and go
 * (corsproxy.io started demanding an API key and began answering HTTP 401,
 * which is what broke live prices), so the app walks the chain until one
 * answers and then sticks with it for the session. See `quotes.ts`.
 *
 * Treat this as best-effort. Every entry is someone else's free service with a
 * shared quota, so all three can be rate-limited or down at once — which is why
 * `VITE_QUOTES_PROXY` (proxy/cloudflare-worker.js, DEPLOY.md Part 3) is the
 * supported way to get prices that reliably work.
 *
 * This module is deliberately dependency-free (no `import.meta.env`) so
 * `vite.config.ts` can import it at build time to derive the CSP allow-list.
 */
export const FALLBACK_PROXIES: readonly string[] = [
  // Verified from a real browser origin, not just curl: several proxies answer
  // curl happily but omit `Access-Control-Allow-Origin`, or redirect in a way
  // that drops it, and only fail once a browser is doing the asking.
  // (`api.cors.lol/?url=` is one such — its `/v1` endpoint is the usable one.)
  'https://api.cors.lol/v1?url=',
  'https://api.allorigins.win/raw?url=',
  'https://api.codetabs.com/v1/proxy?quest=',
]

/** Distinct origins of a proxy list — the hosts a CSP `connect-src` must allow. */
export function proxyOrigins(list: readonly string[] = FALLBACK_PROXIES): string[] {
  return [...new Set(list.map((p) => new URL(p).origin))]
}
