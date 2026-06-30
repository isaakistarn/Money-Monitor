# Money Monitor

A fast, private, **local-first** personal finance PWA. No backend required —
all data lives in your browser via IndexedDB. Optional Supabase sync can mirror
it across your devices (see [DEPLOY.md](./DEPLOY.md)).

## Highlights

- **Dashboard** — Net Worth, Spendable Cash, monthly income/expenses, top spending, recent activity, income-vs-expenses trend.
- **Transactions** — income, expense, and **transfers** (transfers never pollute income/expense or budgets). Search, filter, sort, and a virtualized list that stays smooth at 50k+ rows.
- **Budgets** — monthly per-category limits with progress bars (amber ≥90%, red ≥100%).
- **Accounts** — cash / bank / savings (assets) and credit cards (liabilities), with derived balances.
- **Analytics** — spending pie, income/expense lines, monthly comparison bars.
- **Recurring** — subscriptions, rent, salary surfaced as one-tap confirmations when due.
- **Backup** — export/import JSON, persistent-storage request, and a nudge when you haven't backed up.
- **Sync** (optional) — sign in to mirror data across devices via Supabase, last-write-wins, offline-friendly.
- **PWA** — installable, offline, dark/light themes, mobile bottom-nav + desktop sidebar, keyboard shortcuts.

## Architecture notes

- **Money** is stored as integer minor units (pence/cents) — never floats.
- **Balances are derived**: `openingBalance + signed sum of transactions`.
- **Rollup tables** (`accountRollup`, `monthlyStats`, `categoryMonthly`) are updated
  atomically with every write in `src/db/repo.ts`, so dashboards/charts read O(1)
  aggregates instead of scanning the transaction table. `rebuildRollups()` recomputes
  them after an import.

## Run

```bash
npm install
npm run dev        # start dev server
npm run build      # typecheck + production build
npm run preview    # preview the production build (PWA/service worker active here)
```

> The service worker is disabled in `dev`. Use `npm run build && npm run preview`
> to test installability and offline behaviour.

## Keyboard shortcuts (desktop)

- `N` — new transaction
- `/` — jump to search
- `Esc` — close a modal
