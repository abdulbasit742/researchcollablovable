-- Seed subscription_tiers (#74)
-- subscriptionService + payments-settle resolve user_subscriptions.tier_id by
-- tier NAME. Without these rows, paid subscriptions get tier_id=null and
-- subscriptionGuard falls back to Free. Idempotent: safe to run repeatedly.

-- Ensure the table exists with the columns we rely on (no-op if already there).
create table if not exists public.subscription_tiers (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  monthly_price numeric not null default 0,
  yearly_price numeric not null default 0,
  currency text not null default 'PKR',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Canonical tiers used by subscriptionService.ts (gating names).
insert into public.subscription_tiers (name, monthly_price, yearly_price, currency)
values
  ('Free',          0,      0,      'PKR'),
  ('Pro',           999,    9990,   'PKR'),
  ('Elite',         2499,   24990,  'PKR'),
  ('Institutional', 14999,  149990, 'PKR'),
  ('Enterprise',    0,      0,      'PKR')
on conflict (name) do update
  set monthly_price = excluded.monthly_price,
      yearly_price  = excluded.yearly_price,
      currency      = excluded.currency,
      is_active     = true;

-- Also seed the revenue/plans.ts catalog names, so checkoutService's plan
-- metadata (tier = plan.name) resolves too. Harmless duplicates by intent.
insert into public.subscription_tiers (name, monthly_price, yearly_price, currency)
values
  ('Student Pro',    1500,  14400,  'PKR'),
  ('Researcher Pro', 3500,  33600,  'PKR'),
  ('Supervisor',     4500,  43200,  'PKR'),
  ('Department',     45000, 432000, 'PKR')
on conflict (name) do update
  set monthly_price = excluded.monthly_price,
      yearly_price  = excluded.yearly_price,
      currency      = excluded.currency,
      is_active     = true;

alter table public.subscription_tiers enable row level security;

-- Tiers are public catalog data: anyone may read, no public write.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'subscription_tiers'
      and policyname = 'read subscription tiers'
  ) then
    create policy "read subscription tiers" on public.subscription_tiers
      for select using (true);
  end if;
end $$;
