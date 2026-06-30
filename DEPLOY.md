# Deploying Money Monitor + enabling cross-device sync

Two independent parts:

1. **Host it on GitHub Pages** so you can open it on your phone over HTTPS and
   "Add to Home Screen" as an installable app.
2. **Turn on Supabase sync** so the same data appears on every device you sign
   in on.

You can do part 1 alone (the app works fully offline, data stays on each
device). Part 2 layers sync on top.

---

## Part 1 — Publish to GitHub Pages

### 1.1 Put the project on GitHub

From the project folder:

```bash
git init
git add -A
git commit -m "Money Monitor"
git branch -M main
git remote add origin https://github.com/isaakistarn/Money-Monitor.git
git push -u origin main
```

> This repo is **Money-Monitor**, so the site will be served from
> `/Money-Monitor/` — the CI workflow sets that base path automatically.

### 1.2 Enable Pages

On GitHub: **Settings → Pages → Build and deployment → Source = GitHub Actions**.

That's it. The included workflow (`.github/workflows/deploy.yml`) builds the app
and deploys it on every push to `main`. It automatically sets the correct base
path (`/<repo>/`) so assets resolve on a project site.

Your app will be live at:

```
https://<you>.github.io/<repo>/
```

> Using a custom domain or a `*.github.io` **user** site (repo named
> `<you>.github.io`)? The base path is just `/` — set repo **Variables →**
> `VITE_BASE` to `/`, or it'll be inferred from the repo name.

### 1.3 Install on your phone

Open the URL on your phone:

- **iOS Safari:** Share → **Add to Home Screen** → Add.
- **Android Chrome:** menu → **Install app** (or the install banner).

It launches full-screen and works offline.

---

## Part 2 — Enable sync with Supabase

### 2.1 Create a Supabase project

1. Sign up at [supabase.com](https://supabase.com) (free tier is plenty).
2. **New project** → pick a name, a strong database password, a region near you.
3. Wait ~2 minutes for it to provision.

### 2.2 Create the sync table

In the project: **SQL Editor → New query**, paste the contents of
[`supabase/schema.sql`](./supabase/schema.sql), and **Run**. This creates the
`records` table with Row Level Security so each user only ever sees their own
data.

### 2.3 Get your keys

**Project Settings → API**:

- **Project URL** → `VITE_SUPABASE_URL`
- **Project API keys → `anon` `public`** → `VITE_SUPABASE_ANON_KEY`

The `anon` key is meant to be public in a frontend build — RLS is what protects
the data. **Never** use the `service_role` key here.

### 2.4 (Recommended) Simpler sign-up

By default Supabase requires email confirmation. For a personal app you can turn
it off so sign-up is instant: **Authentication → Providers → Email →** disable
**"Confirm email"**. (Leave it on if you prefer the extra step.)

### 2.5 Give the keys to the build

**Local development** — create `.env.local` (see `.env.example`):

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...
```

Then `npm run dev`. The Settings → **Sync across devices** card becomes active.

**GitHub Pages** — add the keys as repository secrets so the deployed build
includes them: **Settings → Secrets and variables → Actions → New repository
secret**, add both:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Push again (or re-run the workflow) and the live site will have sync enabled.

### 2.6 Use it

On each device: open the app → **Settings → Sync across devices** → create an
account (or sign in). Sync runs automatically — on sign-in, shortly after each
change, on app focus, and every minute. There's also a **Sync now** button.

> **First-time tip:** set up sync on your main device first and let it sync once.
> On a second device, **sign in before adding data** — it'll pull everything
> down. Both devices share the same starter categories by design, so they won't
> duplicate.

---

## How sync works (and its limits)

- Each change is recorded locally and pushed to Supabase; other devices pull it.
- Conflicts resolve **last-write-wins** by edit time. Every sync **pulls before
  pushing**, so a device reconciles with the server before publishing — which
  makes last-write-wins behave correctly across devices.
- It is **not** real-time collaborative editing. If you edit the *same* item on
  two devices while both are offline, the later edit wins when they reconnect.
- Derived data (balances, monthly totals) is **recomputed locally** after each
  pull, so it never drifts.
- Sync is optional and additive: with no keys configured the app is 100% local,
  exactly as before, and the Sync card says so.
