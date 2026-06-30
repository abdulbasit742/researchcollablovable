-- Platform settings key/value store (#42)
-- Single source of truth for tunable platform config (e.g. commission rate).

create table if not exists public.platform_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.platform_settings enable row level security;

-- Anyone signed in may read settings; only admins write (enforced app-side /
-- via a stricter policy you can add once an is_admin() helper exists).
create policy "read platform settings" on public.platform_settings
  for select using (auth.role() = 'authenticated');
