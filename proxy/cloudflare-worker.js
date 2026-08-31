/**
 * Money Monitor — self-hosted quote proxy (Cloudflare Worker).
 *
 * Yahoo Finance doesn't send CORS headers, so the browser needs a proxy. This
 * worker replaces the public proxy chain with one that only YOU control and
 * that only forwards to Yahoo — unlike an open proxy, it can't be used by
 * injected code as a data-exfiltration route, and no third party sees your
 * tickers or can rewrite your prices.
 *
 * Deploy (free tier is plenty — quotes are tiny JSON responses):
 *   1. https://dash.cloudflare.com → Workers & Pages → Create → Worker.
 *   2. Paste this file, adjust ALLOWED_ORIGINS if your app URL differs, Deploy.
 *   3. Note the worker URL, e.g. https://money-monitor-quotes.<you>.workers.dev
 *   4. Point the app at it (a URL prefix the encoded target is appended to):
 *      - GitHub Pages build: repo Settings → Secrets and variables → Actions →
 *        Variables → New: VITE_QUOTES_PROXY = https://<worker-url>/?url=
 *      - Local dev: add the same line to .env.local
 *   5. Push / rebuild. The build narrows the CSP to this worker for you, and
 *      the app stops consulting the public proxies entirely.
 */

// Only these upstream hosts are ever fetched. Everything else → 403.
const ALLOWED_UPSTREAMS = new Set(['query1.finance.yahoo.com', 'query2.finance.yahoo.com'])

// Browser origins allowed to call this worker (CORS). Add localhost for dev.
const ALLOWED_ORIGINS = new Set([
  'https://isaakistarn.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
])

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') ?? ''
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'null',
      Vary: 'Origin',
    }
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors })
    if (request.method !== 'GET') return new Response('method not allowed', { status: 405, headers: cors })

    let target
    try {
      target = new URL(new URL(request.url).searchParams.get('url') ?? '')
    } catch {
      return new Response('bad url', { status: 400, headers: cors })
    }
    if (target.protocol !== 'https:' || !ALLOWED_UPSTREAMS.has(target.hostname)) {
      return new Response('forbidden', { status: 403, headers: cors })
    }

    // Short edge cache keeps repeat quote hits off Yahoo and under rate limits.
    const upstream = await fetch(target, {
      headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (MoneyMonitor quote proxy)' },
      cf: { cacheTtl: 30, cacheEverything: true },
    })
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=30', ...cors },
    })
  },
}
