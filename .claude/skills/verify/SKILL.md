---
name: verify
description: Build, launch and drive Money Monitor headlessly to verify a change end-to-end (production build + vite preview + Playwright).
---

# Verifying Money Monitor changes

Local-first React PWA (Vite 8, Dexie/IndexedDB). Verify against the
**production build**, driven with Playwright (already a devDependency).

## Build & launch

```powershell
npm run build          # tsc -b && vite build
npm run preview        # serves dist/ at http://localhost:4173/ (run in background)
```

No `base` path is configured — the app is at the server root. Routes are
hash-based: `http://localhost:4173/#/settings`, `#/transactions`, `#/budgets`, …

## Playwright gotchas (all learned the hard way)

- **Run the script from the repo root** — `import { chromium } from 'playwright'`
  won't resolve from a temp dir outside the project.
- **Block the service worker**: `browser.newContext({ serviceWorkers: 'block' })`,
  or `networkidle` never fires and stale precache can serve old code.
- **Skip the onboarding modal** (its backdrop swallows every click): after first
  `goto`, write `{ key: 'onboarded', value: true }` into the `meta` store of the
  `finance-tracker` IndexedDB via raw `indexedDB.open`, then `page.reload()` —
  raw-IDB writes bypass Dexie live queries, so a reload is required.
- **Card locators**: UI cards are `div.bg-surface`. Scope with
  `page.locator('div.bg-surface').filter({ has: page.getByRole('heading', { name: '…' }) })` —
  filtering `div` by an inner heading alone lands on the SectionHeader div,
  which does NOT contain the card body.
- **Modals render in a portal at the end of `<body>`** — `.last()` on a
  page-level locator generally picks the modal's instance over the page's.
- **Backup export**: headless Chromium exposes `showSaveFilePicker` but hangs on
  it — `page.addInitScript(() => { delete window.showSaveFilePicker })` to force
  the download fallback.
- **Seed data**: easiest realistic dataset is clicking "Add samples" on
  Settings (13 transactions, 4 accounts, 5 budgets). Raw-IDB seeding also
  works but needs a reload afterwards.

## Flows worth driving

- Transactions: floating "New" button → modal; amount placeholder `0.00`.
- Settings hosts the managers: Categories, Recurring, Pay splits, Sync,
  Data & Backup (export/import modals), sample-data and clear-data buttons.
- Capture `console` errors (`page.on('console')` + `pageerror`) and fail on any.
