-- Money Monitor — Supabase sync schema.
-- Run this once in your Supabase project: Dashboard → SQL Editor → paste → Run.
--
-- One generic table holds every synced row (accounts, categories, transactions,
-- budgets, recurring) as JSON. Row Level Security ties each row to its owner, so
-- the public anon key shipped in the frontend can never read another user's data.

create table if not exists public.records (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  tbl        text        not null,
  row_id     text        not null,
  data       jsonb,
  deleted    boolean     not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, tbl, row_id)
);

-- The server stamps updated_at on every write, so the pull cursor advances on a
-- single consistent clock regardless of device clock skew.
create or replace function public.records_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists records_touch on public.records;
create trigger records_touch
  before insert or update on public.records
  for each row execute function public.records_touch_updated_at();

-- Fast "changes since cursor" lookups, scoped per user.
create index if not exists records_user_updated_idx
  on public.records (user_id, updated_at);

-- Lock the table down: a user may only see and write their own rows.
alter table public.records enable row level security;

drop policy if exists "records are private to owner" on public.records;
create policy "records are private to owner"
  on public.records
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Hardening guardrails (safe to run on an existing table). Even an
-- authenticated session can then only write rows shaped like real app data:
--  · tbl is constrained to the tables the app actually syncs, and
--  · a single row's JSON payload is capped, so a stolen password can't be used
--    to bloat the project with junk data.
alter table public.records
  drop constraint if exists records_tbl_allowed,
  add constraint records_tbl_allowed check (tbl in
    ('accounts','categories','transactions','budgets','recurring','paySplits','holdings','watchlist'));

alter table public.records
  drop constraint if exists records_data_size,
  add constraint records_data_size check (data is null or pg_column_size(data) < 100000);

-- Also review Supabase Dashboard → Auth settings (not expressible in SQL):
--   · minimum password length ≥ 10 + leaked-password protection,
--   · CAPTCHA on sign-up/sign-in — or disable public sign-ups entirely once
--     your own devices are enrolled (this is a personal app).
